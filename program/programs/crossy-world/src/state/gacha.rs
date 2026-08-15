//! Gacha pull state machine:
//! `Pending -> Assigned -> Claimed` XOR `Pending -> Refundable -> Refunded`.

use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
#[repr(u8)]
pub enum PullState {
    Pending,
    RandomnessReady,
    Assigned,
    Claimed,
    Refundable,
    Refunded,
}

/// PDA: ["pull", player, pull_nonce_le]
#[account]
#[derive(InitSpace)]
pub struct GachaPull {
    pub player: Pubkey,
    pub season: u16,
    pub tier: u8,
    pub pull_nonce: u32,
    /// Exact USDC price paid (held in the gacha vault until terminal).
    pub price: u64,
    /// Snapshot of effective weights shown before payment.
    pub effective_weights: [u16; 4],
    /// Snapshot of pity counters at request time.
    pub epic_misses_snapshot: u16,
    pub legendary_misses_snapshot: u16,
    pub requested_at: i64,
    /// VRF request generation; a refund invalidates the generation and a
    /// late callback from an older generation must fail.
    pub request_generation: u16,
    /// Set only by an authenticated MagicBlock VRF callback.
    pub randomness: [u8; 32],
    pub state: PullState,
    pub assigned_rarity: u8,
    pub assigned_variant: u16,
    /// True while one supply unit is reserved and unminted.
    pub inventory_reserved: bool,
    /// Minted Core asset (set on claim).
    pub minted_asset: Pubkey,
    pub bump: u8,
}
