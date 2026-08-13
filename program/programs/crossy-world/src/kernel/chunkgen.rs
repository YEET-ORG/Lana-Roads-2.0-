//! Deterministic chunk generation: VRF bytes -> bounded lane descriptors.
//!
//! The generator is versioned (`GENERATION_VERSION`); its output is validated
//! against bounds so VRF can never produce an impossible or unbounded account
//! layout. Difficulty rises with chunk index through parameter ranges but
//! stays within audited limits. The same code (via golden vectors) drives the
//! renderer's visual hazard positions.

use crate::constants::{CHUNK_ROWS, MAX_CHUNK_LANES, MIN_TRAIN_WARNING_MS, WORLD_WIDTH};

/// Bump on any change to the derivation below.
pub const GENERATION_VERSION: u16 = 2;

/// Lane kinds. A closed set — new kinds require a new generation version.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum LaneKind {
    /// Safe grass; `blocker_mask` may contain static obstacles.
    Grass = 0,
    /// Road with cars/trucks moving at `speed`.
    Road = 1,
    /// River: lethal unless standing on a log window.
    River = 2,
    /// Railway: periodic train with mandatory warning window.
    Rail = 3,
}

impl LaneKind {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Grass),
            1 => Some(Self::Road),
            2 => Some(Self::River),
            3 => Some(Self::Rail),
            _ => None,
        }
    }
}

/// One lane (row) of a chunk. Fixed-size, borsh-friendly, bounded values.
///
/// Hazard positions derive from `(time_ms * speed_mtpm / 60000) + phase`
/// modulo `period` — see `hazard.rs`. All units are integer milli-tiles or
/// milliseconds; no floats.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct LaneDescriptor {
    /// Lane kind (`LaneKind` as u8).
    pub kind: u8,
    /// 1 = moving objects travel +x, 0 = -x.
    pub dir_positive: u8,
    /// Object footprint in tiles (1..=4): car=1..2, truck=2..3, log=2..4,
    /// train=6..8.
    pub footprint: u8,
    /// Gap between object starts, in tiles (footprint < gap <= 64).
    pub gap_tiles: u8,
    /// Speed in milli-tiles per second (250..=4000 i.e. 0.25..4 tiles/s).
    pub speed_mtps: u16,
    /// Initial phase offset in milli-tiles (0..gap*1000).
    pub phase_mt: u32,
    /// Rail only: warning lead time before the train enters, ms.
    pub warning_ms: u32,
    /// Rail only: quiet period between trains, ms.
    pub period_ms: u32,
    /// Grass only: bitmask of statically blocked columns.
    pub blocker_mask: u64,
    /// River only: logs are safe platforms; 1 = sinking logs variant with
    /// deterministic submerge windows.
    pub sinking: u8,
}

/// A generated chunk: exactly CHUNK_ROWS lanes.
#[derive(Clone, Debug)]
pub struct ChunkLayout {
    pub lanes: [LaneDescriptor; MAX_CHUNK_LANES],
}

/// Deterministic RNG over the VRF seed: SplitMix64 stream keyed by
/// (seed, chunk_index, lane, field). Stable across platforms.
pub struct DetRng {
    state: u64,
}

impl DetRng {
    pub fn new(seed: &[u8; 32], chunk_index: u16) -> Self {
        let mut s: u64 = 0x9e37_79b9_7f4a_7c15;
        for (i, chunk) in seed.chunks(8).enumerate() {
            let mut b = [0u8; 8];
            b[..chunk.len()].copy_from_slice(chunk);
            s ^= u64::from_le_bytes(b).rotate_left((i as u32 * 13) % 64);
        }
        s ^= (chunk_index as u64).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        Self { state: s }
    }

