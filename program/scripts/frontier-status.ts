/**
 * Operator view of a live world's frontier: revealed rows on both planes,
 * the terrain of each revealed chunk, and whether every occupancy sector
 * behind the frontier exists and is delegated.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROGRAM_ID = new web3.PublicKey("GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX");
const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
const ER_RPC = process.env.ER_RPC ?? "https://devnet-as.magicblock.app";
const MODE = Number(process.env.MODE ?? 1);
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
  const world = pda(Buffer.from("world"), Buffer.from([MODE]), le8(day));
  const idl = JSON.parse(
    readFileSync(resolve(__dirname, "../target/idl/crossy_world.json"), "utf8"),
  );
  const dummy = new anchor.Wallet(web3.Keypair.generate());
  const base = new Program(
    idl,
    new anchor.AnchorProvider(new web3.Connection(BASE_RPC, "confirmed"), dummy, {}),
  ) as Program<any>;
  const er = new Program(
    idl,
    new anchor.AnchorProvider(new web3.Connection(ER_RPC, "processed"), dummy, {}),
  ) as Program<any>;

  console.log(`day ${day} mode ${MODE} world ${world.toBase58()}`);
  const live = await er.account.worldHeader.fetch(world);
  const committed = await base.account.worldHeader.fetchNullable(world).catch(() => null);
  console.log(
    `  ER: revealed ${live.revealedRows} rows, next chunk ${live.nextChunkIndex}, ` +
      `record ${live.recordScore}, active ${live.activePlayers}`,
  );
  if (committed)
    console.log(`  base (last commit): revealed ${committed.revealedRows} rows`);

  for (let c = 0; c < live.nextChunkIndex; c++) {
    const chunk = await base.account.chunkDefinition.fetchNullable(
      pda(Buffer.from("chunk"), le8(day), le2(c)),
    );
    if (!chunk) {
      console.log(`  chunk ${c}: MISSING`);
      continue;
    }
    const counts = new Map<string, number>();
    let blockers = 0;
    for (const l of chunk.lanes as any[]) {
      counts.set(KINDS[l.kind], (counts.get(KINDS[l.kind]) ?? 0) + 1);
      blockers += BigInt(l.blockerMask.toString())
        .toString(2)
        .split("")
        .filter((b) => b === "1").length;
    }
    const shape = (chunk.lanes as any[]).map((l) => KINDS[l.kind][0]).join("");
    console.log(
      `  chunk ${c} rows ${chunk.rowStart}-${chunk.rowStart + chunk.rowCount - 1} [${shape}] ` +
        `${[...counts].map(([k, v]) => `${k}:${v}`).join(" ")} blockers:${blockers}`,
    );
  }

  const bands = live.revealedRows / 8;
  for (let sy = 0; sy < bands; sy++) {
    const addrs = Array.from({ length: 8 }, (_, sx) =>
      pda(Buffer.from("sector"), world.toBuffer(), Buffer.from([sx]), le2(sy)),
    );
    const infos = await base.provider.connection.getMultipleAccountsInfo(addrs);
    const marks = infos.map((i) => (!i ? "-" : i.owner.equals(PROGRAM_ID) ? "P" : "D"));
    console.log(`  sectors y=${sy} (rows ${sy * 8}-${sy * 8 + 7}): ${marks.join("")}`);
  }
  console.log("  legend: D delegated to ER (playable), P on base only, - missing");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
