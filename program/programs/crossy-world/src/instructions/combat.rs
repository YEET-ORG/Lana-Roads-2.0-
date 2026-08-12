//! Kick and class ability dispatch.
//!
//! Kick is universal: adjacent facing target, one-tile knockback, 5s
//! cooldown, no immunity, no kill credit. Abilities are a closed enum with
//! bounded arguments validated against the versioned `ClassConfig`; no
//! ability directly sets another player dead — displacement into hazards is
//! resolved by the environmental check.
//!
//! V1 zone semantics: Trap/TimeSlow/AreaStun/LaneShift effects are stored in
//! one sector and apply to tiles inside that sector (bounded locality by
//! design). Stun zones immobilize movement; timed statuses on the run gate
//! every action.

use anchor_lang::prelude::*;

use crate::constants::{seeds, KICK_COOLDOWN_SECONDS, MAX_EFFECT_RADIUS};
use crate::errors::CrossyError;
use crate::kernel::grid::{self, Direction};
use crate::kernel::hazard;
use crate::state::*;

use super::gameplay::{assert_sector, lane_for_row, validate_action, world_time_ms};

/// Which of the two provided sector accounts covers a tile.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SectorSlot {
    Caster,
    Dest,
}

// ---------------------------------------------------------------------------
// kick
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Kick<'info> {
    #[account(
        seeds = [seeds::WORLD, &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
    )]
    pub world: Box<Account<'info, WorldHeader>>,
    #[account(
        mut,
        seeds = [seeds::RUN, world.key().as_ref(), kicker.wallet.as_ref()],
        bump = kicker.bump,
    )]
    pub kicker: Box<Account<'info, PlayerRun>>,
    #[account(
        mut,
        seeds = [seeds::RUN, world.key().as_ref(), target.wallet.as_ref()],
        bump = target.bump,
        constraint = target.key() != kicker.key() @ CrossyError::NoTarget
    )]
    pub target: Box<Account<'info, PlayerRun>>,
    /// Sector containing the target's current tile.
    #[account(mut)]
    pub target_sector: Box<Account<'info, OccupancySector>>,
    /// Sector containing the knockback destination; None when it shares the
    /// target's sector (Anchor forbids duplicate mutable accounts).
    #[account(mut)]
    pub dest_sector: Option<Box<Account<'info, OccupancySector>>>,
    /// Chunk covering the knockback destination row.
    pub chunk: Box<Account<'info, ChunkDefinition>>,
    pub signer: Signer<'info>,
}

