/**
 * Frontier keeper.
 *
 * The world header lives in the ER for the whole day, so nothing on the base
 * layer can advance `revealed_rows` on its own and nothing in the ER can
 * create the accounts a new band of rows needs. This crank bridges the two
 * planes, in the only order that is safe:
 *
 *   1. base: `publish_chunk`   — authenticated layout for chunk N
 *   2. base: `init_sector` x16 — occupancy for the 16 rows it covers
 *   3. base: `delegate_sector` — hand those sectors to the ER
 *   4. ER:   `extend_frontier` — publish the new frontier to live players
 *
 * It also cranks hazards. Collisions are only resolved when somebody asks
 * the program to check, so without a server-side watcher a player parked on
 * a road never dies once the other clients look away, and a river rider
 * drowns if their own tab stalls. Clients still crank themselves — this is
 * the backstop, not the fast path.
 *
 * Sectors exist and are delegated *before* the frontier moves, so a player
 * can never reach a row whose accounts are missing. Run it alongside the
 * game; it keeps `LOOKAHEAD_CHUNKS` of revealed map ahead of the leader.
 *
 * Until MagicBlock VRF transport is wired, randomness is drawn locally by the
 * configured `vrf_authority`. The on-chain binding (day, chunk index,
 * continuity, layout validation, no-reroll) is enforced regardless.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3, BN } from "@coral-xyz/anchor";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDayReady } from "./open-day";

const PROGRAM_ID = new web3.PublicKey("GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX");
const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
const ER_RPC = process.env.ER_RPC ?? "https://devnet-as.magicblock.app";
const VALIDATOR = new web3.PublicKey(
  process.env.VALIDATOR ?? "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
);
/**
 * Keep this many chunks of revealed rows beyond the frontier leader.
 * Players cross a 16-row chunk in seconds, and a player who catches up to
 * the frontier is stopped dead by it, so the buffer is deliberately deep.
 */
const LOOKAHEAD_CHUNKS = Number(process.env.LOOKAHEAD_CHUNKS ?? 5);
/** Most chunks to publish in a single pass, so catching up cannot run away. */
const MAX_CHUNKS_PER_TICK = Number(process.env.MAX_CHUNKS_PER_TICK ?? 6);
const POLL_MS = Number(process.env.POLL_MS ?? 3_000);
const CHUNK_ROWS = 16;
const SECTOR_EDGE = 8;
const MAX_CARRY_TILES = 8;
/** Set CRANK_HAZARDS=0 to leave collision resolution entirely to clients. */
const CRANK_HAZARDS = (process.env.CRANK_HAZARDS ?? "1") !== "0";

const S = {
  config: Buffer.from("config"),
  world: Buffer.from("world"),
  chunk: Buffer.from("chunk"),
  sector: Buffer.from("sector"),
  run: Buffer.from("run"),
};
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
const pda = (...seeds: Buffer[]) =>
  web3.PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

const configPda = () => pda(S.config);
const worldPda = (mode: number, day: bigint) =>
  pda(S.world, Buffer.from([mode]), le8(day));
const chunkPda = (day: bigint, index: number) => pda(S.chunk, le8(day), le2(index));
const sectorPda = (world: web3.PublicKey, sx: number, sy: number) =>
  pda(S.sector, world.toBuffer(), Buffer.from([sx]), le2(sy));

const log = (...a: unknown[]) =>
  console.log(new Date().toISOString().slice(11, 19), ...a);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Public devnet RPC rate-limits aggressively and a half-finished band of
 * sectors would strand players at the frontier, so every base call retries
 * with backoff rather than aborting the tick.
 */
async function withRetry<T>(what: string, fn: () => Promise<T>, tries = 6): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = e?.transactionMessage ?? e?.message ?? String(e);
      // An account another crank already created is a success for our purposes.
      if (/already in use|custom program error: 0x0$/.test(msg)) throw e;
      const wait = Math.min(8_000, 600 * 2 ** i);
      log(`  retry ${what} in ${wait}ms (${String(msg).slice(0, 80)})`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// A keeper that dies takes the frontier with it, and public RPC throws from
// places the per-call retries cannot reach (websocket callbacks, library
// internals). Log and keep going rather than letting node exit.
process.on("unhandledRejection", (e: any) => {
  log("unhandled rejection:", String(e?.message ?? e).slice(0, 120));
});
process.on("uncaughtException", (e: any) => {
  log("uncaught exception:", String(e?.message ?? e).slice(0, 120));
});

function loadKeypair(path: string): web3.Keypair {
  return web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
  );
}

