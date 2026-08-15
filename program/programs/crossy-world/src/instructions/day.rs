//! Daily competition lifecycle: prepare -> open -> close -> commit ->
//! settle | void. One-way transitions; Voided and Settled are mutually
//! exclusive. The admin triggers transitions but the program fixes every
//! winner, destination, and amount.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TransferChecked};

use crate::constants::{seeds, CHUNK_ROWS, SAFE_ZONE_ROWS, USDC_DECIMALS, WORLD_WIDTH};
use crate::errors::CrossyError;
use crate::events::*;
use crate::kernel::{chunkgen, economy, time};
use crate::state::*;

// ---------------------------------------------------------------------------
// prepare_day
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(day: u64)]
pub struct PrepareDay<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = config.admin == admin.key() @ CrossyError::NotAdmin
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        init,
        payer = admin,
        space = 8 + DailyCompetition::INIT_SPACE,
        seeds = [seeds::DAILY, &day.to_le_bytes()],
        bump
    )]
    pub daily: Box<Account<'info, DailyCompetition>>,
    /// CHECK: vault authority PDA; only used as token authority.
    #[account(seeds = [seeds::DAILY_VAULT, &day.to_le_bytes()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// Day vault token account owned by the vault authority PDA.
    #[account(
        init,
        payer = admin,
        token::mint = usdc_mint,
        token::authority = vault_authority,
        seeds = [seeds::DAILY_VAULT, &day.to_le_bytes(), b"ata"],
        bump
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint @ CrossyError::WrongMint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = admin,
        space = 8 + WorldHeader::INIT_SPACE,
        seeds = [seeds::WORLD, &[WorldMode::Paid as u8], &day.to_le_bytes()],
        bump
    )]
    pub paid_world: Box<Account<'info, WorldHeader>>,
    #[account(
        init,
        payer = admin,
        space = 8 + WorldHeader::INIT_SPACE,
        seeds = [seeds::WORLD, &[WorldMode::Casual as u8], &day.to_le_bytes()],
        bump
    )]
    pub casual_world: Box<Account<'info, WorldHeader>>,
    /// The safe/spawn chunk (index 0) is deterministic — created revealed.
    #[account(
        init,
        payer = admin,
        space = 8 + ChunkDefinition::INIT_SPACE,
        seeds = [seeds::CHUNK, &day.to_le_bytes(), &0u32.to_le_bytes()],
        bump
    )]
    pub spawn_chunk: Box<Account<'info, ChunkDefinition>>,
    /// CHECK: commit/crank fee payer reference recorded in the worlds.
    pub commit_payer: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: token program matching the configured mint.
    #[account(address = config.token_program @ CrossyError::WrongTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
}

