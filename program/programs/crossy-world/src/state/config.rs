//! Global configuration singleton. PDA: ["config"].

use anchor_lang::prelude::*;

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
    /// MagicBlock validator that must host every delegated gameplay account.
    pub validator: Pubkey,
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
}
