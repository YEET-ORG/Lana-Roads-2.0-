//! Just-in-time chunk generation.
//!
//! When the leader is within eight rows of the revealed frontier, anyone may
//! request the next chunk. The boundary stays closed and safe until an
//! authenticated callback publishes the chunk; there is no client fallback
//! map. Retry after an objective timeout increments the generation; a late
//! callback from an invalidated generation fails; the first valid
//! current-generation callback permanently determines the chunk (a valid
//! result is never rerolled).
//!
//! Randomness authentication: the configured `vrf_authority` must sign the
//! callback. This is the MagicBlock VRF integration point — binding
//! (day, chunk index, generation), idempotency, and retry semantics are
//! fully enforced here regardless of the transport.

use anchor_lang::prelude::*;
use solana_keccak_hasher as keccak;

use crate::constants::{seeds, CHUNK_REQUEST_MARGIN, CHUNK_ROWS, CHUNK_VRF_TIMEOUT_SECONDS};
use crate::errors::CrossyError;
use crate::events::*;
use crate::kernel::chunkgen;
use crate::state::*;

// ---------------------------------------------------------------------------
// request_chunk
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(chunk_index: u16)]
pub struct RequestChunk<'info> {
    #[account(
        mut,
        seeds = [seeds::WORLD, &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
    )]
    pub world: Box<Account<'info, WorldHeader>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + ChunkDefinition::INIT_SPACE,
        seeds = [seeds::CHUNK, &world.day.to_le_bytes(), &chunk_index.to_le_bytes()],
        bump
    )]
    pub chunk: Box<Account<'info, ChunkDefinition>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Permissionless: open (or retry) the VRF request for the next chunk once
/// the frontier margin is reached. `WorldHeader` holds exactly one live
/// request, preventing gaps and selective skipping.
pub fn request_chunk(ctx: Context<RequestChunk>, chunk_index: u16) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let world = &mut ctx.accounts.world;
    require!(world.status == WorldStatus::Open, CrossyError::WorldNotOpen);
    require!(now < world.end_ts, CrossyError::CutoffPassed);
    // Only the world's next chunk may be requested (no gaps).
    require!(
        chunk_index == world.next_chunk_index,
        CrossyError::BadChunkState
    );
    // Frontier margin: the record/frontier leader must be within eight rows
    // of the revealed boundary.
    require!(
        world.record_score + CHUNK_REQUEST_MARGIN >= world.revealed_rows,
        CrossyError::FrontierNotReached
    );

    let chunk = &mut ctx.accounts.chunk;

    // Chunks are shared across paid/casual modes. If the other mode already
    // revealed this chunk, sync this world's frontier — a valid result is
    // NEVER rerolled.
    if chunk.status == ChunkStatus::Revealed {
        world.revealed_rows = world
            .revealed_rows
            .checked_add(CHUNK_ROWS as u16)
            .ok_or(CrossyError::Overflow)?;
        world.next_chunk_index = world
            .next_chunk_index
            .checked_add(1)
            .ok_or(CrossyError::Overflow)?;
        world.chunk_request_state = ChunkRequestState::Idle;
        return Ok(());
    }

    match world.chunk_request_state {
        ChunkRequestState::Idle => {
            // Fresh request.
            chunk.day = world.day;
            chunk.chunk_index = chunk_index;
            chunk.row_start = chunk_index
                .checked_mul(CHUNK_ROWS as u16)
                .ok_or(CrossyError::Overflow)?;
            chunk.row_count = CHUNK_ROWS;
            chunk.generation = chunk
                .generation
                .checked_add(1)
                .ok_or(CrossyError::Overflow)?;
            chunk.generation_version = chunkgen::GENERATION_VERSION;
            chunk.status = ChunkStatus::Requested;
            chunk.requested_at = now;
            chunk.bump = ctx.bumps.chunk;
        }
        ChunkRequestState::Requested => {
            // Objective-timeout retry: invalidates the previous generation.
            require!(
                chunk.status == ChunkStatus::Requested,
                CrossyError::BadChunkState
            );
            require!(
                now >= chunk
                    .requested_at
                    .checked_add(CHUNK_VRF_TIMEOUT_SECONDS)
                    .ok_or(CrossyError::Overflow)?,
                CrossyError::TimeoutNotReached
            );
            chunk.generation = chunk
                .generation
                .checked_add(1)
                .ok_or(CrossyError::Overflow)?;
            chunk.requested_at = now;
        }
    }
    world.chunk_request_state = ChunkRequestState::Requested;
    world.chunk_generation = chunk.generation;
    world.chunk_requested_at = now;

    emit!(ChunkRequested {
        day: world.day,
        chunk_index,
        generation: chunk.generation,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// reveal_chunk — authenticated randomness callback
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RevealChunk<'info> {
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [seeds::WORLD, &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
    )]
    pub world: Box<Account<'info, WorldHeader>>,
    #[account(
        mut,
        seeds = [seeds::CHUNK, &world.day.to_le_bytes(), &chunk.chunk_index.to_le_bytes()],
        bump = chunk.bump,
    )]
    pub chunk: Box<Account<'info, ChunkDefinition>>,
    /// The authenticated randomness identity fixed in config.
    #[account(address = config.vrf_authority @ CrossyError::BadVrfAuthority)]
    pub vrf_authority: Signer<'info>,
}

