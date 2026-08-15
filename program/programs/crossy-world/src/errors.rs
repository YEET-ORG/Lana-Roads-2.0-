//! Error taxonomy, grouped per the contract specification §18 so the SDK can
//! map ranges to user-safe categories.

use anchor_lang::prelude::*;

#[error_code]
pub enum CrossyError {
    // ---- Authorization ----
    #[msg("signer is not the configured admin")]
    NotAdmin,
    #[msg("signer is not the proposed admin")]
    NotProposedAdmin,
    #[msg("signer is not the owning wallet")]
    NotWallet,
    #[msg("signer is not the registered session authority")]
    BadSession,
    #[msg("session is expired")]
    SessionExpired,
    #[msg("session scope does not permit this action")]
    SessionScope,
    #[msg("callback identity is not the authenticated VRF authority")]
    BadVrfAuthority,

    // ---- Time ----
    #[msg("day has not started")]
    DayNotStarted,
    #[msg("hard UTC cutoff has passed")]
    CutoffPassed,
    #[msg("revival deadline has expired")]
    RevivalExpired,
    #[msg("objective timeout has not been reached")]
    TimeoutNotReached,
    #[msg("activation day has not been reached")]
    ActivationNotReached,

    // ---- Asset ----
    #[msg("wrong USDC mint")]
    WrongMint,
    #[msg("wrong token program")]
    WrongTokenProgram,
    #[msg("wrong token account owner")]
    WrongTokenOwner,
    #[msg("asset is not in the configured collection")]
    WrongCollection,
    #[msg("asset owner mismatch")]
    WrongAssetOwner,
    #[msg("class or variant mapping is invalid or inactive")]
    BadClassMapping,
    #[msg("asset metadata URI does not match the configured variant")]
    MetadataMismatch,
    #[msg("agent is locked for an active attempt")]
    AgentLocked,
    #[msg("agent is listed on the marketplace")]
    AgentListed,
    #[msg("starter entitlement already claimed")]
    StarterAlreadyClaimed,
    #[msg("starter entitlement not claimed")]
    StarterNotClaimed,

    // ---- Payment ----
    #[msg("payment amount does not match program-derived amount")]
    WrongAmount,
    #[msg("receipt is not in the required state")]
    BadReceiptState,
    #[msg("receipt does not match this run/attempt/death nonce")]
    ReceiptMismatch,
    #[msg("wrong vault account")]
    WrongVault,
    #[msg("wrong treasury account")]
    WrongTreasury,

    // ---- Accounting ----
    #[msg("checked arithmetic overflow")]
    Overflow,
    #[msg("vault liability invariant violated")]
    LiabilityMismatch,
    #[msg("basis points must sum to 10000")]
    BadBasisPoints,

    // ---- Inventory ----
    #[msg("variant is sold out")]
    SoldOut,
    #[msg("inventory revision is stale")]
    StaleInventory,
    #[msg("required pity inventory unavailable; banner paused")]
    PityInventoryUnavailable,
    #[msg("supply cap exceeded")]
    SupplyExceeded,

    // ---- Lifecycle ----
    #[msg("invalid state transition")]
    InvalidTransition,
    #[msg("already consumed, refunded, claimed, or settled")]
    AlreadyTerminal,
    #[msg("day is not prepared/open for this operation")]
    DayNotOpen,
    #[msg("day is voided")]
    DayVoided,
    #[msg("subsystem is paused")]
    Paused,
    #[msg("duplicate or out-of-order action sequence")]
    BadActionSequence,
    #[msg("attempt nonce mismatch")]
    BadAttemptNonce,
    #[msg("run is not in the required state")]
    BadRunState,
    #[msg("world is not open")]
    WorldNotOpen,
    #[msg("another attempt is still active for this wallet")]
    AttemptStillActive,

    // ---- Gameplay ----
    #[msg("destination tile is occupied")]
    TileOccupied,
    #[msg("destination is out of bounds")]
    OutOfBounds,
    #[msg("destination terrain is not traversable")]
    Blocked,
    #[msg("world is full")]
    WorldFull,
    #[msg("cooldown has not elapsed")]
    Cooldown,
    #[msg("no valid target")]
    NoTarget,
    #[msg("player is stunned or immobilized")]
    Immobilized,
    #[msg("movement cadence exceeded for this slot")]
    TooFast,
    #[msg("Display name is empty, too long, or contains characters that cannot be shown")]
    InvalidName,
    #[msg("hazard nonce is stale")]
    StaleHazardNonce,
    #[msg("tile is lethal at the authoritative time")]
    LethalTile,
    #[msg("effect slots are full")]
    EffectSlotsFull,
    #[msg("ability not available for this class/version")]
    BadAbility,
    #[msg("chunk frontier is closed; wait for reveal")]
    FrontierClosed,
    #[msg("chunk request margin not reached")]
    FrontierNotReached,
    #[msg("wrong sector account for these coordinates")]
    WrongSector,

    // ---- Integration ----
    #[msg("VRF request generation mismatch")]
    BadGeneration,
    #[msg("chunk is not in the required state")]
    BadChunkState,
    #[msg("delegated/committed state unavailable for reconciliation")]
    NotReconcilable,
    #[msg("account version is unsupported")]
    BadVersion,
    #[msg("bounded capacity exceeded")]
    CapacityExceeded,
}