/// Kick: displace the adjacent facing target one tile. Destination must be
/// in bounds, not statically blocked, and unoccupied — but MAY be a hazard
/// window: the environment kills, never the kick.
pub fn kick(ctx: Context<Kick>, attempt_nonce: u32, action_seq: u64, _uniq: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let world_key = ctx.accounts.world.key();
    let world = &ctx.accounts.world;
    let kicker = &mut ctx.accounts.kicker;
    let target = &mut ctx.accounts.target;

    validate_action(
        world,
        kicker,
        &ctx.accounts.signer.key(),
        session_scope::KICK,
        attempt_nonce,
        action_seq,
        now,
    )?;
    require!(now >= kicker.stunned_until, CrossyError::Immobilized);
    require!(now >= kicker.kick_ready_ts, CrossyError::Cooldown);

    // Target: exactly the adjacent tile in facing direction, Active.
    let facing = Direction::from_u8(kicker.facing).ok_or(CrossyError::NoTarget)?;
    let (tx, ty) = grid::facing_tile(kicker.x, kicker.y, facing).ok_or(CrossyError::NoTarget)?;
    require!(target.state == RunState::Active, CrossyError::NoTarget);
    require!(target.x == tx && target.y == ty, CrossyError::NoTarget);

    // Anchor resists forced movement.
    require!(now >= target.anchor_until, CrossyError::Blocked);

    // Knockback destination: one tile further in the same direction.
    let (dx, dy) = grid::step(tx, ty, facing).ok_or(CrossyError::OutOfBounds)?;
    require!(dy < world.revealed_rows, CrossyError::FrontierClosed);

    assert_sector(&ctx.accounts.target_sector, &world_key, tx, ty)?;
    match &ctx.accounts.dest_sector {
        Some(dest) => assert_sector(dest, &world_key, dx, dy)?,
        None => assert_sector(&ctx.accounts.target_sector, &world_key, dx, dy)?,
    }

    let dest_bit = grid::sector_bit(dx, dy);
    {
        let dest_view = ctx
            .accounts
            .dest_sector
            .as_deref()
            .unwrap_or(&ctx.accounts.target_sector);
        require!(!dest_view.is_blocked(dest_bit), CrossyError::Blocked);
        require!(!dest_view.is_occupied(dest_bit), CrossyError::TileOccupied);
    }

    // Atomic displacement.
    let src_bit = grid::sector_bit(tx, ty);
    match ctx.accounts.dest_sector.as_deref_mut() {
        None => {
            let s = &mut ctx.accounts.target_sector;
            s.clear_occupied(src_bit);
            s.set_occupied(dest_bit);
        }
        Some(dest) => {
            ctx.accounts.target_sector.clear_occupied(src_bit);
            dest.set_occupied(dest_bit);
        }
    }
    target.x = dx;
    target.y = dy;

    // Forced movement re-evaluates environmental hazards at the destination.
    let t_ms = world_time_ms(world, now)?;
    require!(
        ctx.accounts.chunk.day == world.day,
        CrossyError::BadChunkState
    );
    let lane = lane_for_row(&ctx.accounts.chunk, dy)?;
    let descriptor: crate::kernel::chunkgen::LaneDescriptor = (*lane).into();
    target.hazard_nonce = target.hazard_nonce.wrapping_add(1);
    target.hazard_deadline_ms = if hazard::is_lethal(&descriptor, dx, t_ms) {
        t_ms // immediate: next check_hazard resolves the death
    } else {
        hazard::next_hazard_deadline_ms(&descriptor, dx, t_ms).unwrap_or(0)
    };

    // Cooldown starts on successful displacement only. No kill credit.
    kicker.kick_ready_ts = now
        .checked_add(KICK_COOLDOWN_SECONDS)
        .ok_or(CrossyError::Overflow)?;
    kicker.action_seq = kicker
        .action_seq
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// use_ability — closed-enum dispatch
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct AbilityArgs {
    /// Direction for directional abilities (Dash/Ram/Hook/Leap/Phase).
    pub direction: u8,
    /// Target tile for placed effects (Trap/TimeSlow/AreaStun/LaneShift).
    pub target_x: u8,
    pub target_y: u16,
}

#[derive(Accounts)]
pub struct UseAbility<'info> {
    #[account(
        seeds = [seeds::WORLD, &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
    )]
    pub world: Box<Account<'info, WorldHeader>>,
    #[account(
        mut,
        seeds = [seeds::RUN, world.key().as_ref(), caster.wallet.as_ref()],
        bump = caster.bump,
    )]
    pub caster: Box<Account<'info, PlayerRun>>,
    /// Class config for the caster's class at the run's balance version.
    #[account(
        seeds = [
            seeds::CLASS,
            &caster.class_id.to_le_bytes(),
            &caster.class_version.to_le_bytes(),
        ],
        bump = class_config.bump,
    )]
    pub class_config: Box<Account<'info, ClassConfig>>,
    /// Target run for Ram/Hook/Swap; None for untargeted kinds.
    #[account(mut)]
    pub target: Option<Box<Account<'info, PlayerRun>>>,
    /// Sector covering the caster's current tile.
    #[account(mut)]
    pub caster_sector: Box<Account<'info, OccupancySector>>,
    /// Second sector for cross-sector destinations/effects; None when all
    /// touched tiles share the caster's sector.
    #[account(mut)]
    pub dest_sector: Option<Box<Account<'info, OccupancySector>>>,
    /// Chunk covering the destination/effect row.
    pub chunk: Box<Account<'info, ChunkDefinition>>,
    pub signer: Signer<'info>,
}

