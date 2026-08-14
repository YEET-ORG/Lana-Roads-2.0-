/**
 * Resolve a live chunk's traffic exactly as a client would, and print it.
 *
 * This is the join between the contract and the renderer: positions and
 * models both come from committed chunk state, so two clients asking the
 * same question at the same instant must get identical answers. Run it
 * twice, or on two machines, and the output must match.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// The program package does not depend on the SDK; load the shared math
// straight from source so this stays a single implementation.
import {
  laneVehicles,
  worldTimeMs,
  type Lane,
} from "../../packages/crossy-world-sdk/src/hazards.js";

const PROGRAM_ID = new web3.PublicKey("GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX");
const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
const ER_RPC = process.env.ER_RPC ?? "https://devnet-as.magicblock.app";
const KINDS = ["grass", "road", "river", "rail"];

const le8 = (v: bigint | number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};
const le2 = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
};
const pda = (...s: Buffer[]) => web3.PublicKey.findProgramAddressSync(s, PROGRAM_ID)[0];

async function main() {
  const day = BigInt(process.env.DAY ?? Math.floor(Date.now() / 1000 / 86400));
  const world = pda(Buffer.from("world"), Buffer.from([1]), le8(day));
  const idl = JSON.parse(
    readFileSync(resolve(__dirname, "../target/idl/crossy_world.json"), "utf8"),
  );
  const wallet = new anchor.Wallet(web3.Keypair.generate());
  const base = new Program(
    idl,
    new anchor.AnchorProvider(new web3.Connection(BASE_RPC, "confirmed"), wallet, {}),
  ) as Program<any>;
  const er = new Program(
    idl,
    new anchor.AnchorProvider(new web3.Connection(ER_RPC, "processed"), wallet, {}),
  ) as Program<any>;

  await er.account.worldHeader.fetch(world);
  // World time is the rollup's slot, not a wall clock — ask the plane the
  // program runs on.
  const slot = await er.provider.connection.getSlot("processed");
  const tMs = worldTimeMs(slot);
  console.log(`day ${day}, slot ${slot}, world time ${tMs}ms\n`);

  const chunkIndex = Number(process.env.CHUNK ?? 1);
  const chunk = await base.account.chunkDefinition.fetch(
    pda(Buffer.from("chunk"), le8(day), le2(chunkIndex)),
  );
  const seed = Uint8Array.from(chunk.randomnessHash as number[]);

  for (const [i, raw] of (chunk.lanes as any[]).entries()) {
    if (raw.kind === 0) continue;
    const row = chunk.rowStart + i;
    const lane: Lane = {
      kind: raw.kind,
      dirPositive: raw.dirPositive,
      footprint: raw.footprint,
      gapTiles: raw.gapTiles,
      speedMtps: raw.speedMtps,
      phaseMt: raw.phaseMt,
      warningMs: raw.warningMs,
      periodMs: raw.periodMs,
      blockerMask: BigInt(raw.blockerMask.toString()),
      sinking: raw.sinking,
    };
    const vehicles = laneVehicles(lane, row, seed, tMs);
    const drawn = vehicles
      .filter((v) => v.x > -4 && v.x < 68)
      .map(
        (v) =>
          `#${v.index}@${v.x}:${v.assetId.replace("vehicle.", "").replace("prop.", "")}`,
      )
      .join(" ");
    console.log(
      `row ${row} ${KINDS[raw.kind].padEnd(5)} fp=${raw.footprint} gap=${raw.gapTiles} ` +
        `spd=${raw.speedMtps} ${raw.dirPositive === 1 ? "->" : "<-"}\n    ${drawn}`,
    );
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
