/**
 * Deterministic helpers mirrored from the program kernel. Checked bigint
 * arithmetic; shared golden vectors prove agreement with Rust.
 */
import {
  BPS_DENOMINATOR,
  DAY_SECONDS,
  REVIVE_BASE_PRICE,
  TEAM_BPS,
} from "./constants.js";

/** Day id for a nonnegative unix timestamp; null for pre-epoch inputs. */
export function utcDayFromUnix(unixTs: bigint | number): bigint | null {
  const ts = BigInt(unixTs);
  if (ts < 0n) return null;
  return ts / DAY_SECONDS;
}

/** Inclusive first second of a UTC day. */
export function dayStart(day: bigint | number): bigint {
  return BigInt(day) * DAY_SECONDS;
}

/** Exclusive end of a UTC day: the hard cutoff. */
export function dayEnd(day: bigint | number): bigint {
  return (BigInt(day) + 1n) * DAY_SECONDS;
}

export function cutoffPassed(day: bigint | number, now: bigint | number): boolean {
  return BigInt(now) >= dayEnd(day);
}

const U64_MAX = (1n << 64n) - 1n;

/**
 * Price of the next revival given successful revivals so far:
 * 10 * 2^n USDC. Null when unrepresentable in u64 (the program rejects it).
 */
export function revivePrice(successfulRevives: number): bigint | null {
  if (successfulRevives >= 64) return null;
  const price = REVIVE_BASE_PRICE << BigInt(successfulRevives);
  return price > U64_MAX ? null : price;
}

/**
 * 90/10 settlement split; every indivisible base unit goes to the winner.
 * Returns [winner, team].
 */
export function settlementSplit(activePool: bigint): [bigint, bigint] {
  const team = (activePool * TEAM_BPS) / BPS_DENOMINATOR;
  return [activePool - team, team];
}

/** Marketplace 90/10 split. Returns [seller, team]. */
export function marketSplit(price: bigint): [bigint, bigint] {
  const team = (price * TEAM_BPS) / BPS_DENOMINATOR;
  return [price - team, team];
}
