//! MagicBlock delegation, commit, and undelegation for gameplay accounts.
//! Mirrors the proven solsocket patterns: `#[delegate]` contexts wrapping
//! `delegate_pda`, `#[commit]` contexts using `MagicIntentBundleBuilder`
//! (deprecated free functions are prohibited).

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::constants::seeds;
use crate::errors::CrossyError;
use crate::state::*;

// ---------------------------------------------------------------------------
// delegation (base layer)
// ---------------------------------------------------------------------------

#[delegate]
#[derive(Accounts)]
pub struct DelegateWorld<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = config.admin == payer.key() @ CrossyError::NotAdmin
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    pub payer: Signer<'info>,
    /// CHECK: the world PDA to delegate; seeds validated by delegate_pda.
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
}

/// Delegate a world header to the rollup its own region names.
///
/// The validator comes from `config.validators[region]`, never from the
/// caller: a world whose seeds say "eu" but which is hosted in Singapore
/// would give European players the latency the region was created to remove,
/// and nothing downstream would notice.
pub fn delegate_world(ctx: Context<DelegateWorld>, region: u8, mode: u8, day: u64) -> Result<()> {
    let validator = ctx
        .accounts
        .config
        .validator_for(region)
        .ok_or(CrossyError::RegionClosed)?;
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[seeds::WORLD, &[region], &[mode], &day.to_le_bytes()],
        DelegateConfig {
            validator: Some(validator),
            ..Default::default()
        },
    )?;
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateSector<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = config.admin == payer.key() @ CrossyError::NotAdmin
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    /// CHECK: the sector's world; normally already delegated, so it is read
    /// cross-plane and validated against its own self-describing PDA.
    pub world_account: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
    /// CHECK: the sector PDA to delegate.
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
}

pub fn delegate_sector(
    ctx: Context<DelegateSector>,
    world: Pubkey,
    sector_x: u8,
    sector_y: u32,
) -> Result<()> {
    let validator = validator_for_world(
        &ctx.accounts.config,
        &ctx.accounts.world_account.to_account_info(),
        world,
    )?;
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[
            seeds::SECTOR,
            world.as_ref(),
            &[sector_x],
            &sector_y.to_le_bytes(),
        ],
        DelegateConfig {
            validator: Some(validator),
            ..Default::default()
        },
    )?;
    Ok(())
}

/// The validator a world's satellite accounts must be delegated to.
///
/// Sectors, runs and daily bests are addressed by the world's pubkey, which
/// says nothing about where that world lives. Taking the region from a caller
/// argument would let a run be delegated to a different rollup than the world
/// it belongs to — the account would exist, on a validator that has no world
/// to play in, and every action against it would fail for reasons pointing
/// somewhere else entirely. So read the world and let it name its own region.
fn validator_for_world(
    config: &GlobalConfig,
    world_info: &AccountInfo,
    expected: Pubkey,
) -> Result<Pubkey> {
    require_keys_eq!(*world_info.key, expected, CrossyError::NotReconcilable);
    let world = crate::cross_plane::read_committed_world_any(world_info)?;
    let derived = Pubkey::find_program_address(
        &[
            seeds::WORLD,
            &[world.region],
            &[world.mode as u8],
            &world.day.to_le_bytes(),
        ],
        &crate::ID,
    )
    .0;
    require_keys_eq!(*world_info.key, derived, CrossyError::NotReconcilable);
    config
        .validator_for(world.region)
        .ok_or(error!(CrossyError::RegionClosed))
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateRun<'info> {
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    /// CHECK: the world this account belongs to; read cross-plane so the
    /// delegation lands on the same rollup the world does.
    pub world_account: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
    /// CHECK: the run PDA to delegate.
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
}

pub fn delegate_run(ctx: Context<DelegateRun>, world: Pubkey, wallet: Pubkey) -> Result<()> {
    require_keys_eq!(ctx.accounts.payer.key(), wallet, CrossyError::NotWallet);
    let validator = validator_for_world(
        &ctx.accounts.config,
        &ctx.accounts.world_account.to_account_info(),
        world,
    )?;
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[seeds::RUN, world.as_ref(), wallet.as_ref()],
        DelegateConfig {
            validator: Some(validator),
            ..Default::default()
        },
    )?;
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateBest<'info> {
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    /// CHECK: the world this account belongs to; read cross-plane so the
    /// delegation lands on the same rollup the world does.
    pub world_account: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
    /// CHECK: the daily-best PDA to delegate.
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
}

