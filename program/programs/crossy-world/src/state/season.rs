//! Seasons, banners, variant inventory, and versioned class configuration.

use crate::constants::MAX_RARITY_VARIANTS;
use crate::errors::CrossyError;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
#[repr(u8)]
pub enum SeasonStatus {
    Configured,
    Active,
    Closed,
    Paused,
}

/// PDA: ["season", season_index_le]
#[account]
#[derive(InitSpace)]
pub struct Season {
    pub season_index: u16,
    /// Inclusive start day.
    pub start_day: u64,
    /// Exclusive end day (start + 30).
    pub end_day: u64,
    /// Hash over the immutable banner base weights (auditable immutability).
    pub weights_hash: [u8; 32],
    /// Class-balance version snapshot for this season.
    pub class_balance_version: u16,
    /// Metadata base URI version.
    pub metadata_version: u16,
    pub status: SeasonStatus,
    /// Number of registered variants (bounded by MAX_SEASON_VARIANTS).
    pub variant_count: u16,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
#[repr(u8)]
pub enum BannerStatus {
    Active,
    Paused,
}

/// PDA: ["banner", season_le, tier]
#[account]
#[derive(InitSpace)]
pub struct Banner {
    pub season: u16,
    /// 0 = Standard (5), 1 = Enhanced (10), 2 = Premium (20).
    pub tier: u8,
    /// Price in USDC base units; immutable after season start.
    pub price: u64,
    /// Base weights [common, rare, epic, legendary], sum 100; immutable
    /// after season start.
    pub base_weights: [u16; 4],
    /// Bumped whenever any variant's availability changes (sold out, pause).
    pub inventory_revision: u32,
    pub status: BannerStatus,
    pub bump: u8,
}

/// PDA: ["variant", season_le, variant_id_le]
#[account]
#[derive(InitSpace)]
pub struct VariantInventory {
    pub season: u16,
    pub variant_id: u16,
    /// Gameplay class this variant maps to (program-owned truth).
    pub class_id: u16,
    /// Rarity 0..=3.
    pub rarity: u8,
    /// Voxel model identifier (asset manifest key).
    pub model_id: u16,
    /// Cosmetic variant identifier.
    pub cosmetic_id: u16,
    /// Hash of the metadata URI template for this variant.
    pub metadata_uri_hash: [u8; 32],
    /// Seasonal mint cap; immutable after season start.
    pub supply_cap: u32,
    /// Assigned-but-unminted reservations.
    pub reserved: u32,
    /// Successfully minted count. reserved + minted <= supply_cap.
    pub minted: u32,
    pub active: bool,
    pub bump: u8,
}

impl VariantInventory {
    pub fn available(&self) -> Result<u32> {
        let used = self
            .reserved
            .checked_add(self.minted)
            .ok_or(CrossyError::Overflow)?;
        require!(used <= self.supply_cap, CrossyError::SupplyExceeded);
        self.supply_cap
            .checked_sub(used)
            .ok_or_else(|| error!(CrossyError::SupplyExceeded))
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default, InitSpace,
)]
pub struct RarityPoolEntry {
    pub variant_id: u16,
    /// Units not yet assigned. Reservations are removed here atomically with
    /// the corresponding `VariantInventory.reserved` increment.
    pub available: u32,
}

/// PDA: ["rarity_pool", season_le, rarity]. A compact canonical catalog
/// lets a gacha assignment select from one bounded account after VRF
/// fulfillment; callback transactions never need hundreds of variant keys.
#[account]
#[derive(InitSpace)]
pub struct RarityPool {
    pub season: u16,
    pub rarity: u8,
    pub count: u16,
    /// Monotonic reservation counter for auditing and indexer cache busting.
    pub revision: u32,
    pub initialized: bool,
    pub entries: [RarityPoolEntry; MAX_RARITY_VARIANTS],
    pub bump: u8,
}

impl RarityPool {
    pub fn has_available(&self) -> bool {
        self.entries[..self.count as usize]
            .iter()
            .any(|entry| entry.available > 0)
    }

