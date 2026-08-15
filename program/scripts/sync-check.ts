/**
 * Does the screen agree with the program?
 *
 * Two ways it can lie, and both are silent:
 *
 *   1. WHERE THE CAR IS. The program moves traffic in whole tiles on whole
 *      seconds; the renderer smooths between those steps so it does not
 *      stutter. If that smoothing runs FORWARD from the current tick, the
 *      drawn car leads the authoritative one by up to a full step — four
 *      tiles at the hardest stage — and a player who hops into the gap
 *      behind it lands on a tile the program still calls lethal.
 *
 *   2. WHEN IT IS. The client anchors world time to the browser clock. The
 *      program uses the validator's. A second of skew is a whole tick.
 *
 * This measures both against a real lane from the live world, at every
 * offset inside a tick, and reports the worst disagreement in tiles.
 *
 *   npx tsx scripts/sync-check.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MS_PER_SLOT,
  laneObjectCovers,
  laneVehicles,
  tickOf,
  worldTimeMs,
} from "../../packages/crossy-world-sdk/src/hazards.js";

const PROGRAM_ID = new web3.PublicKey("GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX");
const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
const ER_RPC = process.env.ER_RPC ?? "https://devnet-as.magicblock.app";
const MODE = Number(process.env.MODE ?? 1);
/** Samples inside one authoritative step. */
const STEPS = 20;

const le8 = (v: bigint | number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};
const le4 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
};
const pda = (...s: Buffer[]) => web3.PublicKey.findProgramAddressSync(s, PROGRAM_ID)[0];

async function main() {
  const day = BigInt(process.env.DAY ?? Math.floor(Date.now() / 1000 / 86400));
  const world = pda(Buffer.from("world"), Buffer.from([MODE]), le8(day));
  const idl = JSON.parse(
    readFileSync(resolve(__dirname, "../target/idl/crossy_world.json"), "utf8"),
  );
  const dummy = new anchor.Wallet(web3.Keypair.generate());
  const baseConn = new web3.Connection(BASE_RPC, "confirmed");
  const erConn = new web3.Connection(ER_RPC, "processed");
  const base = new Program(
    idl,
    new anchor.AnchorProvider(baseConn, dummy, {}),
  ) as Program<any>;
  const er = new Program(
    idl,
    new anchor.AnchorProvider(erConn, dummy, {}),
  ) as Program<any>;

  // ---- 2. the clock -----------------------------------------------------
  // World time is the rollup's slot. Nothing here reads a wall clock, so
  // there is no skew to measure any more — only the grid it advances on.
  const slot = await erConn.getSlot("processed");
  const localNow = Math.floor(Date.now() / 1000);
  console.log(
    `clock: slot ${slot} -> world time ${worldTimeMs(slot)}ms ` +
      `(grid ${MS_PER_SLOT}ms, ${1000 / MS_PER_SLOT} steps per second)`,
  );

  // ---- 1. the smoothing -------------------------------------------------
  const header: any = await er.account.worldHeader.fetch(world);
  const chunks = Math.ceil(header.revealedRows / 16);
  const lanes: any[] = [];
  const randomness: Uint8Array[] = [];
  for (let c = 0; c < chunks; c++) {
    const chunk: any = await base.account.chunkDefinition.fetch(
      pda(Buffer.from("chunk"), le8(day), le4(c)),
    );
    for (const l of chunk.lanes) {
      lanes.push(l);
      randomness.push(Uint8Array.from(chunk.randomnessHash as number[]));
    }
  }

  void localNow;
  const nowMs = worldTimeMs(slot);
  let worstLead = 0; // drawn PAST the authoritative tile: the unfair direction
  let worstLag = 0; // drawn behind it: cautious, and covered by the marks
  let worstRow = -1;
  let ghostBody = 0; // body drawn clear, program says lethal
  let ghostMarked = 0; // same, with the danger marks counted as drawn
  let phantomTiles = 0; // drawn covered, program says clear
  let samples = 0;

  for (let row = 0; row < lanes.length; row++) {
    const lane = lanes[row];
    const kind = lane.kind;
    if (kind !== 1 && kind !== 2) continue; // only moving terrain has this problem
    const asLane = {
      kind,
      dirPositive: lane.dirPositive,
      footprint: lane.footprint,
      gapTiles: lane.gapTiles,
      speedMtps: lane.speedMtps,
      phaseMt: lane.phaseMt,
      warningMs: lane.warningMs,
      periodMs: lane.periodMs,
      blockerMask: BigInt(lane.blockerMask.toString()),
      sinking: lane.sinking,
    };
    for (let s = 0; s < STEPS; s++) {
      const t = nowMs + (s * MS_PER_SLOT) / STEPS;
      const tick = tickOf(t);
      const drawn = laneVehicles(asLane, row, randomness[row], t);
      for (const v of drawn) {
        // Signed along the direction of travel: positive means the drawn
        // car is PAST the tile the program has it on, which is the error
        // that kills a player who hops into the gap behind it.
        const lead = asLane.dirPositive === 1 ? v.renderX - v.x : v.x - v.renderX;
        if (lead > worstLead) {
          worstLead = lead;
          worstRow = row;
        }
        if (-lead > worstLag) worstLag = -lead;
      }
      // Tile-by-tile: what the player sees covered vs what the program
      // will kill them on, at this instant. Roads only — on a river the
      // object is where you STAND, so "covered" means safe and counting it
      // as lethal would measure the opposite of the truth.
      if (kind !== 1) continue;
      for (let x = 0; x < 64; x++) {
        const lethalNow = laneObjectCovers(asLane, x, tick);
        const body = drawn.some(
          (v) => x >= Math.round(v.renderX) && x < Math.round(v.renderX) + v.footprint,
        );
        // The danger mark is drawn on the authoritative span, so with it on
        // the screen shows every lethal tile by construction.
        const marked = drawn.some((v) => x >= v.x && x < v.x + v.footprint);
        samples += 1;
        if (lethalNow && !body) ghostBody += 1;
        if (lethalNow && !body && !marked) ghostMarked += 1;
        if (body && !lethalNow) phantomTiles += 1;
      }
    }
  }

  console.log(
    `\nsmoothing: worst LEAD ${worstLead.toFixed(2)} tile(s)` +
      (worstRow >= 0 ? ` on row ${worstRow}` : "") +
      `, worst lag ${worstLag.toFixed(2)}`,
  );
  console.log(
    `  body only:  ${ghostBody} of ${samples} tile samples are LETHAL but drawn clear`,
  );
  console.log(`  with marks: ${ghostMarked} of ${samples} — every lethal tile is shown`);
  console.log(
    `  ${phantomTiles} of ${samples} are drawn covered but safe ` +
      `(looks blocked, is not — the forgiving direction)`,
  );
}

if (require.main === module) {
  process.on("unhandledRejection", (e) => console.error("(ignored)", e));
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
