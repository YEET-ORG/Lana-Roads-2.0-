//! Gacha: request -> authenticated VRF assignment -> claim mint, with
//! five-minute timeout refunds. Pity-then-weighted selection without modulo
//! bias; inventory reservation and pity updates are atomic with assignment;
//! a valid assigned result is never rerolled or refunded on preference.
//!
//! Variant selection is over the season's immutable per-rarity catalog.
//! A selected entry that sold out concurrently refunds instead of rerolling;
//! another player's assignment can therefore never change a random result.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TransferChecked};
use ephemeral_rollups_sdk::{
    anchor::{vrf, vrf_callback},
    vrf::{
        self,
        instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
        types::SerializableAccountMeta,
    },
};
use solana_keccak_hasher as keccak;
use solana_sha256_hasher as sha256;

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

#[vrf]
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
        constraint = season.status == SeasonStatus::Active @ CrossyError::DayNotOpen,
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
        seeds = [seeds::RARITY_POOL, &season.season_index.to_le_bytes(), &[0u8]],
        bump = common_pool.bump,
        constraint = common_pool.initialized @ CrossyError::StaleInventory
    )]
    pub common_pool: Box<Account<'info, RarityPool>>,
    #[account(
        seeds = [seeds::RARITY_POOL, &season.season_index.to_le_bytes(), &[1u8]],
        bump = rare_pool.bump,
        constraint = rare_pool.initialized @ CrossyError::StaleInventory
    )]
    pub rare_pool: Box<Account<'info, RarityPool>>,
    #[account(
        seeds = [seeds::RARITY_POOL, &season.season_index.to_le_bytes(), &[2u8]],
        bump = epic_pool.bump,
        constraint = epic_pool.initialized @ CrossyError::StaleInventory
    )]
    pub epic_pool: Box<Account<'info, RarityPool>>,
    #[account(
        seeds = [seeds::RARITY_POOL, &season.season_index.to_le_bytes(), &[3u8]],
        bump = legendary_pool.bump,
        constraint = legendary_pool.initialized @ CrossyError::StaleInventory
    )]
    pub legendary_pool: Box<Account<'info, RarityPool>>,
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
    /// CHECK: official MagicBlock base queue, or local test queue.
    #[account(
        mut,
        constraint = oracle_queue.key() == vrf::consts::DEFAULT_QUEUE
            || oracle_queue.key() == vrf::consts::DEFAULT_TEST_QUEUE
            @ CrossyError::BadVrfAuthority
    )]
    pub oracle_queue: UncheckedAccount<'info>,
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
        ctx.accounts.profile.pending_pull == Pubkey::default(),
        CrossyError::AttemptStillActive
    );
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

    let pools = [
        &*ctx.accounts.common_pool,
        &*ctx.accounts.rare_pool,
        &*ctx.accounts.epic_pool,
        &*ctx.accounts.legendary_pool,
    ];
    let mut available = [false; 4];
    for (rarity, pool) in pools.iter().enumerate() {
        require!(
            pool.season == season.season_index && pool.rarity == rarity as u8,
            CrossyError::StaleInventory
        );
        available[rarity] = pool.has_available();
    }

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
    pull.requested_at = now;
    pull.request_generation = 1;
    pull.randomness = [0u8; 32];
    pull.state = PullState::Pending;
    pull.bump = ctx.bumps.pull;

    let pull_key = pull.key();
    let profile = &mut ctx.accounts.profile;
    profile.pending_pull = pull_key;
    profile.pull_count = profile
        .pull_count
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;

    let generation = pull.request_generation;
    emit!(PullRequested {
        pull: pull_key,
        wallet: pull.player,
        season: pull.season,
        tier: pull.tier,
        pull_nonce: pull.pull_nonce,
        price: pull.price,
    });

    let mut callback_args = Vec::with_capacity(2);
    generation.serialize(&mut callback_args)?;
    let nonce_bytes = pull.pull_nonce.to_le_bytes();
    let generation_bytes = generation.to_le_bytes();
    let caller_seed = keccak::hashv(&[
        b"lana-roads-gacha-vrf-v1",
        pull_key.as_ref(),
        &nonce_bytes,
        &generation_bytes,
    ])
    .to_bytes();
    let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.wallet.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::ConsumePullRandomness::DISCRIMINATOR.to_vec(),
        accounts_metas: Some(vec![SerializableAccountMeta {
            pubkey: pull_key,
            is_signer: false,
            is_writable: true,
        }]),
        caller_seed,
        callback_args: Some(callback_args),
    });
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.wallet.to_account_info(), &ix)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// assign_pull — authenticated randomness callback
// ---------------------------------------------------------------------------

#[vrf_callback]
#[derive(Accounts)]
pub struct ConsumePullRandomness<'info> {
    #[account(
        mut,
        seeds = [seeds::PULL, pull.player.as_ref(), &pull.pull_nonce.to_le_bytes()],
        bump = pull.bump,
        constraint = pull.state == PullState::Pending @ CrossyError::AlreadyTerminal
    )]
    pub pull: Box<Account<'info, GachaPull>>,
}

