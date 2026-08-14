//! Canonical vehicle identity.
//!
//! Every moving object in a lane has a stable identity derived from state
//! that is already on chain, so no account grows by a byte: the lane it
//! belongs to, its index on that lane's infinite conveyor, and the chunk's
//! committed randomness. Two clients looking at the same car therefore
//! resolve the same model without ever being told which one to draw, and a
//! client that picks its own model at random is simply wrong.
//!
//! What this module does *not* do is decide anything mechanical. Footprint,
//! speed, direction, timing, collision and lethality all come from the lane
//! descriptor and `hazard.rs`. A police car is a compact car wearing a
//! different hat; the roster below can be re-cut without touching gameplay.

use super::chunkgen::{LaneDescriptor, LaneKind};

/// Bump when the roster or the derivation below changes. Clients pin this to
/// know their model table still agrees with the chain.
pub const ROSTER_VERSION: u16 = 2;

/// The mechanical archetype a rendered object belongs to. Derived from lane
/// kind and footprint — never from a filename or a client's choice.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum VehicleClass {
    /// One-tile road traffic.
    Compact = 0,
    /// Two-tile road traffic.
    Pickup = 1,
    /// Three-tile-plus road traffic.
    Bus = 2,
    /// River platform.
    Log = 3,
    /// Rail train.
    Train = 4,
}

impl VehicleClass {
    /// How many interchangeable skins this class has. Variants share
    /// geometry, footprint and behaviour; only the look differs.
    pub const fn variant_count(self) -> u8 {
        match self {
            // compact.a / compact.b / compact.c / police.a — one coherent
            // vehicle set, and the class carrying most of the traffic.
            VehicleClass::Compact => 4,
            VehicleClass::Pickup => 1,
            VehicleClass::Bus => 1,
            // Logs and trains are built procedurally by the renderer, so
            // they have nothing to choose between.
            VehicleClass::Log => 1,
            VehicleClass::Train => 1,
        }
    }

    pub const fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Compact),
            1 => Some(Self::Pickup),
            2 => Some(Self::Bus),
            3 => Some(Self::Log),
            4 => Some(Self::Train),
            _ => None,
        }
    }
}

/// The class of object this lane carries.
pub fn lane_vehicle_class(lane: &LaneDescriptor) -> Option<VehicleClass> {
    match LaneKind::from_u8(lane.kind)? {
        LaneKind::Grass => None,
        LaneKind::River => Some(VehicleClass::Log),
        LaneKind::Rail => Some(VehicleClass::Train),
        LaneKind::Road => Some(match lane.footprint {
            0 | 1 => VehicleClass::Compact,
            2 => VehicleClass::Pickup,
            _ => VehicleClass::Bus,
        }),
    }
}

