/**
 * Presence, from the two places the HUD reads it.
 *
 * The world header keeps a counter (`active_players`) that spawn and death
 * maintain; the run accounts are the ground truth behind it. When those two
 * disagree, the header is the one that drifted — a run that never dies is
 * never subtracted — so print both and let the difference be visible rather
 * than trusting either alone.
 */
import { Program, web3 } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

const le8 = (v: bigint | number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};
const pda = (...s: Buffer[]) => web3.PublicKey.findProgramAddressSync(s, PROGRAM_ID)[0];

async function main() {
  const idl = JSON.parse(
    readFileSync(resolve(__dirname, "../target/idl/crossy_world.json"), "utf8"),
  );
  const dummy = web3.Keypair.generate();
  const wallet = new anchor.Wallet(dummy);
  const er = new Program(idl, new anchor.AnchorProvider(
    new web3.Connection(ER_RPC, "processed"),
    wallet,
    { commitment: "processed" },
  )) as Program<any>;
  const base = new Program(idl, new anchor.AnchorProvider(
    new web3.Connection(BASE_RPC, "confirmed"),
    wallet,
    { commitment: "confirmed" },
  )) as Program<any>;

  const day = BigInt(process.env.DAY ?? Math.floor(Date.now() / 1000 / 86400));
  console.log(`day ${day}`);
  void base;

  for (const [name, mode] of [
    ["casual", 1],
    ["paid", 0],
  ] as const) {
    const world = pda(Buffer.from("world"), Buffer.from([REGION]), Buffer.from([mode]), le8(day));
    const header = await er.account.worldHeader.fetchNullable(world).catch(() => null);
    if (!header) {
      console.log(`  ${name}: no world on the ER`);
      continue;
    }
    const runs = await er.account.playerRun.all([
      { memcmp: { offset: 8, bytes: world.toBase58() } },
    ]);
    const byState = new Map<string, number>();
    for (const { account } of runs) {
      const s = Object.keys(account.state)[0] ?? "?";
      byState.set(s, (byState.get(s) ?? 0) + 1);
    }
    const active = byState.get("active") ?? 0;
    console.log(
      `  ${name}: header.active_players=${header.activePlayers} · runs active=${active} ` +
        `(${[...byState].map(([k, v]) => `${k}:${v}`).join(", ") || "none"})` +
        (header.activePlayers === active ? "" : "  <- counter drifted"),
    );
  }

  const t0 = Date.now();
  await er.provider.connection.getSlot("processed");
  console.log(`ER round-trip: ${Date.now() - t0} ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
