//! Delegated gameplay: run initialization, sessions, spawn, movement,
//! record claims, and revival completion. These instructions execute on the
//! ER (except base-layer initialization) and are signed by session keys —
//! which can never touch USDC, NFTs, or admin state.

use anchor_lang::prelude::*;

use crate::constants::{seeds, CHUNK_ROWS, ENTRY_PRICE, MS_PER_SLOT, WORLD_WIDTH};
use crate::errors::CrossyError;
use crate::events::*;
use crate::kernel::grid::{self, Direction};
use crate::kernel::{economy, hazard};
use crate::state::*;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/// Milliseconds of authoritative time since world start.
pub fn world_time_ms(world: &WorldHeader, clock: &Clock) -> Result<u64> {
    // The day must have started; hazards are meaningless before it.
    require!(
        clock.unix_timestamp >= world.start_ts,
        CrossyError::DayNotStarted
    );
    // Time comes from the SLOT, not from `unix_timestamp`.
    //
    // `unix_timestamp` advances in whole seconds, so hazards used to
    // teleport up to four tiles at once and no renderer could do anything
    // but guess in between. Every instruction that reads this clock takes
    // the delegated world and therefore runs on the ephemeral rollup,
    // where a block is ~50ms — twenty times finer, and the same counter
    // every client can read, instead of each one trusting its own wall
    // clock.
    //
    // The origin is deliberately absolute rather than measured from
    // `start_ts`: lane phases are arbitrary already, so where t=0 sits
    // changes nothing about the pattern, and anchoring to a base-layer
    // timestamp would mean mixing two unrelated slot spaces.
    clock
        .slot
        .checked_mul(MS_PER_SLOT)
        .ok_or(error!(CrossyError::Overflow))
}

/// Validate a session-signed gameplay action envelope. Enforces world open,
/// pre-cutoff time, session authority/expiry/scope, attempt binding, and
/// exact-next action sequence.
#[allow(clippy::too_many_arguments)]
pub fn validate_action(
    world: &WorldHeader,
    run: &PlayerRun,
    signer: &Pubkey,
    scope_bit: u8,
    attempt_nonce: u32,
    action_seq: u64,
    now: i64,
) -> Result<()> {
    require!(world.status == WorldStatus::Open, CrossyError::WorldNotOpen);
    require!(world.spawn_ready, CrossyError::FrontierClosed);
    require!(now < world.end_ts, CrossyError::CutoffPassed);
    // Session OR wallet may sign (wallet always retains authority).
    if *signer != run.wallet {
        require_keys_eq!(*signer, run.session_authority, CrossyError::BadSession);
        require!(now < run.session_expiry, CrossyError::SessionExpired);
        require!(
            run.session_scope & scope_bit != 0,
            CrossyError::SessionScope
        );
    }
    require!(
        run.attempt_nonce == attempt_nonce,
        CrossyError::BadAttemptNonce
    );
    require!(run.action_seq == action_seq, CrossyError::BadActionSequence);
    require!(run.state == RunState::Active, CrossyError::BadRunState);
    Ok(())
}

/// Effects on the tile the run currently occupies (stun/slow zones).
pub fn tile_effects(sector: &OccupancySector, x: u8, y: u32, now: i64) -> (bool, bool) {
    let mut stunned = false;
    let mut slowed = false;
    for e in sector.effects.iter() {
        if e.covers(x, y, now) {
            match e.kind {
                k if k == AbilityKind::AreaStun as u8 => stunned = true,
                k if k == AbilityKind::Trap as u8 || k == AbilityKind::TimeSlow as u8 => {
                    slowed = true
                }
                _ => {}
            }
        }
    }
    (stunned, slowed)
}

/// Lane descriptor for absolute row `y` out of the chunk covering it.
pub fn lane_for_row(chunk: &ChunkDefinition, y: u32) -> Result<&Lane> {
    let row_end = chunk
        .row_start
        .checked_add(CHUNK_ROWS as u32)
        .ok_or(CrossyError::Overflow)?;
    require!(
        y >= chunk.row_start && y < row_end,
        CrossyError::BadChunkState
    );
    require!(
        chunk.status == ChunkStatus::Revealed,
        CrossyError::FrontierClosed
    );
    Ok(&chunk.lanes[(y - chunk.row_start) as usize])
}

/// Verify a sector account matches the derived coordinates for a tile.
pub fn assert_sector(sector: &OccupancySector, world: &Pubkey, x: u8, y: u32) -> Result<()> {
    let (sx, sy) = grid::sector_of(x, y);
    require!(
        sector.world == *world && sector.sector_x == sx && sector.sector_y == sy,
        CrossyError::WrongSector
    );
    Ok(())
}

fn accept_turn_in_place(run: &mut PlayerRun, direction: u8, slot: u64) -> Result<()> {
    run.facing = direction;
    run.last_move_slot = slot;
    run.action_seq = run.action_seq.checked_add(1).ok_or(CrossyError::Overflow)?;
    run.touch()
}