/// Which skin a specific object wears.
///
/// `index` is the object's stable conveyor index from
/// `hazard::object_index`, and `randomness` is the chunk's committed
/// `randomness_hash`, so the answer is fixed the moment the chunk is
/// revealed and identical for everyone who asks.
pub fn vehicle_variant(randomness: &[u8; 32], row: u16, index: i64, class: VehicleClass) -> u8 {
    let count = class.variant_count() as u64;
    if count <= 1 {
        return 0;
    }
    // SplitMix64 over the chunk entropy mixed with (row, object index).
    let mut state: u64 = 0x9e37_79b9_7f4a_7c15;
    for chunk in randomness.chunks(8) {
        let mut b = [0u8; 8];
        b[..chunk.len()].copy_from_slice(chunk);
        state ^= u64::from_le_bytes(b);
        state = state.rotate_left(17);
    }
    state ^= (row as u64).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    state ^= (index as u64).wrapping_mul(0x94d0_49bb_1331_11eb);
    state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^= z >> 31;
    (z % count) as u8
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::hazard;

    fn road(footprint: u8) -> LaneDescriptor {
        LaneDescriptor {
            kind: LaneKind::Road as u8,
            dir_positive: 1,
            footprint,
            gap_tiles: 8,
            speed_mtps: 1_000,
            phase_mt: 0,
            ..Default::default()
        }
    }

    #[test]
    fn class_comes_from_footprint_not_appearance() {
        assert_eq!(lane_vehicle_class(&road(1)), Some(VehicleClass::Compact));
        assert_eq!(lane_vehicle_class(&road(2)), Some(VehicleClass::Pickup));
        assert_eq!(lane_vehicle_class(&road(3)), Some(VehicleClass::Bus));
        let grass = LaneDescriptor {
            kind: LaneKind::Grass as u8,
            ..Default::default()
        };
        assert_eq!(lane_vehicle_class(&grass), None);
    }

    #[test]
    fn a_car_keeps_its_identity_as_it_crosses_the_world() {
        // One tile per second: follow a single car across the lane and check
        // both its conveyor index and its skin stay put.
        let lane = road(1);
        let seed = [3u8; 32];
        let start = hazard::object_index(&lane, 0, 0).expect("a car sits on tile 0 at t=0");
        let skin = vehicle_variant(&seed, 7, start, VehicleClass::Compact);
        for step in 1..8u64 {
            let t = step * 1_000;
            let x = step as u8; // the car advances one tile per second
            assert_eq!(
                hazard::object_index(&lane, x, t),
                Some(start),
                "same car at t={t}"
            );
            assert_eq!(
                vehicle_variant(&seed, 7, start, VehicleClass::Compact),
                skin,
                "skin must not flicker"
            );
        }
    }

    #[test]
    fn neighbouring_cars_have_distinct_indices() {
        let lane = road(1);
        let a = hazard::object_index(&lane, 0, 0).unwrap();
        let b = hazard::object_index(&lane, 8, 0).unwrap(); // one gap along
        assert_ne!(a, b);
        assert_eq!(b - a, 1, "adjacent conveyor slots differ by one");
    }

    #[test]
    fn variants_are_in_range_and_deterministic() {
        let seed = [11u8; 32];
        for class in [
            VehicleClass::Compact,
            VehicleClass::Pickup,
            VehicleClass::Bus,
            VehicleClass::Log,
            VehicleClass::Train,
        ] {
            for index in -50..50i64 {
                let v = vehicle_variant(&seed, 3, index, class);
                assert!(
                    v < class.variant_count(),
                    "{class:?} variant {v} out of range"
                );
                assert_eq!(v, vehicle_variant(&seed, 3, index, class), "deterministic");
            }
        }
    }

    /// Printed with `cargo test -p crossy-world --lib -- --nocapture
    /// golden_vectors_for_the_sdk`, and asserted in the SDK's
    /// `tests/vectors.test.ts`. Any drift is a release blocker.
    #[test]
    fn golden_vectors_for_the_sdk() {
        let seed = [7u8; 32];
        let lane = LaneDescriptor {
            kind: LaneKind::Road as u8,
            dir_positive: 1,
            footprint: 2,
            gap_tiles: 7,
            speed_mtps: 1_500,
            phase_mt: 400,
            ..Default::default()
        };
        for t in [0u64, 1_000, 2_000, 5_000, 60_000] {
            let covered: Vec<u8> = (0..20u8)
                .filter(|x| hazard::lane_object_covers(&lane, *x, t))
                .collect();
            let indices: Vec<i64> = (0..20u8)
                .filter_map(|x| hazard::object_index(&lane, x, t))
                .collect();
            println!("t={t} covered={covered:?} indices={indices:?}");
        }
        let variants: Vec<u8> = (-4..8i64)
            .map(|i| vehicle_variant(&seed, 9, i, VehicleClass::Compact))
            .collect();
        println!("variants={variants:?}");
    }

    #[test]
    fn different_chunks_dress_their_traffic_differently() {
        // The same conveyor slot in two chunks should not be forced to the
        // same skin — otherwise every road in the world looks identical.
        let a = [1u8; 32];
        let b = [2u8; 32];
        let differing = (0..40i64)
            .filter(|i| {
                vehicle_variant(&a, 5, *i, VehicleClass::Compact)
                    != vehicle_variant(&b, 5, *i, VehicleClass::Compact)
            })
            .count();
        assert!(differing > 10, "only {differing}/40 slots differed");
    }
}
