//! Deterministic hazard evaluation.
//!
//! Rendered and validated hazard state derives from
//! `generation_version + chunk randomness + lane descriptor + authoritative
//! time + bounded temporary effects`. The contract evaluates discrete tile
//! occupancy windows; the frontend interpolates visuals from the same math.
//!
//! All positions are in milli-tiles (mt); all times in milliseconds since the
//! world's `start_ts`. Integer arithmetic only.

use super::chunkgen::{LaneDescriptor, LaneKind};
use crate::constants::WORLD_WIDTH;

/// How often a rider on a river tile is rescheduled for a hazard check.
/// The carry logic reads this back to work out how long it has been since
/// the rider was last known to be aboard.
pub const RIVER_RECHECK_MS: u64 = 250;

/// Most tiles a single carry may move a rider. A stall longer than this is
/// pathological, and an unbounded carry could teleport someone across the
/// world after a long outage.
pub const MAX_CARRY_TILES: u64 = 8;

/// Outcome of evaluating one tile at one authoritative instant.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TileState {
    /// Safe to stand on.
    Safe,
    /// Lethal right now (vehicle/train overlap, unsupported water, sink).
    Lethal,
    /// Not passable but not lethal (static blocker; train warning gate).
    Blocked,
    /// Water with an active support (log/platform) under this tile.
    Supported,
}

/// The world-x span [start, end) in milli-tiles of the k-th object in a
/// moving lane at time `t_ms`. Objects repeat every `gap_tiles`; the lane is
/// an infinite conveyor sampled modulo its cycle.
fn object_offset_mt(lane: &LaneDescriptor, t_ms: u64) -> u64 {
    let cycle = lane.gap_tiles as u64 * 1_000;
    traveled_mt(lane, t_ms) % cycle
}

/// Distance traveled by the lane's conveyor, snapped to whole tiles.
///
/// Objects sit on tile boundaries, never between them. Without the snap a
/// one-tile car parked at a 0.4-tile offset overlaps *two* cells and kills on
/// both, which is neither what the player sees nor what any two clients would
/// agree on. Snapping also makes the object grid exactly reproducible off
/// chain: every position is an integer tile, so a renderer and the program
/// cannot drift apart.
fn traveled_mt(lane: &LaneDescriptor, t_ms: u64) -> u64 {
    let raw = t_ms
        .wrapping_mul(lane.speed_mtps as u64)
        .wrapping_div(1_000)
        .wrapping_add(lane.phase_mt as u64);
    raw / 1_000 * 1_000
}

/// Whole tiles the conveyor has advanced at `t_ms`.
fn traveled_tiles(lane: &LaneDescriptor, t_ms: u64) -> u64 {
    traveled_mt(lane, t_ms) / 1_000
}

/// True when world tile-x `x` overlaps any object footprint of the lane at
/// `t_ms`. Treats the lane as a repeating pattern of `footprint` filled tiles
/// followed by `gap - footprint` empty tiles, scrolled by direction.
pub fn lane_object_covers(lane: &LaneDescriptor, x: u8, t_ms: u64) -> bool {
    if lane.gap_tiles == 0 {
        return false;
    }
    let cycle_mt = lane.gap_tiles as u64 * 1_000;
    let offset = object_offset_mt(lane, t_ms);
    let x_mt = x as u64 * 1_000;
    // Position of this tile inside the scrolling pattern.
    let pattern_pos = if lane.dir_positive == 1 {
        // Pattern moves +x: pattern coordinate = (x - offset) mod cycle
        (x_mt + cycle_mt - (offset % cycle_mt)) % cycle_mt
    } else {
        (x_mt + offset) % cycle_mt
    };
    // A tile overlaps an object when its 1000mt-wide cell intersects the
    // [0, footprint*1000) object window on the cycle. Either the cell starts
    // inside the window, or the cell wraps past the cycle end (the wrapped
    // part always lands inside [0, fp_mt) because fp_mt >= 1000).
    let fp_mt = lane.footprint as u64 * 1_000;
    pattern_pos < fp_mt || pattern_pos + 1_000 > cycle_mt
}

