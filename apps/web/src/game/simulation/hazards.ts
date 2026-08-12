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
