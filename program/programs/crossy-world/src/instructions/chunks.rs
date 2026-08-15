//! Just-in-time chunk generation.
//!
//! The permissionless keeper may maintain ten complete chunks beyond the
//! chunk containing the leader. The boundary stays closed and safe until an
//! authenticated callback publishes each chunk; there is no client fallback
//! map. Retry after an objective timeout increments the generation; a late
//! callback from an invalidated generation fails; the first valid
//! current-generation callback permanently determines the chunk (a valid
//! result is never rerolled).
//!
//! Randomness authentication is enforced by MagicBlock's scoped VRF callback
//! identity. The callback binds day, chunk index, and request generation.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{
    anchor::{vrf, vrf_callback},
    vrf::{
        self,
        instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
        types::SerializableAccountMeta,
    },
};
use solana_keccak_hasher as keccak;

use crate::constants::{
    seeds, CHUNK_LOOKAHEAD_CHUNKS, CHUNK_REQUEST_MARGIN, CHUNK_ROWS, CHUNK_VRF_TIMEOUT_SECONDS,
};
use crate::errors::CrossyError;
use crate::events::*;
use crate::kernel::chunkgen;
use crate::state::*;

// ---------------------------------------------------------------------------
// request_chunk
// ---------------------------------------------------------------------------

#[vrf]
#[derive(Accounts)]
#[instruction(region: u8, day: u64, chunk_index: u32)]
pub struct RequestChunk<'info> {
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    /// CHECK: normally delegated; validated from committed data in handler.
    pub world: UncheckedAccount<'info>,
    /// CHECK: continuity anchor; may already be delegated.
    pub prev_chunk: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + ChunkDefinition::INIT_SPACE,
        seeds = [seeds::CHUNK, &[region], &day.to_le_bytes(), &chunk_index.to_le_bytes()],
        bump
    )]
    pub chunk: Box<Account<'info, ChunkDefinition>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: official base queue, or the local test queue.
    #[account(
        mut,
        constraint = oracle_queue.key() == vrf::consts::DEFAULT_QUEUE
            || oracle_queue.key() == vrf::consts::DEFAULT_TEST_QUEUE
            @ CrossyError::BadVrfAuthority
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

/// Permissionless: open (or retry) the VRF request for the next contiguous
/// chunk while the ten-chunk lookahead buffer needs filling. The bounded
/// request window plus the previous revealed chunk prevent gaps and skips.
pub fn request_chunk(
    ctx: Context<RequestChunk>,
    region: u8,
    day: u64,
    chunk_index: u32,
) -> Result<()> {
    require!(chunk_index >= 1, CrossyError::BadChunkState);
    let now = Clock::get()?.unix_timestamp;
    let world =
        crate::cross_plane::read_committed_world_any(&ctx.accounts.world.to_account_info())?;
    let expected_world = Pubkey::find_program_address(
        &[seeds::WORLD, &[world.region], &[world.mode as u8], &world.day.to_le_bytes()],
        &crate::ID,
    )
    .0;
    require_keys_eq!(
        ctx.accounts.world.key(),
        expected_world,
        CrossyError::NotReconcilable
    );
    require!(world.day == day, CrossyError::BadChunkState);
    // The chunk belongs to the region whose world is asking for it, so a
    // world can never advance its frontier over another region's terrain.
    require!(world.region == region, CrossyError::BadChunkState);
    require!(world.status == WorldStatus::Open, CrossyError::WorldNotOpen);
    require!(now < world.end_ts, CrossyError::CutoffPassed);
    require!(
        chunk_in_request_window(world.next_chunk_index, chunk_index),
        CrossyError::BadChunkState
    );
    require!(
        world
            .record_score
            .checked_add(CHUNK_REQUEST_MARGIN)
            .ok_or(CrossyError::Overflow)?
            >= world.revealed_rows,
        CrossyError::FrontierNotReached
    );
    let previous = crate::cross_plane::read_committed_chunk(
        &ctx.accounts.prev_chunk.to_account_info(),
        region,
        day,
        chunk_index - 1,
    )?;
    require!(
        previous.status == ChunkStatus::Revealed,
        CrossyError::BadChunkState
    );

    let chunk = &mut ctx.accounts.chunk;

    // Chunks are shared across paid/casual modes. If the other mode already
    // revealed this chunk, sync this world's frontier — a valid result is
    // NEVER rerolled.
    match chunk.status {
        ChunkStatus::Uninitialized => {
            // Fresh request.
            chunk.region = region;
            chunk.day = world.day;
            chunk.chunk_index = chunk_index;
            chunk.row_start = chunk_index
                .checked_mul(CHUNK_ROWS as u32)
                .ok_or(CrossyError::Overflow)?;
            chunk.row_count = CHUNK_ROWS;
            chunk.generation = 1;
            chunk.generation_version = chunkgen::GENERATION_VERSION;
            chunk.status = ChunkStatus::Requested;
            chunk.requested_at = now;
            chunk.bump = ctx.bumps.chunk;
        }
        ChunkStatus::Requested => {
            // Objective-timeout retry: invalidates the previous generation.
            require!(
                chunk.day == day && chunk.chunk_index == chunk_index,
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
        ChunkStatus::Revealed | ChunkStatus::Closed => {
            return err!(CrossyError::BadChunkState);
        }
    }

    let generation = chunk.generation;
    let mut callback_args = Vec::with_capacity(12);
    day.serialize(&mut callback_args)?;
    chunk_index.serialize(&mut callback_args)?;
    generation.serialize(&mut callback_args)?;
    let day_bytes = day.to_le_bytes();
    let index_bytes = chunk_index.to_le_bytes();
    let generation_bytes = generation.to_le_bytes();
    let chunk_key = ctx.accounts.chunk.key();
    let caller_seed = keccak::hashv(&[
        b"lana-roads-chunk-vrf-v1",
        &day_bytes,
        &index_bytes,
        &generation_bytes,
        chunk_key.as_ref(),
    ])
    .to_bytes();
    let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.payer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::PublishChunk::DISCRIMINATOR.to_vec(),
        accounts_metas: Some(vec![SerializableAccountMeta {
            pubkey: chunk_key,
            is_signer: false,
            is_writable: true,
        }]),
        caller_seed,
        callback_args: Some(callback_args),
    });
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;

    emit!(ChunkRequested {
        day,
        chunk_index,
        generation,
    });
    Ok(())
}

