//! Agent NFT lifecycle: lock (freeze) for an attempt, permissionless
//! terminal thaw. Selected assets must belong to the configured collection
//! and current wallet owner, be unlocked, and not be listed. The lock binds
//! asset, owner, world, and attempt nonce.

use anchor_lang::prelude::*;

use crate::constants::seeds;
use crate::cross_plane::read_committed_run;
use crate::errors::CrossyError;
use crate::events::*;
use crate::external::mpl_core;
use crate::state::*;

/// Program authority PDA that acts as the Core freeze delegate.
pub const FREEZE_AUTHORITY_SEED: &[u8] = b"freeze_authority";

// ---------------------------------------------------------------------------
// lock_agent — wallet-signed, same reviewed flow as begin_paid_attempt
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(attempt_nonce: u32)]
pub struct LockAgent<'info> {
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    /// Target world for this attempt (address recorded in the lock).
    /// CHECK: world PDA validated by seeds via stored key comparison in
    /// handler (may be delegated).
    pub world: UncheckedAccount<'info>,
    /// The Core asset being locked. `Pubkey::default()`-marker starters use
    /// `lock_starter` instead.
    /// CHECK: owner/collection validated via mpl-core account data + CPI.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: the configured Core collection.
    #[account(mut, address = config.collection @ CrossyError::WrongCollection)]
    pub collection: UncheckedAccount<'info>,
    /// Program-owned asset -> variant/class binding written at mint.
    #[account(
        seeds = [seeds::ASSET_MAP, asset.key().as_ref()],
        bump = asset_map.bump,
        constraint = asset_map.asset == asset.key() @ CrossyError::BadClassMapping
    )]
    pub asset_map: Box<Account<'info, AssetMap>>,
    /// No active listing may exist for the asset (lock/listing mutual
    /// exclusion): the listing PDA must not be an initialized active listing.
    /// CHECK: absence/state validated in handler.
    pub listing: UncheckedAccount<'info>,
    #[account(
        init,
        payer = wallet,
        space = 8 + AgentLock::INIT_SPACE,
        seeds = [
            seeds::AGENT_LOCK,
            world.key().as_ref(),
            wallet.key().as_ref(),
            &attempt_nonce.to_le_bytes(),
        ],
        bump
    )]
    pub lock: Box<Account<'info, AgentLock>>,
    /// CHECK: freeze authority PDA (the Core freeze delegate).
    #[account(seeds = [FREEZE_AUTHORITY_SEED], bump)]
    pub freeze_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: mpl-core program.
    #[account(address = mpl_core::MPL_CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
}

/// Freeze the selected NFT for the attempt. Wallet signs (owner authority
/// approves the freeze delegate + freeze in one CPI).
pub fn lock_agent(ctx: Context<LockAgent>, attempt_nonce: u32) -> Result<()> {
    // Current owner must be the signing wallet.
    let owner = mpl_core::read_asset_owner(&ctx.accounts.asset.to_account_info())?;
    require_keys_eq!(
        owner,
        ctx.accounts.wallet.key(),
        CrossyError::WrongAssetOwner
    );

    // Listing mutual exclusion: the listing PDA for this asset must either
    // not exist or not be Active.
    let (expected_listing, _) = Pubkey::find_program_address(
        &[seeds::LISTING, ctx.accounts.asset.key().as_ref()],
        &crate::ID,
    );
    require_keys_eq!(
        ctx.accounts.listing.key(),
        expected_listing,
        CrossyError::AgentListed
    );
    if ctx.accounts.listing.data_len() > 8 {
        let data = ctx.accounts.listing.try_borrow_data()?;
        use anchor_lang::Discriminator;
        if data[..8] == MarketplaceListing::DISCRIMINATOR[..] {
            let listing = MarketplaceListing::try_deserialize(&mut &data[..])
                .map_err(|_| error!(CrossyError::AgentListed))?;
            require!(
                listing.status != ListingStatus::Active,
                CrossyError::AgentListed
            );
        }
    }

    // Freeze under the game PDA, dispatching on the asset's actual plugin
    // state (add / re-approve / update). Fails if already frozen elsewhere.
    let freeze_seeds: &[&[&[u8]]] = &[&[FREEZE_AUTHORITY_SEED, &[ctx.bumps.freeze_authority]]];
    mpl_core::ensure_frozen_under(
        &ctx.accounts.asset.to_account_info(),
        Some(&ctx.accounts.collection.to_account_info()),
        &ctx.accounts.wallet.to_account_info(),
        &ctx.accounts.wallet.to_account_info(),
        &ctx.accounts.freeze_authority.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.core_program.to_account_info(),
        freeze_seeds,
    )?;

    let lock = &mut ctx.accounts.lock;
    lock.owner = ctx.accounts.wallet.key();
    lock.asset = ctx.accounts.asset.key();
    lock.world = ctx.accounts.world.key();
    lock.attempt_nonce = attempt_nonce;
    lock.class_id = ctx.accounts.asset_map.class_id;
    lock.frozen = true;
    lock.unlocked = false;
    lock.bump = ctx.bumps.lock;

    emit!(AgentLockedEvent {
        wallet: lock.owner,
        asset: lock.asset,
        world: lock.world,
        attempt_nonce,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// lock_starter — starter marker lock (nothing to freeze)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(attempt_nonce: u32)]
pub struct LockStarter<'info> {
    #[account(
        seeds = [seeds::PLAYER, wallet.key().as_ref()],
        bump = profile.bump,
        constraint = profile.starter_claimed @ CrossyError::StarterNotClaimed
    )]
    pub profile: Box<Account<'info, PlayerProfile>>,
    /// CHECK: target world address.
    pub world: UncheckedAccount<'info>,
    #[account(
        init,
        payer = wallet,
        space = 8 + AgentLock::INIT_SPACE,
        seeds = [
            seeds::AGENT_LOCK,
            world.key().as_ref(),
            wallet.key().as_ref(),
            &attempt_nonce.to_le_bytes(),
        ],
        bump
    )]
    pub lock: Box<Account<'info, AgentLock>>,
    #[account(mut)]
    pub wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn lock_starter(ctx: Context<LockStarter>, attempt_nonce: u32) -> Result<()> {
    let lock = &mut ctx.accounts.lock;
    lock.owner = ctx.accounts.wallet.key();
    lock.asset = Pubkey::default(); // starter marker
    lock.world = ctx.accounts.world.key();
    lock.attempt_nonce = attempt_nonce;
    lock.class_id = 0; // starter class: Kick-only
    lock.frozen = false;
    lock.unlocked = false;
    lock.bump = ctx.bumps.lock;
    Ok(())
}