async function main() {
  const keeper = loadKeypair(
    process.env.KEEPER_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`,
  );
  const baseConn = new web3.Connection(BASE_RPC, "confirmed");
  const erConn = new web3.Connection(ER_RPC, "processed");
  const wallet = new anchor.Wallet(keeper);
  const idl = JSON.parse(
    readFileSync(resolve(__dirname, "../target/idl/crossy_world.json"), "utf8"),
  );
  const baseProgram = new Program(
    idl,
    new anchor.AnchorProvider(baseConn, wallet, {
      commitment: "confirmed",
    }),
  ) as Program<any>;
  const erProgram = new Program(
    idl,
    new anchor.AnchorProvider(erConn, wallet, {
      commitment: "processed",
    }),
  ) as Program<any>;

  const cfg = await baseProgram.account.globalConfig.fetch(configPda());
  log("keeper", keeper.publicKey.toBase58());
  log("vrf_authority", cfg.vrfAuthority.toBase58());
  if (!cfg.vrfAuthority.equals(keeper.publicKey)) {
    throw new Error(
      `config.vrf_authority is ${cfg.vrfAuthority.toBase58()} but the keeper is ` +
        `${keeper.publicKey.toBase58()}; rotate it with set_vrf_authority first`,
    );
  }

  // Modes are keyed by the world PDA discriminant: 0 = paid, 1 = casual.
  const modes = (process.env.MODES ?? "1").split(",").map(Number);

  /**
   * State the hoisted helpers below close over. It has to be initialised
   * BEFORE the loop: `function` declarations hoist but `const` does not, and
   * the loop never returns, so anything declared after it stays in the
   * temporal dead zone forever — the helper throws on first use instead.
   */
  /** Lane layouts per (day, chunk); chunks are immutable once revealed. */
  const laneCache = new Map<string, any[]>();
  /** Last day-setup attempt per (mode, day), to rate-limit the roll. */
  const dayRollAt = new Map<string, number>();

  for (;;) {
    for (const mode of modes) {
      try {
        await tick(mode);
      } catch (e: any) {
        log(`mode ${mode} error:`, e?.message ?? e);
      }
    }
    await sleep(POLL_MS);
  }

  /**
   * Ask the program to resolve collisions for everyone standing on moving
   * terrain. Stale nonces are rejected harmlessly, so over-asking is safe.
   */
  async function crankHazards(
    mode: number,
    world: web3.PublicKey,
    day: bigint,
    lanes: any[],
  ) {
    let runs: any[];
    try {
      runs = await erProgram.account.playerRun.all([
        { memcmp: { offset: 8, bytes: world.toBase58() } },
      ]);
    } catch {
      return;
    }
    const exposed = runs.filter(({ account }: any) => {
      if (Object.keys(account.state)[0] !== "active") return false;
      const lane = lanes[account.y];
      return lane != null && lane.kind !== 0;
    });
    if (!exposed.length) return;

    let resolved = 0;
    await Promise.all(
      exposed.map(async ({ account }: any) => {
        const lane = lanes[account.y];
        const drift = lane.kind === 2 ? (lane.dirPositive === 1 ? 1 : -1) : 0;
        const driftX = Math.max(0, Math.min(63, account.x + drift * MAX_CARRY_TILES));
        const here = sectorPda(
          world,
          Math.floor(account.x / 8),
          Math.floor(account.y / 8),
        );
        const there = sectorPda(world, Math.floor(driftX / 8), Math.floor(account.y / 8));
        try {
          await erProgram.methods
            .checkHazard(account.hazardNonce)
            .accountsPartial({
              world,
              run: pda(
                S.run,
                world.toBuffer(),
                (account.wallet as web3.PublicKey).toBuffer(),
              ),
              sector: here,
              driftSector: there.equals(here) ? null : there,
              chunk: chunkPda(day, Math.floor(account.y / CHUNK_ROWS)),
            })
            .rpc({ skipPreflight: true, commitment: "processed" });
          resolved++;
        } catch {
          /* stale nonce, already resolved, or the run moved on */
        }
      }),
    );
    if (resolved) log(`mode ${mode}: cranked ${resolved}/${exposed.length} exposed runs`);
  }

  /** Revealed lanes for a day, cached — chunks never change once revealed. */
  async function revealedLanes(day: bigint, chunks: number) {
    const key = `${day}:${chunks}`;
    const hit = laneCache.get(key);
    if (hit) return hit;
    const lanes: any[] = [];
    for (let c = 0; c < chunks; c++) {
      const chunk = await withRetry(`read chunk ${c}`, () =>
        baseProgram.account.chunkDefinition.fetch(chunkPda(day, c)),
      );
      for (const l of chunk.lanes as any[]) lanes.push(l);
    }
    laneCache.set(key, lanes);
    return lanes;
  }

  async function tick(mode: number) {
    const day = BigInt(Math.floor(Date.now() / 1000 / 86400));
    const world = worldPda(mode, day);
    // The live header is the ER copy; the base copy lags until a commit.
    let live: any;
    try {
      live = await erProgram.account.worldHeader.fetch(world);
    } catch {
      // No world on the ER. At a UTC boundary that is simply the new day
      // arriving: the accounts for it do not exist until somebody makes
      // them, and until then the game looks like an outage to every client.
      // Build it here rather than waiting for an operator to notice.
      await rollDay(mode, day);
      return;
    }
    // `world.record_score` only moves when someone calls claim_record, which
    // is deliberately decoupled from movement — so it is not a reliable
    // picture of where players actually are. Ask the live runs directly.
    if (CRANK_HAZARDS) {
      const lanes = await revealedLanes(day, Math.ceil(live.revealedRows / CHUNK_ROWS));
      await crankHazards(mode, world, day, lanes).catch(() => {});
    }

    const leader = await frontierLeader(world, live.recordScore);
    const target = (Math.floor(leader / CHUNK_ROWS) + LOOKAHEAD_CHUNKS) * CHUNK_ROWS;
    if (live.revealedRows >= target) return;

    // Catch the whole gap up in one pass. Publishing a single chunk per poll
    // loses ground against a fast player, and against a cold start it would
    // take a minute to build the buffer at all.
    let revealed: number = live.revealedRows;
    let index: number = live.nextChunkIndex;
    log(
      `mode ${mode} day ${day}: leader row ${leader}, revealed ${revealed} ` +
        `-> building out to ${target}`,
    );
    for (let n = 0; n < MAX_CHUNKS_PER_TICK && revealed < target; n++) {
      await publishChunk(day, world, index);
      await ensureSectors(world, index);
      await extendFrontier(world, index);
      revealed = (index + 1) * CHUNK_ROWS;
      index += 1;
      log(`mode ${mode}: frontier now ${revealed} rows`);
    }
  }

  /**
   * Create and delegate a day's world when it is missing.
   *
   * Rate-limited per (mode, day): day setup is a burst of writes on a public
   * RPC that throttles, and a keeper polling every few seconds would retry
   * the burst forever if the cluster were merely busy. One attempt a minute
   * is fast enough for a boundary nobody is watching.
   */
  async function rollDay(mode: number, day: bigint) {
    const key = `${mode}:${day}`;
    const last = dayRollAt.get(key) ?? 0;
    if (Date.now() - last < 60_000) return;
    dayRollAt.set(key, Date.now());
    log(`mode ${mode} day ${day}: no world on the ER — bringing the day online`);
    try {
      const out = await ensureDayReady({
        baseProgram,
        admin: keeper,
        validator: VALIDATOR,
        day,
        modes: [mode],
        log: (...a: any[]) => log(" ", ...a),
      });
      log(
        `mode ${mode} day ${day}: prepared=${out.prepared} sectors=${out.sectorsCreated} ` +
          `delegated=[${out.delegated.join(",")}] opened=${out.opened}` +
          (out.notes.length ? ` notes=${out.notes.join("; ")}` : ""),
      );
    } catch (e: any) {
      log(`mode ${mode} day ${day}: day setup failed:`, e?.message ?? e);
    }
  }

  /** Furthest row any live run has reached, floored by the claimed record. */
  async function frontierLeader(world: web3.PublicKey, recordScore: number) {
    try {
      const runs = await erProgram.account.playerRun.all([
        { memcmp: { offset: 8, bytes: world.toBase58() } },
      ]);
      let best = recordScore;
      for (const { account } of runs as any[]) {
        if (Object.keys(account.state)[0] !== "active") continue;
        best = Math.max(best, account.y, account.score);
      }
      return best;
    } catch {
      return recordScore;
    }
  }

  async function publishChunk(day: bigint, world: web3.PublicKey, index: number) {
    const addr = chunkPda(day, index);
    const existing = await withRetry(`read chunk ${index}`, () =>
      baseProgram.account.chunkDefinition.fetchNullable(addr),
    ).catch(() => null);
    if (existing && "revealed" in (existing.status as object)) {
      log(`  chunk ${index} already revealed`);
      return;
    }
    const randomness = Array.from(randomBytes(32));
    const sig = await withRetry(`publish chunk ${index}`, () =>
      baseProgram.methods
        .publishChunk(new BN(day.toString()), index, randomness)
        .accountsPartial({
          config: configPda(),
          world,
          prevChunk: chunkPda(day, index - 1),
          chunk: addr,
          vrfAuthority: keeper.publicKey,
        })
        .rpc(),
    );
    log(`  published chunk ${index} (${sig.slice(0, 8)})`);
  }

  /** Create + delegate every sector covering the chunk's rows. */
  async function ensureSectors(world: web3.PublicKey, index: number) {
    const day = BigInt(Math.floor(Date.now() / 1000 / 86400));
    const firstSectorY = (index * CHUNK_ROWS) / SECTOR_EDGE;
    const bands = CHUNK_ROWS / SECTOR_EDGE;
    const chunk = chunkPda(day, index);

    for (let b = 0; b < bands; b++) {
      const sy = firstSectorY + b;
      const addrs = Array.from({ length: 8 }, (_, sx) => sectorPda(world, sx, sy));
      // One RPC call for the whole band rather than eight.
      const infos = await withRetry(`scan y=${sy}`, () =>
        baseConn.getMultipleAccountsInfo(addrs),
      );

      const missing = addrs.map((_, sx) => sx).filter((sx) => !infos[sx]);
      for (let i = 0; i < missing.length; i += 4) {
        const batch = missing.slice(i, i + 4);
        const tx = new web3.Transaction();
        for (const sx of batch) {
          tx.add(
            await baseProgram.methods
              .initSector(sx, sy)
              .accountsPartial({
                world,
                chunk,
                sector: sectorPda(world, sx, sy),
                payer: keeper.publicKey,
              })
              .instruction(),
          );
        }
        await withRetry(`init sectors y=${sy} x=[${batch.join(",")}]`, () =>
          baseProgram.provider.sendAndConfirm!(tx),
        );
      }
      if (missing.length) log(`  created sectors y=${sy} x=[${missing.join(",")}]`);

      // Delegate any sector still owned by the program. Re-scan, because the
      // creations above changed what is on chain.
      const after = await withRetry(`rescan y=${sy}`, () =>
        baseConn.getMultipleAccountsInfo(addrs),
      );
      const toDelegate = addrs
        .map((_, sx) => sx)
        .filter((sx) => after[sx] && after[sx]!.owner.equals(PROGRAM_ID));
      // Two delegation CPIs per transaction keeps the call count down while
      // staying well inside the compute budget.
      for (let i = 0; i < toDelegate.length; i += 2) {
        const batch = toDelegate.slice(i, i + 2);
        const tx = new web3.Transaction();
        for (const sx of batch) {
          tx.add(
            await baseProgram.methods
              .delegateSector(world, sx, sy)
              .accountsPartial({ payer: keeper.publicKey, pda: sectorPda(world, sx, sy) })
              .remainingAccounts([
                { pubkey: VALIDATOR, isSigner: false, isWritable: false },
              ])
              .instruction(),
          );
        }
        await withRetry(`delegate y=${sy} x=[${batch.join(",")}]`, () =>
          baseProgram.provider.sendAndConfirm!(tx),
        );
      }
      if (toDelegate.length)
        log(`  delegated sectors y=${sy} x=[${toDelegate.join(",")}]`);
    }
  }

  async function extendFrontier(world: web3.PublicKey, index: number) {
    const day = BigInt(Math.floor(Date.now() / 1000 / 86400));
    // The ER must be able to read the freshly created base chunk account.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const sig = await erProgram.methods
          .extendFrontier()
          .accountsPartial({
            world,
            chunk: chunkPda(day, index),
            signer: keeper.publicKey,
          })
          .rpc({ skipPreflight: true, commitment: "processed" });
        log(`  extended frontier (${sig.slice(0, 8)})`);
        return;
      } catch (e: any) {
        const msg = e?.transactionMessage ?? e?.message ?? String(e);
        if (attempt === 9) throw new Error(`extend_frontier failed: ${msg}`);
        await sleep(1_000);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
