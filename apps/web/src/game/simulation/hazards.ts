/**
 * Display-only mirror of the program's deterministic hazard math
 * (kernel/hazard.rs). The contract remains the collision authority; this
 * merely renders the same integer formulas smoothly.
 */
export interface Lane {
  kind: number; // 0 grass, 1 road, 2 river, 3 rail
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

export const LANE_GRASS = 0;
export const LANE_ROAD = 1;
export const LANE_RIVER = 2;
export const LANE_RAIL = 3;

/** World-x positions (fractional tiles) of moving objects at time tMs. */
export function laneObjects(lane: Lane, tMs: number): number[] {
  if (lane.kind !== LANE_ROAD && lane.kind !== LANE_RIVER) return [];
  if (lane.gapTiles === 0) return [];
  const cycleMt = lane.gapTiles * 1000;
  const traveled = ((tMs * lane.speedMtps) / 1000 + lane.phaseMt) % cycleMt;
  const positions: number[] = [];
  for (let base = -lane.gapTiles; base < 64 + lane.gapTiles; base += lane.gapTiles) {
    const x = lane.dirPositive === 1 ? base + traveled / 1000 : base - traveled / 1000;
    positions.push(x);
  }
  return positions;
}

export type RailPhase = "quiet" | "warning" | "train";

export function railPhase(lane: Lane, tMs: number): { phase: RailPhase; trainX: number } {
  const crossingMs = ((64 + lane.footprint) * 1_000_000) / Math.max(1, lane.speedMtps);
  const cycle = lane.periodMs + lane.warningMs + crossingMs;
  const pos = (tMs + lane.phaseMt) % cycle;
  if (pos < lane.periodMs) return { phase: "quiet", trainX: -100 };
  if (pos < lane.periodMs + lane.warningMs) return { phase: "warning", trainX: -100 };
  const progress = (pos - lane.periodMs - lane.warningMs) / crossingMs;
  const trainX =
    lane.dirPositive === 1
      ? -lane.footprint + progress * (64 + lane.footprint)
      : 64 - progress * (64 + lane.footprint);
  return { phase: "train", trainX };
}

export function logSubmerged(lane: Lane, tMs: number): boolean {
  if (lane.sinking === 0) return false;
  const pos = (tMs + lane.phaseMt) % 8000;
  return pos >= 6000;
}

export type TileState = "safe" | "lethal" | "blocked" | "supported";

/**
 * Tile-level coverage, transcribed from `hazard::lane_object_covers`. This is
 * the discrete test the program uses to accept a move, as opposed to
 * `laneObjects` above which returns continuous positions for drawing. Both
 * describe the same objects; keep them in step.
 */
export function laneObjectCovers(lane: Lane, x: number, tMs: number): boolean {
  if (lane.gapTiles === 0) return false;
  const cycleMt = lane.gapTiles * 1000;
  const traveled = Math.floor((tMs * lane.speedMtps) / 1000) + lane.phaseMt;
  const offset = traveled % cycleMt;
  const xMt = x * 1000;
  const patternPos =
    lane.dirPositive === 1
      ? (xMt + cycleMt - (offset % cycleMt)) % cycleMt
      : (xMt + offset) % cycleMt;
  const fpMt = lane.footprint * 1000;
  return patternPos < fpMt || patternPos + 1000 > cycleMt;
}

/** Mirror of `hazard::evaluate_tile`. The contract stays the authority. */
export function evaluateTile(lane: Lane, x: number, tMs: number): TileState {
  switch (lane.kind) {
    case LANE_GRASS:
      return lane.blockerMask & (1n << BigInt(x % 64)) ? "blocked" : "safe";
    case LANE_ROAD:
      return laneObjectCovers(lane, x, tMs) ? "lethal" : "safe";
    case LANE_RIVER:
      return laneObjectCovers(lane, x, tMs) && !logSubmerged(lane, tMs)
        ? "supported"
        : "lethal";
    case LANE_RAIL:
      return railPhase(lane, tMs).phase === "train" ? "lethal" : "safe";
    default:
      return "blocked";
  }
}

/** Can a move enter this tile right now? (Supported water counts.) */
export function isTraversable(lane: Lane, x: number, tMs: number): boolean {
  const state = evaluateTile(lane, x, tMs);
  return state === "safe" || state === "supported";
}

/** Human-readable reason a tile refused entry, for the HUD. */
export function blockedReason(lane: Lane, x: number, tMs: number): string | null {
  switch (evaluateTile(lane, x, tMs)) {
    case "blocked":
      return "blocked";
    case "lethal":
      return lane.kind === LANE_RIVER
        ? "water — wait for a log"
        : lane.kind === LANE_RAIL
          ? "train coming"
          : "traffic";
    default:
      return null;
  }
}