// ---------------------------------------------------------------------------
// unlock_agent — permissionless terminal thaw
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct UnlockAgent<'info> {
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [
            seeds::AGENT_LOCK,
            lock.world.as_ref(),
            lock.owner.as_ref(),
            &lock.attempt_nonce.to_le_bytes(),
        ],
        bump = lock.bump,
    )]
    pub lock: Box<Account<'info, AgentLock>>,
    /// CHECK: committed run for (world, owner) — proves the attempt is
    /// terminal; or the day cutoff proves it (validated in handler).
    pub run: UncheckedAccount<'info>,
    /// CHECK: the lock's world header provides paid-cutoff evidence. Casual
    /// attempts require committed terminal run state instead.
    pub world: UncheckedAccount<'info>,
    /// CHECK: the locked asset.
    #[account(mut, address = lock.asset @ CrossyError::WrongAssetOwner)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: configured collection.
    #[account(mut, address = config.collection @ CrossyError::WrongCollection)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: freeze authority PDA (thaw signer).
    #[account(seeds = [FREEZE_AUTHORITY_SEED], bump)]
    pub freeze_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: mpl-core program.
    #[account(address = mpl_core::MPL_CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
}

/// Permissionless, idempotent thaw once committed terminal evidence exists:
/// either the run shows a terminal state for this attempt (or a later
/// attempt), or the day cutoff has passed. Recipient and asset are fixed by
/// the lock — the caller can only help, never redirect.
pub fn unlock_agent(ctx: Context<UnlockAgent>) -> Result<()> {
    let lock = &mut ctx.accounts.lock;
    require!(!lock.unlocked, CrossyError::AlreadyTerminal);
    require!(
        lock.asset != Pubkey::default(),
        CrossyError::BadClassMapping
    );

    // Terminal evidence: committed run state, OR a paid world's hard cutoff
    // (which also frees locks whose attempt never spawned).
    let now = Clock::get()?.unix_timestamp;
    let world = crate::cross_plane::read_committed_world(
        &ctx.accounts.world.to_account_info(),
        &lock.world,
    )?;
    let day_over = world.mode.cutoff_passed(now, world.end_ts);
    let attempt_terminal = if day_over {
        true
    } else {
        let committed = read_committed_run(
            &ctx.accounts.run.to_account_info(),
            &lock.world,
            &lock.owner,
        )?;
        committed.attempt_nonce > lock.attempt_nonce
            || (committed.attempt_nonce == lock.attempt_nonce && committed.is_terminal())
    };
    require!(attempt_terminal, CrossyError::NotReconcilable);

    // Thaw (idempotent at the Core level: updating frozen=false twice is
    // harmless; a second unlock call is blocked by `unlocked`).
    let signer_seeds: &[&[&[u8]]] = &[&[FREEZE_AUTHORITY_SEED, &[ctx.bumps.freeze_authority]]];
    mpl_core::set_frozen(
        &ctx.accounts.asset.to_account_info(),
        Some(&ctx.accounts.collection.to_account_info()),
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.freeze_authority.to_account_info(),
        false,
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.core_program.to_account_info(),
        signer_seeds,
    )?;

    lock.frozen = false;
    lock.unlocked = true;

    emit!(AgentUnlocked {
        wallet: lock.owner,
        asset: lock.asset,
        world: lock.world,
        attempt_nonce: lock.attempt_nonce,
    });
    Ok(())
}