pub fn prepare_day(ctx: Context<PrepareDay>, day: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let today = time::utc_day_from_unix(now).ok_or(CrossyError::Overflow)?;
    // May prepare today (late recovery) or a future day; never the past.
    require!(day >= today, CrossyError::CutoffPassed);

    let start_ts = time::day_start(day).ok_or(CrossyError::Overflow)?;
    let end_ts = time::day_end(day).ok_or(CrossyError::Overflow)?;

    let daily = &mut ctx.accounts.daily;
    daily.day = day;
    daily.status = DayStatus::Prepared;
    daily.paid_world = ctx.accounts.paid_world.key();
    daily.casual_world = ctx.accounts.casual_world.key();
    daily.vault = ctx.accounts.vault.key();
    daily.vault_authority_bump = ctx.bumps.vault_authority;
    daily.bump = ctx.bumps.daily;

    let config = &ctx.accounts.config;
    for (world, mode, cap) in [
        (
            &mut ctx.accounts.paid_world,
            WorldMode::Paid,
            config.max_paid_players,
        ),
        (
            &mut ctx.accounts.casual_world,
            WorldMode::Casual,
            config.max_casual_players,
        ),
    ] {
        world.day = day;
        world.mode = mode;
        // Worlds are born Open: actual play is gated by authoritative time
        // (start_ts/end_ts checks in every gameplay instruction) and paid
        // admission additionally by DailyCompetition status. This avoids an
        // extra write to already-delegated world accounts at day start.
        world.status = WorldStatus::Open;
        world.start_ts = start_ts;
        world.end_ts = end_ts;
        world.width = WORLD_WIDTH;
        world.safe_rows = SAFE_ZONE_ROWS;
        world.active_players = 0;
        world.player_cap = cap;
        world.revealed_rows = CHUNK_ROWS as u32; // chunk 0 = safe zone
        world.map_seq = 0;
        world.latest_chunk_index = 0;
        world.latest_chunk_generation = 0;
        world.latest_chunk_hash = [0u8; 32];
        world.ready_chunk_index = 0;
        world.ready_chunk_hash = [0u8; 32];
        world.spawn_ready = false;
        world.record_score = 0;
        world.record_holder = Pubkey::default();
        world.next_chunk_index = 1;
        world.chunk_request_state = ChunkRequestState::Idle;
        world.class_balance_version = 1;
        world.action_domain = day;
        world.commit_payer = ctx.accounts.commit_payer.key();
    }
    ctx.accounts.paid_world.bump = ctx.bumps.paid_world;
    ctx.accounts.casual_world.bump = ctx.bumps.casual_world;

    // Deterministic hazard-free spawn chunk, shared by both modes.
    let layout = chunkgen::generate_chunk(&[0u8; 32], 0);
    let chunk = &mut ctx.accounts.spawn_chunk;
    chunk.day = day;
    chunk.chunk_index = 0;
    chunk.row_start = 0;
    chunk.row_count = CHUNK_ROWS;
    chunk.generation = 0;
    chunk.randomness_hash = [0u8; 32];
    chunk.generation_version = chunkgen::GENERATION_VERSION;
    chunk.status = ChunkStatus::Revealed;
    chunk.requested_at = now;
    for (i, lane) in layout.lanes.iter().enumerate() {
        chunk.lanes[i] = (*lane).into();
    }
    chunk.bump = ctx.bumps.spawn_chunk;

    emit!(DayPrepared {
        day,
        rollover_in: 0
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// consume_rollover — attach the previous no-winner pool to this day
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ConsumeRollover<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [seeds::DAILY, &previous.day.to_le_bytes()],
        bump = previous.bump,
    )]
    pub previous: Box<Account<'info, DailyCompetition>>,
    #[account(
        mut,
        seeds = [seeds::DAILY, &daily.day.to_le_bytes()],
        bump = daily.bump,
        constraint = daily.day == previous.day + 1 @ CrossyError::InvalidTransition
    )]
    pub daily: Box<Account<'info, DailyCompetition>>,
    /// CHECK: previous day vault authority PDA (transfer signer).
    #[account(
        seeds = [seeds::DAILY_VAULT, &previous.day.to_le_bytes()],
        bump = previous.vault_authority_bump
    )]
    pub previous_vault_authority: UncheckedAccount<'info>,
    #[account(mut, address = previous.vault @ CrossyError::WrongVault)]
    pub previous_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = daily.vault @ CrossyError::WrongVault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint @ CrossyError::WrongMint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: configured token program.
    #[account(address = config.token_program @ CrossyError::WrongTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
}

