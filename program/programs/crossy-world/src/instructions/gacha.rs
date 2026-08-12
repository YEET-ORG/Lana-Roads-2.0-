//! Gacha: request -> authenticated VRF assignment -> claim mint, with
//! five-minute timeout refunds. Pity-then-weighted selection without modulo
//! bias; inventory reservation and pity updates are atomic with assignment;
//! a valid assigned result is never rerolled or refunded on preference.
//!
//! Variant eligibility snapshot: the callback receives the candidate variant
//! accounts as remaining accounts in variant_id order; the program filters
//! eligibility deterministically (active, in-stock, matching rarity) and
//! selects uniformly among them. The pull's inventory_revision guards
//! against concurrent-assignment races: mismatch => refundable, never
//! silently newer odds.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TransferChecked};

use crate::constants::{seeds, GACHA_TIMEOUT_SECONDS, USDC_DECIMALS};
use crate::errors::CrossyError;
use crate::events::*;
use crate::external::mpl_core;
use crate::kernel::pity::{self, PityCounters};
use crate::kernel::sampling::{self, Rarity, SelectionRng};
use crate::kernel::time;
use crate::state::config::pause;
use crate::state::*;

/// Mint authority PDA for gacha claims (collection authority delegate).
pub const MINT_AUTHORITY_SEED: &[u8] = b"mint_authority";
/// Gacha vault authority PDA.
pub const GACHA_VAULT_AUTHORITY_SEED: &[u8] = b"gacha_vault_authority";

// ---------------------------------------------------------------------------
// request_pull
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RequestPull<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = !config.is_paused(pause::GACHA) @ CrossyError::Paused
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        seeds = [seeds::SEASON, &season.season_index.to_le_bytes()],
        bump = season.bump,
    )]
    pub season: Box<Account<'info, Season>>,
    #[account(
        mut,
        seeds = [seeds::BANNER, &season.season_index.to_le_bytes(), &[banner.tier]],
        bump = banner.bump,
        constraint = banner.status == BannerStatus::Active @ CrossyError::Paused
    )]
    pub banner: Box<Account<'info, Banner>>,
    #[account(
        mut,
        seeds = [seeds::PLAYER, wallet.key().as_ref()],
        bump = profile.bump,
        constraint = profile.wallet == wallet.key() @ CrossyError::NotWallet
    )]
    pub profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        init,
        payer = wallet,
        space = 8 + GachaPull::INIT_SPACE,
        seeds = [seeds::PULL, wallet.key().as_ref(), &profile.pull_count.to_le_bytes()],
        bump
    )]
    pub pull: Box<Account<'info, GachaPull>>,
    /// CHECK: gacha vault authority PDA.
    #[account(seeds = [GACHA_VAULT_AUTHORITY_SEED], bump)]
    pub gacha_vault_authority: UncheckedAccount<'info>,
    /// Gacha vault token account (held pending until assignment/refund).
    #[account(
        init_if_needed,
        payer = wallet,
        token::mint = usdc_mint,
        token::authority = gacha_vault_authority,
        seeds = [seeds::GACHA_VAULT],
        bump
    )]
    pub gacha_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = payer_token.owner == wallet.key() @ CrossyError::WrongTokenOwner,
        constraint = payer_token.mint == config.usdc_mint @ CrossyError::WrongMint
    )]
    pub payer_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint @ CrossyError::WrongMint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: configured token program.
    #[account(address = config.token_program @ CrossyError::WrongTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
    // remaining_accounts: every active VariantInventory of the season, in
    // variant_id order — used to prove pity inventory availability and
    // snapshot effective weights.
}

