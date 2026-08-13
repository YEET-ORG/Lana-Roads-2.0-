/**
 * Hazard geometry and canonical vehicle identity.
 *
 * This is a transcription of `kernel/hazard.rs` and `kernel/vehicle.rs`, kept
 * honest by the golden vectors in `tests/vectors.test.ts`. The program stays
 * the authority on collision; this exists so a client can predict the same
 * answer instead of guessing, and so every client draws the same car in the
 * same place.
 */

export const LANE_GRASS = 0;
export const LANE_ROAD = 1;
export const LANE_RIVER = 2;
export const LANE_RAIL = 3;

import { WORLD_WIDTH } from "./constants.js";

/** Mirrors `kernel::hazard::MAX_CARRY_TILES`. */
export const MAX_CARRY_TILES = 8;

/** Bump in step with `kernel::vehicle::ROSTER_VERSION`. */
export const ROSTER_VERSION = 2;

export interface Lane {
  kind: number;
  dirPositive: number;
  footprint: number;
  gapTiles: number;
  speedMtps: number;
  phaseMt: number;
  warningMs: number;
  periodMs: number;
  blockerMask: bigint;
  sinking: number;
}

/**
 * Authoritative world time.
 *
 * The program derives this from `Clock::unix_timestamp`, so it advances in
 * whole seconds — hazards do not move continuously, and anything predicting
 * collisions must ask on the same grid the program evaluates on. Pass
 * `Date.now() / 1000` for the current tick.
 */
export function worldTimeMs(startTs: number | bigint, nowSeconds: number): number {
  const start = Number(startTs);
  return Math.max(0, Math.floor(nowSeconds) - start) * 1000;
}

/** Whole tiles the lane's conveyor has advanced. Objects never sit between tiles. */
function traveledTiles(lane: Lane, tMs: number): number {
  const raw = Math.floor((tMs * lane.speedMtps) / 1000) + lane.phaseMt;
  return Math.floor(raw / 1000);
}

/** Does any object of this lane cover tile `x` at `tMs`? */
export function laneObjectCovers(lane: Lane, x: number, tMs: number): boolean {
  return objectIndex(lane, x, tMs) !== null;
}

/**
 * The stable conveyor index of the object covering `x`, or null when clear.
 *
 * A car keeps this index for its whole journey across the world, which is
 * what makes it addressable: pair it with the chunk's `randomnessHash` and
 * every client independently resolves the same vehicle.
 */
export function objectIndex(lane: Lane, x: number, tMs: number): number | null {
  if (lane.gapTiles === 0 || lane.footprint === 0) return null;
  const traveled = traveledTiles(lane, tMs);
  const relative = lane.dirPositive === 1 ? x - traveled : x + traveled;
  const gap = lane.gapTiles;
  const index = Math.floor(relative / gap);
  const offsetInObject = relative - index * gap;
  return offsetInObject < lane.footprint ? index : null;
}

/**
 * World-x of the object with the given conveyor index, in whole tiles. Use
 * it to place a mesh; the object spans `[x, x + footprint)`.
 */
export function objectTileX(lane: Lane, index: number, tMs: number): number {
  const traveled = traveledTiles(lane, tMs);
  return lane.dirPositive === 1
    ? index * lane.gapTiles + traveled
    : index * lane.gapTiles - traveled;
}

/** Every object of this lane with any part inside the world, at `tMs`. */
export function laneObjects(
  lane: Lane,
  tMs: number,
): Array<{ index: number; x: number }> {
  if (lane.gapTiles === 0 || lane.footprint === 0) return [];
  const traveled = traveledTiles(lane, tMs);
  const out: Array<{ index: number; x: number }> = [];
  // Solve for the slots whose footprint can touch [0, WORLD_WIDTH).
  const lo = lane.dirPositive === 1 ? -traveled : traveled - WORLD_WIDTH;
  const first = Math.floor((lo - lane.footprint) / lane.gapTiles);
  const span = Math.ceil((WORLD_WIDTH + lane.footprint * 2) / lane.gapTiles) + 2;
  for (let i = 0; i <= span; i++) {
    const index = first + i;
    const x = objectTileX(lane, index, tMs);
    if (x + lane.footprint > 0 && x < WORLD_WIDTH) out.push({ index, x });
  }
  return out;
}

export type RailPhase = "quiet" | "warning" | "train";

export function railPhase(lane: Lane, tMs: number): RailPhase {
  const crossingMs =
    ((WORLD_WIDTH + lane.footprint) * 1_000_000) / Math.max(1, lane.speedMtps);
  const cycle = lane.periodMs + lane.warningMs + crossingMs;
  const pos = (tMs + lane.phaseMt) % cycle;
  if (pos < lane.periodMs) return "quiet";
  if (pos < lane.periodMs + lane.warningMs) return "warning";
  return "train";
}

export function logSubmerged(lane: Lane, tMs: number): boolean {
  if (lane.sinking === 0) return false;
  return (tMs + lane.phaseMt) % 8000 >= 6000;
}

export type TileState = "safe" | "lethal" | "blocked" | "supported";

/** Mirror of `hazard::evaluate_tile`. */
export function evaluateTile(lane: Lane, x: number, tMs: number): TileState {
  switch (lane.kind) {
    case LANE_GRASS:
      return lane.blockerMask & (1n << BigInt(x % WORLD_WIDTH)) ? "blocked" : "safe";
    case LANE_ROAD:
      return laneObjectCovers(lane, x, tMs) ? "lethal" : "safe";
    case LANE_RIVER:
      return laneObjectCovers(lane, x, tMs) && !logSubmerged(lane, tMs)
        ? "supported"
        : "lethal";
    case LANE_RAIL:
      return railPhase(lane, tMs) === "train" ? "lethal" : "safe";
    default:
      return "blocked";
  }
}