/// Permissionless: moves the settled rollover of day N into day N+1's vault
/// and accounting. Exactly once (guarded by `rollover_consumed`).
pub fn consume_rollover(ctx: Context<ConsumeRollover>) -> Result<()> {
    let previous = &mut ctx.accounts.previous;
    require!(
        matches!(previous.status, DayStatus::Settled | DayStatus::Voided),
        CrossyError::InvalidTransition
    );
    require!(!previous.rollover_consumed, CrossyError::AlreadyTerminal);
    let amount = previous.rollover_out;
    require!(amount > 0, CrossyError::WrongAmount);
    let daily = &ctx.accounts.daily;
    require!(
        matches!(daily.status, DayStatus::Prepared | DayStatus::Open),
        CrossyError::InvalidTransition
    );
    require!(daily.rollover_in == 0, CrossyError::AlreadyTerminal);
    let now = Clock::get()?.unix_timestamp;
    require!(
        !time::cutoff_passed(daily.day, now),
        CrossyError::CutoffPassed
    );
    previous.assert_solvency(ctx.accounts.previous_vault.amount)?;
    daily.assert_solvency(ctx.accounts.vault.amount)?;

    let day_bytes = previous.day.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        seeds::DAILY_VAULT,
        &day_bytes,
        &[previous.vault_authority_bump],
    ]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.previous_vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.previous_vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        USDC_DECIMALS,
    )?;

    previous.rollover_consumed = true;

    let daily = &mut ctx.accounts.daily;
    daily.rollover_in = daily
        .rollover_in
        .checked_add(amount)
        .ok_or(CrossyError::Overflow)?;
    daily.active_pool = daily
        .active_pool
        .checked_add(amount)
        .ok_or(CrossyError::Overflow)?;
    daily.total_deposited = daily
        .total_deposited
        .checked_add(amount)
        .ok_or(CrossyError::Overflow)?;

    emit!(RolloverConsumed {
        into_day: daily.day,
        amount
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// open_day — readiness reconciliation
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct OpenDay<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = config.admin == admin.key() @ CrossyError::NotAdmin
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [seeds::DAILY, &daily.day.to_le_bytes()],
        bump = daily.bump,
    )]
    pub daily: Box<Account<'info, DailyCompetition>>,
    pub admin: Signer<'info>,
}

/// Marks the day Open once its start time is reached. Delegation/router/ER
/// readiness is proven off-chain by automation before calling; admission
/// additionally rechecks time and pause on every entry.
pub fn open_day(ctx: Context<OpenDay>) -> Result<()> {
    let daily = &mut ctx.accounts.daily;
    require!(
        daily.status == DayStatus::Prepared,
        CrossyError::InvalidTransition
    );
    let now = Clock::get()?.unix_timestamp;
    let start = time::day_start(daily.day).ok_or(CrossyError::Overflow)?;
    require!(now >= start, CrossyError::DayNotStarted);
    require!(
        !time::cutoff_passed(daily.day, now),
        CrossyError::CutoffPassed
    );
    daily.status = DayStatus::Open;
    emit!(DayOpened { day: daily.day });
    Ok(())
}

// ---------------------------------------------------------------------------
// close_day / record_final_commit
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CloseDay<'info> {
    #[account(
        mut,
        seeds = [seeds::DAILY, &daily.day.to_le_bytes()],
        bump = daily.bump,
    )]
    pub daily: Box<Account<'info, DailyCompetition>>,
}

/// Permissionless after cutoff: Open -> Closed. Gameplay instructions reject
/// independently on time, so correctness never depends on this crank.
pub fn close_day(ctx: Context<CloseDay>) -> Result<()> {
    let daily = &mut ctx.accounts.daily;
    require!(
        daily.status == DayStatus::Open,
        CrossyError::InvalidTransition
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        time::cutoff_passed(daily.day, now),
        CrossyError::CutoffPassed
    );
    daily.status = DayStatus::Closed;
    emit!(DayClosed { day: daily.day });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseWorldBase<'info> {
    #[account(
        mut,
        seeds = [seeds::WORLD, &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
    )]
    pub world: Box<Account<'info, WorldHeader>>,
    pub closer: Signer<'info>,
}

/// Commit-payer-authorized base-layer closure for an UNDELEGATED world after
/// the hard cutoff. In production the world is delegated (owned by the
/// delegation program) so this fails Anchor's owner check and `close_world`
/// (ER commit + undelegate) is the normal path — this exists for recovery
/// when a world was never delegated or was undelegated without closing.
pub fn close_world_base(ctx: Context<CloseWorldBase>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let world = &mut ctx.accounts.world;
    require_keys_eq!(
        ctx.accounts.closer.key(),
        world.commit_payer,
        CrossyError::NotAdmin
    );
    require!(now >= world.end_ts, CrossyError::CutoffPassed);
    require!(
        world.status != WorldStatus::Closed,
        CrossyError::InvalidTransition
    );
    world.status = WorldStatus::Closed;
    Ok(())
}

