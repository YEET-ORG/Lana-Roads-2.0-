//! Durable player profile. High-frequency position/cooldown data never lives
//! here — that belongs to the delegated `PlayerRun`.

use anchor_lang::prelude::*;

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default, InitSpace,
)]
pub struct PityPair {
    pub epic_misses: u16,
    pub legendary_misses: u16,
}

/// PDA: ["player", wallet]
#[account]
#[derive(InitSpace)]
pub struct PlayerProfile {
    pub wallet: Pubkey,
    /// One-time non-transferable starter entitlement.
    pub starter_claimed: bool,
    /// Per-banner-tier pity counters [standard, enhanced, premium]; carry
    /// across seasons.
    pub pity: [PityPair; 3],
    /// Sequential nonce for gacha pull PDAs.
    pub pull_count: u32,
    /// The only unresolved pull for this wallet. Serializing pulls is what
    /// makes pity snapshots exact instead of allowing parallel requests to
    /// reuse the same counters.
    pub pending_pull: Pubkey,
    /// Sequential nonce for payment receipt PDAs.
    pub receipt_count: u32,
    /// Authoritative daily wins, all time.
    pub total_paid_wins: u32,
    /// Wins in `wins_season`.
    pub season_wins: u32,
    pub wins_season: u16,
    pub highest_paid_score: u32,
    pub highest_casual_score: u32,
    pub completed_attempts: u32,
    pub total_successful_revives: u32,
    pub version: u16,
    pub bump: u8,
}

/// A player's chosen display identity.
///
/// Separate from `PlayerProfile` on purpose: profiles already exist on
/// chain, and widening a live account would strand every one of them. This
/// is additive — a wallet without one is simply anonymous, drawn from its
/// address like before.
///
/// PDA: ["identity", wallet]
#[account]
#[derive(InitSpace)]
pub struct PlayerIdentity {
    pub wallet: Pubkey,
    /// Sanitised ASCII, `name_len` bytes significant. Never unique: the
    /// wallet identifies a player, this only labels them.
    pub name: [u8; crate::kernel::name::NAME_MAX],
    pub name_len: u8,
    /// Cosmetic agent the player picked, so everyone draws them the same.
    pub agent: u16,
    pub version: u16,
    pub bump: u8,
}