/// Deliver randomness for the current generation. Duplicate callbacks are
/// idempotently rejected (status changed), late callbacks from invalidated
/// generations fail, and the revealed layout is validated against generator
/// bounds before persisting. The first valid callback is permanent.
pub fn reveal_chunk(
    ctx: Context<RevealChunk>,
    generation: u16,
    randomness: [u8; 32],
) -> Result<()> {
    let world = &mut ctx.accounts.world;
    let chunk = &mut ctx.accounts.chunk;

    require!(
        chunk.status == ChunkStatus::Requested,
        CrossyError::BadChunkState
    );
    // Bind: exact current generation only.
    require!(chunk.generation == generation, CrossyError::BadGeneration);
    require!(
        world.chunk_generation == generation,
        CrossyError::BadGeneration
    );
    require!(
        world.next_chunk_index == chunk.chunk_index,
        CrossyError::BadChunkState
    );

    // Deterministic, versioned derivation + defense-in-depth validation.
    let layout = chunkgen::generate_chunk(&randomness, chunk.chunk_index);
    require!(
        chunkgen::validate_layout(&layout, chunk.chunk_index),
        CrossyError::BadChunkState
    );

    for (i, lane) in layout.lanes.iter().enumerate() {
        chunk.lanes[i] = (*lane).into();
    }
    chunk.randomness_hash = keccak::hash(&randomness).to_bytes();
    chunk.status = ChunkStatus::Revealed;

    // Extend the frontier and advance the pipeline.
    world.revealed_rows = world
        .revealed_rows
        .checked_add(CHUNK_ROWS as u16)
        .ok_or(CrossyError::Overflow)?;
    world.next_chunk_index = world
        .next_chunk_index
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;
    world.chunk_request_state = ChunkRequestState::Idle;

    emit!(ChunkRevealed {
        day: world.day,
        chunk_index: chunk.chunk_index,
        generation,
        randomness_hash: chunk.randomness_hash,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// init_sector — lazily create/derive occupancy sectors for revealed rows
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(sector_x: u8, sector_y: u16)]
pub struct InitSector<'info> {
    #[account(
        seeds = [seeds::WORLD, &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
    )]
    pub world: Box<Account<'info, WorldHeader>>,
    /// Chunk covering this sector's rows (blocker derivation).
    #[account(
        seeds = [
            seeds::CHUNK,
            &world.day.to_le_bytes(),
            &((sector_y * 8) / CHUNK_ROWS as u16).to_le_bytes(),
        ],
        bump = chunk.bump,
        constraint = chunk.status == ChunkStatus::Revealed @ CrossyError::FrontierClosed
    )]
    pub chunk: Box<Account<'info, ChunkDefinition>>,
    #[account(
        init,
        payer = payer,
        space = 8 + OccupancySector::INIT_SPACE,
        seeds = [
            seeds::SECTOR,
            world.key().as_ref(),
            &[sector_x],
            &sector_y.to_le_bytes(),
        ],
        bump
    )]
    pub sector: Box<Account<'info, OccupancySector>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Permissionless: materialize a sector for revealed rows, deriving its
/// static blocker bits from the committed chunk definition.
pub fn init_sector(ctx: Context<InitSector>, sector_x: u8, sector_y: u16) -> Result<()> {
    require!(sector_x < 8, CrossyError::WrongSector);
    let world = &ctx.accounts.world;
    let first_row = sector_y.checked_mul(8).ok_or(CrossyError::Overflow)?;
    require!(first_row < world.revealed_rows, CrossyError::FrontierClosed);

    let sector = &mut ctx.accounts.sector;
    sector.world = world.key();
    sector.sector_x = sector_x;
    sector.sector_y = sector_y;
    sector.occupancy = 0;
    sector.seq = 0;
    sector.bump = ctx.bumps.sector;

    // Static blockers from the chunk's grass lanes.
    let chunk = &ctx.accounts.chunk;
    let mut blockers = 0u64;
    for local_y in 0..8u16 {
        let row = first_row + local_y;
        if row < chunk.row_start || row >= chunk.row_start + CHUNK_ROWS as u16 {
            continue;
        }
        let lane = &chunk.lanes[(row - chunk.row_start) as usize];
        if lane.kind == chunkgen::LaneKind::Grass as u8 {
            for local_x in 0..8u8 {
                let world_x = sector_x * 8 + local_x;
                if lane.blocker_mask & (1u64 << world_x) != 0 {
                    blockers |= 1u64 << (local_y as u8 * 8 + local_x);
                }
            }
        }
    }
    sector.blockers = blockers;
    Ok(())
}
