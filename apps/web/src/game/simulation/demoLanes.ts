/**
 * Deterministic synthetic lane generator for offline surfaces (practice
 * mode and the menu-world backdrop). Never used for paid play — real lanes
 * come from the chain.
 */
import {
  evaluateTile,
  Lane,
  LANE_GRASS,
  LANE_RAIL,
  LANE_RIVER,
  LANE_ROAD,
  railPhase,
  TileState,
} from "./hazards";

/**
 * Demo-only tile rule: the program marks a whole rail row lethal for the
 * entire crossing window (authoritative, mirrored online) — but offline
 * practice owes the player positional fairness: the train only kills the
 * tiles it actually covers.
 */
export function demoEvaluateTile(lane: Lane, x: number, tMs: number): TileState {
  if (lane.kind === LANE_RAIL) {
    const { phase, trainX } = railPhase(lane, tMs);
    if (phase !== "train") return "safe";
    return x + 1 > trainX && x < trainX + lane.footprint ? "lethal" : "safe";
  }
  return evaluateTile(lane, x, tMs);
}

export function demoIsTraversable(lane: Lane, x: number, tMs: number): boolean {
  const state = demoEvaluateTile(lane, x, tMs);
  return state === "safe" || state === "supported";
}

export function demoBlockedReason(lane: Lane, x: number, tMs: number): string | null {
  switch (demoEvaluateTile(lane, x, tMs)) {
    case "blocked":
      return "blocked";
    case "lethal":
      return lane.kind === LANE_RIVER
        ? "water — wait for a log"
        : lane.kind === LANE_RAIL
          ? "train!"
          : "traffic";
    default:
      return null;
  }
}

const SAFE_LANE: Omit<Lane, "blockerMask"> = {
  kind: LANE_GRASS,
  dirPositive: 1,
  footprint: 1,
  gapTiles: 0,
  speedMtps: 0,
  phaseMt: 0,
  warningMs: 0,
  periodMs: 0,
  sinking: 0,
};

/** mulberry32 on (row, seed): stable across clients and reloads. */
export function makeLane(row: number, seed = 7): Lane {
  let a = (row * 2654435761 + seed * 40503) >>> 0;
  const rnd = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  if (row < 3) return { ...SAFE_LANE, blockerMask: 0n };
  const roll = rnd();
  const dirPositive = rnd() > 0.5 ? 1 : 0;
  if (roll < 0.38) {
    let mask = 0n;
    for (let x = 0; x < 64; x++) if (rnd() < 0.18) mask |= 1n << BigInt(x);
    // Guarantee gaps so rows never wall off.
    mask &= ~(0b1111n << BigInt(Math.floor(rnd() * 60)));
    return { ...SAFE_LANE, blockerMask: mask };
  }
  if (roll < 0.72) {
    const footprint = rnd() < 0.25 ? 3 : rnd() < 0.5 ? 2 : 1;
    return {
      kind: LANE_ROAD,
      dirPositive,
      footprint,
      gapTiles: 6 + Math.floor(rnd() * 8),
      speedMtps: 1600 + Math.floor(rnd() * 2600),
      phaseMt: Math.floor(rnd() * 64000),
      warningMs: 0,
      periodMs: 0,
      blockerMask: 0n,
      sinking: 0,
    };
  }
  if (roll < 0.9) {
    return {
      kind: LANE_RIVER,
      dirPositive,
      footprint: 2 + Math.floor(rnd() * 2),
      gapTiles: 5 + Math.floor(rnd() * 4),
      speedMtps: 1000 + Math.floor(rnd() * 1400),
      phaseMt: Math.floor(rnd() * 64000),
      warningMs: 0,
      periodMs: 0,
      blockerMask: 0n,
      sinking: rnd() < 0.3 ? 1 : 0,
    };
  }
  return {
    kind: LANE_RAIL,
    dirPositive,
    footprint: 8,
    gapTiles: 0,
    speedMtps: 18000,
    phaseMt: Math.floor(rnd() * 8000),
    warningMs: 1100,
    periodMs: 3200 + Math.floor(rnd() * 4000),
    blockerMask: 0n,
    sinking: 0,
  };
}
