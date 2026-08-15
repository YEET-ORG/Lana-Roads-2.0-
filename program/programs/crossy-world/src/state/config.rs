//! Global configuration singleton. PDA: ["config"].

use anchor_lang::prelude::*;

use crate::constants::MAX_REGIONS;

/// Independent pause scopes (bitmask in `GlobalConfig.pause_flags`).
/// A pause blocks new mutations in scope but never valid refunds, terminal
/// NFT unlock, retry of already-fixed payouts, or reads.
pub mod pause {
    pub const PROTOCOL: u16 = 1 << 0;
    pub const PAID_ADMISSION: u16 = 1 << 1;
    pub const PAID_GAMEPLAY: u16 = 1 << 2;
    pub const CASUAL: u16 = 1 << 3;
    pub const GACHA: u16 = 1 << 4;
    pub const MARKETPLACE: u16 = 1 << 5;
}

#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    /// V1 single admin (two-step rotation to allow future multisig handoff).
    pub admin: Pubkey,
    /// Pending admin of an in-flight rotation (None when idle).
    pub pending_admin: Option<Pubkey>,
    /// Canonical USDC mint. Every USDC account is checked against it.
    pub usdc_mint: Pubkey,
    /// Supported SPL token program for the canonical mint.
    pub token_program: Pubkey,
    /// Team treasury USDC token account (settlement + royalties + gacha).
    pub team_treasury: Pubkey,
    /// Verified Metaplex Core collection for agent assets.
    pub collection: Pubkey,
    /// Update authority configured for the collection.
    pub collection_authority: Pubkey,
    /// MagicBlock validator per region; `Pubkey::default()` = region closed.
    ///
    /// Indexed by the region id in the world PDA, so a world can only ever be
    /// delegated to the validator its own region names. A single field would
    /// have let any world land on any rollup, which is how a European world
    /// ends up hosted in Singapore and the whole point is lost.
    pub validators: [Pubkey; MAX_REGIONS],
    /// Pause bitmask (see `pause`).
    pub pause_flags: u16,
    /// Winner basis points: 9000.
    pub winner_bps: u16,
    /// Team basis points: 1000.
    pub team_bps: u16,
    /// Maximum concurrent paid players (<= HARD_MAX_PLAYERS).
    pub max_paid_players: u16,
    /// Maximum concurrent casual players (<= HARD_MAX_PLAYERS).
    pub max_casual_players: u16,
    /// Configuration version for upgrade compatibility.
    pub version: u16,
    pub bump: u8,
}

impl GlobalConfig {
    pub fn is_paused(&self, scope: u16) -> bool {
        self.pause_flags & (pause::PROTOCOL | scope) != 0
    }

    /// The validator hosting `region`, or None if the region is not open.
    pub fn validator_for(&self, region: u8) -> Option<Pubkey> {
        let slot = *self.validators.get(region as usize)?;
        if slot == Pubkey::default() {
            None
        } else {
            Some(slot)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_region_with_no_validator_is_closed() {
        let mut config = GlobalConfig {
            admin: Pubkey::default(),
            pending_admin: None,
            usdc_mint: Pubkey::default(),
            token_program: Pubkey::default(),
            team_treasury: Pubkey::default(),
            collection: Pubkey::default(),
            collection_authority: Pubkey::default(),
            validators: [Pubkey::default(); MAX_REGIONS],
            pause_flags: 0,
            winner_bps: 9_000,
            team_bps: 1_000,
            max_paid_players: 500,
            max_casual_players: 500,
            version: 3,
            bump: 255,
        };
        // Every region starts closed: an unset slot must never resolve to a
        // validator, or a world would delegate to the default pubkey and be
        // stranded somewhere nothing runs.
        for region in 0..MAX_REGIONS as u8 {
            assert!(config.validator_for(region).is_none());
        }
        let eu = Pubkey::new_unique();
        config.validators[1] = eu;
        assert_eq!(config.validator_for(1), Some(eu));
        assert!(config.validator_for(0).is_none());
        // Out of range is closed, not a panic: region ids arrive from clients.
        assert!(config.validator_for(MAX_REGIONS as u8).is_none());
        assert!(config.validator_for(u8::MAX).is_none());
    }
}