/// The stable conveyor index of the object covering tile `x`, or `None` when
/// the tile is clear.
///
/// The lane is an infinite line of objects spaced `gap_tiles` apart, and the
/// whole line scrolls. Indexing by *slot on that line* rather than by
/// position means a given car keeps one index for its entire journey across
/// the world, which is what makes it addressable: pair it with the chunk's
/// randomness and every client independently agrees on which car this is.
pub fn object_index(lane: &LaneDescriptor, x: u8, t_ms: u64) -> Option<i64> {
    if lane.gap_tiles == 0 || lane.footprint == 0 {
        return None;
    }
    let gap = lane.gap_tiles as i64;
    let traveled = traveled_tiles(lane, t_ms) as i64;
    // Objects sit at `k * gap + traveled` (or minus, travelling the other
    // way); solve for the slot whose footprint covers this tile.
    let relative = if lane.dir_positive == 1 {
        x as i64 - traveled
    } else {
        x as i64 + traveled
    };
    let index = relative.div_euclid(gap);
    let offset_in_object = relative.rem_euclid(gap);
    (offset_in_object < lane.footprint as i64).then_some(index)
}

/// Train cycle state for a rail lane at `t_ms`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RailPhase {
    Quiet,
    Warning,
    Train,
}

pub fn rail_phase(lane: &LaneDescriptor, t_ms: u64) -> RailPhase {
    let crossing_ms =
        (WORLD_WIDTH as u64 + lane.footprint as u64) * 1_000_000 / (lane.speed_mtps as u64).max(1);
    let cycle = lane.period_ms as u64 + lane.warning_ms as u64 + crossing_ms;
    let pos = (t_ms + lane.phase_mt as u64) % cycle;
    if pos < lane.period_ms as u64 {
        RailPhase::Quiet
    } else if pos < lane.period_ms as u64 + lane.warning_ms as u64 {
        RailPhase::Warning
    } else {
        RailPhase::Train
    }
}

/// Milliseconds until the next phase boundary of a rail lane (for hazard
/// scheduling).
pub fn rail_next_transition_ms(lane: &LaneDescriptor, t_ms: u64) -> u64 {
    let crossing_ms =
        (WORLD_WIDTH as u64 + lane.footprint as u64) * 1_000_000 / (lane.speed_mtps as u64).max(1);
    let cycle = lane.period_ms as u64 + lane.warning_ms as u64 + crossing_ms;
    let pos = (t_ms + lane.phase_mt as u64) % cycle;
    let quiet_end = lane.period_ms as u64;
    let warn_end = quiet_end + lane.warning_ms as u64;
    if pos < quiet_end {
        quiet_end - pos
    } else if pos < warn_end {
        warn_end - pos
    } else {
        cycle - pos
    }
}

/// Sinking log windows: logs are submerged for the last quarter of every
/// 8-second cycle, with 1.5s of deterministic "wobble" warning before.
pub fn log_submerged(lane: &LaneDescriptor, t_ms: u64) -> bool {
    if lane.sinking == 0 {
        return false;
    }
    const CYCLE_MS: u64 = 8_000;
    const SUBMERGED_MS: u64 = 2_000;
    let pos = (t_ms + lane.phase_mt as u64) % CYCLE_MS;
    pos >= CYCLE_MS - SUBMERGED_MS
}

/// Evaluate one tile of one lane at authoritative time `t_ms` (ms since
/// world start). `y_in_chunk` selects the lane; caller resolves the lane
/// descriptor from the revealed chunk.
pub fn evaluate_tile(lane: &LaneDescriptor, x: u8, t_ms: u64) -> TileState {
    match LaneKind::from_u8(lane.kind) {
        Some(LaneKind::Grass) => {
            if lane.blocker_mask & (1u64 << (x % WORLD_WIDTH)) != 0 {
                TileState::Blocked
            } else {
                TileState::Safe
            }
        }
        Some(LaneKind::Road) => {
            if lane_object_covers(lane, x, t_ms) {
                TileState::Lethal
            } else {
                TileState::Safe
            }
        }
        Some(LaneKind::River) => {
            if lane_object_covers(lane, x, t_ms) && !log_submerged(lane, t_ms) {
                TileState::Supported
            } else {
                TileState::Lethal
            }
        }
        Some(LaneKind::Rail) => match rail_phase(lane, t_ms) {
            RailPhase::Train => TileState::Lethal,
            _ => TileState::Safe,
        },
        None => TileState::Blocked,
    }
}

/// Is the tile enterable by a movement right now? (Supported water counts.)
pub fn is_traversable(lane: &LaneDescriptor, x: u8, t_ms: u64) -> bool {
    matches!(
        evaluate_tile(lane, x, t_ms),
        TileState::Safe | TileState::Supported
    )
}

