//! Reconstructable events for every economic transition (AGENTS.md). Events
//! carry stable object identities + nonces, never secrets. The indexer must be
//! able to rebuild all leaderboards/history from these plus accounts.

use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub treasury: Pubkey,
    pub collection: Pubkey,
}

#[event]
pub struct AdminRotationProposed {
    pub current: Pubkey,
    pub proposed: Pubkey,
}

#[event]
pub struct AdminRotated {
    pub previous: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct PauseChanged {
    pub scope: u8,
    pub paused: bool,
}

#[event]
pub struct SeasonConfigured {
    pub season: u16,
    pub start_day: u64,
    pub end_day: u64,
}

#[event]
pub struct BannerConfigured {
    pub season: u16,
    pub tier: u8,
    pub price: u64,
}

#[event]
pub struct VariantConfigured {
    pub season: u16,
    pub variant_id: u16,
    pub class_id: u16,
    pub rarity: u8,
    pub supply_cap: u32,
}

#[event]
pub struct ClassConfigured {
    pub class_id: u16,
    pub version: u16,
    pub activation_day: u64,
}

#[event]
pub struct DayPrepared {
    pub day: u64,
    pub rollover_in: u64,
}

#[event]
pub struct DayOpened {
    pub day: u64,
}

#[event]
pub struct DayClosed {
    pub day: u64,
}

#[event]
pub struct DayCommitted {
    pub day: u64,
    pub record_score: u16,
    pub record_holder: Pubkey,
}

#[event]
pub struct DayVoided {
    pub day: u64,
    pub refund_liability: u64,
}

#[event]
pub struct DaySettled {
    pub day: u64,
    pub winner: Pubkey,
    pub winner_amount: u64,
    pub team_amount: u64,
}

#[event]
pub struct RolloverCreated {
    pub from_day: u64,
    pub amount: u64,
}

#[event]
pub struct RolloverConsumed {
    pub into_day: u64,
    pub amount: u64,
}

#[event]
pub struct PaymentPending {
    pub receipt: Pubkey,
    pub day: u64,
    pub wallet: Pubkey,
    pub kind: u8,
    pub amount: u64,
    pub attempt_nonce: u32,
    pub death_nonce: u32,
}

#[event]
pub struct PaymentConsumed {
    pub receipt: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PaymentRefundable {
    pub receipt: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PaymentRefunded {
    pub receipt: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
}

#[event]
pub struct VoidRefundClaimed {
    pub day: u64,
    pub wallet: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AttemptActivated {
    pub world: Pubkey,
    pub wallet: Pubkey,
    pub attempt_nonce: u32,
    pub class_id: u16,
    pub asset: Pubkey,
    pub x: u8,
    pub y: u16,
}

#[event]
pub struct AttemptEnded {
    pub world: Pubkey,
    pub wallet: Pubkey,
    pub attempt_nonce: u32,
    pub final_score: u16,
    pub reason: u8,
}

#[event]
pub struct PlayerDied {
    pub world: Pubkey,
    pub wallet: Pubkey,
    pub attempt_nonce: u32,
    pub death_nonce: u32,
    pub cause: u8,
    pub x: u8,
    pub y: u16,
    pub revive_deadline: i64,
}

#[event]
pub struct PlayerRevived {
    pub world: Pubkey,
    pub wallet: Pubkey,
    pub attempt_nonce: u32,
    pub death_nonce: u32,
    pub revive_count: u16,
    pub x: u8,
    pub y: u16,
}

#[event]
pub struct RecordChanged {
    pub world: Pubkey,
    pub wallet: Pubkey,
    pub attempt_nonce: u32,
    pub score: u16,
    pub slot: u64,
}

#[event]
pub struct ChunkRequested {
    pub day: u64,
    pub chunk_index: u16,
    pub generation: u16,
}

#[event]
pub struct ChunkRevealed {
    pub day: u64,
    pub chunk_index: u16,
    pub generation: u16,
    pub randomness_hash: [u8; 32],
}

#[event]
pub struct StarterClaimed {
    pub wallet: Pubkey,
}

#[event]
pub struct AgentLockedEvent {
    pub wallet: Pubkey,
    pub asset: Pubkey,
    pub world: Pubkey,
    pub attempt_nonce: u32,
}

#[event]
pub struct AgentUnlocked {
    pub wallet: Pubkey,
    pub asset: Pubkey,
    pub world: Pubkey,
    pub attempt_nonce: u32,
}

#[event]
pub struct PullRequested {
    pub pull: Pubkey,
    pub wallet: Pubkey,
    pub season: u16,
    pub tier: u8,
    pub pull_nonce: u32,
    pub price: u64,
    pub inventory_revision: u32,
}

#[event]
pub struct PullAssigned {
    pub pull: Pubkey,
    pub wallet: Pubkey,
    pub rarity: u8,
    pub variant_id: u16,
    pub epic_pity_after: u16,
    pub legendary_pity_after: u16,
}

#[event]
pub struct PullClaimed {
    pub pull: Pubkey,
    pub wallet: Pubkey,
    pub asset: Pubkey,
    pub variant_id: u16,
}

#[event]
pub struct PullRefunded {
    pub pull: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AgentListedEvent {
    pub listing: Pubkey,
    pub seller: Pubkey,
    pub asset: Pubkey,
    pub price: u64,
}

#[event]
pub struct AgentDelisted {
    pub listing: Pubkey,
    pub asset: Pubkey,
}

#[event]
pub struct AgentSold {
    pub listing: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub asset: Pubkey,
    pub price: u64,
    pub seller_amount: u64,
    pub team_amount: u64,
}

#[event]
pub struct PayoutLegCompleted {
    pub day: u64,
    pub leg: u8,
    pub amount: u64,
    pub destination: Pubkey,
}
