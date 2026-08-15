import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Tracked IDL used by both the browser SDK and clean production workers. */
export const DEFAULT_CROSSY_WORLD_IDL = resolve(
  __dirname,
  "../../packages/crossy-world-sdk/src/generated/crossy_world.json",
);

export function loadCrossyWorldIdl(expectedProgramId: string): any {
  const path = process.env.CROSSY_WORLD_IDL ?? DEFAULT_CROSSY_WORLD_IDL;
  const idl = JSON.parse(readFileSync(path, "utf8"));
  if (idl.address !== expectedProgramId) {
    throw new Error(
      `IDL program ${idl.address} does not match expected ${expectedProgramId}`,
    );
  }
  return idl;
}