pub fn consume_pull_randomness(
    ctx: Context<ConsumePullRandomness>,
    randomness: [u8; 32],
    generation: u16,
) -> Result<()> {
    let pull = &mut ctx.accounts.pull;
    require!(
        pull.request_generation == generation,
        CrossyError::BadGeneration
    );
    pull.randomness = randomness;
    pull.state = PullState::RandomnessReady;
    Ok(())
}

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
        constraint = pull.state == PullState::RandomnessReady @ CrossyError::AlreadyTerminal
    )]
    pub pull: Box<Account<'info, GachaPull>>,
    #[account(
        mut,
        seeds = [seeds::RARITY_POOL, &pull.season.to_le_bytes(), &[0u8]],
        bump = common_pool.bump
    )]
    pub common_pool: Box<Account<'info, RarityPool>>,
    #[account(
        mut,
        seeds = [seeds::RARITY_POOL, &pull.season.to_le_bytes(), &[1u8]],
        bump = rare_pool.bump
    )]
    pub rare_pool: Box<Account<'info, RarityPool>>,
    #[account(
        mut,
        seeds = [seeds::RARITY_POOL, &pull.season.to_le_bytes(), &[2u8]],
        bump = epic_pool.bump
    )]
    pub epic_pool: Box<Account<'info, RarityPool>>,
    #[account(
        mut,
        seeds = [seeds::RARITY_POOL, &pull.season.to_le_bytes(), &[3u8]],
        bump = legendary_pool.bump
    )]
    pub legendary_pool: Box<Account<'info, RarityPool>>,
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
    /// CHECK: configured token program.
    #[account(address = config.token_program @ CrossyError::WrongTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
}

pub fn assign_pull(ctx: Context<AssignPull>) -> Result<()> {
    let pull_key = ctx.accounts.pull.key();
    let pull = &mut ctx.accounts.pull;

    // Deterministic selection domain-separated by the pull identity.
    let domain = (pull.player.to_bytes()[0] as u64) << 32 | pull.pull_nonce as u64;
    let mut rng = SelectionRng::new(&pull.randomness, domain);

    let counters = PityCounters {
        epic_misses: pull.epic_misses_snapshot,
        legendary_misses: pull.legendary_misses_snapshot,
    };
    let floor = pity::pity_override(counters);
    let rolled = sampling::select_rarity(&mut rng, pull.effective_weights);
    let rarity = pity::enforce_floor(rolled, floor);

    let pool: &mut RarityPool = match rarity {
        Rarity::Common => &mut ctx.accounts.common_pool,
        Rarity::Rare => &mut ctx.accounts.rare_pool,
        Rarity::Epic => &mut ctx.accounts.epic_pool,
        Rarity::Legendary => &mut ctx.accounts.legendary_pool,
    };
    require!(
        pool.initialized && pool.season == pull.season && pool.rarity == rarity as u8,
        CrossyError::StaleInventory
    );
    let catalog_count = pool.count as u32;
    if catalog_count == 0 {
        pull.state = PullState::Refundable;
        emit!(PaymentRefundable {
            receipt: pull_key,
            amount: pull.price
        });
        return Ok(());
    }
    let selected = sampling::select_variant_index(&mut rng, catalog_count);
    let (pool_index, entry) = pool.entry(selected)?;
    if entry.available == 0 {
        pull.state = PullState::Refundable;
        emit!(PaymentRefundable {
            receipt: pull_key,
            amount: pull.price
        });
        return Ok(());
    }
    let variant_id = entry.variant_id;

    let variant = &mut ctx.accounts.selected_variant;
    require!(
        variant.season == pull.season
            && variant.variant_id == variant_id
            && variant.rarity == rarity as u8
            && variant.active,
        CrossyError::StaleInventory
    );
    require!(
        variant.available()? == entry.available,
        CrossyError::LiabilityMismatch
    );
    pool.entries[pool_index].available = pool.entries[pool_index]
        .available
        .checked_sub(1)
        .ok_or(CrossyError::SoldOut)?;
    variant.reserved = variant
        .reserved
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;
    require!(
        variant.available()? == pool.entries[pool_index].available,
        CrossyError::LiabilityMismatch
    );
    pool.revision = pool.revision.checked_add(1).ok_or(CrossyError::Overflow)?;

    let after = pity::apply_assignment(counters, rarity);
    let tier = pull.tier as usize;
    let profile = &mut ctx.accounts.profile;
    require_keys_eq!(profile.pending_pull, pull_key, CrossyError::BadReceiptState);
    profile.pity[tier].epic_misses = after.epic_misses;
    profile.pity[tier].legendary_misses = after.legendary_misses;
    profile.pending_pull = Pubkey::default();

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

pub fn claim_pull(ctx: Context<ClaimPull>, uri: String) -> Result<()> {
    require!(
        ctx.accounts.pull.inventory_reserved,
        CrossyError::BadReceiptState
    );
    require!(uri.len() <= 200, CrossyError::CapacityExceeded);
    require!(
        sha256::hash(uri.as_bytes()).to_bytes() == ctx.accounts.variant.metadata_uri_hash,
        CrossyError::MetadataMismatch
    );
    let name = format!("Lana Agent #{}", ctx.accounts.variant.variant_id);

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
    #[account(
        mut,
        seeds = [seeds::PLAYER, pull.player.as_ref()],
        bump = profile.bump,
        constraint = profile.pending_pull == pull.key() @ CrossyError::BadReceiptState
    )]
    pub profile: Box<Account<'info, PlayerProfile>>,
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

/// Refund a pull that is Refundable, or unassigned past the objective timeout.
/// Refund invalidates the request generation so a late callback fails, and
/// never advances pity or supply.
pub fn refund_pull(ctx: Context<RefundPull>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pull = &mut ctx.accounts.pull;
    match pull.state {
        PullState::Refundable => {}
        PullState::Pending | PullState::RandomnessReady => {
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
    ctx.accounts.profile.pending_pull = Pubkey::default();
    emit!(PullRefunded {
        pull: pull.key(),
        wallet: pull.player,
        amount: pull.price,
    });
    Ok(())
}