#[derive(Accounts)]
pub struct RecordFinalCommit<'info> {
    #[account(
        mut,
        seeds = [seeds::DAILY, &daily.day.to_le_bytes()],
        bump = daily.bump,
    )]
    pub daily: Box<Account<'info, DailyCompetition>>,
    /// The paid world account, now undelegated and committed back to base.
    /// Ownership by this program proves undelegation completed; its record
    /// fields are the final authority.
    #[account(
        seeds = [seeds::WORLD, &[WorldMode::Paid as u8], &daily.day.to_le_bytes()],
        bump = paid_world.bump,
        constraint = paid_world.key() == daily.paid_world @ CrossyError::WrongVault
    )]
    pub paid_world: Box<Account<'info, WorldHeader>>,
}

/// Permissionless: reconciles the committed final world record into the
/// daily account. Settlement is blocked until this has happened.
pub fn record_final_commit(ctx: Context<RecordFinalCommit>) -> Result<()> {
    let daily = &mut ctx.accounts.daily;
    require!(
        daily.status == DayStatus::Closed,
        CrossyError::InvalidTransition
    );
    let world = &ctx.accounts.paid_world;
    require!(
        world.status == WorldStatus::Closed,
        CrossyError::NotReconcilable
    );

    daily.settled_winner = world.record_holder;
    daily.settled_score = world.record_score;
    daily.final_commit_slot = Clock::get()?.slot;
    daily.status = DayStatus::Committed;

    emit!(DayCommitted {
        day: daily.day,
        record_score: world.record_score,
        record_holder: world.record_holder,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// finalize_day — settlement
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct FinalizeDay<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = config.admin == admin.key() @ CrossyError::NotAdmin
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [seeds::DAILY, &daily.day.to_le_bytes()],
        bump = daily.bump,
    )]
    pub daily: Box<Account<'info, DailyCompetition>>,
    /// CHECK: vault authority PDA (transfer signer).
    #[account(
        seeds = [seeds::DAILY_VAULT, &daily.day.to_le_bytes()],
        bump = daily.vault_authority_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, address = daily.vault @ CrossyError::WrongVault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Winner USDC token account: must belong to the recorded winner and the
    /// canonical mint. The admin supplies the account but cannot substitute
    /// the owner. On a no-winner day (settled_score == 0) no winner transfer
    /// occurs, so any canonical-mint token account satisfies the slot.
    #[account(
        mut,
        constraint = daily.settled_score == 0
            || winner_token.owner == daily.settled_winner @ CrossyError::WrongTokenOwner,
        constraint = winner_token.mint == config.usdc_mint @ CrossyError::WrongMint
    )]
    pub winner_token: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Team treasury fixed by config.
    #[account(mut, address = config.team_treasury @ CrossyError::WrongTreasury)]
    pub team_treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint @ CrossyError::WrongMint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: configured token program.
    #[account(address = config.token_program @ CrossyError::WrongTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
    pub admin: Signer<'info>,
}