pub fn request_pull<'info>(ctx: Context<'info, RequestPull<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let today = time::utc_day_from_unix(now).ok_or(CrossyError::Overflow)?;
    let season = &ctx.accounts.season;
    require!(
        today >= season.start_day && today < season.end_day,
        CrossyError::DayNotOpen
    );

    let banner = &ctx.accounts.banner;
    let tier = banner.tier as usize;
    let counters = PityCounters {
        epic_misses: ctx.accounts.profile.pity[tier].epic_misses,
        legendary_misses: ctx.accounts.profile.pity[tier].legendary_misses,
    };

    // Availability per rarity across the season's variants (remaining accts).
    let mut available = [false; 4];
    let mut seen: u16 = 0;
    for info in ctx.remaining_accounts.iter() {
        let variant: Account<VariantInventory> = Account::try_from(info)?;
        require!(
            variant.season == season.season_index,
            CrossyError::StaleInventory
        );
        seen = seen.checked_add(1).ok_or(CrossyError::Overflow)?;
        if variant.active && variant.available() > 0 {
            available[variant.rarity as usize] = true;
        }
    }
    // The full season inventory must be presented (no cherry-picking).
    require!(seen == season.variant_count, CrossyError::StaleInventory);

    // Pity guarantee must be satisfiable: if the pity floor's inventory is
    // unavailable, the banner rejects payment instead of violating pity.
    if let Some(floor) = pity::pity_override(counters) {
        let ok = match floor {
            Rarity::Legendary => available[3],
            Rarity::Epic => available[2] || available[3],
            _ => true,
        };
        require!(ok, CrossyError::PityInventoryUnavailable);
    }
    let effective =
        sampling::effective_weights(banner.base_weights, available).map_err(|e| error!(e))?;

    // Exact banner price into the gacha vault (pending team revenue).
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.payer_token.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.gacha_vault.to_account_info(),
                authority: ctx.accounts.wallet.to_account_info(),
            },
        ),
        banner.price,
        USDC_DECIMALS,
    )?;

    let pull = &mut ctx.accounts.pull;
    pull.player = ctx.accounts.wallet.key();
    pull.season = season.season_index;
    pull.tier = banner.tier;
    pull.pull_nonce = ctx.accounts.profile.pull_count;
    pull.price = banner.price;
    pull.effective_weights = effective;
    pull.epic_misses_snapshot = counters.epic_misses;
    pull.legendary_misses_snapshot = counters.legendary_misses;
    pull.inventory_revision = banner.inventory_revision;
    pull.requested_at = now;
    pull.request_generation = 1;
    pull.state = PullState::Pending;
    pull.bump = ctx.bumps.pull;

    let profile = &mut ctx.accounts.profile;
    profile.pull_count = profile
        .pull_count
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;

    emit!(PullRequested {
        pull: pull.key(),
        wallet: pull.player,
        season: pull.season,
        tier: pull.tier,
        pull_nonce: pull.pull_nonce,
        price: pull.price,
        inventory_revision: pull.inventory_revision,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// assign_pull — authenticated randomness callback
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct AssignPull<'info> {
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        seeds = [seeds::SEASON, &pull.season.to_le_bytes()],
        bump = season.bump,
    )]
    pub season: Box<Account<'info, Season>>,
    #[account(
        mut,
        seeds = [seeds::BANNER, &pull.season.to_le_bytes(), &[pull.tier]],
        bump = banner.bump,
    )]
    pub banner: Box<Account<'info, Banner>>,
    #[account(
        mut,
        seeds = [seeds::PLAYER, pull.player.as_ref()],
        bump = profile.bump,
    )]
    pub profile: Box<Account<'info, PlayerProfile>>,
    #[account(
        mut,
        seeds = [seeds::PULL, pull.player.as_ref(), &pull.pull_nonce.to_le_bytes()],
        bump = pull.bump,
        constraint = pull.state == PullState::Pending @ CrossyError::AlreadyTerminal
    )]
    pub pull: Box<Account<'info, GachaPull>>,
    /// The variant that will be reserved (selected deterministically; the
    /// handler re-derives the selection and requires this account to match).
    #[account(
        mut,
        seeds = [seeds::VARIANT, &pull.season.to_le_bytes(), &selected_variant.variant_id.to_le_bytes()],
        bump = selected_variant.bump,
    )]
    pub selected_variant: Box<Account<'info, VariantInventory>>,
    /// Team treasury: assignment finalizes the revenue.
    #[account(mut, address = config.team_treasury @ CrossyError::WrongTreasury)]
    pub team_treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: gacha vault authority PDA.
    #[account(seeds = [GACHA_VAULT_AUTHORITY_SEED], bump)]
    pub gacha_vault_authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [seeds::GACHA_VAULT], bump)]
    pub gacha_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint @ CrossyError::WrongMint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    /// The authenticated randomness identity fixed in config.
    #[account(address = config.vrf_authority @ CrossyError::BadVrfAuthority)]
    pub vrf_authority: Signer<'info>,
    /// CHECK: configured token program.
    #[account(address = config.token_program @ CrossyError::WrongTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
    // remaining_accounts: every active VariantInventory of the season in
    // variant_id order (same set as request), for deterministic selection.
}

