//! Delegated gameplay accounts: world headers, chunk definitions, occupancy
//! sectors, player runs, and daily bests. These are initialized on base,
//! delegated to one ER, mutated there, and committed per policy.

use anchor_lang::prelude::*;

use crate::constants::{MAX_CHUNK_LANES, MAX_SECTOR_EFFECTS};
use crate::errors::CrossyError;
use crate::kernel::chunkgen::LaneDescriptor;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
#[repr(u8)]
pub enum WorldMode {
    Paid,
    Casual,
}

impl WorldMode {
    pub fn seed_byte(self) -> u8 {
        self as u8
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
#[repr(u8)]
pub enum WorldStatus {
    Prepared,
    Open,
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
#[repr(u8)]
pub enum ChunkRequestState {
    /// No live request; next chunk may be requested at the frontier margin.
    Idle,
    /// A VRF request is in flight for `next_chunk_index`.
    Requested,
}

/// PDA: ["world", mode, utc_day_le]
#[account]
#[derive(InitSpace)]
pub struct WorldHeader {
    /// Rollup region this world runs on; part of its own PDA seeds.
    pub region: u8,
    pub day: u64,
    pub mode: WorldMode,
    pub status: WorldStatus,
    /// Authoritative day window (derived from `day`, stored for cheap checks).
    pub start_ts: i64,
    pub end_ts: i64,
    /// Fixed 64.
    pub width: u8,
    /// Safe-zone rows [0, safe_rows).
    pub safe_rows: u16,
    pub active_players: u16,
    pub player_cap: u16,
    /// Number of revealed rows; the frontier. Movement at/above this row is
    /// rejected (fail closed at an unrevealed boundary).
    pub revealed_rows: u32,
    /// Monotonic sequence for visible map changes. Clients use this to
    /// detect dropped frontier notifications and refetch a snapshot.
    pub map_seq: u64,
    /// Exact immutable chunk currently terminating the visible frontier.
    pub latest_chunk_index: u32,
    pub latest_chunk_generation: u16,
    pub latest_chunk_hash: [u8; 32],
    /// A non-zero index means all sectors for that next chunk were observed
    /// together on this ER and the frontier may advance over it.
    pub ready_chunk_index: u32,
    pub ready_chunk_hash: [u8; 32],
    /// The spawn chunk and all of its sectors have been observed together on
    /// this world's ER. No attempt may activate before this barrier is set.
    pub spawn_ready: bool,
    /// Current record: score, holder, attempt, slot. The ONLY prize authority.
    pub record_score: u32,
    pub record_holder: Pubkey,
    pub record_attempt: u32,
    pub record_slot: u64,
    /// Chunk pipeline: index the next request will target and its state.
    pub next_chunk_index: u32,
    pub chunk_request_state: ChunkRequestState,
    /// VRF request generation for the in-flight chunk request.
    pub chunk_generation: u16,
    pub chunk_requested_at: i64,
    /// Class-balance version snapshotted at preparation.
    pub class_balance_version: u16,
    /// Domain for action-envelope uniqueness.
    pub action_domain: u64,
    /// Authorized commit/crank fee payer reference.
    pub commit_payer: Pubkey,
    pub bump: u8,
}

/// Borsh-friendly lane mirror of the kernel `LaneDescriptor`.
#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default, InitSpace,
)]
pub struct Lane {
    pub kind: u8,
    pub dir_positive: u8,
    pub footprint: u8,
    pub gap_tiles: u8,
    pub speed_mtps: u16,
    pub phase_mt: u32,
    pub warning_ms: u32,
    pub period_ms: u32,
    pub blocker_mask: u64,
    pub sinking: u8,
}

impl From<LaneDescriptor> for Lane {
    fn from(d: LaneDescriptor) -> Self {
        Self {
            kind: d.kind,
            dir_positive: d.dir_positive,
            footprint: d.footprint,
            gap_tiles: d.gap_tiles,
            speed_mtps: d.speed_mtps,
            phase_mt: d.phase_mt,
            warning_ms: d.warning_ms,
            period_ms: d.period_ms,
            blocker_mask: d.blocker_mask,
            sinking: d.sinking,
        }
    }
}

impl From<Lane> for LaneDescriptor {
    fn from(l: Lane) -> Self {
        Self {
            kind: l.kind,
            dir_positive: l.dir_positive,
            footprint: l.footprint,
            gap_tiles: l.gap_tiles,
            speed_mtps: l.speed_mtps,
            phase_mt: l.phase_mt,
            warning_ms: l.warning_ms,
            period_ms: l.period_ms,
            blocker_mask: l.blocker_mask,
            sinking: l.sinking,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
#[repr(u8)]
pub enum ChunkStatus {
    Uninitialized,
    Requested,
    Revealed,
    Closed,
}

/// PDA: ["chunk", utc_day_le, chunk_index_le]
/// One revealed definition is shared by both paid and casual modes.
#[account]
#[derive(InitSpace)]
pub struct ChunkDefinition {
    /// Rollup region; regions generate independent maps because a chunk can
    /// only be delegated to one validator at a time.
    pub region: u8,
    pub day: u64,
    pub chunk_index: u32,
    /// First absolute row of this chunk (chunk_index * 16).
    pub row_start: u32,
    /// Fixed 16.
    pub row_count: u8,
    /// VRF request generation this chunk was revealed under.
    pub generation: u16,
    /// Commitment to the raw randomness for auditability.
    pub randomness_hash: [u8; 32],
    /// Deterministic generator version.
    pub generation_version: u16,
    pub status: ChunkStatus,
    pub requested_at: i64,
    pub lanes: [Lane; MAX_CHUNK_LANES],
    pub bump: u8,
}

/// Bounded temporary effect stored in a sector. Expired slots are reusable;
/// full slots reject new effects rather than evicting unpredictably.
#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default, InitSpace,
)]
pub struct TempEffect {
    /// 0 = empty slot. Mirrors AbilityKind for placed effects.
    pub kind: u8,
    pub center_x: u8,
    pub center_y: u32,
    pub radius: u8,
    /// e.g. slow permille for Trap/TimeSlow, unused otherwise.
    pub magnitude: u16,
    pub start_ts: i64,
    pub end_ts: i64,
    /// Originating run (kick/ability attribution for UI; no kill credit).
    pub source: Pubkey,
    pub nonce: u32,
}

impl TempEffect {
    pub fn is_free(&self, now: i64) -> bool {
        self.kind == 0 || self.end_ts <= now
    }
    pub fn is_active(&self, now: i64) -> bool {
        self.kind != 0 && self.start_ts <= now && now < self.end_ts
    }
    pub fn covers(&self, x: u8, y: u32, now: i64) -> bool {
        if !self.is_active(now) {
            return false;
        }
        let dx = (self.center_x as i32 - x as i32).abs();
        let dy = (self.center_y as i64 - y as i64).abs();
        dx <= self.radius as i32 && dy <= self.radius as i64
    }
}

/// PDA: ["sector", world, sector_x, sector_y_le]
/// 8x8 tiles; occupancy + static blockers as bitsets, bounded effect slots.
#[account]
#[derive(InitSpace)]
pub struct OccupancySector {
    pub world: Pubkey,
    pub sector_x: u8,
    pub sector_y: u32,
    /// One bit per tile (bit = local_y * 8 + local_x). One live player per
    /// tile, enforced atomically by movement/spawn/displacement handlers.
    pub occupancy: u64,
    /// Static blockers derived from the revealed chunk rows.
    pub blockers: u64,
    /// Monotonic sequence for client gap detection.
    pub seq: u64,
    pub effects: [TempEffect; MAX_SECTOR_EFFECTS],
    pub bump: u8,
}

impl OccupancySector {
    pub fn is_occupied(&self, bit: u8) -> bool {
        self.occupancy & (1u64 << bit) != 0
    }
    pub fn set_occupied(&mut self, bit: u8) -> Result<()> {
        self.occupancy |= 1u64 << bit;
        self.seq = self.seq.checked_add(1).ok_or(CrossyError::Overflow)?;
        Ok(())
    }
    pub fn clear_occupied(&mut self, bit: u8) -> Result<()> {
        self.occupancy &= !(1u64 << bit);
        self.seq = self.seq.checked_add(1).ok_or(CrossyError::Overflow)?;
        Ok(())
    }
    pub fn is_blocked(&self, bit: u8) -> bool {
        self.blockers & (1u64 << bit) != 0
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
#[repr(u8)]
pub enum RunState {
    /// No attempt yet or account recycled for a new attempt.
    Idle,
    /// Entry paid; awaiting ER spawn evaluation.
    PendingSpawn,
    Active,
    DeadAwaitingRevive,
    /// Spawn failed (capacity/cutoff); entry receipt becomes refundable.
    EntryFailed,
    Ended,
}

/// Session action scope bitmap.
pub mod session_scope {
    pub const MOVE: u8 = 1 << 0;
    pub const KICK: u8 = 1 << 1;
    pub const ABILITY: u8 = 1 << 2;
    pub const HEARTBEAT: u8 = 1 << 3;
    pub const ALL_GAMEPLAY: u8 = MOVE | KICK | ABILITY | HEARTBEAT;
}

/// PDA: ["run", world, wallet]
/// One account per wallet per world, reused across attempts by incrementing
/// `attempt_nonce`. Never two active attempts simultaneously.
#[account]
#[derive(InitSpace)]
pub struct PlayerRun {
    pub world: Pubkey,
    pub wallet: Pubkey,
    /// Registered session signer for gameplay actions.
    pub session_authority: Pubkey,
    pub session_expiry: i64,
    pub session_scope: u8,
    /// Rate limit + binding for session rotation.
    pub session_rotation: u16,
    pub attempt_nonce: u32,
    pub state: RunState,
    /// Selected Core asset; Pubkey::default() = starter marker.
    pub agent_asset: Pubkey,
    pub class_id: u16,
    pub class_version: u16,
    pub x: u8,
    pub y: u32,
    /// Facing direction (grid::Direction as u8), updated by accepted moves.
    pub facing: u8,
    /// Furthest forward row = authoritative score for this attempt.
    pub score: u32,
    /// Last verified safe tile (revival placement policy).
    pub safe_x: u8,
    pub safe_y: u32,
    /// Last spent movement slot; batches retain at most four elapsed slots
    /// of credit. Single moves consume through the current runtime slot.
    pub last_move_slot: u64,
    /// Exact-next action sequence; consumed by successfully executed actions.
    pub action_seq: u64,
    /// Monotonic sequence for every authoritative run mutation, including
    /// changes that do not consume a player action.
    pub state_seq: u64,
    pub kick_ready_ts: i64,
    pub ability_ready_ts: i64,
    // ---- bounded status effects (authoritative timestamps) ----
    pub stunned_until: i64,
    pub slowed_until: i64,
    /// Guardian shield: absorbs one environmental collision until expiry.
    pub shield_until: i64,
    pub shield_charges: u8,
    /// Anchor: ignores forced movement until expiry.
    pub anchor_until: i64,
    // ---- attempt lifecycle ----
    pub successful_revives: u16,
    pub death_nonce: u32,
    pub revive_deadline: i64,
    /// Receipt PDAs currently bound to this attempt (entry / latest revival).
    pub entry_receipt: Pubkey,
    pub revive_receipt: Pubkey,
    /// Hazard scheduling: stale-nonce protection for crank checks.
    pub hazard_nonce: u32,
    /// Next scheduled hazard deadline in ms since world start (0 = none).
    pub hazard_deadline_ms: u64,
    /// Reconciliation markers: committed state observed by base instructions.
    pub last_committed_state: u8,
    pub bump: u8,
}

impl PlayerRun {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self.state,
            RunState::Ended | RunState::EntryFailed | RunState::Idle
        )
    }

    pub fn touch(&mut self) -> Result<()> {
        self.state_seq = self
            .state_seq
            .checked_add(1)
            .ok_or(crate::errors::CrossyError::Overflow)?;
        Ok(())
    }

    pub fn bump_hazard_nonce(&mut self) -> Result<()> {
        self.hazard_nonce = self
            .hazard_nonce
            .checked_add(1)
            .ok_or(crate::errors::CrossyError::Overflow)?;
        Ok(())
    }
}

/// PDA: ["best", world, wallet]
/// Every wallet writes its own best account; indexers sort them for pages.
/// The prize record itself lives in `WorldHeader`.
#[account]
#[derive(InitSpace)]
pub struct DailyBest {
    pub world: Pubkey,
    pub wallet: Pubkey,
    pub best_score: u32,
    pub attempt_nonce: u32,
    pub reached_slot: u64,
    pub class_id: u16,
    pub asset: Pubkey,
    pub bump: u8,
}