pub fn use_ability(
    mut ctx: Context<UseAbility>,
    attempt_nonce: u32,
    action_seq: u64,
    args: AbilityArgs,
    _uniq: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let world = &ctx.accounts.world;
    let class = (*ctx.accounts.class_config).clone().into_inner();
    let t_ms = world_time_ms(world, now)?;

    {
        let caster = &ctx.accounts.caster;
        validate_action(
            world,
            caster,
            &ctx.accounts.signer.key(),
            session_scope::ABILITY,
            attempt_nonce,
            action_seq,
            now,
        )?;
        require!(now >= caster.stunned_until, CrossyError::Immobilized);
        require!(now >= caster.ability_ready_ts, CrossyError::Cooldown);
        require!(caster.class_id == class.class_id, CrossyError::BadAbility);
        require!(class.ability != AbilityKind::None, CrossyError::BadAbility);
        require!(
            ctx.accounts.chunk.day == world.day,
            CrossyError::BadChunkState
        );
        assert_sector(
            &ctx.accounts.caster_sector,
            &world.key(),
            caster.x,
            caster.y,
        )?;
        if let Some(target) = &ctx.accounts.target {
            require!(target.key() != caster.key(), CrossyError::NoTarget);
            require!(target.world == caster.world, CrossyError::NoTarget);
        }
    }

    match class.ability {
        AbilityKind::None => unreachable!(),
        AbilityKind::Dash => dash(&mut ctx, &class, args, t_ms)?,
        AbilityKind::Shield => {
            let caster = &mut ctx.accounts.caster;
            caster.shield_until = now
                .checked_add(class.duration_seconds as i64)
                .ok_or(CrossyError::Overflow)?;
            caster.shield_charges = 1;
        }
        AbilityKind::Anchor => {
            let caster = &mut ctx.accounts.caster;
            caster.anchor_until = now
                .checked_add(class.duration_seconds as i64)
                .ok_or(CrossyError::Overflow)?;
        }
        AbilityKind::Ram => ram(&mut ctx, &class, t_ms, now)?,
        AbilityKind::Hook => hook(&mut ctx, &class, t_ms, now)?,
        AbilityKind::Leap => leap_or_phase(&mut ctx, args, t_ms, false)?,
        AbilityKind::Phase => leap_or_phase(&mut ctx, args, t_ms, true)?,
        AbilityKind::Swap => swap(&mut ctx, &class, now)?,
        AbilityKind::Trap
        | AbilityKind::TimeSlow
        | AbilityKind::AreaStun
        | AbilityKind::LaneShift => place_effect(&mut ctx, &class, args, now)?,
    }

    let caster = &mut ctx.accounts.caster;
    caster.ability_ready_ts = now
        .checked_add(class.cooldown_seconds as i64)
        .ok_or(CrossyError::Overflow)?;
    caster.action_seq = caster
        .action_seq
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;
    Ok(())
}

/// Which provided sector account covers the tile (caster_sector, or the
/// optional dest_sector).
fn find_slot(ctx: &Context<UseAbility>, x: u8, y: u16) -> Result<SectorSlot> {
    let world_key = ctx.accounts.world.key();
    let (sx, sy) = grid::sector_of(x, y);
    let cs = &ctx.accounts.caster_sector;
    if cs.world == world_key && cs.sector_x == sx && cs.sector_y == sy {
        return Ok(SectorSlot::Caster);
    }
    if let Some(ds) = &ctx.accounts.dest_sector {
        if ds.world == world_key && ds.sector_x == sx && ds.sector_y == sy {
            return Ok(SectorSlot::Dest);
        }
    }
    Err(error!(CrossyError::WrongSector))
}

fn sector_ref<'a>(ctx: &'a Context<UseAbility>, slot: SectorSlot) -> &'a OccupancySector {
    match slot {
        SectorSlot::Caster => &ctx.accounts.caster_sector,
        SectorSlot::Dest => ctx.accounts.dest_sector.as_deref().unwrap(),
    }
}

/// Move an occupancy bit from one tile to another across the provided
/// sector accounts.
fn move_bit(ctx: &mut Context<UseAbility>, from: (u8, u16), to: (u8, u16)) -> Result<()> {
    let src_slot = find_slot(ctx, from.0, from.1)?;
    let dst_slot = find_slot(ctx, to.0, to.1)?;
    let src_bit = grid::sector_bit(from.0, from.1);
    let dst_bit = grid::sector_bit(to.0, to.1);
    match (src_slot, dst_slot) {
        (SectorSlot::Caster, SectorSlot::Caster) => {
            let s = &mut ctx.accounts.caster_sector;
            s.clear_occupied(src_bit);
            s.set_occupied(dst_bit);
        }
        (SectorSlot::Dest, SectorSlot::Dest) => {
            let s = ctx.accounts.dest_sector.as_deref_mut().unwrap();
            s.clear_occupied(src_bit);
            s.set_occupied(dst_bit);
        }
        (SectorSlot::Caster, SectorSlot::Dest) => {
            ctx.accounts.caster_sector.clear_occupied(src_bit);
            ctx.accounts
                .dest_sector
                .as_deref_mut()
                .unwrap()
                .set_occupied(dst_bit);
        }
        (SectorSlot::Dest, SectorSlot::Caster) => {
            ctx.accounts
                .dest_sector
                .as_deref_mut()
                .unwrap()
                .clear_occupied(src_bit);
            ctx.accounts.caster_sector.set_occupied(dst_bit);
        }
    }
    Ok(())
}

