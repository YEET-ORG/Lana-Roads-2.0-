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
 * Milliseconds of world time per rollup slot. Mirrors `MS_PER_SLOT`.
 */
export const MS_PER_SLOT = 50;

/**
 * Authoritative world time.
 *
 * The program derives this from `Clock::slot` on the rollup, NOT from a
 * wall clock: `unix_timestamp` only advances in whole seconds, which made
 * hazards jump several tiles at once and left every client guessing in
 * between. A slot is ~50ms, and it is the same counter for everyone, so
 * two players watching the same road see the same cars in the same places.
 *
 * Pass the rollup's current slot.
 */
export function worldTimeMs(slot: number | bigint): number {
  return Number(slot) * MS_PER_SLOT;
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

/** The authoritative tick containing `tMs`. Hazards only move on these. */
export function tickOf(tMs: number): number {
  return Math.floor(tMs / 1000) * 1000;
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
  //
  // An object sits at `index * gap + traveled` when the lane runs right and
  // `index * gap - traveled` when it runs left, so the lowest index that
  // can still touch the world is found by moving `traveled` to the other
  // side — it changes SIGN with the direction. Subtracting the world width
  // instead (as this did) walks a window of indices that are entirely off
  // the left edge: on a left-running lane only the first two or three cars
  // were ever listed, while every other car on that row went on colliding
  // unseen.
  const lo = lane.dirPositive === 1 ? -traveled : traveled;
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
  /** Stable identity of this object on its lane. */
  index: number;
  /**
   * Authoritative tile the object occupies, spanning `[x, x + footprint)`.
   * This is what collides; it only ever changes on a whole second.
   */
  x: number;
  /**
   * Where to draw it: interpolated across the tick so motion is continuous.
   *
   * Always between the previous authoritative tile and `x`, and never past
   * `x`. The drawn car therefore lags the program by up to one step and
   * catches up as the tick closes — a screen that is at worst cautious.
   * Leading instead would open a gap behind every car that the program
   * still calls lethal.
   */
  renderX: number;
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
  // Positions are resolved on the authoritative tick — passing a render
  // clock straight through would put objects a tile away from where the
  // program has them — and the leftover fraction only smooths the draw.
  //
  // The smoothing runs from the PREVIOUS tick INTO the current one, never
  // forward out of it. Drawing ahead is the one direction that gets a
  // player killed: a car rendered up to a full step past its authoritative
  // tile leaves an inviting gap behind it that the program still calls
  // lethal. Lagging instead means the screen is at worst conservative —
  // the car is shown arriving at the tile the program already considers
  // occupied.
  const tick = tickOf(tMs);
  const frac = Math.min(1, Math.max(0, (tMs - tick) / 1000));
  const prevTick = Math.max(0, tick - 1000);
  return laneObjects(lane, tick).map(({ index, x }) => {
    const variant = vehicleVariant(randomness, row, index, cls);
    // Conveyor indices are stable and positions are linear in `traveled`,
    // so the previous tile is exactly one step back with no wraparound.
    const prevX = objectTileX(lane, index, prevTick);
    return {
      index,
      x,
      renderX: prevX + (x - prevX) * frac,
      footprint: lane.footprint,
      dirPositive: lane.dirPositive,
      cls,
      variant,
      assetId: VEHICLE_ASSET_IDS[cls][variant] ?? VEHICLE_ASSET_IDS[cls][0],
    };
  });
}