/// Is standing on this tile lethal right now?
pub fn is_lethal(lane: &LaneDescriptor, x: u8, t_ms: u64) -> bool {
    evaluate_tile(lane, x, t_ms) == TileState::Lethal
}

/// The tile a river passenger drifts to, or `None` when this lane cannot
/// carry anyone from `x` right now.
///
/// A log is a moving platform: the water under a rider only turns lethal
/// because the log scrolled on without them. At that instant the rider sits
/// exactly one tile behind the log's trailing edge, so the tile immediately
/// downstream is the one still under the log. Following it is what "the log
/// carries you" means on a tile grid.
pub fn carry_target(lane: &LaneDescriptor, x: u8, t_ms: u64, tiles: u64) -> Option<u8> {
    if LaneKind::from_u8(lane.kind) != Some(LaneKind::River) {
        return None;
    }
    let step = u8::try_from(tiles.clamp(1, MAX_CARRY_TILES)).ok()?;
    let next = if lane.dir_positive == 1 {
        x.checked_add(step)?
    } else {
        x.checked_sub(step)?
    };
    if next >= WORLD_WIDTH {
        return None; // carried off the edge of the world
    }
    (evaluate_tile(lane, next, t_ms) == TileState::Supported).then_some(next)
}

/// Tiles the lane's conveyor advanced between two instants.
///
/// A rider is only ever unsupported because the log moved on without them,
/// so the distance the log travelled since they were last confirmed aboard
/// is exactly the distance they should be carried. Checking one tile ahead
/// is only correct when the check is punctual; hazard checks are
/// permissionless, and a client that stalls for two seconds would otherwise
/// drown a rider who never left the log.
pub fn conveyor_advance(lane: &LaneDescriptor, from_ms: u64, to_ms: u64) -> u64 {
    traveled_tiles(lane, to_ms)
        .saturating_sub(traveled_tiles(lane, from_ms))
        .clamp(1, MAX_CARRY_TILES)
}