/// Admin-triggered settlement. Retryable: each leg has its own completion
/// flag; a partial failure retries only the incomplete leg. With no valid
/// winner (record_score == 0) the whole pool becomes rollover.
pub fn finalize_day(ctx: Context<FinalizeDay>) -> Result<()> {
    let daily = &mut ctx.accounts.daily;
    require!(
        matches!(daily.status, DayStatus::Committed),
        CrossyError::InvalidTransition
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        time::cutoff_passed(daily.day, now),
        CrossyError::CutoffPassed
    );
    // All pending payments must have been reconciled before settlement.
    require!(daily.pending_total == 0, CrossyError::NotReconcilable);
    // Solvency check before moving money. Unsolicited vault donations are
    // harmless surplus and cannot be used to grief settlement.
    daily.assert_solvency(ctx.accounts.vault.amount)?;

    if daily.settled_score == 0 {
        // No winner: entire active pool rolls to the next day; no team cut.
        daily.rollover_out = daily.active_pool;
        daily.active_pool = 0;
        daily.winner_amount = 0;
        daily.team_amount = 0;
        daily.winner_paid = true;
        daily.team_paid = true;
        daily.status = DayStatus::Settled;
        emit!(RolloverCreated {
            from_day: daily.day,
            amount: daily.rollover_out
        });
        emit!(DaySettled {
            day: daily.day,
            winner: Pubkey::default(),
            winner_amount: 0,
            team_amount: 0,
        });
        return Ok(());
    }

    // Fix the obligation once (idempotent across retries).
    if daily.winner_amount == 0 && daily.team_amount == 0 && daily.active_pool > 0 {
        let (winner, team) =
            economy::settlement_split(daily.active_pool).ok_or(CrossyError::Overflow)?;
        daily.winner_amount = winner;
        daily.team_amount = team;
        daily.winner_unpaid = winner;
        daily.team_unpaid = team;
        daily.active_pool = 0;
    }
    if daily.active_pool == 0 && daily.winner_amount == 0 && daily.team_amount == 0 {
        daily.winner_paid = true;
        daily.team_paid = true;
    }

    let day_bytes = daily.day.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        seeds::DAILY_VAULT,
        &day_bytes,
        &[daily.vault_authority_bump],
    ]];

    if !daily.winner_paid && daily.winner_unpaid > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.winner_token.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer_seeds,
            ),
            daily.winner_unpaid,
            USDC_DECIMALS,
        )?;
        daily.total_settled = daily
            .total_settled
            .checked_add(daily.winner_unpaid)
            .ok_or(CrossyError::Overflow)?;
        daily.winner_unpaid = 0;
        daily.winner_paid = true;
        emit!(PayoutLegCompleted {
            day: daily.day,
            leg: 0,
            amount: daily.winner_amount,
            destination: ctx.accounts.winner_token.key(),
        });
    }

    if !daily.team_paid && daily.team_unpaid > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.team_treasury.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer_seeds,
            ),
            daily.team_unpaid,
            USDC_DECIMALS,
        )?;
        daily.total_settled = daily
            .total_settled
            .checked_add(daily.team_unpaid)
            .ok_or(CrossyError::Overflow)?;
        daily.team_unpaid = 0;
        daily.team_paid = true;
        emit!(PayoutLegCompleted {
            day: daily.day,
            leg: 1,
            amount: daily.team_amount,
            destination: ctx.accounts.team_treasury.key(),
        });
    }

    if daily.winner_paid && daily.team_paid {
        daily.status = DayStatus::Settled;
        emit!(DaySettled {
            day: daily.day,
            winner: daily.settled_winner,
            winner_amount: daily.winner_amount,
            team_amount: daily.team_amount,
        });
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// void_day
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct VoidDay<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = config.admin == admin.key() @ CrossyError::NotAdmin
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [seeds::DAILY, &daily.day.to_le_bytes()],
        bump = daily.bump,
    )]
    pub daily: Box<Account<'info, DailyCompetition>>,
    pub admin: Signer<'info>,
}

/// Irreversible: converts same-day player contributions into refund liability.
/// Inherited rollover is not owned by today's entrants, so it remains a
/// rollover liability for the successor day. Pending receipts follow their
/// own refund path. No winner and no team fee.
pub fn void_day(ctx: Context<VoidDay>) -> Result<()> {
    let daily = &mut ctx.accounts.daily;
    require!(
        matches!(
            daily.status,
            DayStatus::Prepared | DayStatus::Open | DayStatus::Closed | DayStatus::Committed
        ),
        CrossyError::InvalidTransition
    );
    let player_contributions = daily
        .active_pool
        .checked_sub(daily.rollover_in)
        .ok_or(CrossyError::LiabilityMismatch)?;
    daily.refund_liability = daily
        .refund_liability
        .checked_add(player_contributions)
        .ok_or(CrossyError::Overflow)?;
    daily.rollover_out = daily
        .rollover_out
        .checked_add(daily.rollover_in)
        .ok_or(CrossyError::Overflow)?;
    daily.active_pool = 0;
    daily.winner_amount = 0;
    daily.team_amount = 0;
    daily.status = DayStatus::Voided;
    emit!(DayVoided {
        day: daily.day,
        refund_liability: daily.refund_liability
    });
    Ok(())
}
