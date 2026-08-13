/**
 * Hazard math for the client.
 *
 * The authoritative implementation lives in the SDK (`@crossy-world/sdk`),
 * which is itself a transcription of the program's kernel pinned by
 * cross-language golden vectors. Everything the game *decides* with — is
 * this tile lethal, which car is this, where is it — comes from there, so a
 * second copy can never drift out of agreement with the chain.
 *
 * What stays here is presentation only: facts a renderer needs that the
 * program has no opinion about.
 */
export {
  LANE_GRASS,
  LANE_ROAD,
  LANE_RIVER,
  LANE_RAIL,
  MAX_CARRY_TILES,
  VehicleClass,
  VEHICLE_ASSET_IDS,
  carryTarget,
  evaluateTile,
  isLethal,
  isTraversable,
  laneObjectCovers,
  laneObjects,
  laneVehicleClass,
  laneVehicles,
  logSubmerged,
  objectIndex,
  objectTileX,
  tickOf,
  vehicleVariant,
  worldTimeMs,
} from "@crossy-world/sdk";
export type { Lane, RenderedVehicle, TileState } from "@crossy-world/sdk";

import {
  LANE_RIVER,
  LANE_RAIL,
  type Lane,
  evaluateTile,
  railPhase,
  WORLD_WIDTH,
} from "@crossy-world/sdk";

/**
 * Where to draw the train, on top of the authoritative phase.
 *
 * The program marks the whole rail row lethal for the entire crossing
 * window — it does not track where along the row the train is — so this
 * position is decoration. It must never be used to decide whether a tile is
 * safe; `evaluateTile` is the authority.
 */
export function railPhaseVisual(
  lane: Lane,
  tMs: number,
): { phase: "quiet" | "warning" | "train"; trainX: number } {
  const phase = railPhase(lane, tMs);
  if (phase !== "train") return { phase, trainX: -100 };
  const crossingMs =
    ((WORLD_WIDTH + lane.footprint) * 1_000_000) / Math.max(1, lane.speedMtps);
  const cycle = lane.periodMs + lane.warningMs + crossingMs;
  const pos = (tMs + lane.phaseMt) % cycle;
  const progress = (pos - lane.periodMs - lane.warningMs) / crossingMs;
  const trainX =
    lane.dirPositive === 1
      ? -lane.footprint + progress * (WORLD_WIDTH + lane.footprint)
      : WORLD_WIDTH - progress * (WORLD_WIDTH + lane.footprint);
  return { phase, trainX };
}

/** Why a move was refused, in words a player understands. */
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