/// Earliest future instant (ms, strictly > t_ms) at which the tile *could*
/// become lethal, or `None` if the tile is permanently safe under static
/// geometry. Used to schedule the bounded crank collision check. The result
/// is conservative (never later than the true transition).
pub fn next_hazard_deadline_ms(lane: &LaneDescriptor, x: u8, t_ms: u64) -> Option<u64> {
    match LaneKind::from_u8(lane.kind) {
        Some(LaneKind::Grass) | None => None,
        Some(LaneKind::Road) => {
            // Scan forward in 250ms steps up to one full cycle for the next
            // covering window. Bounded: cycle <= 64s at min speed.
            let cycle_ms = (lane.gap_tiles as u64 * 1_000).saturating_mul(1_000)
                / (lane.speed_mtps as u64).max(1);
            let step = 100u64;
            let mut t = t_ms + step;
            let end = t_ms + cycle_ms.max(step) + step;
            while t <= end {
                if lane_object_covers(lane, x, t) {
                    return Some(t);
                }
                t += step;
            }
            None
        }
        Some(LaneKind::River) => {
            // Standing on water: support may scroll away or sink. Conservative
            // short deadline — recheck often while on a river tile.
            Some(t_ms + RIVER_RECHECK_MS)
        }
        Some(LaneKind::Rail) => Some(t_ms + rail_next_transition_ms(lane, t_ms).max(1)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn road_lane() -> LaneDescriptor {
        LaneDescriptor {
            kind: LaneKind::Road as u8,
            dir_positive: 1,
            footprint: 2,
            gap_tiles: 8,
            speed_mtps: 1_000, // 1 tile/s
            phase_mt: 0,
            ..Default::default()
        }
    }

    #[test]
    fn road_coverage_is_periodic_and_deterministic() {
        let lane = road_lane();
        // At t=0, pattern position of tile x equals x mod 8; footprint 2 =>
        // tiles 0,1 covered (cells 0..2000mt), 8,9 covered, etc.
        assert!(lane_object_covers(&lane, 0, 0));
        assert!(lane_object_covers(&lane, 1, 0));
        assert!(!lane_object_covers(&lane, 3, 0));
        assert!(lane_object_covers(&lane, 8, 0));
        // Determinism
        for x in 0..16u8 {
            assert_eq!(
                lane_object_covers(&lane, x, 1234),
                lane_object_covers(&lane, x, 1234)
            );
        }
        // One full cycle later (8 tiles at 1 t/s = 8000ms) identical.
        for x in 0..16u8 {
            assert_eq!(
                lane_object_covers(&lane, x, 0),
                lane_object_covers(&lane, x, 8_000)
            );
        }
    }

    #[test]
    fn road_objects_move_with_time() {
        let lane = road_lane();
        // After 1s at 1 tile/s moving +x, coverage shifts by one tile.
        for x in 1..15u8 {
            assert_eq!(
                lane_object_covers(&lane, x, 1_000),
                lane_object_covers(&lane, x - 1, 0)
            );
        }
    }

    #[test]
    fn rail_phases_cycle_with_minimum_warning() {
        let lane = LaneDescriptor {
            kind: LaneKind::Rail as u8,
            footprint: 6,
            speed_mtps: 3_000,
            warning_ms: 1_500,
            period_ms: 6_000,
            phase_mt: 0,
            ..Default::default()
        };
        assert_eq!(rail_phase(&lane, 0), RailPhase::Quiet);
        assert_eq!(rail_phase(&lane, 5_999), RailPhase::Quiet);
        assert_eq!(rail_phase(&lane, 6_000), RailPhase::Warning);
        assert_eq!(rail_phase(&lane, 7_499), RailPhase::Warning);
        assert_eq!(rail_phase(&lane, 7_500), RailPhase::Train);
        // Scheduling: from quiet, next transition is warning start.
        assert_eq!(rail_next_transition_ms(&lane, 0), 6_000);
        assert_eq!(rail_next_transition_ms(&lane, 6_000), 1_500);
    }

    #[test]
    fn river_needs_support() {
        let lane = LaneDescriptor {
            kind: LaneKind::River as u8,
            dir_positive: 1,
            footprint: 3,
            gap_tiles: 8,
            speed_mtps: 500,
            phase_mt: 0,
            sinking: 0,
            ..Default::default()
        };
        // t=0: pattern pos = x mod 8; log covers cells 0..3.
        assert_eq!(evaluate_tile(&lane, 0, 0), TileState::Supported);
        assert_eq!(evaluate_tile(&lane, 2, 0), TileState::Supported);
        assert_eq!(evaluate_tile(&lane, 5, 0), TileState::Lethal);
    }

    #[test]
    fn objects_sit_on_whole_tiles_and_cover_exactly_their_footprint() {
        // A one-tile car must never occupy two cells, whatever the phase or
        // speed: that is what lets a renderer and the program agree.
        for phase in [0u32, 250, 400, 750, 999] {
            for speed in [250u16, 333, 1_000, 2_500, 4_000] {
                let lane = LaneDescriptor {
                    kind: LaneKind::Road as u8,
                    dir_positive: 1,
                    footprint: 1,
                    gap_tiles: 8,
                    speed_mtps: speed,
                    phase_mt: phase,
                    ..Default::default()
                };
                for step in 0..12u64 {
                    let t = step * 1_000; // the authoritative clock ticks in seconds
                    let covered = (0..64u8)
                        .filter(|x| lane_object_covers(&lane, *x, t))
                        .count();
                    // 64 tiles / gap 8 = 8 objects, one tile each.
                    assert_eq!(covered, 8, "phase {phase} speed {speed} t {t}");
                }
            }
        }
    }

    #[test]
    fn object_index_matches_coverage() {
        let lane = LaneDescriptor {
            kind: LaneKind::Road as u8,
            dir_positive: 0,
            footprint: 3,
            gap_tiles: 9,
            speed_mtps: 2_000,
            phase_mt: 0,
            ..Default::default()
        };
        for step in 0..20u64 {
            let t = step * 1_000;
            for x in 0..64u8 {
                assert_eq!(
                    object_index(&lane, x, t).is_some(),
                    lane_object_covers(&lane, x, t),
                    "x {x} t {t}"
                );
            }
        }
    }

    #[test]
    fn logs_carry_their_passenger_downstream() {
        let lane = LaneDescriptor {
            kind: LaneKind::River as u8,
            dir_positive: 1,
            footprint: 3,
            gap_tiles: 8,
            speed_mtps: 1_000, // 1 tile/s
            phase_mt: 0,
            sinking: 0,
            ..Default::default()
        };
        // t=0: the log covers tiles 0..3. A rider at tile 0 is supported.
        assert_eq!(evaluate_tile(&lane, 0, 0), TileState::Supported);
        // One second on, the log has moved to 1..4 and tile 0 is open water.
        assert_eq!(evaluate_tile(&lane, 0, 1_000), TileState::Lethal);
        // The rider is carried to tile 1, which is still under the log.
        assert_eq!(carry_target(&lane, 0, 1_000, 1), Some(1));
        assert_eq!(evaluate_tile(&lane, 1, 1_000), TileState::Supported);
    }

    #[test]
    fn carrying_stops_at_the_world_edge_and_off_water() {
        let mut lane = LaneDescriptor {
            kind: LaneKind::River as u8,
            dir_positive: 1,
            footprint: 3,
            gap_tiles: 8,
            speed_mtps: 1_000,
            phase_mt: 0,
            ..Default::default()
        };
        // Nothing downstream of the last column: the rider drowns.
        assert_eq!(carry_target(&lane, WORLD_WIDTH - 1, 1_000, 1), None);
        // Moving the other way, column 0 has nowhere to drift either.
        lane.dir_positive = 0;
        assert_eq!(carry_target(&lane, 0, 1_000, 1), None);
        // Only rivers carry — roads and rails never do.
        lane.kind = LaneKind::Road as u8;
        assert_eq!(carry_target(&lane, 10, 0, 1), None);
    }

    #[test]
    fn a_late_check_still_carries_the_rider() {
        // One tile per second. A rider boards at tile 0 at t=0 and nobody
        // checks for three seconds: the log is now three tiles along, and a
        // one-tile lookahead would find open water and drown them.
        let lane = LaneDescriptor {
            kind: LaneKind::River as u8,
            dir_positive: 1,
            footprint: 2,
            gap_tiles: 8,
            speed_mtps: 1_000,
            phase_mt: 0,
            sinking: 0,
            ..Default::default()
        };
        assert_eq!(evaluate_tile(&lane, 0, 0), TileState::Supported);
        assert_eq!(evaluate_tile(&lane, 0, 3_000), TileState::Lethal);
        assert_eq!(carry_target(&lane, 0, 3_000, 1), None, "the naive lookahead drowns them");

        let advanced = conveyor_advance(&lane, 0, 3_000);
        assert_eq!(advanced, 3);
        assert_eq!(carry_target(&lane, 0, 3_000, advanced), Some(3));
        assert_eq!(evaluate_tile(&lane, 3, 3_000), TileState::Supported);
    }

    #[test]
    fn carrying_is_bounded_after_a_long_stall() {
        let lane = LaneDescriptor {
            kind: LaneKind::River as u8,
            dir_positive: 1,
            footprint: 2,
            gap_tiles: 8,
            speed_mtps: 1_000,
            phase_mt: 0,
            ..Default::default()
        };
        // An hour-long outage must not teleport anyone across the world.
        assert_eq!(conveyor_advance(&lane, 0, 3_600_000), MAX_CARRY_TILES);
        // And a check that arrives before any movement still tries one tile.
        assert_eq!(conveyor_advance(&lane, 1_000, 1_000), 1);
    }

    #[test]
    fn sinking_log_windows() {
        let lane = LaneDescriptor {
            kind: LaneKind::River as u8,
            dir_positive: 1,
            footprint: 3,
            gap_tiles: 8,
            speed_mtps: 500,
            phase_mt: 0,
            sinking: 1,
            ..Default::default()
        };
        assert!(!log_submerged(&lane, 0));
        assert!(log_submerged(&lane, 6_500));
        assert!(!log_submerged(&lane, 8_000));
    }

    #[test]
    fn grass_blockers_block() {
        let lane = LaneDescriptor {
            kind: LaneKind::Grass as u8,
            blocker_mask: 1 << 5,
            ..Default::default()
        };
        assert_eq!(evaluate_tile(&lane, 5, 0), TileState::Blocked);
        assert_eq!(evaluate_tile(&lane, 6, 0), TileState::Safe);
        assert!(next_hazard_deadline_ms(&lane, 6, 0).is_none());
    }

    #[test]
    fn road_deadline_finds_next_window() {
        let lane = road_lane();
        // Tile 3 free at t=0; moving +x pattern reaches it later.
        let d = next_hazard_deadline_ms(&lane, 3, 0).expect("road tile gets covered");
        assert!(d > 0);
        assert!(lane_object_covers(&lane, 3, d));
    }
}