// ---------------------------------------------------------------------------
// init_run (base layer, before delegation)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitRun<'info> {
    /// CHECK: the target world. Usually DELEGATED by the time players join
    /// (owner = delegation program), so a typed Account would reject it —
    /// the handler validates address + discriminator via
    /// `read_committed_world` and reads the immutable day window from the
    /// committed data.
    pub world: UncheckedAccount<'info>,
    #[account(
        init,
        payer = wallet,
        space = 8 + PlayerRun::INIT_SPACE,
        seeds = [seeds::RUN, world.key().as_ref(), wallet.key().as_ref()],
        bump
    )]
    pub run: Box<Account<'info, PlayerRun>>,
    #[account(
        init_if_needed,
        payer = wallet,
        space = 8 + DailyBest::INIT_SPACE,
        seeds = [seeds::BEST, world.key().as_ref(), wallet.key().as_ref()],
        bump
    )]
    pub best: Box<Account<'info, DailyBest>>,
    #[account(mut)]
    pub wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Create the wallet's run + best accounts for a world (once per day per
/// mode), registering the initial session key. Delegation happens next.
pub fn init_run(
    ctx: Context<InitRun>,
    session_authority: Pubkey,
    session_expiry: i64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    // Validate the (possibly delegated) world by expected PDA address:
    // the account key must match one of the two mode-PDAs whose committed
    // data it deserializes to.
    let world = {
        let committed =
            crate::cross_plane::read_committed_world_any(&ctx.accounts.world.to_account_info())?;
        let expected = Pubkey::find_program_address(
            &[
                seeds::WORLD,
                &[committed.region],
                &[committed.mode as u8],
                &committed.day.to_le_bytes(),
            ],
            &crate::ID,
        )
        .0;
        require_keys_eq!(
            ctx.accounts.world.key(),
            expected,
            CrossyError::NotReconcilable
        );
        committed
    };
    require!(now < world.end_ts, CrossyError::CutoffPassed);
    require!(
        session_expiry > now && session_expiry <= now + crate::constants::MAX_SESSION_SECONDS,
        CrossyError::SessionExpired
    );

    let run = &mut ctx.accounts.run;
    run.world = ctx.accounts.world.key();
    run.wallet = ctx.accounts.wallet.key();
    run.session_authority = session_authority;
    run.session_expiry = session_expiry;
    run.session_scope = session_scope::ALL_GAMEPLAY;
    run.state = RunState::Idle;
    run.state_seq = 0;
    run.bump = ctx.bumps.run;

    let best = &mut ctx.accounts.best;
    if best.wallet == Pubkey::default() {
        best.world = ctx.accounts.world.key();
        best.wallet = ctx.accounts.wallet.key();
        best.bump = ctx.bumps.best;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// rotate_session (wallet-signed; executes wherever the run currently lives)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RotateSession<'info> {
    #[account(
        mut,
        constraint = run.wallet == wallet.key() @ CrossyError::NotWallet
    )]
    pub run: Box<Account<'info, PlayerRun>>,
    pub wallet: Signer<'info>,
}

/// Lost-session recovery: the wallet rotates the gameplay authority without
/// changing score or economic ownership. Rate-limited by rotation counter.
pub fn rotate_session(
    ctx: Context<RotateSession>,
    new_authority: Pubkey,
    new_expiry: i64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        new_expiry > now && new_expiry <= now + crate::constants::MAX_SESSION_SECONDS,
        CrossyError::SessionExpired
    );
    let run = &mut ctx.accounts.run;
    run.session_authority = new_authority;
    run.session_expiry = new_expiry;
    run.session_rotation = run
        .session_rotation
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;
    run.touch()?;
    Ok(())
}

/// Hand the gameplay authority back to the wallet.
///
/// A session key lives in browser storage and keeps working until it
/// expires, so a player who walks away, dies, or closes the tab leaves a
/// usable credential behind for as long as it has left to run. Ending it is
/// the wallet saying "nothing may act for me until I say so again": the
/// authority is cleared and the expiry zeroed, so every session-signed
/// action is refused from the next instruction onward.
///
/// This touches no score, position, or ownership, and the wallet can always
/// act on its own run or register a fresh session with `rotate_session`.
pub fn end_session(ctx: Context<RotateSession>) -> Result<()> {
    let run = &mut ctx.accounts.run;
    run.session_authority = Pubkey::default();
    run.session_expiry = 0;
    run.session_rotation = run
        .session_rotation
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;
    run.touch()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// spawn (ER) — paid via receipt, casual free
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Spawn<'info> {
    #[account(
        mut,
        seeds = [seeds::WORLD, &[world.region], &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
    )]
    pub world: Box<Account<'info, WorldHeader>>,
    #[account(
        mut,
        seeds = [seeds::RUN, world.key().as_ref(), run.wallet.as_ref()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, PlayerRun>>,
    /// Entry receipt (paid mode): cloned base account, read-only evidence of
    /// finalized payment. Casual mode passes the world account here instead.
    /// CHECK: validated in handler per mode.
    pub receipt: UncheckedAccount<'info>,
    /// Agent lock for this attempt: program-derived class binding.
    /// CHECK: PDA + discriminator validated in handler.
    pub agent_lock: UncheckedAccount<'info>,
    pub signer: Signer<'info>,
    // remaining_accounts: the 16 spawn-zone sectors in canonical order
    // (sy 0..2, sx 0..8), all writable.
}