/// Tile emptiness across the provided sectors.
fn tile_free(ctx: &Context<UseAbility>, x: u8, y: u16) -> Result<bool> {
    let slot = find_slot(ctx, x, y)?;
    let s = sector_ref(ctx, slot);
    let bit = grid::sector_bit(x, y);
    Ok(!s.is_occupied(bit) && !s.is_blocked(bit))
}

fn tile_statically_blocked(ctx: &Context<UseAbility>, x: u8, y: u16) -> Result<bool> {
    let slot = find_slot(ctx, x, y)?;
    let s = sector_ref(ctx, slot);
    Ok(s.is_blocked(grid::sector_bit(x, y)))
}

fn require_row_traversable(ctx: &Context<UseAbility>, x: u8, y: u16, t_ms: u64) -> Result<()> {
    require!(
        y < ctx.accounts.world.revealed_rows,
        CrossyError::FrontierClosed
    );
    let lane = lane_for_row(&ctx.accounts.chunk, y)?;
    let d: crate::kernel::chunkgen::LaneDescriptor = (*lane).into();
    require!(hazard::is_traversable(&d, x, t_ms), CrossyError::Blocked);
    Ok(())
}

/// Reschedule the caster's hazard deadline for its (new) tile.
fn reschedule_caster_hazard(ctx: &mut Context<UseAbility>, t_ms: u64) -> Result<()> {
    let (x, y) = (ctx.accounts.caster.x, ctx.accounts.caster.y);
    let lane = lane_for_row(&ctx.accounts.chunk, y)?;
    let d: crate::kernel::chunkgen::LaneDescriptor = (*lane).into();
    let caster = &mut ctx.accounts.caster;
    caster.hazard_nonce = caster.hazard_nonce.wrapping_add(1);
    caster.hazard_deadline_ms = hazard::next_hazard_deadline_ms(&d, x, t_ms).unwrap_or(0);
    Ok(())
}

/// Schedule an immediate-or-next hazard check for a displaced target.
fn reschedule_target_hazard(ctx: &mut Context<UseAbility>, t_ms: u64) -> Result<()> {
    let target = ctx
        .accounts
        .target
        .as_deref()
        .ok_or(CrossyError::NoTarget)?;
    let (x, y) = (target.x, target.y);
    let lane = lane_for_row(&ctx.accounts.chunk, y)?;
    let d: crate::kernel::chunkgen::LaneDescriptor = (*lane).into();
    let target = ctx.accounts.target.as_deref_mut().unwrap();
    target.hazard_nonce = target.hazard_nonce.wrapping_add(1);
    target.hazard_deadline_ms = if hazard::is_lethal(&d, x, t_ms) {
        t_ms // lethal now: the next check_hazard resolves the death
    } else {
        hazard::next_hazard_deadline_ms(&d, x, t_ms).unwrap_or(0)
    };
    Ok(())
}

/// Dash: exactly two tiles forward, all-or-nothing; intermediate and
/// destination must be free and the destination traversable now.
fn dash(
    ctx: &mut Context<UseAbility>,
    class: &ClassConfig,
    args: AbilityArgs,
    t_ms: u64,
) -> Result<()> {
    require!(class.displacement == 2, CrossyError::BadAbility);
    let dir = Direction::from_u8(args.direction).ok_or(CrossyError::BadAbility)?;
    require!(dir == Direction::Forward, CrossyError::BadAbility);
    let (cx, cy) = (ctx.accounts.caster.x, ctx.accounts.caster.y);
    let (x1, y1) = grid::step(cx, cy, dir).ok_or(CrossyError::OutOfBounds)?;
    let (x2, y2) = grid::step(x1, y1, dir).ok_or(CrossyError::OutOfBounds)?;
    require!(tile_free(ctx, x1, y1)?, CrossyError::TileOccupied);
    require!(tile_free(ctx, x2, y2)?, CrossyError::TileOccupied);
    require_row_traversable(ctx, x2, y2, t_ms)?;
    move_bit(ctx, (cx, cy), (x2, y2))?;
    let caster = &mut ctx.accounts.caster;
    caster.x = x2;
    caster.y = y2;
    // Score counts forward progress achieved by the dash.
    if y2 > caster.score {
        caster.score = y2;
    }
    reschedule_caster_hazard(ctx, t_ms)
}