pub fn assign_pull<'info>(
    ctx: Context<'info, AssignPull<'info>>,
    generation: u16,
    randomness: [u8; 32],
) -> Result<()> {
    let pull_key = ctx.accounts.pull.key();
    let pull = &mut ctx.accounts.pull;
    // Bind to the exact live generation (refund invalidates it; a late
    // callback from an older generation must fail).
    require!(
        pull.request_generation == generation,
        CrossyError::BadGeneration
    );
    // Concurrent-assignment protection: the snapshot revision must still
    // hold, otherwise the pull becomes refundable instead of silently using
    // newer odds.
    if ctx.accounts.banner.inventory_revision != pull.inventory_revision {
        pull.state = PullState::Refundable;
        emit!(PaymentRefundable {
            receipt: pull_key,
            amount: pull.price
        });
        return Ok(());
    }

    // Deterministic selection domain-separated by the pull identity.
    let domain = (pull.player.to_bytes()[0] as u64) << 32 | pull.pull_nonce as u64;
    let mut rng = SelectionRng::new(&randomness, domain);

    let counters = PityCounters {
        epic_misses: pull.epic_misses_snapshot,
        legendary_misses: pull.legendary_misses_snapshot,
    };
    let floor = pity::pity_override(counters);
    let rolled = sampling::select_rarity(&mut rng, pull.effective_weights);
    let rarity = pity::enforce_floor(rolled, floor);

    // Deterministic eligible set: active, in-stock variants of `rarity` in
    // variant_id order from the remaining accounts (full season set).
    let season = &ctx.accounts.season;
    let mut eligible: Vec<(u16, Pubkey, u32)> = Vec::new();
    let mut seen: u16 = 0;
    let mut last_id: Option<u16> = None;
    for info in ctx.remaining_accounts.iter() {
        let variant: Account<VariantInventory> = Account::try_from(info)?;
        require!(variant.season == pull.season, CrossyError::StaleInventory);
        // Enforce strict ordering so the eligible list is canonical.
        if let Some(prev) = last_id {
            require!(variant.variant_id > prev, CrossyError::StaleInventory);
        }
        last_id = Some(variant.variant_id);
        seen = seen.checked_add(1).ok_or(CrossyError::Overflow)?;
        if variant.active && variant.available() > 0 && variant.rarity == rarity as u8 {
            eligible.push((variant.variant_id, info.key(), variant.available()));
        }
    }
    require!(seen == season.variant_count, CrossyError::StaleInventory);

    if eligible.is_empty() {
        // Sold-out race since the snapshot: refundable, never downgraded.
        pull.state = PullState::Refundable;
        emit!(PaymentRefundable {
            receipt: pull_key,
            amount: pull.price
        });
        return Ok(());
    }

    let idx = sampling::select_variant_index(&mut rng, eligible.len() as u32) as usize;
    let (variant_id, variant_key, _) = eligible[idx];
    // The mutable selected_variant account must be exactly the derived one.
    require_keys_eq!(
        ctx.accounts.selected_variant.key(),
        variant_key,
        CrossyError::StaleInventory
    );

    // Atomically: reserve inventory + update pity + finalize team revenue.
    let variant = &mut ctx.accounts.selected_variant;
    require!(variant.available() > 0, CrossyError::SoldOut);
    variant.reserved = variant
        .reserved
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;
    if variant.available() == 0 {
        // Sold out: bump the banner revision so newer pulls resnapshot.
        let banner = &mut ctx.accounts.banner;
        banner.inventory_revision = banner
            .inventory_revision
            .checked_add(1)
            .ok_or(CrossyError::Overflow)?;
    }

    let after = pity::apply_assignment(counters, rarity);
    let tier = pull.tier as usize;
    let profile = &mut ctx.accounts.profile;
    profile.pity[tier].epic_misses = after.epic_misses;
    profile.pity[tier].legendary_misses = after.legendary_misses;

    // Team revenue becomes final on assignment.
    let signer_seeds: &[&[&[u8]]] = &[&[
        GACHA_VAULT_AUTHORITY_SEED,
        &[ctx.bumps.gacha_vault_authority],
    ]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.gacha_vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.team_treasury.to_account_info(),
                authority: ctx.accounts.gacha_vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        pull.price,
        USDC_DECIMALS,
    )?;

    pull.assigned_rarity = rarity as u8;
    pull.assigned_variant = variant_id;
    pull.inventory_reserved = true;
    pull.state = PullState::Assigned;

    emit!(PullAssigned {
        pull: pull_key,
        wallet: pull.player,
        rarity: rarity as u8,
        variant_id,
        epic_pity_after: after.epic_misses,
        legendary_pity_after: after.legendary_misses,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// claim_pull — mint the assigned asset (retryable, idempotent)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ClaimPull<'info> {
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [seeds::PULL, pull.player.as_ref(), &pull.pull_nonce.to_le_bytes()],
        bump = pull.bump,
        constraint = pull.state == PullState::Assigned @ CrossyError::BadReceiptState
    )]
    pub pull: Box<Account<'info, GachaPull>>,
    #[account(
        mut,
        seeds = [seeds::VARIANT, &pull.season.to_le_bytes(), &pull.assigned_variant.to_le_bytes()],
        bump = variant.bump,
    )]
    pub variant: Box<Account<'info, VariantInventory>>,
    /// New asset keypair (client-generated, signs creation).
    #[account(mut)]
    pub asset: Signer<'info>,
    /// Program-owned asset -> class binding, written now.
    #[account(
        init,
        payer = payer,
        space = 8 + AssetMap::INIT_SPACE,
        seeds = [seeds::ASSET_MAP, asset.key().as_ref()],
        bump
    )]
    pub asset_map: Box<Account<'info, AssetMap>>,
    /// CHECK: configured Core collection.
    #[account(mut, address = config.collection @ CrossyError::WrongCollection)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: mint authority PDA (collection authority delegate).
    #[account(seeds = [MINT_AUTHORITY_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK: the pull's player — fixed asset owner regardless of caller.
    #[account(address = pull.player @ CrossyError::NotWallet)]
    pub owner: UncheckedAccount<'info>,
    /// Permissionless sponsor pays rent/fees; owner is fixed above.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: mpl-core program.
    #[account(address = mpl_core::MPL_CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
}