/// Evaluate the spawn: deterministic wrapped scan from a wallet-derived
/// offset over the 64x16 safe zone, atomically reserving the first free
/// unblocked tile. Full capacity or cutoff commits EntryFailed (never a
/// silently charged active entry).
pub fn spawn<'info>(ctx: Context<'info, Spawn<'info>>, attempt_nonce: u32) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let world_key = ctx.accounts.world.key();
    let world = &mut ctx.accounts.world;
    let run = &mut ctx.accounts.run;

    // Signed by wallet or registered session.
    let signer = ctx.accounts.signer.key();
    if signer != run.wallet {
        require_keys_eq!(signer, run.session_authority, CrossyError::BadSession);
        require!(now < run.session_expiry, CrossyError::SessionExpired);
    }

    require!(world.status == WorldStatus::Open, CrossyError::WorldNotOpen);
    require!(world.spawn_ready, CrossyError::FrontierClosed);
    require!(now >= world.start_ts, CrossyError::DayNotStarted);
    require!(run.is_terminal(), CrossyError::AttemptStillActive);
    let next_attempt = run
        .attempt_nonce
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;
    require!(next_attempt == attempt_nonce, CrossyError::BadAttemptNonce);

    // Agent lock: the program-derived class binding for this attempt. The
    // lock PDA is derived from (world, wallet, attempt); its class_id is the
    // ONLY class source — clients never supply a class.
    let (expected_lock, _) = Pubkey::find_program_address(
        &[
            seeds::AGENT_LOCK,
            world_key.as_ref(),
            run.wallet.as_ref(),
            &attempt_nonce.to_le_bytes(),
        ],
        &crate::ID,
    );
    require_keys_eq!(
        ctx.accounts.agent_lock.key(),
        expected_lock,
        CrossyError::BadClassMapping
    );
    let (class_id, agent_asset) = {
        let info = ctx.accounts.agent_lock.to_account_info();
        require_keys_eq!(*info.owner, crate::ID, CrossyError::BadClassMapping);
        let data = info.try_borrow_data()?;
        require!(data.len() > 8, CrossyError::BadClassMapping);
        use anchor_lang::Discriminator;
        require!(
            data[..8] == AgentLock::DISCRIMINATOR[..],
            CrossyError::BadClassMapping
        );
        let lock = AgentLock::try_deserialize(&mut &data[..])
            .map_err(|_| error!(CrossyError::BadClassMapping))?;
        require!(lock.owner == run.wallet, CrossyError::WrongAssetOwner);
        require!(lock.world == world_key, CrossyError::BadClassMapping);
        require!(
            lock.attempt_nonce == attempt_nonce,
            CrossyError::BadAttemptNonce
        );
        require!(!lock.unlocked, CrossyError::AgentLocked);
        (lock.class_id, lock.asset)
    };

    // Paid mode requires authenticated durable payment evidence: the entry
    // receipt PDA for this run/attempt, in Pending state, exact entry amount.
    if world.mode == WorldMode::Paid {
        let receipt_info = ctx.accounts.receipt.to_account_info();
        require_keys_eq!(*receipt_info.owner, crate::ID, CrossyError::ReceiptMismatch);
        let data = receipt_info.try_borrow_data()?;
        require!(data.len() > 8, CrossyError::ReceiptMismatch);
        use anchor_lang::Discriminator;
        require!(
            data[..8] == PaymentReceipt::DISCRIMINATOR[..],
            CrossyError::ReceiptMismatch
        );
        let receipt = PaymentReceipt::try_deserialize(&mut &data[..])
            .map_err(|_| error!(CrossyError::ReceiptMismatch))?;
        require!(
            receipt.kind == ReceiptKind::Entry,
            CrossyError::ReceiptMismatch
        );
        require!(receipt.day == world.day, CrossyError::ReceiptMismatch);
        require!(receipt.wallet == run.wallet, CrossyError::ReceiptMismatch);
        require!(receipt.run == run.key(), CrossyError::ReceiptMismatch);
        require!(receipt.amount == ENTRY_PRICE, CrossyError::WrongAmount);
        require!(
            receipt.attempt_nonce == attempt_nonce,
            CrossyError::ReceiptMismatch
        );
        let receipt_nonce = receipt.receipt_nonce.to_le_bytes();
        let (expected_receipt, _) = Pubkey::find_program_address(
            &[
                seeds::PAYMENT,
                &[ReceiptKind::Entry as u8],
                &[world.region],
                &world.day.to_le_bytes(),
                run.wallet.as_ref(),
                &receipt_nonce,
            ],
            &crate::ID,
        );
        require_keys_eq!(
            ctx.accounts.receipt.key(),
            expected_receipt,
            CrossyError::ReceiptMismatch
        );
        require!(
            receipt.state == ReceiptState::Pending,
            CrossyError::BadReceiptState
        );
        run.entry_receipt = ctx.accounts.receipt.key();
    } else {
        run.entry_receipt = Pubkey::default();
    }

    // Cutoff / capacity failure -> committed EntryFailed.
    let failed = now >= world.end_ts || world.active_players >= world.player_cap;
    if failed {
        run.attempt_nonce = attempt_nonce;
        run.state = RunState::EntryFailed;
        run.last_committed_state = RunState::EntryFailed as u8;
        run.touch()?;
        emit!(AttemptEnded {
            world: world_key,
            wallet: run.wallet,
            attempt_nonce,
            final_score: 0,
            reason: 1, // spawn failed
        });
        return Ok(());
    }

    // Deterministic wrapped scan over the safe zone via remaining accounts.
    let tile_count = WORLD_WIDTH as u32 * world.safe_rows as u32;
    let wallet_bytes = run.wallet.to_bytes();
    let start = grid::spawn_scan_start(&wallet_bytes, world.day, attempt_nonce, tile_count);

    let sectors = ctx.remaining_accounts;
    let expected_sectors = (world.safe_rows as usize).div_ceil(8) * (WORLD_WIDTH as usize / 8);
    require!(sectors.len() == expected_sectors, CrossyError::WrongSector);

    // Find the first free tile scanning from `start`, wrapping.
    let mut chosen: Option<(u8, u32, usize, u8)> = None;
    for i in 0..tile_count {
        let idx = (start + i) % tile_count;
        let (x, y) = grid::scan_index_to_tile(idx);
        let (sx, sy) = grid::sector_of(x, y);
        let sector_index = sy as usize * (WORLD_WIDTH as usize / 8) + sx as usize;
        let info = &sectors[sector_index];
        let sector: Account<OccupancySector> = Account::try_from(info)?;
        assert_sector(&sector, &world_key, x, y)?;
        let bit = grid::sector_bit(x, y);
        if !sector.is_occupied(bit) && !sector.is_blocked(bit) {
            chosen = Some((x, y, sector_index, bit));
            break;
        }
    }

    match chosen {
        Some((x, y, sector_index, bit)) => {
            let info = &sectors[sector_index];
            let mut sector: Account<OccupancySector> = Account::try_from(info)?;
            sector.set_occupied(bit)?;
            sector.exit(&crate::ID)?;

            run.attempt_nonce = attempt_nonce;
            run.state = RunState::Active;
            run.agent_asset = agent_asset;
            run.class_id = class_id;
            run.class_version = world.class_balance_version;
            run.x = x;
            run.y = y;
            run.facing = 0;
            run.score = 0;
            run.safe_x = x;
            run.safe_y = y;
            run.last_move_slot = 0;
            run.action_seq = 0;
            // Cooldowns and status effects persist ONLY within an attempt;
            // a fresh attempt starts clean.
            run.kick_ready_ts = 0;
            run.ability_ready_ts = 0;
            run.stunned_until = 0;
            run.slowed_until = 0;
            run.shield_until = 0;
            run.shield_charges = 0;
            run.anchor_until = 0;
            run.successful_revives = 0;
            run.death_nonce = 0;
            run.revive_deadline = 0;
            run.revive_receipt = Pubkey::default();
            run.bump_hazard_nonce()?;
            run.hazard_deadline_ms = 0;
            run.last_committed_state = RunState::Active as u8;

            world.active_players = world
                .active_players
                .checked_add(1)
                .ok_or(CrossyError::Overflow)?;

            emit!(AttemptActivated {
                world: world_key,
                wallet: run.wallet,
                attempt_nonce,
                class_id,
                asset: agent_asset,
                x,
                y,
            });
        }
        None => {
            run.attempt_nonce = attempt_nonce;
            run.state = RunState::EntryFailed;
            run.last_committed_state = RunState::EntryFailed as u8;
            emit!(AttemptEnded {
                world: world_key,
                wallet: run.wallet,
                attempt_nonce,
                final_score: 0,
                reason: 1,
            });
        }
    }
    run.touch()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// move_action (ER)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct MoveAction<'info> {
    /// Mutable: a move into a hazard window is fatal, and death updates the
    /// world's active-player count.
    #[account(
        mut,
        seeds = [seeds::WORLD, &[world.region], &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
    )]
    pub world: Box<Account<'info, WorldHeader>>,
    #[account(
        mut,
        seeds = [seeds::RUN, world.key().as_ref(), run.wallet.as_ref()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, PlayerRun>>,
    /// Source sector (must match the run's current tile).
    #[account(mut)]
    pub source_sector: Box<Account<'info, OccupancySector>>,
    /// Destination sector for cross-sector moves; None when the destination
    /// shares the source sector (Anchor forbids duplicate mutable accounts).
    #[account(mut)]
    pub dest_sector: Option<Box<Account<'info, OccupancySector>>>,
    /// Chunk covering the destination row.
    pub chunk: Box<Account<'info, ChunkDefinition>>,
    #[account(
        mut,
        seeds = [seeds::BEST, world.key().as_ref(), run.wallet.as_ref()],
        bump = best.bump,
    )]
    pub best: Box<Account<'info, DailyBest>>,
    pub signer: Signer<'info>,
}

