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
  railVisualSpan,
  tickOf,
} from "@crossy-world/sdk";

/**
 * Where to draw the train, on top of the authoritative phase.
 *
 * The train's danger window is positional in the program (`rail_train_covers`),
 * so the mesh must COVER that window: if a train is going, it has to be on
 * screen where it kills. `railVisualSpan` is the conservative body — it only
 * ever over-covers, never leaves the lethal span invisible.
 *
 * Returns the body's left edge (`trainX`) and length (`trainLen`), in tiles;
 * the renderer centers and stretches the mesh accordingly.
 */
export function railPhaseVisual(
  lane: Lane,
  tMs: number,
): { phase: "quiet" | "warning" | "train"; trainX: number; trainLen: number } {
  const phase = railPhase(lane, tickOf(tMs));
  if (phase !== "train") return { phase, trainX: -100, trainLen: lane.footprint };
  const { left, length } = railVisualSpan(lane, tMs);
  return { phase, trainX: left, trainLen: length };
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
