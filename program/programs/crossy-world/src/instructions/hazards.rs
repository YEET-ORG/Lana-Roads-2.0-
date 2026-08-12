//! Event-driven hazard resolution — no 500-player global tick.
//!
//! Every movement/displacement schedules the tile's next meaningful hazard
//! deadline on the run (`hazard_nonce` + `hazard_deadline_ms`). A bounded,
//! permissionless check recomputes canonical hazard state at authoritative
//! time and executes the death transition if lethal. Stale nonces reject
//! harmlessly; disconnected players remain fully subject to hazards.

use anchor_lang::prelude::*;

use crate::constants::{seeds, REVIVE_WINDOW_SECONDS};
use crate::errors::CrossyError;
use crate::events::*;
use crate::kernel::{grid, hazard};
use crate::state::*;

use super::gameplay::{assert_sector, lane_for_row, world_time_ms};

#[derive(Accounts)]
pub struct CheckHazard<'info> {
    #[account(
        mut,
        seeds = [seeds::WORLD, &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
    )]
    pub world: Box<Account<'info, WorldHeader>>,
    #[account(
        mut,
        seeds = [seeds::RUN, world.key().as_ref(), run.wallet.as_ref()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, PlayerRun>>,
    /// Sector containing the run's current tile.
    #[account(mut)]
    pub sector: Box<Account<'info, OccupancySector>>,
    /// Chunk covering the run's current row.
    pub chunk: Box<Account<'info, ChunkDefinition>>,
}

/// Permissionless collision check against canonical hazard state. Never
/// trusts precomputed client data; recomputes from the revealed chunk and
/// authoritative ER time. A Guardian shield absorbs exactly one lethal
/// environmental collision.
pub fn check_hazard(ctx: Context<CheckHazard>, hazard_nonce: u32) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let world_key = ctx.accounts.world.key();
    let world = &mut ctx.accounts.world;
    let run = &mut ctx.accounts.run;

    // Stale or superseded schedule: harmless no-op rejection.
    require!(
        run.hazard_nonce == hazard_nonce,
        CrossyError::StaleHazardNonce
    );
    require!(run.state == RunState::Active, CrossyError::BadRunState);

    assert_sector(&ctx.accounts.sector, &world_key, run.x, run.y)?;
    require!(
        ctx.accounts.chunk.day == world.day,
        CrossyError::BadChunkState
    );

    let t_ms = world_time_ms(world, now)?;
    let lane = lane_for_row(&ctx.accounts.chunk, run.y)?;
    let descriptor: crate::kernel::chunkgen::LaneDescriptor = (*lane).into();

    if !hazard::is_lethal(&descriptor, run.x, t_ms) {
        // Still safe: reschedule the next meaningful deadline, if any.
        run.hazard_nonce = run.hazard_nonce.wrapping_add(1);
        run.hazard_deadline_ms =
            hazard::next_hazard_deadline_ms(&descriptor, run.x, t_ms).unwrap_or(0);
        return Ok(());
    }

    // Shield absorbs one environmental collision.
    if run.shield_charges > 0 && now < run.shield_until {
        run.shield_charges -= 1;
        run.hazard_nonce = run.hazard_nonce.wrapping_add(1);
        run.hazard_deadline_ms =
            hazard::next_hazard_deadline_ms(&descriptor, run.x, t_ms).unwrap_or(0);
        return Ok(());
    }

    execute_death(world, run, &mut ctx.accounts.sector, world_key, now, 0)
}

/// The single authoritative death transition (environmental causes only —
/// no ability may call this directly on another player).
pub fn execute_death(
    world: &mut WorldHeader,
    run: &mut PlayerRun,
    sector: &mut OccupancySector,
    world_key: Pubkey,
    now: i64,
    cause: u8,
) -> Result<()> {
    // Remove from occupancy immediately.
    let bit = grid::sector_bit(run.x, run.y);
    sector.clear_occupied(bit);
    world.active_players = world.active_players.saturating_sub(1);

    let death_x = run.x;
    let death_y = run.y;
    run.death_nonce = run
        .death_nonce
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;
    // Invalidate movement and scheduled-action nonces.
    run.hazard_nonce = run.hazard_nonce.wrapping_add(1);
    run.hazard_deadline_ms = 0;

    match world.mode {
        WorldMode::Paid => {
            run.state = RunState::DeadAwaitingRevive;
            run.last_committed_state = RunState::DeadAwaitingRevive as u8;
            // 60-second window, clamped to the day cutoff.
            let deadline = now
                .checked_add(REVIVE_WINDOW_SECONDS)
                .ok_or(CrossyError::Overflow)?
                .min(world.end_ts - 1);
            run.revive_deadline = deadline;
            emit!(PlayerDied {
                world: world_key,
                wallet: run.wallet,
                attempt_nonce: run.attempt_nonce,
                death_nonce: run.death_nonce,
                cause,
                x: death_x,
                y: death_y,
                revive_deadline: deadline,
            });
        }
        WorldMode::Casual => {
            // Casual death ends the run; a new free run may start at once.
            run.state = RunState::Ended;
            run.last_committed_state = RunState::Ended as u8;
            run.revive_deadline = 0;
            emit!(PlayerDied {
                world: world_key,
                wallet: run.wallet,
                attempt_nonce: run.attempt_nonce,
                death_nonce: run.death_nonce,
                cause,
                x: death_x,
                y: death_y,
                revive_deadline: 0,
            });
            emit!(AttemptEnded {
                world: world_key,
                wallet: run.wallet,
                attempt_nonce: run.attempt_nonce,
                final_score: run.score,
                reason: 3, // environmental death (casual)
            });
        }
    }
    Ok(())
}
