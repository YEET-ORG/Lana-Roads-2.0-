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

/// Delegate a world header to the ER using the validator pinned in config.
pub fn delegate_world(ctx: Context<DelegateWorld>, mode: u8, day: u64) -> Result<()> {
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[seeds::WORLD, &[mode], &day.to_le_bytes()],
        DelegateConfig {
            validator: Some(ctx.accounts.config.validator),
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
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[
            seeds::SECTOR,
            world.as_ref(),
            &[sector_x],
            &sector_y.to_le_bytes(),
        ],
        DelegateConfig {
            validator: Some(ctx.accounts.config.validator),
            ..Default::default()
        },
    )?;
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateRun<'info> {
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    pub payer: Signer<'info>,
    /// CHECK: the run PDA to delegate.
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
}

pub fn delegate_run(ctx: Context<DelegateRun>, world: Pubkey, wallet: Pubkey) -> Result<()> {
    require_keys_eq!(ctx.accounts.payer.key(), wallet, CrossyError::NotWallet);
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[seeds::RUN, world.as_ref(), wallet.as_ref()],
        DelegateConfig {
            validator: Some(ctx.accounts.config.validator),
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
    pub payer: Signer<'info>,
    /// CHECK: the daily-best PDA to delegate.
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
}

pub fn delegate_best(ctx: Context<DelegateBest>, world: Pubkey, wallet: Pubkey) -> Result<()> {
    require_keys_eq!(ctx.accounts.payer.key(), wallet, CrossyError::NotWallet);
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[seeds::BEST, world.as_ref(), wallet.as_ref()],
        DelegateConfig {
            validator: Some(ctx.accounts.config.validator),
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

pub fn delegate_chunk(ctx: Context<DelegateChunk>, day: u64, chunk_index: u32) -> Result<()> {
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[seeds::CHUNK, &day.to_le_bytes(), &chunk_index.to_le_bytes()],
        DelegateConfig {
            validator: Some(ctx.accounts.config.validator),
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
        seeds = [seeds::WORLD, &[world.mode as u8], &world.day.to_le_bytes()],
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
    require!(now >= world.end_ts, CrossyError::CutoffPassed);
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