/** Can a move enter this tile? Only walls refuse — hazards accept and kill. */
export function isTraversable(lane: Lane, x: number, tMs: number): boolean {
  const state = evaluateTile(lane, x, tMs);
  return state === "safe" || state === "supported";
}

/** Would entering this tile be fatal right now? */
export function isLethal(lane: Lane, x: number, tMs: number): boolean {
  return evaluateTile(lane, x, tMs) === "lethal";
}

/** Mirror of `hazard::carry_target` — where a log takes its rider next. */
export function carryTarget(lane: Lane, x: number, tMs: number): number | null {
  if (lane.kind !== LANE_RIVER) return null;
  const next = lane.dirPositive === 1 ? x + 1 : x - 1;
  if (next < 0 || next >= WORLD_WIDTH) return null;
  return evaluateTile(lane, next, tMs) === "supported" ? next : null;
}

// ---------------------------------------------------------------------------
// canonical vehicle identity
// ---------------------------------------------------------------------------

export enum VehicleClass {
  Compact = 0,
  Pickup = 1,
  Bus = 2,
  Log = 3,
  Train = 4,
}

/** Interchangeable skins per class — geometry and behaviour are identical. */
export const VEHICLE_VARIANT_COUNT: Record<VehicleClass, number> = {
  [VehicleClass.Compact]: 4,
  [VehicleClass.Pickup]: 1,
  [VehicleClass.Bus]: 1,
  [VehicleClass.Log]: 1,
  [VehicleClass.Train]: 1,
};

/** Stable semantic asset IDs. Pack filenames must never reach protocol data. */
export const VEHICLE_ASSET_IDS: Record<VehicleClass, string[]> = {
  [VehicleClass.Compact]: [
    "vehicle.compact.a",
    "vehicle.compact.b",
    "vehicle.compact.c",
    "vehicle.police.a",
  ],
  [VehicleClass.Pickup]: ["vehicle.pickup.a"],
  [VehicleClass.Bus]: ["vehicle.bus.a"],
  // Built procedurally by the renderer; the id is descriptive only.
  [VehicleClass.Log]: ["prop.log.a"],
  [VehicleClass.Train]: ["vehicle.train.a"],
};

/** The class a lane carries, from its mechanical footprint — never its look. */
export function laneVehicleClass(lane: Lane): VehicleClass | null {
  switch (lane.kind) {
    case LANE_RIVER:
      return VehicleClass.Log;
    case LANE_RAIL:
      return VehicleClass.Train;
    case LANE_ROAD:
      if (lane.footprint <= 1) return VehicleClass.Compact;
      if (lane.footprint === 2) return VehicleClass.Pickup;
      return VehicleClass.Bus;
    default:
      return null;
  }
}

const MASK64 = (1n << 64n) - 1n;
const rotl = (v: bigint, n: bigint) => ((v << n) | (v >> (64n - n))) & MASK64;

/**
 * Which skin a given object wears. Mirror of `vehicle::vehicle_variant`:
 * SplitMix64 over the chunk's committed randomness mixed with (row, index).
 */
export function vehicleVariant(
  randomness: Uint8Array,
  row: number,
  index: number,
  cls: VehicleClass,
): number {
  const count = BigInt(VEHICLE_VARIANT_COUNT[cls]);
  if (count <= 1n) return 0;
  let state = 0x9e3779b97f4a7c15n;
  for (let i = 0; i < 32; i += 8) {
    let word = 0n;
    for (let b = 0; b < 8 && i + b < randomness.length; b++) {
      word |= BigInt(randomness[i + b]) << BigInt(8 * b);
    }
    state = (state ^ word) & MASK64;
    state = rotl(state, 17n);
  }
  state = (state ^ (BigInt(row) * 0xbf58476d1ce4e5b9n)) & MASK64;
  // Rust casts i64 to u64; mirror the two's-complement wrap for negatives.
  const idx = BigInt(index) & MASK64;
  state = (state ^ ((idx * 0x94d049bb133111ebn) & MASK64)) & MASK64;
  state = (state + 0x9e3779b97f4a7c15n) & MASK64;
  let z = state;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  z = (z ^ (z >> 31n)) & MASK64;
  return Number(z % count);
}

/**
 * Everything a renderer needs for one object: where it is, how long it is,
 * and which model to draw. Resolve it from chunk data — never at random.
 */
export interface RenderedVehicle {
  index: number;
  x: number;
  footprint: number;
  dirPositive: number;
  cls: VehicleClass;
  variant: number;
  assetId: string;
}

/** Every vehicle visible on a lane at `tMs`, with its canonical model. */
export function laneVehicles(
  lane: Lane,
  row: number,
  randomness: Uint8Array,
  tMs: number,
): RenderedVehicle[] {
  const cls = laneVehicleClass(lane);
  if (cls === null) return [];
  return laneObjects(lane, tMs).map(({ index, x }) => {
    const variant = vehicleVariant(randomness, row, index, cls);
    return {
      index,
      x,
      footprint: lane.footprint,
      dirPositive: lane.dirPositive,
      cls,
      variant,
      assetId: VEHICLE_ASSET_IDS[cls][variant] ?? VEHICLE_ASSET_IDS[cls][0],
    };
  });
}