/// One-tile cardinal movement. The program derives the destination, checks
/// bounds/frontier/terrain/occupancy, and writes run + sectors atomically.
/// A blocked destination consumes the action as a turn-in-place, allowing
/// the next Kick to target that direction without moving through the blocker.
pub fn move_action(
    mut ctx: Context<MoveAction>,
    attempt_nonce: u32,
    action_seq: u64,
    direction: u8,
    _uniq: u64, // client uniqueness memo: distinct logical actions never share bytes
) -> Result<()> {
    let clock = Clock::get()?;
    move_step(
        &mut ctx,
        attempt_nonce,
        action_seq,
        direction,
        &clock,
        clock.slot,
    )
}

/// Execute a bounded prefix in one sector, using elapsed runtime slots as
/// credit. All hazards are evaluated NOW, never at client-supplied timestamps.
/// Blockage, death, exhausted credit or a sector boundary stops the prefix.
/// Invalid envelopes/accounts fail the entire transaction.
pub fn move_batch(
    mut ctx: Context<MoveAction>,
    attempt_nonce: u32,
    action_seq: u64,
    directions: Vec<u8>,
    _uniq: u64,
) -> Result<()> {
    use crate::kernel::movement::{next_move_slot, MAX_MOVE_BATCH};
    require!(
        !directions.is_empty() && directions.len() <= MAX_MOVE_BATCH,
        CrossyError::CapacityExceeded
    );
    require!(
        directions.iter().all(|d| Direction::from_u8(*d).is_some()),
        CrossyError::OutOfBounds
    );
    require!(ctx.accounts.dest_sector.is_none(), CrossyError::WrongSector);
    let clock = Clock::get()?;
    validate_action(
        &ctx.accounts.world,
        &ctx.accounts.run,
        &ctx.accounts.signer.key(),
        session_scope::MOVE,
        attempt_nonce,
        action_seq,
        clock.unix_timestamp,
    )?;
    assert_sector(
        &ctx.accounts.source_sector,
        &ctx.accounts.world.key(),
        ctx.accounts.run.x,
        ctx.accounts.run.y,
    )?;

    for (index, direction) in directions.into_iter().enumerate() {
        let run = &ctx.accounts.run;
        let (x, y) = (run.x, run.y);
        let Some((nx, ny)) = grid::step(x, y, Direction::from_u8(direction).unwrap()) else {
            break;
        };
        if grid::sector_of(x, y) != grid::sector_of(nx, ny) {
            break;
        }
        let (stunned, slowed) =
            tile_effects(&ctx.accounts.source_sector, x, y, clock.unix_timestamp);
        if stunned || clock.unix_timestamp < run.stunned_until {
            break;
        }
        let gap = if slowed || clock.unix_timestamp < run.slowed_until {
            2
        } else {
            1
        };
        let Some(slot) = next_move_slot(run.last_move_slot, clock.slot, gap) else {
            break;
        };
        let seq = action_seq
            .checked_add(index as u64)
            .ok_or(CrossyError::Overflow)?;
        move_step(&mut ctx, attempt_nonce, seq, direction, &clock, slot)?;
        if ctx.accounts.run.state != RunState::Active
            || (ctx.accounts.run.x, ctx.accounts.run.y) == (x, y)
        {
            break;
        }
    }
    Ok(())
}

