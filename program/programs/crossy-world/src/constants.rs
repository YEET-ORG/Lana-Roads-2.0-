//! Global constants. Every numeric game rule that the specs fix lives here so
//! auditors find one authoritative definition.

/// PDA seed domains. Fixed-width values only — never unbounded strings.
pub mod seeds {
    pub const CONFIG: &[u8] = b"config";
    pub const SEASON: &[u8] = b"season";
    pub const BANNER: &[u8] = b"banner";
    pub const VARIANT: &[u8] = b"variant";
    pub const CLASS: &[u8] = b"class";
    pub const PLAYER: &[u8] = b"player";
    pub const PULL: &[u8] = b"pull";
    pub const DAILY: &[u8] = b"daily";
    pub const DAILY_VAULT: &[u8] = b"daily_vault";
    pub const CONTRIBUTION: &[u8] = b"contribution";
    pub const PAYMENT: &[u8] = b"payment";
    pub const AGENT_LOCK: &[u8] = b"agent_lock";
    pub const ASSET_MAP: &[u8] = b"asset_map";
    pub const LISTING: &[u8] = b"listing";
    pub const WORLD: &[u8] = b"world";
    pub const CHUNK: &[u8] = b"chunk";
    pub const SECTOR: &[u8] = b"sector";
    pub const RUN: &[u8] = b"run";
    pub const BEST: &[u8] = b"best";
    pub const GACHA_VAULT: &[u8] = b"gacha_vault";
}

/// Seconds in one UTC day; the day id is `floor(unix_ts / DAY_SECONDS)`.
pub const DAY_SECONDS: i64 = 86_400;

/// Milliseconds of world time per rollup slot.
///
/// Hazards advance on this grid rather than on whole seconds, which is what
/// makes traffic move a tile at a time instead of jumping several at once.
/// MagicBlock ephemeral rollups produce a block every ~50ms (measured 50.9ms
/// on devnet-as); the base layer's 400ms never applies, because every
/// instruction that reads this clock requires the delegated world and can
/// only execute on the rollup.
pub const MS_PER_SLOT: u64 = 50;

/// USDC uses 6 decimals; amounts below are integer base units.
pub const USDC_DECIMALS: u8 = 6;
/// Fresh paid attempt: exactly 1 USDC.
pub const ENTRY_PRICE: u64 = 1_000_000;
/// First successful revival: 10 USDC; price doubles per successful revival.
pub const REVIVE_BASE_PRICE: u64 = 10_000_000;
/// Death opens a 60-second revival window.
pub const REVIVE_WINDOW_SECONDS: i64 = 60;

/// Winner receives 90.00%, team treasury 10.00%.
pub const WINNER_BPS: u16 = 9_000;
pub const TEAM_BPS: u16 = 1_000;
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Marketplace: 90% seller / 10% team royalty, same basis points.
pub const MARKET_SELLER_BPS: u16 = 9_000;
pub const MARKET_TEAM_BPS: u16 = 1_000;

/// World geometry (fixed by the approved design).
pub const WORLD_WIDTH: u8 = 64;
/// Rows per generated chunk.
pub const CHUNK_ROWS: u8 = 16;
/// The first chunk is the hazard-free safe/spawn zone (16 rows x 64 cols).
pub const SAFE_ZONE_ROWS: u16 = 16;
/// Occupancy sector edge (8x8 tiles per sector account).
pub const SECTOR_EDGE: u8 = 8;
/// Sectors per row of the world (64 / 8).
pub const SECTORS_PER_ROW: u8 = 8;
/// Bounded temporary-effect slots per sector.
pub const MAX_SECTOR_EFFECTS: usize = 8;
/// Bounded lanes per chunk (16 rows -> at most 16 lane descriptors).
pub const MAX_CHUNK_LANES: usize = 16;

/// Maximum concurrent players per mode (paid / casual each).
pub const MAX_PLAYERS_PER_MODE: u16 = 500;
/// Compiled safety maximum for the configurable player cap.
pub const HARD_MAX_PLAYERS: u16 = 1_024;

/// Request the next chunk when the leader is within this many rows of the
/// revealed frontier.
pub const CHUNK_REQUEST_MARGIN: u16 = 8;
/// A chunk VRF request may be permissionlessly retried after this timeout.
pub const CHUNK_VRF_TIMEOUT_SECONDS: i64 = 90;

/// Universal Kick cooldown.
pub const KICK_COOLDOWN_SECONDS: i64 = 5;
/// Class ability cooldown bounds (versioned per class inside these bounds).
pub const MIN_ABILITY_COOLDOWN_SECONDS: u16 = 10;
pub const MAX_ABILITY_COOLDOWN_SECONDS: u16 = 30;

/// Session keys are short-lived gameplay authorities.
pub const MAX_SESSION_SECONDS: i64 = 12 * 60 * 60;

/// Gacha pending pull becomes refundable after five minutes with no
/// authenticated assignment.
pub const GACHA_TIMEOUT_SECONDS: i64 = 300;
/// Epic pity: the 10th consecutive miss is forced to at least Epic.
pub const EPIC_PITY_THRESHOLD: u16 = 10;
/// Legendary pity: the 100th consecutive miss is forced to Legendary.
pub const LEGENDARY_PITY_THRESHOLD: u16 = 100;
/// Banner tiers and their immutable prices (USDC base units).
pub const BANNER_PRICES: [u64; 3] = [5_000_000, 10_000_000, 20_000_000];

/// A season lasts 30 UTC days.
pub const SEASON_DAYS: u64 = 30;

/// Maximum variants a season may register (bounded account growth).
pub const MAX_SEASON_VARIANTS: u16 = 256;

/// Minimum train warning window in slots-equivalent milliseconds; the
/// generator may not produce a railway lane with a shorter warning.
pub const MIN_TRAIN_WARNING_MS: u32 = 1_500;

/// Bounded ability parameters.
pub const MAX_ABILITY_RANGE: u8 = 3;
pub const MAX_EFFECT_DURATION_SECONDS: u16 = 10;
pub const MAX_EFFECT_RADIUS: u8 = 2;