/// The keeper may pre-reveal a bounded contiguous window on base while the
/// ER frontier is still preparing earlier chunks. Continuity is separately
/// enforced by the required revealed `prev_chunk` account.
fn chunk_in_request_window(next_chunk_index: u32, chunk_index: u32) -> bool {
    next_chunk_index
        .checked_add(CHUNK_LOOKAHEAD_CHUNKS)
        .is_some_and(|exclusive_end| chunk_index >= next_chunk_index && chunk_index < exclusive_end)
}

#[cfg(test)]
mod request_window_tests {
    use super::chunk_in_request_window;

    #[test]
    fn permits_exactly_ten_chunks_from_the_frontier() {
        assert!(chunk_in_request_window(1, 1));
        assert!(chunk_in_request_window(1, 10));
        assert!(!chunk_in_request_window(1, 11));
        assert!(!chunk_in_request_window(1, 0));
    }

    #[test]
    fn fails_closed_on_index_overflow() {
        assert!(!chunk_in_request_window(u32::MAX - 5, u32::MAX - 5));
    }
}

// ---------------------------------------------------------------------------
// reveal_chunk — authenticated randomness callback
// ---------------------------------------------------------------------------

#[vrf_callback]
#[derive(Accounts)]
#[instruction(randomness: [u8; 32], region: u8, day: u64, chunk_index: u32)]
pub struct PublishChunk<'info> {
    #[account(
        mut,
        seeds = [seeds::CHUNK, &[region], &day.to_le_bytes(), &chunk_index.to_le_bytes()],
        bump = chunk.bump,
    )]
    pub chunk: Box<Account<'info, ChunkDefinition>>,
}

/// Deliver randomness for the current generation. Duplicate callbacks are
/// idempotently rejected (status changed), late callbacks from invalidated
/// generations fail, and the revealed layout is validated against generator
/// bounds before persisting. The first valid callback is permanent.
pub fn publish_chunk(
    ctx: Context<PublishChunk>,
    randomness: [u8; 32],
    region: u8,
    day: u64,
    chunk_index: u32,
    generation: u16,
) -> Result<()> {
    let chunk = &mut ctx.accounts.chunk;

    require!(
        chunk.status == ChunkStatus::Requested,
        CrossyError::BadChunkState
    );
    require!(
        chunk.day == day && chunk.chunk_index == chunk_index && chunk.region == region,
        CrossyError::BadChunkState
    );
    require!(chunk.generation == generation, CrossyError::BadGeneration);

    // Deterministic, versioned derivation + defense-in-depth validation.
    let layout = chunkgen::generate_chunk(&randomness, chunk_index);
    require!(
        chunkgen::validate_layout(&layout, chunk_index),
        CrossyError::BadChunkState
    );

    for (i, lane) in layout.lanes.iter().enumerate() {
        chunk.lanes[i] = (*lane).into();
    }
    chunk.randomness_hash = keccak::hash(&randomness).to_bytes();
    chunk.status = ChunkStatus::Revealed;

    emit!(ChunkRevealed {
        day,
        chunk_index,
        generation,
        randomness_hash: chunk.randomness_hash,
    });
    Ok(())
}