fn move_step(
    ctx: &mut Context<MoveAction>,
    attempt_nonce: u32,
    action_seq: u64,
    direction: u8,
    clock: &Clock,
    move_slot: u64,
) -> Result<()> {
    let now = clock.unix_timestamp;
    let world_key = ctx.accounts.world.key();
    let world = &ctx.accounts.world;
    let run = &mut ctx.accounts.run;

    validate_action(
        world,
        run,
        &ctx.accounts.signer.key(),
        session_scope::MOVE,
        attempt_nonce,
        action_seq,
        now,
    )?;

    // Cadence: one accepted move per ER slot; slowed players every 2 slots.
    let (stunned, slowed_zone) = tile_effects(&ctx.accounts.source_sector, run.x, run.y, now);
    require!(
        !stunned && now >= run.stunned_until,
        CrossyError::Immobilized
    );
    let min_gap = if slowed_zone || now < run.slowed_until {
        2
    } else {
        1
    };
    require!(
        run.last_move_slot == 0
            || clock.slot
                >= run
                    .last_move_slot
                    .checked_add(min_gap)
                    .ok_or(CrossyError::Overflow)?,
        CrossyError::TooFast
    );

    let dir = Direction::from_u8(direction).ok_or(CrossyError::OutOfBounds)?;
    let (nx, ny) = grid::step(run.x, run.y, dir).ok_or(CrossyError::OutOfBounds)?;

    // Fail closed at the unrevealed frontier.
    require!(ny < world.revealed_rows, CrossyError::FrontierClosed);

    // Sector accounts must match derived coordinates. `dest_sector: None`
    // means the destination shares the source sector.
    assert_sector(&ctx.accounts.source_sector, &world_key, run.x, run.y)?;
    match &ctx.accounts.dest_sector {
        Some(dest) => assert_sector(dest, &world_key, nx, ny)?,
        None => assert_sector(&ctx.accounts.source_sector, &world_key, nx, ny)?,
    }

    // Terrain: destination must be traversable at the authoritative instant.
    let t_ms = world_time_ms(world, clock)?;
    let lane = lane_for_row(&ctx.accounts.chunk, ny)?;
    require!(
        ctx.accounts.chunk.day == world.day && ctx.accounts.chunk.region == world.region,
        CrossyError::BadChunkState
    );
    let descriptor: crate::kernel::chunkgen::LaneDescriptor = (*lane).into();
    // Terrain decides what entering the tile *means*, not whether it is
    // allowed. Rocks and trees are walls and simply stop you; traffic,
    // trains and open water are entered and are fatal. Only the fatal case
    // needs to be carried past the occupancy transfer below.
    let fatal = match hazard::evaluate_tile(&descriptor, nx, t_ms) {
        hazard::TileState::Blocked => {
            accept_turn_in_place(run, direction, move_slot)?;
            return Ok(());
        }
        hazard::TileState::Lethal => true,
        hazard::TileState::Safe | hazard::TileState::Supported => false,
    };

    let dest_bit = grid::sector_bit(nx, ny);
    {
        let dest_view = ctx
            .accounts
            .dest_sector
            .as_deref()
            .unwrap_or(&ctx.accounts.source_sector);
        if dest_view.is_blocked(dest_bit) || dest_view.is_occupied(dest_bit) {
            accept_turn_in_place(run, direction, move_slot)?;
            return Ok(());
        }
    }

    // Atomic occupancy transfer.
    let src_bit = grid::sector_bit(run.x, run.y);
    match ctx.accounts.dest_sector.as_deref_mut() {
        None => {
            let sector = &mut ctx.accounts.source_sector;
            sector.clear_occupied(src_bit)?;
            sector.set_occupied(dest_bit)?;
        }
        Some(dest) => {
            ctx.accounts.source_sector.clear_occupied(src_bit)?;
            dest.set_occupied(dest_bit)?;
        }
    }

    run.x = nx;
    run.y = ny;
    run.facing = direction;
    run.last_move_slot = move_slot;
    run.action_seq = run.action_seq.checked_add(1).ok_or(CrossyError::Overflow)?;

    if fatal {
        // A shield absorbs one lethal environmental collision, here exactly
        // as it does for a hazard that arrives while standing still.
        if run.shield_charges > 0 && now < run.shield_until {
            run.shield_charges -= 1;
            run.bump_hazard_nonce()?;
            run.hazard_deadline_ms =
                hazard::next_hazard_deadline_ms(&descriptor, nx, t_ms).unwrap_or(0);
            run.touch()?;
            return Ok(());
        }
        // Walking into traffic scores nothing: the row is not survived.
        let sector: &mut OccupancySector = match ctx.accounts.dest_sector.as_deref_mut() {
            Some(dest) => dest,
            None => &mut ctx.accounts.source_sector,
        };
        return crate::instructions::hazards::execute_death(
            &mut ctx.accounts.world,
            run,
            sector,
            world_key,
            now,
            descriptor.kind.saturating_add(1),
        );
    }

    // Track last verified safe tile (grass, unblocked).
    if hazard::evaluate_tile(&descriptor, nx, t_ms) == hazard::TileState::Safe {
        run.safe_x = nx;
        run.safe_y = ny;
    }

    // Score: strictly-forward record within the attempt.
    if ny > run.score {
        run.score = ny;
        let best = &mut ctx.accounts.best;
        if ny > best.best_score {
            best.best_score = ny;
            best.attempt_nonce = run.attempt_nonce;
            best.reached_slot = clock.slot;
            best.class_id = run.class_id;
            best.asset = run.agent_asset;
        }
    }

    // Hazard scheduling for the entered tile.
    run.bump_hazard_nonce()?;
    run.hazard_deadline_ms = hazard::next_hazard_deadline_ms(&descriptor, nx, t_ms).unwrap_or(0);
    run.touch()?;

    Ok(())
}

