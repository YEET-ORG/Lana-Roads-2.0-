//! Agent lock (attempt freeze) and marketplace listing state.

use anchor_lang::prelude::*;

/// PDA: ["agent_lock", world, wallet, attempt_nonce_le]
///
/// Binds asset, owner, world, and attempt. `asset == Pubkey::default()` is
/// the starter marker (nothing to freeze/thaw).
#[account]
#[derive(InitSpace)]
pub struct AgentLock {
    pub owner: Pubkey,
    pub asset: Pubkey,
    pub world: Pubkey,
    pub attempt_nonce: u32,
    /// Program-derived gameplay class (from the asset's `AssetMap`, or 0 for
    /// the starter). Spawn reads this — never a client-supplied class.
    pub class_id: u16,
    /// True while the Core asset is frozen for this attempt.
    pub frozen: bool,
    /// Terminal unlock completed (idempotent thaw).
    pub unlocked: bool,
    pub bump: u8,
}

/// PDA: ["asset_map", asset]
/// Immutable binding written at claim-mint time: the program-owned truth of
/// which variant/class an asset embodies. Off-chain metadata is display-only.
#[account]
#[derive(InitSpace)]
pub struct AssetMap {
    pub asset: Pubkey,
    pub season: u16,
    pub variant_id: u16,
    pub class_id: u16,
    pub rarity: u8,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
#[repr(u8)]
pub enum ListingStatus {
    Active,
    Sold,
    Delisted,
}

/// PDA: ["listing", asset]
#[account]
#[derive(InitSpace)]
pub struct MarketplaceListing {
    pub seller: Pubkey,
    pub asset: Pubkey,
    /// Nonzero USDC base units.
    pub price: u64,
    pub created_ts: i64,
    /// 0 = no expiry.
    pub expiry_ts: i64,
    pub status: ListingStatus,
    pub sale_nonce: u32,
    pub bump: u8,
}