/// Ram: push the facing-adjacent target `displacement` tiles; every
/// intermediate and the destination must be free; all-or-nothing.
fn ram(ctx: &mut Context<UseAbility>, class: &ClassConfig, t_ms: u64, now: i64) -> Result<()> {
    let dir = Direction::from_u8(ctx.accounts.caster.facing).ok_or(CrossyError::NoTarget)?;
    let (cx, cy) = (ctx.accounts.caster.x, ctx.accounts.caster.y);
    let (tx, ty) = grid::facing_tile(cx, cy, dir).ok_or(CrossyError::NoTarget)?;
    {
        let target = ctx
            .accounts
            .target
            .as_deref()
            .ok_or(CrossyError::NoTarget)?;
        require!(target.state == RunState::Active, CrossyError::NoTarget);
        require!(target.x == tx && target.y == ty, CrossyError::NoTarget);
        require!(now >= target.anchor_until, CrossyError::Blocked);
    }
    let push = class.displacement.max(1);
    let (mut px, mut py) = (tx, ty);
    for _ in 0..push {
        let (nx, ny) = grid::step(px, py, dir).ok_or(CrossyError::OutOfBounds)?;
        require!(
            ny < ctx.accounts.world.revealed_rows,
            CrossyError::FrontierClosed
        );
        require!(tile_free(ctx, nx, ny)?, CrossyError::TileOccupied);
        px = nx;
        py = ny;
    }
    move_bit(ctx, (tx, ty), (px, py))?;
    let target = ctx.accounts.target.as_deref_mut().unwrap();
    target.x = px;
    target.y = py;
    reschedule_target_hazard(ctx, t_ms)
}

/// Hook: pull a target within straight-line `range` one tile toward the
/// caster; the destination must be free.
fn hook(ctx: &mut Context<UseAbility>, class: &ClassConfig, t_ms: u64, now: i64) -> Result<()> {
    let (cx, cy) = (ctx.accounts.caster.x, ctx.accounts.caster.y);
    let (tx, ty) = {
        let target = ctx
            .accounts
            .target
            .as_deref()
            .ok_or(CrossyError::NoTarget)?;
        require!(target.state == RunState::Active, CrossyError::NoTarget);
        require!(now >= target.anchor_until, CrossyError::Blocked);
        (target.x, target.y)
    };
    // Straight cardinal line within range, at least 2 tiles away.
    let (dx, dy) = (tx as i32 - cx as i32, ty as i32 - cy as i32);
    require!((dx == 0) != (dy == 0), CrossyError::NoTarget);
    let dist = dx.unsigned_abs().max(dy.unsigned_abs());
    require!(
        dist >= 2 && dist <= class.range as u32,
        CrossyError::NoTarget
    );
    let step_dir = if dx > 0 {
        Direction::Left
    } else if dx < 0 {
        Direction::Right
    } else if dy > 0 {
        Direction::Backward
    } else {
        Direction::Forward
    };
    let (nx, ny) = grid::step(tx, ty, step_dir).ok_or(CrossyError::OutOfBounds)?;
    require!(tile_free(ctx, nx, ny)?, CrossyError::TileOccupied);
    move_bit(ctx, (tx, ty), (nx, ny))?;
    let target = ctx.accounts.target.as_deref_mut().unwrap();
    target.x = nx;
    target.y = ny;
    reschedule_target_hazard(ctx, t_ms)
}