    pub fn available_count(&self) -> Result<u32> {
        self.entries[..self.count as usize]
            .iter()
            .filter(|entry| entry.available > 0)
            .try_fold(0u32, |count, _| {
                count.checked_add(1).ok_or(CrossyError::Overflow)
            })
            .map_err(Into::into)
    }

    pub fn nth_available(&self, selected: u32) -> Result<(usize, RarityPoolEntry)> {
        let mut cursor = 0u32;
        for (index, entry) in self.entries[..self.count as usize].iter().enumerate() {
            if entry.available == 0 {
                continue;
            }
            if cursor == selected {
                return Ok((index, *entry));
            }
            cursor = cursor.checked_add(1).ok_or(CrossyError::Overflow)?;
        }
        err!(CrossyError::SoldOut)
    }

    /// Select from the immutable configured catalog. Sold-out entries are
    /// deliberately not rerolled: callers refund that pull, which prevents
    /// concurrent assignments from changing another player's random result.
    pub fn entry(&self, selected: u32) -> Result<(usize, RarityPoolEntry)> {
        require!(selected < self.count as u32, CrossyError::SoldOut);
        let index = selected as usize;
        Ok((index, self.entries[index]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn immutable_catalog_selection_never_rerolls_a_sold_out_entry() {
        let mut pool = RarityPool {
            season: 1,
            rarity: 3,
            count: 2,
            revision: 1,
            initialized: true,
            entries: [RarityPoolEntry::default(); MAX_RARITY_VARIANTS],
            bump: 0,
        };
        pool.entries[0] = RarityPoolEntry {
            variant_id: 10,
            available: 0,
        };
        pool.entries[1] = RarityPoolEntry {
            variant_id: 11,
            available: 5,
        };

        assert_eq!(pool.entry(0).unwrap().1.variant_id, 10);
        assert_eq!(pool.entry(0).unwrap().1.available, 0);
        assert_eq!(pool.entry(1).unwrap().1.variant_id, 11);
        assert!(pool.entry(2).is_err());
    }
}

/// Closed set of ability kinds. Adding one requires a program upgrade —
/// never client-supplied scripts or arbitrary effect payloads.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
#[repr(u8)]
pub enum AbilityKind {
    /// Starter: Kick only, no class ability.
    None,
    /// Two-tile forward dash through valid tiles (all-or-nothing).
    Dash,
    /// Absorb one environmental collision before expiry.
    Shield,
    /// Ignore forced movement while active.
    Anchor,
    /// Bounded stronger directional push.
    Ram,
    /// Pull a valid nearby target one tile toward the caster.
    Hook,
    /// Leap over one blocker, landing exactly two tiles away.
    Leap,
    /// Temporary local slowing tile.
    Trap,
    /// Pass through one static blocker onto a free tile.
    Phase,
    /// Swap positions with a valid nearby player.
    Swap,
    /// Briefly alter one nearby traffic lane (bounded, min safety).
    LaneShift,
    /// Slow players and hazards in a local zone.
    TimeSlow,
    /// Short bounded area stun (no damage).
    AreaStun,
}

/// PDA: ["class", class_id_le, version_le]
#[account]
#[derive(InitSpace)]
pub struct ClassConfig {
    pub class_id: u16,
    pub version: u16,
    pub ability: AbilityKind,
    /// Fixed cooldown 10..=30 seconds.
    pub cooldown_seconds: u16,
    /// Targeting range in tiles (bounded by MAX_ABILITY_RANGE).
    pub range: u8,
    /// Effect duration seconds (bounded by MAX_EFFECT_DURATION_SECONDS).
    pub duration_seconds: u16,
    /// Displacement magnitude in tiles for push/pull/dash kinds.
    pub displacement: u8,
    /// Bounded kind-specific parameters (e.g. slow permille, stun ms).
    pub param_a: u16,
    pub param_b: u16,
    /// Minimum rarity allowed to reference this class (pay-to-win is
    /// intentional and disclosed).
    pub min_rarity: u8,
    /// UTC day at which this version activates (future day boundary only).
    pub activation_day: u64,
    pub bump: u8,
}