pub fn delegate_best(ctx: Context<DelegateBest>, world: Pubkey, wallet: Pubkey) -> Result<()> {
    require_keys_eq!(ctx.accounts.payer.key(), wallet, CrossyError::NotWallet);
    let validator = validator_for_world(
        &ctx.accounts.config,
        &ctx.accounts.world_account.to_account_info(),
        world,
    )?;
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[seeds::BEST, world.as_ref(), wallet.as_ref()],
        DelegateConfig {
            validator: Some(validator),
            ..Default::default()
        },
    )?;
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateChunk<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = config.admin == payer.key() @ CrossyError::NotAdmin
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    pub payer: Signer<'info>,
    /// CHECK: the chunk PDA to delegate.
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
}

pub fn delegate_chunk(
    ctx: Context<DelegateChunk>,
    region: u8,
    day: u64,
    chunk_index: u32,
) -> Result<()> {
    // A chunk's seeds carry its region, so no world read is needed here.
    let validator = ctx
        .accounts
        .config
        .validator_for(region)
        .ok_or(CrossyError::RegionClosed)?;
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[
            seeds::CHUNK,
            &[region],
            &day.to_le_bytes(),
            &chunk_index.to_le_bytes(),
        ],
        DelegateConfig {
            validator: Some(validator),
            ..Default::default()
        },
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// commits (ER)
// ---------------------------------------------------------------------------

#[commit]
#[derive(Accounts)]
pub struct CommitAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
}

/// Checkpoint up to N delegated accounts (remaining accounts) to base
/// without undelegating. Used for: record changes, chunk reveals, entry
/// activation/failure, death, revival results, DailyBest batches.
pub fn commit_state<'info>(ctx: Context<'info, CommitAccounts<'info>>) -> Result<()> {
    require!(
        !ctx.remaining_accounts.is_empty(),
        CrossyError::CapacityExceeded
    );
    require!(
        ctx.remaining_accounts.len() <= 8,
        CrossyError::CapacityExceeded
    );
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit(ctx.remaining_accounts)
    .build_and_invoke()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// close world + final commit/undelegate (ER)
// ---------------------------------------------------------------------------

#[commit]
#[derive(Accounts)]
pub struct CloseWorld<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [seeds::WORLD, &[world.region], &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
    )]
    pub world: Box<Account<'info, WorldHeader>>,
}

/// After the hard cutoff, the world's configured commit payer may mark it
/// Closed and commit+undelegate it to base. Restricting closure leaves time
/// for the final DailyBest audit; gameplay still stops independently at the
/// hard cutoff.
pub fn close_world(ctx: Context<CloseWorld>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let world = &mut ctx.accounts.world;
    require_keys_eq!(
        ctx.accounts.payer.key(),
        world.commit_payer,
        CrossyError::NotAdmin
    );
    require!(
        world.mode == WorldMode::Paid,
        CrossyError::InvalidTransition
    );
    require!(
        world.mode.cutoff_passed(now, world.end_ts),
        CrossyError::CutoffPassed
    );
    require!(
        world.status != WorldStatus::Closed,
        CrossyError::InvalidTransition
    );
    world.status = WorldStatus::Closed;

    ctx.accounts.world.exit(&crate::ID)?;
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.world.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateAccounts<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = config.admin == payer.key() @ CrossyError::NotAdmin
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(mut)]
    pub payer: Signer<'info>,
}

/// Commit + undelegate arbitrary delegated gameplay accounts after closure
/// (runs, sectors, bests) so base cleanup/rent reclamation can proceed.
pub fn undelegate_state<'info>(ctx: Context<'info, UndelegateAccounts<'info>>) -> Result<()> {
    require!(
        !ctx.remaining_accounts.is_empty(),
        CrossyError::CapacityExceeded
    );
    require!(
        ctx.remaining_accounts.len() <= 8,
        CrossyError::CapacityExceeded
    );
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(ctx.remaining_accounts)
    .build_and_invoke()?;
    Ok(())
}