// The VRF request and callback run on base. Chunk accounts remain on base and
// are read cross-plane by the ER; `extend_frontier` advances the delegated
// world only after the revealed chunk and all of its sectors are ready.

#[derive(Accounts)]
pub struct ExtendFrontier<'info> {
    #[account(
        mut,
        seeds = [seeds::WORLD, &[world.region], &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
    )]
    pub world: Box<Account<'info, WorldHeader>>,
    /// The next chunk, already revealed on base and read cross-plane here.
    #[account(
        seeds = [
            seeds::CHUNK,
            &[world.region],
            &world.day.to_le_bytes(),
            &world.next_chunk_index.to_le_bytes(),
        ],
        bump = chunk.bump,
        constraint = chunk.status == ChunkStatus::Revealed @ CrossyError::FrontierClosed,
    )]
    pub chunk: Box<Account<'info, ChunkDefinition>>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(chunk_index: u32)]
pub struct MarkChunkReady<'info> {
    #[account(
        mut,
        seeds = [seeds::WORLD, &[world.region], &[world.mode as u8], &world.day.to_le_bytes()],
        bump = world.bump,
    )]
    pub world: Box<Account<'info, WorldHeader>>,
    #[account(
        seeds = [
            seeds::CHUNK,
            &[world.region],
            &world.day.to_le_bytes(),
            &chunk_index.to_le_bytes(),
        ],
        bump = chunk.bump,
        constraint = chunk.status == ChunkStatus::Revealed @ CrossyError::FrontierClosed,
    )]
    pub chunk: Box<Account<'info, ChunkDefinition>>,
    pub signer: Signer<'info>,
}

/// Permissionless ER readiness barrier. The sixteen sector accounts covering
/// the next chunk must all be readable together on the same rollup before
/// the world can expose those rows.
pub fn mark_chunk_ready<'info>(
    ctx: Context<'info, MarkChunkReady<'info>>,
    chunk_index: u32,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let world_key = ctx.accounts.world.key();
    let world = &mut ctx.accounts.world;
    let chunk = &ctx.accounts.chunk;
    require!(world.status == WorldStatus::Open, CrossyError::WorldNotOpen);
    require!(now < world.end_ts, CrossyError::CutoffPassed);
    require!(chunk.day == world.day, CrossyError::BadChunkState);
    require!(chunk.region == world.region, CrossyError::BadChunkState);
    require!(chunk.chunk_index == chunk_index, CrossyError::BadChunkState);
    if chunk_index == 0 {
        require!(chunk.row_start == 0, CrossyError::BadChunkState);
    } else {
        require!(
            chunk_index == world.next_chunk_index,
            CrossyError::BadChunkState
        );
        require!(
            chunk.row_start == world.revealed_rows,
            CrossyError::BadChunkState
        );
    }

    let first_sector_y = chunk.row_start / 8;
    let sector_bands = (chunk.row_count as usize).div_ceil(8);
    let expected_count = sector_bands * 8;
    require!(
        ctx.remaining_accounts.len() == expected_count,
        CrossyError::WrongSector
    );
    for (index, info) in ctx.remaining_accounts.iter().enumerate() {
        let sector = Account::<OccupancySector>::try_from(info)?;
        let expected_x = (index % 8) as u8;
        let expected_y = first_sector_y
            .checked_add((index / 8) as u32)
            .ok_or(CrossyError::Overflow)?;
        require_keys_eq!(sector.world, world_key, CrossyError::WrongSector);
        require!(
            sector.sector_x == expected_x && sector.sector_y == expected_y,
            CrossyError::WrongSector
        );
    }

    if chunk_index == 0 {
        world.spawn_ready = true;
    } else {
        world.ready_chunk_index = chunk.chunk_index;
        world.ready_chunk_hash = chunk.randomness_hash;
    }
    emit!(ChunkReady {
        world: world_key,
        chunk_index: chunk.chunk_index,
        randomness_hash: chunk.randomness_hash,
    });
    Ok(())
}