/// Leap (over one blocked/occupied tile) or Phase (through one static
/// blocker): land exactly two tiles away on a free, traversable tile.
fn leap_or_phase(
    ctx: &mut Context<UseAbility>,
    args: AbilityArgs,
    t_ms: u64,
    static_only: bool,
) -> Result<()> {
    let dir = Direction::from_u8(args.direction).ok_or(CrossyError::BadAbility)?;
    let (cx, cy) = (ctx.accounts.caster.x, ctx.accounts.caster.y);
    let (x1, y1) = grid::step(cx, cy, dir).ok_or(CrossyError::OutOfBounds)?;
    let (x2, y2) = grid::step(x1, y1, dir).ok_or(CrossyError::OutOfBounds)?;
    if static_only {
        // Phantom: the crossed tile must be a static blocker.
        require!(
            tile_statically_blocked(ctx, x1, y1)?,
            CrossyError::BadAbility
        );
    } else {
        // Acrobat: something to leap over (blocked or occupied).
        require!(!tile_free(ctx, x1, y1)?, CrossyError::BadAbility);
    }
    require!(tile_free(ctx, x2, y2)?, CrossyError::TileOccupied);
    require_row_traversable(ctx, x2, y2, t_ms)?;
    move_bit(ctx, (cx, cy), (x2, y2))?;
    let caster = &mut ctx.accounts.caster;
    caster.x = x2;
    caster.y = y2;
    if y2 > caster.score {
        caster.score = y2;
    }
    reschedule_caster_hazard(ctx, t_ms)
}

/// Switcher: atomic position swap with an Active player within range. Both
/// tiles stay occupied — only the occupants change.
fn swap(ctx: &mut Context<UseAbility>, class: &ClassConfig, now: i64) -> Result<()> {
    let (cx, cy) = (ctx.accounts.caster.x, ctx.accounts.caster.y);
    let (tx, ty) = {
        let target = ctx
            .accounts
            .target
            .as_deref()
            .ok_or(CrossyError::NoTarget)?;
        require!(target.state == RunState::Active, CrossyError::NoTarget);
        require!(now >= target.anchor_until, CrossyError::Blocked);
        (target.x, target.y)
    };
    let dist = (cx as i32 - tx as i32).unsigned_abs() + (cy as i32 - ty as i32).unsigned_abs();
    require!(
        dist >= 1 && dist <= class.range as u32,
        CrossyError::NoTarget
    );
    // Both tiles must be covered by provided sectors (address validation).
    find_slot(ctx, cx, cy)?;
    find_slot(ctx, tx, ty)?;

    {
        let caster = &mut ctx.accounts.caster;
        caster.x = tx;
        caster.y = ty;
        caster.hazard_nonce = caster.hazard_nonce.wrapping_add(1);
        caster.hazard_deadline_ms = 0;
    }
    let target = ctx.accounts.target.as_deref_mut().unwrap();
    target.x = cx;
    target.y = cy;
    target.hazard_nonce = target.hazard_nonce.wrapping_add(1);
    target.hazard_deadline_ms = 0;
    // Swap never increases score (prevents swap-score exploits): score only
    // advances through movement/dash/leap instructions.
    Ok(())
}

/// Place a bounded temporary effect (Trap/TimeSlow/AreaStun/LaneShift) into
/// the covering sector. Full slots fail; expired slots are reused.
fn place_effect(
    ctx: &mut Context<UseAbility>,
    class: &ClassConfig,
    args: AbilityArgs,
    now: i64,
) -> Result<()> {
    let (cx, cy) = (ctx.accounts.caster.x, ctx.accounts.caster.y);
    // Target tile within class range (Chebyshev distance).
    let dx = (cx as i32 - args.target_x as i32).abs();
    let dy = (cy as i32 - args.target_y as i32).abs();
    require!(dx.max(dy) <= class.range as i32, CrossyError::NoTarget);
    require!(class.duration_seconds > 0, CrossyError::BadAbility);
    let radius = (class.param_b as u8).min(MAX_EFFECT_RADIUS);

    let slot = find_slot(ctx, args.target_x, args.target_y)?;
    let caster_key = ctx.accounts.caster.key();
    let nonce = ctx.accounts.caster.hazard_nonce;
    let end_ts = now
        .checked_add(class.duration_seconds as i64)
        .ok_or(CrossyError::Overflow)?;
    let effect = TempEffect {
        kind: class.ability as u8,
        center_x: args.target_x,
        center_y: args.target_y,
        radius,
        magnitude: class.param_a,
        start_ts: now,
        end_ts,
        source: caster_key,
        nonce,
    };
    let sector: &mut OccupancySector = match slot {
        SectorSlot::Caster => &mut ctx.accounts.caster_sector,
        SectorSlot::Dest => ctx.accounts.dest_sector.as_deref_mut().unwrap(),
    };
    let free = sector
        .effects
        .iter()
        .position(|e| e.is_free(now))
        .ok_or(CrossyError::EffectSlotsFull)?;
    sector.effects[free] = effect;
    sector.seq = sector.seq.wrapping_add(1);
    Ok(())
}