pub fn claim_pull(ctx: Context<ClaimPull>, name: String, uri: String) -> Result<()> {
    require!(
        name.len() <= 32 && uri.len() <= 200,
        CrossyError::CapacityExceeded
    );

    let signer_seeds: &[&[&[u8]]] = &[&[MINT_AUTHORITY_SEED, &[ctx.bumps.mint_authority]]];
    mpl_core::create_asset(
        &ctx.accounts.asset.to_account_info(),
        &ctx.accounts.collection.to_account_info(),
        &ctx.accounts.mint_authority.to_account_info(),
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        &name,
        &uri,
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.core_program.to_account_info(),
        signer_seeds,
    )?;

    // reserved -> minted, atomically with recording the asset.
    let variant = &mut ctx.accounts.variant;
    variant.reserved = variant
        .reserved
        .checked_sub(1)
        .ok_or(CrossyError::Overflow)?;
    variant.minted = variant.minted.checked_add(1).ok_or(CrossyError::Overflow)?;

    let map = &mut ctx.accounts.asset_map;
    map.asset = ctx.accounts.asset.key();
    map.season = ctx.accounts.pull.season;
    map.variant_id = variant.variant_id;
    map.class_id = variant.class_id;
    map.rarity = variant.rarity;
    map.bump = ctx.bumps.asset_map;

    let pull = &mut ctx.accounts.pull;
    pull.minted_asset = ctx.accounts.asset.key();
    pull.inventory_reserved = false;
    pull.state = PullState::Claimed;

    emit!(PullClaimed {
        pull: pull.key(),
        wallet: pull.player,
        asset: pull.minted_asset,
        variant_id: variant.variant_id,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// refund_pull — objective five-minute timeout, or refundable races
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RefundPull<'info> {
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [seeds::PULL, pull.player.as_ref(), &pull.pull_nonce.to_le_bytes()],
        bump = pull.bump,
    )]
    pub pull: Box<Account<'info, GachaPull>>,
    /// CHECK: gacha vault authority PDA.
    #[account(seeds = [GACHA_VAULT_AUTHORITY_SEED], bump)]
    pub gacha_vault_authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [seeds::GACHA_VAULT], bump)]
    pub gacha_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Fixed recipient: the pull player's canonical USDC account.
    #[account(
        mut,
        constraint = wallet_token.owner == pull.player @ CrossyError::WrongTokenOwner,
        constraint = wallet_token.mint == config.usdc_mint @ CrossyError::WrongMint
    )]
    pub wallet_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint @ CrossyError::WrongMint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: configured token program.
    #[account(address = config.token_program @ CrossyError::WrongTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
}

/// Refund a pull that is Refundable, or Pending past the objective timeout.
/// Refund invalidates the request generation so a late callback fails, and
/// never advances pity or supply.
pub fn refund_pull(ctx: Context<RefundPull>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pull = &mut ctx.accounts.pull;
    match pull.state {
        PullState::Refundable => {}
        PullState::Pending => {
            require!(
                now >= pull
                    .requested_at
                    .checked_add(GACHA_TIMEOUT_SECONDS)
                    .ok_or(CrossyError::Overflow)?,
                CrossyError::TimeoutNotReached
            );
        }
        _ => return err!(CrossyError::AlreadyTerminal),
    }

    // Invalidate the live generation: any late callback must fail.
    pull.request_generation = pull
        .request_generation
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;

    let signer_seeds: &[&[&[u8]]] = &[&[
        GACHA_VAULT_AUTHORITY_SEED,
        &[ctx.bumps.gacha_vault_authority],
    ]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.gacha_vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.wallet_token.to_account_info(),
                authority: ctx.accounts.gacha_vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        pull.price,
        USDC_DECIMALS,
    )?;

    pull.state = PullState::Refunded;
    emit!(PullRefunded {
        pull: pull.key(),
        wallet: pull.player,
        amount: pull.price,
    });
    Ok(())
}
