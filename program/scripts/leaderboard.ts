/**
 * A day's standings, from the accounts the program actually keeps.
 *
 * `PlayerRun` only holds the CURRENT attempt, so it is the wrong source: a
 * player who reached row 40, died, and respawned is worth 3 there. The
 * authoritative high water mark is `DailyBest`, one per world+wallet,
 * written as it is beaten. Live run state is merged on top so the board can
 * say who is still out there.
 *
 *   npx tsx scripts/leaderboard.ts              # today, casual
 *   MODE=0 npx tsx scripts/leaderboard.ts       # today, paid
 *   DAY=20678 npx tsx scripts/leaderboard.ts    # a past day
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
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
const MODE = Number(process.env.MODE ?? 1);

const le8 = (v: bigint | number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};
const pda = (...s: Buffer[]) => web3.PublicKey.findProgramAddressSync(s, PROGRAM_ID)[0];

async function main() {
  const day = BigInt(process.env.DAY ?? Math.floor(Date.now() / 1000 / 86400));
  const world = pda(Buffer.from("world"), Buffer.from([REGION]), Buffer.from([MODE]), le8(day));
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

  const filter = [{ memcmp: { offset: 8, bytes: world.toBase58() } }];
  // The rollup while the day is live, base once the accounts have come
  // home. Both are right, at different times.
  let bests: any[] = await er.account.dailyBest.all(filter).catch(() => []);
  let source = "rollup";
  if (!bests.length) {
    bests = await base.account.dailyBest.all(filter).catch(() => []);
    source = "base";
  }
  const runs: any[] = await er.account.playerRun.all(filter).catch(() => []);
  const byWallet = new Map(
    runs.map(({ account }: any) => [account.wallet.toBase58(), account]),
  );

  const header: any = await er.account.worldHeader.fetchNullable(world).catch(() => null);
  const onBase: any = await base.account.worldHeader
    .fetchNullable(world)
    .catch(() => null);
  const w = header ?? onBase;
  console.log(
    `day ${day} mode ${MODE} (${MODE === 0 ? "paid" : "casual"}) — ` +
      `${bests.length} player(s) from ${source}` +
      (w
        ? `, record row ${w.recordScore} by ${w.recordHolder.toBase58().slice(0, 8)}…`
        : ""),
  );

  const rows = bests
    .map(({ account }: any) => {
      const run = byWallet.get(account.wallet.toBase58());
      const state = run ? (Object.keys(run.state)[0] ?? "?") : "no run";
      return {
        wallet: account.wallet.toBase58(),
        // A run in progress can already be past the recorded best.
        score: Math.max(account.bestScore, run?.score ?? 0),
        slot: BigInt(account.reachedSlot.toString()),
        state,
      };
    })
    .sort(
      (a, b) => b.score - a.score || (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0),
    );

  rows
    .slice(0, Number(process.env.TOP ?? 20))
    .forEach((r, i) =>
      console.log(
        `  #${String(i + 1).padStart(2)} row ${String(r.score).padStart(3)}  ` +
          `${r.wallet.slice(0, 8)}…  ${r.state}`,
      ),
    );
  if (!rows.length) console.log("  (nobody has scored yet)");
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
