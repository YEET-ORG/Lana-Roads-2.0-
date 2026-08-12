//! Pity counter transitions, exactly per contract spec §14.
//!
//! - Epic miss count 9 => next assigned result is at least Epic.
//! - Legendary miss count 99 => next assigned result is Legendary.
//! - Epic resets the Epic counter; Legendary resets both.
//! - Failed/refunded pulls never touch pity.
//! - Pity carries across seasons per banner tier.

use super::sampling::Rarity;
use crate::constants::{EPIC_PITY_THRESHOLD, LEGENDARY_PITY_THRESHOLD};

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct PityCounters {
    /// Consecutive assigned pulls without Epic-or-better.
    pub epic_misses: u16,
    /// Consecutive assigned pulls without Legendary.
    pub legendary_misses: u16,
}

/// Pity override applied BEFORE ordinary weighted selection. Returns the
/// minimum rarity this assignment must produce, if any. Legendary pity is
/// evaluated first (it satisfies both guarantees).
pub fn pity_override(c: PityCounters) -> Option<Rarity> {
    if c.legendary_misses >= LEGENDARY_PITY_THRESHOLD - 1 {
        Some(Rarity::Legendary)
    } else if c.epic_misses >= EPIC_PITY_THRESHOLD - 1 {
        Some(Rarity::Epic)
    } else {
        None
    }
}

/// Counter update for an *assigned* result. Atomic with inventory
/// reservation in the program.
pub fn apply_assignment(c: PityCounters, assigned: Rarity) -> PityCounters {
    match assigned {
        Rarity::Common | Rarity::Rare => PityCounters {
            epic_misses: c.epic_misses.saturating_add(1),
            legendary_misses: c.legendary_misses.saturating_add(1),
        },
        Rarity::Epic => PityCounters {
            epic_misses: 0,
            legendary_misses: c.legendary_misses.saturating_add(1),
        },
        Rarity::Legendary => PityCounters {
            epic_misses: 0,
            legendary_misses: 0,
        },
    }
}

/// Raise a selected rarity to the pity floor when an override is active.
pub fn enforce_floor(selected: Rarity, floor: Option<Rarity>) -> Rarity {
    match floor {
        Some(f) if (selected as u8) < (f as u8) => f,
        _ => selected,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epic_pity_forces_on_tenth() {
        let mut c = PityCounters::default();
        for i in 0..9 {
            assert_eq!(pity_override(c), None, "pull {} must not force", i + 1);
            c = apply_assignment(c, Rarity::Common);
        }
        // 9 misses recorded; the 10th pull is forced to at least Epic.
        assert_eq!(pity_override(c), Some(Rarity::Epic));
        c = apply_assignment(c, Rarity::Epic);
        assert_eq!(c.epic_misses, 0);
        assert_eq!(c.legendary_misses, 10);
    }

    #[test]
    fn legendary_pity_forces_on_hundredth() {
        let mut c = PityCounters::default();
        for _ in 0..99 {
            let floor = pity_override(c);
            assert_ne!(floor, Some(Rarity::Legendary));
            // Simulate epic pity resolutions along the way.
            let assigned = enforce_floor(Rarity::Common, floor);
            c = apply_assignment(c, assigned);
        }
        assert_eq!(c.legendary_misses, 99);
        assert_eq!(pity_override(c), Some(Rarity::Legendary));
        c = apply_assignment(c, Rarity::Legendary);
        assert_eq!(c, PityCounters::default());
    }

    #[test]
    fn legendary_resets_both_counters() {
        let c = PityCounters {
            epic_misses: 5,
            legendary_misses: 50,
        };
        assert_eq!(
            apply_assignment(c, Rarity::Legendary),
            PityCounters::default()
        );
    }

    #[test]
    fn epic_resets_only_epic() {
        let c = PityCounters {
            epic_misses: 5,
            legendary_misses: 50,
        };
        let after = apply_assignment(c, Rarity::Epic);
        assert_eq!(after.epic_misses, 0);
        assert_eq!(after.legendary_misses, 51);
    }

    #[test]
    fn floor_enforcement() {
        assert_eq!(
            enforce_floor(Rarity::Common, Some(Rarity::Epic)),
            Rarity::Epic
        );
        assert_eq!(
            enforce_floor(Rarity::Legendary, Some(Rarity::Epic)),
            Rarity::Legendary
        );
        assert_eq!(enforce_floor(Rarity::Rare, None), Rarity::Rare);
    }
}
