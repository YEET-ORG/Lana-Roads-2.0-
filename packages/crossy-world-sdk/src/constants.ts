/**
 * Program constants mirrored from `programs/crossy-world/src/constants.rs`.
 * Golden vectors in tests/ prove byte-for-byte agreement with the program.
 */
import { PublicKey } from "@solana/web3.js";

export const CROSSY_WORLD_PROGRAM_ID = new PublicKey(
  "GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX",
);

export const DAY_SECONDS = 86_400n;
export const USDC_DECIMALS = 6;
/** Fresh paid attempt: exactly 1 USDC (base units). */
export const ENTRY_PRICE = 1_000_000n;
/** First successful revival: 10 USDC; doubles per successful revival. */
export const REVIVE_BASE_PRICE = 10_000_000n;
export const REVIVE_WINDOW_SECONDS = 60;

export const WINNER_BPS = 9_000n;
export const TEAM_BPS = 1_000n;
export const BPS_DENOMINATOR = 10_000n;

export const WORLD_WIDTH = 64;
export const CHUNK_ROWS = 16;
export const SAFE_ZONE_ROWS = 16;
export const SECTOR_EDGE = 8;
export const SECTORS_PER_ROW = 8;
export const CHUNK_REQUEST_MARGIN = 8;

export const KICK_COOLDOWN_SECONDS = 5;
export const GACHA_TIMEOUT_SECONDS = 300;
export const EPIC_PITY_THRESHOLD = 10;
export const LEGENDARY_PITY_THRESHOLD = 100;
export const BANNER_PRICES = [5_000_000n, 10_000_000n, 20_000_000n] as const;

export const SEEDS = {
  config: Buffer.from("config"),
  season: Buffer.from("season"),
  banner: Buffer.from("banner"),
  variant: Buffer.from("variant"),
  class: Buffer.from("class"),
  player: Buffer.from("player"),
  identity: Buffer.from("identity"),
  pull: Buffer.from("pull"),
  daily: Buffer.from("daily"),
  dailyVault: Buffer.from("daily_vault"),
  contribution: Buffer.from("contribution"),
  payment: Buffer.from("payment"),
  agentLock: Buffer.from("agent_lock"),
  assetMap: Buffer.from("asset_map"),
  listing: Buffer.from("listing"),
  world: Buffer.from("world"),
  chunk: Buffer.from("chunk"),
  sector: Buffer.from("sector"),
  run: Buffer.from("run"),
  best: Buffer.from("best"),
  gachaVault: Buffer.from("gacha_vault"),
  gachaVaultAuthority: Buffer.from("gacha_vault_authority"),
  mintAuthority: Buffer.from("mint_authority"),
  freezeAuthority: Buffer.from("freeze_authority"),
} as const;

export enum WorldMode {
  Paid = 0,
  Casual = 1,
}

export enum ReceiptKind {
  Entry = 0,
  Revival = 1,
}

export enum Direction {
  Forward = 0,
  Backward = 1,
  Left = 2,
  Right = 3,
}

/** Session scope bits (`state::world::session_scope`). */
export const SESSION_SCOPE = {
  move: 1 << 0,
  kick: 1 << 1,
  ability: 1 << 2,
  heartbeat: 1 << 3,
  allGameplay: 0b1111,
} as const;

/** Mirrors `constants::MAX_SESSION_SECONDS`: how far ahead a session may run. */
export const MAX_SESSION_SECONDS = 12 * 60 * 60;

/** Outcome of claiming the gameplay session on a run. */
export interface SessionClaim {
  /** A rotation was sent: this client now holds the session. */
  rotated: boolean;
  /** Another window claimed it more recently; this client must stand down. */
  displaced: boolean;
  /** The run's rotation counter after this call. */
  rotation: number;
  /** Whether the session authority is this client's key. */
  mine: boolean;
}