    pub fn next_u64(&mut self) -> u64 {
        // SplitMix64
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// Unbiased sample in [0, bound) via rejection (no modulo bias).
    pub fn below(&mut self, bound: u64) -> u64 {
        debug_assert!(bound > 0);
        let zone = u64::MAX - (u64::MAX % bound);
        loop {
            let v = self.next_u64();
            if v < zone {
                return v % bound;
            }
        }
    }

    /// Inclusive range sample.
    pub fn range(&mut self, lo: u64, hi: u64) -> u64 {
        debug_assert!(hi >= lo);
        lo + self.below(hi - lo + 1)
    }
}

/// Difficulty stage from chunk index: hazards start immediately after the
/// spawn rows and get denser/faster within audited maxima.
pub const fn difficulty_stage(chunk_index: u16) -> u8 {
    match chunk_index {
        0..=3 => 1,
        4..=8 => 2,
        9..=15 => 3,
        _ => 4,
    }
}

/// Rows at the head of a chunk forced to open grass. The spawn chunk keeps a
/// wider apron so players are never dropped straight onto traffic; every
/// later chunk still opens on one safe row, so entering it is never an
/// instant trap.
pub const fn safe_prefix(chunk_index: u16) -> usize {
    if chunk_index == 0 {
        3
    } else {
        1
    }
}

struct StageParams {
    hazard_weight: u64, // percent of rows that are hazardous
    max_speed: u64,     // milli-tiles per second
    min_gap: u64,       // tiles between object starts
    rail_allowed: bool,
    river_allowed: bool,
    sinking_allowed: bool,
    max_blockers_per_row: u32,
}

const fn stage_params(stage: u8) -> StageParams {
    match stage {
        0 | 1 => StageParams {
            hazard_weight: 45,
            max_speed: 1_000,
            min_gap: 6,
            rail_allowed: false,
            river_allowed: true,
            sinking_allowed: false,
            max_blockers_per_row: 6,
        },
        2 => StageParams {
            hazard_weight: 60,
            max_speed: 1_600,
            min_gap: 5,
            rail_allowed: true,
            river_allowed: true,
            sinking_allowed: false,
            max_blockers_per_row: 8,
        },
        3 => StageParams {
            hazard_weight: 70,
            max_speed: 2_400,
            min_gap: 4,
            rail_allowed: true,
            river_allowed: true,
            sinking_allowed: true,
            max_blockers_per_row: 10,
        },
        _ => StageParams {
            hazard_weight: 80,
            max_speed: 3_200,
            min_gap: 3,
            rail_allowed: true,
            river_allowed: true,
            sinking_allowed: true,
            max_blockers_per_row: 12,
        },
    }
}

/// Generate a chunk from VRF randomness. Total function: every seed yields a
/// valid, bounded layout satisfying the generator guarantees (16 rows, a
/// traversable static route, bounded params, minimum train warning).
pub fn generate_chunk(seed: &[u8; 32], chunk_index: u16) -> ChunkLayout {
    let mut rng = DetRng::new(seed, chunk_index);
    let stage = difficulty_stage(chunk_index);
    let p = stage_params(stage);
    let mut lanes = [LaneDescriptor::default(); MAX_CHUNK_LANES];
    let prefix = safe_prefix(chunk_index);

    let mut consecutive_hazard = 0u8;
    #[allow(clippy::needless_range_loop)]
    for row in 0..CHUNK_ROWS as usize {
        // Force a safe row after 4 consecutive hazard rows so a static route
        // always exists; the chunk's opening rows are safe so entering it is
        // never an instant trap.
        let force_safe = row < prefix || consecutive_hazard >= 4;
        let hazardous = !force_safe && rng.below(100) < p.hazard_weight;

        let lane = &mut lanes[row];
        if !hazardous {
            consecutive_hazard = 0;
            lane.kind = LaneKind::Grass as u8;
            // The spawn apron is completely clear: no blockers at all.
            if row < prefix {
                lane.blocker_mask = 0;
                continue;
            }
            // Bounded static blockers that always leave >= 8 open columns.
            let blocker_count = rng.below(p.max_blockers_per_row as u64 + 1) as u32;
            let mut mask = 0u64;
            for _ in 0..blocker_count {
                mask |= 1u64 << rng.below(WORLD_WIDTH as u64);
            }
            // Guarantee openings: clear a random aligned 8-column window.
            let open_start = rng.below(8) * 8;
            let open_window = 0xFFu64 << open_start;
            lane.blocker_mask = mask & !open_window;
            continue;
        }

        consecutive_hazard += 1;
        let kind_roll = rng.below(100);
        let kind = if p.rail_allowed && kind_roll < 15 {
            LaneKind::Rail
        } else if p.river_allowed && kind_roll < 45 {
            LaneKind::River
        } else {
            LaneKind::Road
        };

        lane.kind = kind as u8;
        lane.dir_positive = rng.below(2) as u8;
        match kind {
            LaneKind::Road => {
                lane.footprint = rng.range(1, 3) as u8; // car..truck
                lane.gap_tiles = rng.range(p.min_gap.max(lane.footprint as u64 + 2), 12) as u8;
                lane.speed_mtps = rng.range(250, p.max_speed) as u16;
                lane.phase_mt = rng.below(lane.gap_tiles as u64 * 1000) as u32;
            }
            LaneKind::River => {
                lane.footprint = rng.range(2, 4) as u8; // log length
                lane.gap_tiles = rng.range((lane.footprint as u64 + 2).max(p.min_gap), 10) as u8;
                lane.speed_mtps = rng.range(250, p.max_speed.min(1_500)) as u16;
                lane.phase_mt = rng.below(lane.gap_tiles as u64 * 1000) as u32;
                lane.sinking = (p.sinking_allowed && rng.below(100) < 25) as u8;
            }
            LaneKind::Rail => {
                lane.footprint = rng.range(6, 8) as u8;
                lane.speed_mtps = rng.range(2_000, 4_000) as u16;
                lane.warning_ms = rng.range(MIN_TRAIN_WARNING_MS as u64, 3_000) as u32;
                lane.period_ms = rng.range(5_000, 12_000) as u32;
                lane.phase_mt = rng.below(lane.period_ms as u64) as u32;
            }
            LaneKind::Grass => unreachable!(),
        }
    }

    ChunkLayout { lanes }
}

/// Validate a layout against the audited bounds. The program re-validates the
/// generator output before persisting a reveal — a defense-in-depth check
/// that VRF bytes can never smuggle an invalid account layout.
pub fn validate_layout(layout: &ChunkLayout, chunk_index: u16) -> bool {
    let prefix = safe_prefix(chunk_index);
    for (row, lane) in layout.lanes.iter().enumerate() {
        let Some(kind) = LaneKind::from_u8(lane.kind) else {
            return false;
        };
        match kind {
            LaneKind::Grass => {
                if lane.blocker_mask.count_ones() > 56 {
                    return false; // must leave open columns
                }
                // The spawn apron must be completely clear.
                if row < prefix && lane.blocker_mask != 0 {
                    return false;
                }
            }
            LaneKind::Road | LaneKind::River => {
                if lane.footprint == 0
                    || lane.footprint > 4
                    || lane.gap_tiles as u64 <= lane.footprint as u64
                    || lane.gap_tiles > 64
                    || lane.speed_mtps < 250
                    || lane.speed_mtps > 4_000
                {
                    return false;
                }
            }
            LaneKind::Rail => {
                if lane.warning_ms < MIN_TRAIN_WARNING_MS
                    || lane.period_ms == 0
                    || lane.period_ms > 60_000
                    || lane.footprint < 6
                    || lane.footprint > 8
                {
                    return false;
                }
            }
        }
        // The opening rows of every chunk must be safe (grass).
        if row < prefix && kind != LaneKind::Grass {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spawn_apron_is_clear_but_the_chunk_is_not_empty() {
        let layout = generate_chunk(&[0u8; 32], 0);
        for lane in layout.lanes.iter().take(safe_prefix(0)) {
            assert_eq!(lane.kind, LaneKind::Grass as u8);
            assert_eq!(lane.blocker_mask, 0);
        }
        // The deterministic spawn chunk must still contain real terrain past
        // the apron — an empty opening chunk is the bug this guards.
        let interesting = layout
            .lanes
            .iter()
            .skip(safe_prefix(0))
            .any(|l| l.kind != LaneKind::Grass as u8 || l.blocker_mask != 0);
        assert!(interesting, "spawn chunk past the apron must have terrain");
    }

    #[test]
    fn every_chunk_opens_on_safe_rows() {
        for s in 0u8..40 {
            for idx in [0u16, 1, 2, 7, 12, 33] {
                let layout = generate_chunk(&[s; 32], idx);
                for lane in layout.lanes.iter().take(safe_prefix(idx)) {
                    assert_eq!(lane.kind, LaneKind::Grass as u8, "seed {s} chunk {idx}");
                    assert_eq!(lane.blocker_mask, 0, "seed {s} chunk {idx}");
                }
            }
        }
    }

    #[test]
    fn generation_is_deterministic() {
        let a = generate_chunk(&[9u8; 32], 5);
        let b = generate_chunk(&[9u8; 32], 5);
        for (la, lb) in a.lanes.iter().zip(b.lanes.iter()) {
            assert_eq!(la, lb);
        }
    }

    #[test]
    fn every_seed_validates() {
        for s in 0u8..50 {
            for idx in [0u16, 1, 4, 9, 16, 100] {
                let layout = generate_chunk(&[s; 32], idx);
                assert!(validate_layout(&layout, idx), "seed {s} chunk {idx}");
            }
        }
    }

    #[test]
    fn hazard_runs_are_bounded() {
        for s in 0u8..30 {
            let layout = generate_chunk(&[s; 32], 20);
            let mut consecutive = 0;
            for lane in layout.lanes.iter() {
                if lane.kind == LaneKind::Grass as u8 {
                    consecutive = 0;
                } else {
                    consecutive += 1;
                    assert!(consecutive <= 4, "static route must exist");
                }
            }
        }
    }

    #[test]
    fn grass_rows_leave_open_columns() {
        for s in 0u8..30 {
            let layout = generate_chunk(&[s; 32], 20);
            for lane in layout.lanes.iter() {
                if lane.kind == LaneKind::Grass as u8 {
                    assert!(lane.blocker_mask.count_ones() <= 56);
                }
            }
        }
    }
}
