/**
 * Operator view of a live world's frontier: revealed rows on both planes,
 * the terrain of each revealed chunk, and whether every occupancy sector
 * behind the frontier exists and is delegated.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { loadCrossyWorldIdl } from "./runtime-config";

const PROGRAM_ID = new web3.PublicKey("9HciUP5BBW2i9JZYdWxaD5rRsT7FgidharReBNyyXvN8");
const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
/**
 * Rollup region. Each region runs its own world, pot and map, so this
 * selects which game the script is talking about — not just a transport.
 */
const REGION = Number(process.env.REGION ?? 0);
/** Region id -> the rollup that hosts it. Must match apps/web/src/lib/regions.ts. */
const REGION_RPC = [
  "https://devnet-as.magicblock.app",
  "https://devnet-eu.magicblock.app",
  "https://devnet-us.magicblock.app",
];
const REGION_VALIDATOR = [
  "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
  "MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e",
  "MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd",
];

const ER_RPC = process.env.ER_RPC ?? REGION_RPC[REGION];
const MODE = Number(process.env.MODE ?? 1);
const KINDS = ["grass", "road", "river", "rail"];

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
  const world = pda(
    Buffer.from("world"),
    Buffer.from([REGION]),
    Buffer.from([MODE]),
    le8(day),
  );
  const idl = loadCrossyWorldIdl(PROGRAM_ID.toBase58());
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
  let live: any;
  try {
    live = await er.account.worldHeader.fetch(world);
  } catch (error: any) {
    const raw = await er.provider.connection.getAccountInfo(world, "processed");
    if (!raw) throw new Error("world is not open on the configured ER");
    const detail = error?.message ?? String(error);
    throw new Error(
      `world exists (${raw.data.length} bytes) but the current IDL cannot decode it; ` +
        `the deployed binary/account layout is stale. Redeploy, then open a fresh UTC-day ` +
        `world (or migrate the existing accounts). Decoder error: ${detail}`,
    );
  }
  const committed = await base.account.worldHeader.fetchNullable(world).catch(() => null);
  console.log(
    `  ER: revealed ${live.revealedRows} rows, next chunk ${live.nextChunkIndex}, ` +
      `record ${live.recordScore}, active ${live.activePlayers}`,
  );
  if (committed)
    console.log(`  base (last commit): revealed ${committed.revealedRows} rows`);

  for (let c = 0; c < live.nextChunkIndex; c++) {
    const chunk = await base.account.chunkDefinition.fetchNullable(
      pda(Buffer.from("chunk"), Buffer.from([REGION]), le8(day), le4(c)),
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
      pda(Buffer.from("sector"), world.toBuffer(), Buffer.from([sx]), le4(sy)),
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