/// Permissionless: advance the live world's frontier over the next revealed
/// chunk. The layout is authenticated on base, so no authority is needed to
/// publish the fact that it exists.
pub fn extend_frontier(ctx: Context<ExtendFrontier>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let world_key = ctx.accounts.world.key();
    let world = &mut ctx.accounts.world;
    let chunk = &ctx.accounts.chunk;
    require!(world.status == WorldStatus::Open, CrossyError::WorldNotOpen);
    require!(now < world.end_ts, CrossyError::CutoffPassed);
    require!(chunk.day == world.day, CrossyError::BadChunkState);
    require!(chunk.region == world.region, CrossyError::BadChunkState);
    require!(
        world.ready_chunk_index == chunk.chunk_index
            && world.ready_chunk_hash == chunk.randomness_hash,
        CrossyError::FrontierClosed
    );
    // The chunk must butt exactly against the current frontier.
    require!(
        chunk.row_start == world.revealed_rows,
        CrossyError::BadChunkState
    );

    advance_frontier(world, world_key, chunk)
}

fn advance_frontier(
    world: &mut WorldHeader,
    world_key: Pubkey,
    chunk: &ChunkDefinition,
) -> Result<()> {
    world.revealed_rows = world
        .revealed_rows
        .checked_add(chunk.row_count as u32)
        .ok_or(CrossyError::Overflow)?;
    world.next_chunk_index = world
        .next_chunk_index
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;
    world.map_seq = world.map_seq.checked_add(1).ok_or(CrossyError::Overflow)?;
    world.latest_chunk_index = chunk.chunk_index;
    world.latest_chunk_generation = chunk.generation;
    world.latest_chunk_hash = chunk.randomness_hash;
    world.ready_chunk_index = 0;
    world.ready_chunk_hash = [0u8; 32];
    world.chunk_request_state = ChunkRequestState::Idle;
    emit!(FrontierExtended {
        world: world_key,
        day: world.day,
        mode: world.mode,
        map_seq: world.map_seq,
        chunk_index: chunk.chunk_index,
        generation: chunk.generation,
        revealed_rows: world.revealed_rows,
        randomness_hash: chunk.randomness_hash,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// init_sector — lazily create/derive occupancy sectors for revealed rows
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(sector_x: u8, sector_y: u32)]
pub struct InitSector<'info> {
    /// CHECK: the world is normally DELEGATED once the day is live, so a
    /// typed account would reject it and no sector could ever be created for
    /// newly revealed rows. The handler validates it by committed read +
    /// mode/day PDA derivation, exactly like `init_run`.
    pub world: UncheckedAccount<'info>,
    /// Chunk covering this sector's rows (blocker derivation). Its address is
    /// pinned in the handler against the committed world's day, since the
    /// day is not available to the seeds expression here.
    #[account(constraint = chunk.status == ChunkStatus::Revealed @ CrossyError::FrontierClosed)]
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
/// static blocker bits from the committed chunk definition. The revealed
/// chunk *is* the frontier proof — it only exists once randomness for those
/// rows was authenticated — so no (possibly stale) world counter is read.
pub fn init_sector(ctx: Context<InitSector>, sector_x: u8, sector_y: u32) -> Result<()> {
    require!(sector_x < 8, CrossyError::WrongSector);
    let first_row = sector_y.checked_mul(8).ok_or(CrossyError::Overflow)?;

    // Validate the (possibly delegated) world by its self-describing PDA.
    let committed =
        crate::cross_plane::read_committed_world_any(&ctx.accounts.world.to_account_info())?;
    let expected_world = Pubkey::find_program_address(
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
        expected_world,
        CrossyError::NotReconcilable
    );

    // Pin the chunk to the one covering these rows for this world's day.
    let chunk_index = first_row / CHUNK_ROWS as u32;
    let expected_chunk = Pubkey::find_program_address(
        &[
            seeds::CHUNK,
            &[committed.region],
            &committed.day.to_le_bytes(),
            &chunk_index.to_le_bytes(),
        ],
        &crate::ID,
    )
    .0;
    require_keys_eq!(
        ctx.accounts.chunk.key(),
        expected_chunk,
        CrossyError::BadChunkState
    );

    let sector = &mut ctx.accounts.sector;
    sector.world = ctx.accounts.world.key();
    sector.sector_x = sector_x;
    sector.sector_y = sector_y;
    sector.occupancy = 0;
    sector.seq = 0;
    sector.bump = ctx.bumps.sector;

    // Static blockers from the chunk's grass lanes.
    let chunk = &ctx.accounts.chunk;
    let mut blockers = 0u64;
    for local_y in 0..8u16 {
        let row = first_row + local_y as u32;
        if row < chunk.row_start || row >= chunk.row_start + CHUNK_ROWS as u32 {
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