// ---------------------------------------------------------------------------
// claim_record (ER) — decoupled from movement to avoid a global hot account
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ClaimRecord<'info> {
    #[account(
        mut,
        seeds = [seeds::WORLD, &[world.region], &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
    )]
    pub world: Box<Account<'info, WorldHeader>>,
    #[account(
        seeds = [seeds::BEST, world.key().as_ref(), best.wallet.as_ref()],
        bump = best.bump,
        constraint = best.world == world.key() @ CrossyError::NotReconcilable
    )]
    pub best: Box<Account<'info, DailyBest>>,
}

/// Permissionless: propagate a wallet's permanent daily best into the world
/// record when it STRICTLY exceeds the incumbent. Equal scores never replace
/// the record. This remains claimable after death or a new attempt resets the
/// high-frequency `PlayerRun` account.
/// Writing `WorldHeader` on every movement would serialize 500 players on
/// one account (explicitly prohibited); the client/crank calls this whenever
/// its run's score beats the observed record.
pub fn claim_record(ctx: Context<ClaimRecord>) -> Result<()> {
    let world = &mut ctx.accounts.world;
    let best = &ctx.accounts.best;
    require!(
        world.status == WorldStatus::Open,
        CrossyError::InvalidTransition
    );
    require!(
        best.best_score > world.record_score,
        CrossyError::InvalidTransition
    );
    world.record_score = best.best_score;
    world.record_holder = best.wallet;
    world.record_attempt = best.attempt_nonce;
    world.record_slot = Clock::get()?.slot;
    emit!(RecordChanged {
        world: world.key(),
        wallet: best.wallet,
        attempt_nonce: best.attempt_nonce,
        score: best.best_score,
        slot: world.record_slot,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// complete_revive (ER)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CompleteRevive<'info> {
    #[account(
        mut,
        seeds = [seeds::WORLD, &[world.region], &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
        constraint = world.mode == WorldMode::Paid @ CrossyError::InvalidTransition
    )]
    pub world: Box<Account<'info, WorldHeader>>,
    #[account(
        mut,
        seeds = [seeds::RUN, world.key().as_ref(), run.wallet.as_ref()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, PlayerRun>>,
    /// Revival receipt: cloned base account, read-only payment evidence.
    /// CHECK: discriminator + binding validated in handler.
    pub receipt: UncheckedAccount<'info>,
    /// Sector containing the saved safe tile (revival placement).
    #[account(mut)]
    pub safe_sector: Box<Account<'info, OccupancySector>>,
    pub signer: Signer<'info>,
}

/// Revive at the last verified safe tile (or nearest free tile on that row,
/// found by wrapped scan inside the safe sector; a fully blocked sector
/// fails and the receipt becomes refundable via reconciliation).
pub fn complete_revive(ctx: Context<CompleteRevive>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let world_key = ctx.accounts.world.key();
    let world = &mut ctx.accounts.world;
    let run = &mut ctx.accounts.run;

    let signer = ctx.accounts.signer.key();
    if signer != run.wallet {
        require_keys_eq!(signer, run.session_authority, CrossyError::BadSession);
        require!(now < run.session_expiry, CrossyError::SessionExpired);
    }
    require!(
        run.state == RunState::DeadAwaitingRevive,
        CrossyError::BadRunState
    );
    require!(now < world.end_ts, CrossyError::CutoffPassed);
    require!(now <= run.revive_deadline, CrossyError::RevivalExpired);

    // Authenticated durable payment evidence.
    let receipt_info = ctx.accounts.receipt.to_account_info();
    require_keys_eq!(*receipt_info.owner, crate::ID, CrossyError::ReceiptMismatch);
    let data = receipt_info.try_borrow_data()?;
    require!(data.len() > 8, CrossyError::ReceiptMismatch);
    use anchor_lang::Discriminator;
    require!(
        data[..8] == PaymentReceipt::DISCRIMINATOR[..],
        CrossyError::ReceiptMismatch
    );
    let receipt = PaymentReceipt::try_deserialize(&mut &data[..])
        .map_err(|_| error!(CrossyError::ReceiptMismatch))?;
    require!(
        receipt.kind == ReceiptKind::Revival,
        CrossyError::ReceiptMismatch
    );
    require!(receipt.day == world.day, CrossyError::ReceiptMismatch);
    require!(receipt.wallet == run.wallet, CrossyError::ReceiptMismatch);
    require!(receipt.run == run.key(), CrossyError::ReceiptMismatch);
    require!(
        receipt.attempt_nonce == run.attempt_nonce,
        CrossyError::ReceiptMismatch
    );
    require!(
        receipt.death_nonce == run.death_nonce,
        CrossyError::ReceiptMismatch
    );
    require!(
        receipt.revive_index == run.successful_revives,
        CrossyError::ReceiptMismatch
    );
    let expected_amount =
        economy::revive_price(run.successful_revives).ok_or(CrossyError::Overflow)?;
    require!(receipt.amount == expected_amount, CrossyError::WrongAmount);
    let receipt_nonce = receipt.receipt_nonce.to_le_bytes();
    let (expected_receipt, _) = Pubkey::find_program_address(
        &[
            seeds::PAYMENT,
            &[ReceiptKind::Revival as u8],
            &[world.region],
            &world.day.to_le_bytes(),
            run.wallet.as_ref(),
            &receipt_nonce,
        ],
        &crate::ID,
    );
    require_keys_eq!(
        ctx.accounts.receipt.key(),
        expected_receipt,
        CrossyError::ReceiptMismatch
    );
    require!(
        receipt.state == ReceiptState::Pending,
        CrossyError::BadReceiptState
    );
    // One successful consumption per receipt.
    require!(
        run.revive_receipt != ctx.accounts.receipt.key(),
        CrossyError::AlreadyTerminal
    );

    // Reserve the saved safe tile or nearest free tile on the same safe row
    // within its sector.
    assert_sector(
        &ctx.accounts.safe_sector,
        &world_key,
        run.safe_x,
        run.safe_y,
    )?;
    let sector = &mut ctx.accounts.safe_sector;
    let base_bit = grid::sector_bit(run.safe_x, run.safe_y);
    let row_base = base_bit - (run.safe_x % 8);
    let mut placed: Option<(u8, u8)> = None; // (bit, x)
    for offset in 0..8u8 {
        // Nearest-first: 0, +1, -1, +2, -2 ... within the sector row.
        let local_x = run.safe_x % 8;
        let cand = if offset % 2 == 1 {
            local_x.checked_add(offset / 2 + 1)
        } else if offset == 0 {
            Some(local_x)
        } else {
            local_x.checked_sub(offset / 2)
        };
        let Some(cx) = cand else { continue };
        if cx >= 8 {
            continue;
        }
        let bit = row_base + cx;
        if !sector.is_occupied(bit) && !sector.is_blocked(bit) {
            let world_x = (run.safe_x / 8) * 8 + cx;
            placed = Some((bit, world_x));
            break;
        }
    }
    let (bit, world_x) = placed.ok_or(CrossyError::TileOccupied)?;
    sector.set_occupied(bit)?;

    run.state = RunState::Active;
    run.x = world_x;
    run.y = run.safe_y;
    run.successful_revives = run
        .successful_revives
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;
    run.revive_receipt = ctx.accounts.receipt.key();
    run.revive_deadline = 0;
    // Score, cooldown deadlines, agent selection, and attempt identity are
    // preserved (per the non-negotiable invariants). Cooldowns are NOT reset.
    run.bump_hazard_nonce()?;
    run.hazard_deadline_ms = 0;
    run.last_committed_state = RunState::Active as u8;
    run.touch()?;

    world.active_players = world
        .active_players
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;

    emit!(PlayerRevived {
        world: world_key,
        wallet: run.wallet,
        attempt_nonce: run.attempt_nonce,
        death_nonce: run.death_nonce,
        revive_count: run.successful_revives,
        x: run.x,
        y: run.y,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// expire_revival (ER, permissionless)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ExpireRevival<'info> {
    #[account(
        seeds = [seeds::WORLD, &[world.region], &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
    )]
    pub world: Box<Account<'info, WorldHeader>>,
    #[account(
        mut,
        seeds = [seeds::RUN, world.key().as_ref(), run.wallet.as_ref()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, PlayerRun>>,
}

/// Permissionless terminal transition once the 60-second window (or the day
/// cutoff) has passed without a successful revival.
pub fn expire_revival(ctx: Context<ExpireRevival>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let world = &ctx.accounts.world;
    let run = &mut ctx.accounts.run;
    require!(
        run.state == RunState::DeadAwaitingRevive,
        CrossyError::BadRunState
    );
    require!(
        now > run.revive_deadline || now >= world.end_ts,
        CrossyError::TimeoutNotReached
    );
    run.state = RunState::Ended;
    run.last_committed_state = RunState::Ended as u8;
    run.touch()?;
    emit!(AttemptEnded {
        world: world.key(),
        wallet: run.wallet,
        attempt_nonce: run.attempt_nonce,
        final_score: run.score,
        reason: 0, // window expired
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// end_casual_attempt — casual death ends immediately; player restarts free
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct EndAttempt<'info> {
    #[account(
        mut,
        seeds = [seeds::WORLD, &[world.region], &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
    )]
    pub world: Box<Account<'info, WorldHeader>>,
    #[account(
        mut,
        seeds = [seeds::RUN, world.key().as_ref(), run.wallet.as_ref()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, PlayerRun>>,
    /// Sector containing the run's current tile (occupancy release).
    #[account(mut)]
    pub sector: Box<Account<'info, OccupancySector>>,
    pub signer: Signer<'info>,
}

/// Voluntary end of an active attempt (paid "give up" or casual restart).
/// Releases occupancy and decrements population.
pub fn end_attempt(ctx: Context<EndAttempt>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let world_key = ctx.accounts.world.key();
    let world = &mut ctx.accounts.world;
    let run = &mut ctx.accounts.run;
    let signer = ctx.accounts.signer.key();
    if signer != run.wallet {
        require_keys_eq!(signer, run.session_authority, CrossyError::BadSession);
        require!(now < run.session_expiry, CrossyError::SessionExpired);
    }
    require!(run.state == RunState::Active, CrossyError::BadRunState);

    assert_sector(&ctx.accounts.sector, &world_key, run.x, run.y)?;
    let bit = grid::sector_bit(run.x, run.y);
    ctx.accounts.sector.clear_occupied(bit)?;

    world.active_players = world
        .active_players
        .checked_sub(1)
        .ok_or(CrossyError::LiabilityMismatch)?;
    run.state = RunState::Ended;
    run.last_committed_state = RunState::Ended as u8;
    run.touch()?;
    emit!(AttemptEnded {
        world: world_key,
        wallet: run.wallet,
        attempt_nonce: run.attempt_nonce,
        final_score: run.score,
        reason: 2, // voluntary
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocked_move_turns_without_moving_or_resetting_cooldowns() {
        let mut run = PlayerRun {
            world: Pubkey::default(),
            wallet: Pubkey::default(),
            session_authority: Pubkey::default(),
            session_expiry: 0,
            session_scope: 0,
            session_rotation: 0,
            attempt_nonce: 1,
            state: RunState::Active,
            agent_asset: Pubkey::default(),
            class_id: 0,
            class_version: 1,
            x: 7,
            y: 9,
            facing: Direction::Forward as u8,
            score: 9,
            safe_x: 7,
            safe_y: 8,
            last_move_slot: 40,
            action_seq: 12,
            state_seq: 20,
            kick_ready_ts: 500,
            ability_ready_ts: 700,
            stunned_until: 0,
            slowed_until: 0,
            shield_until: 0,
            shield_charges: 0,
            anchor_until: 0,
            successful_revives: 0,
            death_nonce: 0,
            revive_deadline: 0,
            entry_receipt: Pubkey::default(),
            revive_receipt: Pubkey::default(),
            hazard_nonce: 3,
            hazard_deadline_ms: 1_000,
            last_committed_state: RunState::Active as u8,
            bump: 1,
        };

        accept_turn_in_place(&mut run, Direction::Right as u8, 41).unwrap();

        assert_eq!((run.x, run.y, run.score), (7, 9, 9));
        assert_eq!(run.facing, Direction::Right as u8);
        assert_eq!(run.last_move_slot, 41);
        assert_eq!((run.action_seq, run.state_seq), (13, 21));
        assert_eq!((run.kick_ready_ts, run.ability_ready_ts), (500, 700));
        assert_eq!((run.hazard_nonce, run.hazard_deadline_ms), (3, 1_000));
    }
}
