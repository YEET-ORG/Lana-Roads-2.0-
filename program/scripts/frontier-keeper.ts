/**
 * Frontier keeper.
 *
 * The world header lives in the ER for the whole day, so nothing on the base
 * layer can advance `revealed_rows` on its own and nothing in the ER can
 * create the accounts a new band of rows needs. This crank bridges the two
 * planes, in the only order that is safe:
 *
 *   1. ER→base: checkpoint the live record/frontier
 *   2. base: `request_chunk`   — request authenticated VRF for chunk N
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
 * game. It continuously fills ten complete chunks beyond the leader;
 * authenticated MagicBlock VRF fixes each immutable layout independently.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3, BN } from "@coral-xyz/anchor";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { ensureDayReady } from "./open-day";
import { ensureDaySettled } from "./settle-day";
import { loadCrossyWorldIdl } from "./runtime-config";
import {
  CHUNK_LOOKAHEAD_CHUNKS,
  CHUNK_ROWS,
  chunksNeededForLookahead,
} from "./frontier-policy";

const PROGRAM_ID = new web3.PublicKey("GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX");
const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
const ER_RPC = process.env.ER_RPC ?? "https://devnet-as.magicblock.app";
const VALIDATOR_OVERRIDE = process.env.VALIDATOR
  ? new web3.PublicKey(process.env.VALIDATOR)
  : null;
const VRF_BASE_QUEUE = new web3.PublicKey(
  process.env.VRF_BASE_QUEUE ?? "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
);
const POLL_MS = Number(process.env.POLL_MS ?? 3_000);
const SECTOR_EDGE = 8;
const MAX_CARRY_TILES = 8;
/** Set CRANK_HAZARDS=0 to leave collision resolution entirely to clients. */
const CRANK_HAZARDS = (process.env.CRANK_HAZARDS ?? "1") !== "0";
/** Set SETTLE=0 to leave day settlement (and the payout) to an operator. */
const SETTLE = (process.env.SETTLE ?? "1") !== "0";
/** Settlement is idempotent and slow-moving; once every few minutes is plenty. */
const SETTLE_EVERY_MS = Number(process.env.SETTLE_EVERY_MS ?? 5 * 60_000);
const HEALTH_PORT = Number(process.env.KEEPER_HEALTH_PORT ?? 8_787);

const health = {
  startedAt: Date.now(),
  lastActivityAt: Date.now(),
  lastSuccessfulCycleAt: 0,
  consecutiveFailedCycles: 0,
  lastError: null as string | null,
};

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
const le4 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
};
const pda = (...seeds: Buffer[]) =>
  web3.PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

const configPda = () => pda(S.config);
const worldPda = (mode: number, day: bigint) =>
  pda(S.world, Buffer.from([mode]), le8(day));
const chunkPda = (day: bigint, index: number) => pda(S.chunk, le8(day), le4(index));
const sectorPda = (world: web3.PublicKey, sx: number, sy: number) =>
  pda(S.sector, world.toBuffer(), Buffer.from([sx]), le4(sy));

const log = (...a: unknown[]) => {
  health.lastActivityAt = Date.now();
  console.log(new Date().toISOString().slice(11, 19), ...a);
};

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

function loadKeeper(): web3.Keypair {
  const inline = process.env.KEEPER_SECRET_JSON;
  if (inline) {
    return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(inline)));
  }
  const defaultPath = process.env.USERPROFILE
    ? `${process.env.USERPROFILE}/.config/solana/id.json`
    : `${process.env.HOME}/.config/solana/id.json`;
  return loadKeypair(process.env.KEEPER_KEYPAIR ?? defaultPath);
}

function startHealthServer() {
  if (!Number.isInteger(HEALTH_PORT) || HEALTH_PORT <= 0) return;
  const server = createServer((req, res) => {
    if (req.url !== "/healthz") {
      res.writeHead(404).end("not found");
      return;
    }
    const staleForMs = Date.now() - health.lastActivityAt;
    const healthy = health.consecutiveFailedCycles < 3 && staleForMs < 10 * 60_000;
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ healthy, staleForMs, ...health }));
  });
  server.listen(HEALTH_PORT, "0.0.0.0", () =>
    log(`health http://0.0.0.0:${HEALTH_PORT}/healthz`),
  );
}

function isFatalCompatibilityError(error: unknown): boolean {
  const message = String((error as any)?.message ?? error);
  return /Invalid bool|cannot decode|account discriminator|DeclaredProgramIdMismatch|IDL cannot decode|config\.admin|admin-only/i.test(
    message,
  );
}

async function main() {
  startHealthServer();
  const keeper = loadKeeper();
  const baseConn = new web3.Connection(BASE_RPC, "confirmed");
  const erConn = new web3.Connection(ER_RPC, "processed");
  const wallet = new anchor.Wallet(keeper);
  // Production workers run from a clean checkout where `target/` is ignored.
  // The SDK copy is tracked and is the same IDL consumed by the web client.
  const idl = loadCrossyWorldIdl(PROGRAM_ID.toBase58());
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
  const validator: web3.PublicKey = VALIDATOR_OVERRIDE ?? cfg.validator;
  log("keeper", keeper.publicKey.toBase58());
  log(
    "validator",
    validator.toBase58(),
    VALIDATOR_OVERRIDE ? "(override)" : "(on-chain)",
  );
  log("vrf_queue", VRF_BASE_QUEUE.toBase58());
  if (VALIDATOR_OVERRIDE && !cfg.validator.equals(VALIDATOR_OVERRIDE)) {
    throw new Error(
      `config.validator is ${cfg.validator.toBase58()} but keeper targets ` +
        VALIDATOR_OVERRIDE.toBase58(),
    );
  }

  // Modes are keyed by the world PDA discriminant: 0 = paid, 1 = casual.
  const modes = (process.env.MODES ?? "0,1").split(",").map(Number);

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
  /** Last settlement sweep; settlement is a pipeline, not a fast path. */
  let settleAt = 0;

  for (;;) {
    let failedModes = 0;
    for (const mode of modes) {
      try {
        await tick(mode);
      } catch (e: any) {
        failedModes++;
        const message = e?.message ?? String(e);
        health.lastError = `mode ${mode}: ${message}`;
        log(`mode ${mode} error:`, message);
        if (isFatalCompatibilityError(e)) throw e;
      }
    }
    if (failedModes === modes.length) health.consecutiveFailedCycles++;
    else {
      health.consecutiveFailedCycles = 0;
      health.lastSuccessfulCycleAt = Date.now();
      health.lastError = null;
    }
    await settleYesterday();
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
    } catch (error: any) {
      // `fetch` also throws when an account exists but this IDL cannot decode
      // it. Treating every exception as "not found" made the keeper attempt
      // day setup, swallow that failure, and look healthy forever.
      const raw = await erConn.getAccountInfo(world, "processed").catch(() => null);
      if (raw) {
        throw new Error(
          `world ${world.toBase58()} exists (${raw.data.length} bytes) but the current ` +
            `IDL cannot decode it: ${error?.message ?? error}`,
        );
      }
      // No world on the ER. At a UTC boundary that is simply the new day
      // arriving: the accounts for it do not exist until somebody makes
      // them, and until then the game looks like an outage to every client.
      // Build it here rather than waiting for an operator to notice.
      const attempted = await rollDay(mode, day);
      if (!attempted) throw new Error(`day setup for mode ${mode} is in retry backoff`);
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
    if (leader.score > live.recordScore && leader.best) {
      await erProgram.methods
        .claimRecord()
        .accountsPartial({ world, best: leader.best })
        .rpc({ skipPreflight: true, commitment: "processed" });
      live = await erProgram.account.worldHeader.fetch(world);
    }
    const needed = chunksNeededForLookahead(
      leader.score,
      Number(live.revealedRows),
      CHUNK_LOOKAHEAD_CHUNKS,
    );
    if (needed === 0) return;

    log(
      `mode ${mode} day ${day}: leader row ${leader.score}, revealed ` +
        `${live.revealedRows}; filling ${needed}/${CHUNK_LOOKAHEAD_CHUNKS} lookahead chunks`,
    );
    // request_chunk reads the committed cross-plane world on base. Seed the
    // bounded lookahead request window from this ER snapshot. Reveal the
    // whole immutable base-layer window first; account preparation and ER
    // frontier publication can then resume independently after any failure.
    await checkpointWorld(world, Number(live.recordScore), Number(live.mapSeq));
    const firstIndex = Number(live.nextChunkIndex);
    for (let pass = 0; pass < needed; pass++) {
      await publishChunk(day, world, firstIndex + pass);
    }
    for (let pass = 0; pass < needed; pass++) {
      const index = Number(live.nextChunkIndex);
      if (index !== firstIndex + pass) {
        throw new Error(
          `frontier advanced out of order: expected ${firstIndex + pass}, got ${index}`,
        );
      }
      log(`  lookahead ${pass + 1}/${needed}: chunk ${index}`);
      await ensureSectors(worldPda(0, day), index);
      await ensureSectors(worldPda(1, day), index);
      await ensureChunkDelegated(day, index);
      await markChunkReady(world, day, index);
      await extendFrontier(world, index);
      live = await erProgram.account.worldHeader.fetch(world);
      await checkpointWorld(world, Number(live.recordScore), Number(live.mapSeq));
      log(`mode ${mode}: frontier now ${live.revealedRows} rows`);
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
  async function rollDay(mode: number, day: bigint): Promise<boolean> {
    const key = `${mode}:${day}`;
    const last = dayRollAt.get(key) ?? 0;
    if (Date.now() - last < 60_000) return false;
    dayRollAt.set(key, Date.now());
    log(`mode ${mode} day ${day}: no world on the ER — bringing the day online`);
    try {
      const out = await ensureDayReady({
        baseProgram,
        erProgram,
        admin: keeper,
        validator,
        day,
        modes: [0, 1],
        log: (...a: any[]) => log(" ", ...a),
      });
      log(
        `mode ${mode} day ${day}: prepared=${out.prepared} sectors=${out.sectorsCreated} ` +
          `delegated=[${out.delegated.join(",")}] opened=${out.opened}` +
          (out.notes.length ? ` notes=${out.notes.join("; ")}` : ""),
      );
      return true;
    } catch (e: any) {
      log(`mode ${mode} day ${day}: day setup failed:`, e?.message ?? e);
      throw e;
    }
  }

  /**
   * Walk yesterday towards Settled.
   *
   * A finished day is not finished on its own: the vault keeps the entry
   * money, the worlds stay delegated, and nobody is paid until someone
   * cranks the pipeline. It is a sequence of confirmed base transactions,
   * so it runs on its own slow clock rather than in the frontier's hot
   * path, and it is deliberately quiet when there is nothing to do.
   */
  async function settleYesterday() {
    if (!SETTLE) return;
    if (Date.now() - settleAt < SETTLE_EVERY_MS) return;
    settleAt = Date.now();
    const day = BigInt(Math.floor(Date.now() / 1000 / 86400)) - 1n;
    try {
      const out = await ensureDaySettled({
        baseProgram,
        erProgram,
        admin: keeper,
        day,
        log: (...a: any[]) => log(" ", ...a),
      });
      if (out.did.length) {
        log(`settlement day ${day}: ${out.did.join("; ")} -> ${out.status}`);
        if (out.winner)
          log(`  winner ${out.winner} paid ${out.winnerAmount}, team ${out.teamAmount}`);
      }
      // Blockages are only worth saying when work was possible at all; a
      // day that is simply already settled says nothing.
      if (out.blocked.length && out.status !== "settled" && out.status !== "voided")
        log(`settlement day ${day} blocked: ${out.blocked.join("; ")}`);
    } catch (e: any) {
      log(`settlement day ${day} failed:`, e?.message ?? e);
    }
  }

  /** Furthest row any live run has reached, floored by the claimed record. */
  async function frontierLeader(world: web3.PublicKey, recordScore: number) {
    try {
      const bests = await erProgram.account.dailyBest.all([
        { memcmp: { offset: 8, bytes: world.toBase58() } },
      ]);
      let best = recordScore;
      let bestAccount: web3.PublicKey | null = null;
      for (const { publicKey, account } of bests as any[]) {
        if (account.bestScore > best) {
          best = account.bestScore;
          bestAccount = publicKey;
        }
      }
      return { score: best, best: bestAccount };
    } catch {
      return { score: recordScore, best: null };
    }
  }

  /** Commit the ER world and wait until the exact checkpoint is visible on base. */
  async function checkpointWorld(
    world: web3.PublicKey,
    recordScore: number,
    mapSeq: number,
  ) {
    await withRetry("commit world checkpoint", () =>
      erProgram.methods
        .commitState()
        .accountsPartial({ payer: keeper.publicKey })
        .remainingAccounts([{ pubkey: world, isSigner: false, isWritable: true }])
        .rpc({ commitment: "processed" }),
    );
    for (let attempt = 0; attempt < 20; attempt++) {
      const committed: any = await baseProgram.account.worldHeader.fetchNullable(world);
      if (
        committed &&
        Number(committed.recordScore) >= recordScore &&
        Number(committed.mapSeq) >= mapSeq
      )
        return;
      await sleep(500);
    }
    throw new Error(
      `world checkpoint did not reach base (record=${recordScore}, map=${mapSeq})`,
    );
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
    const requestedAt = existing ? Number(existing.requestedAt?.toString?.() ?? 0) : 0;
    const retryDue = !existing || Math.floor(Date.now() / 1000) >= requestedAt + 90;
    if (retryDue) {
      const sig = await withRetry(`request chunk ${index}`, () =>
        baseProgram.methods
          .requestChunk(new BN(day.toString()), index)
          .accountsPartial({
            config: configPda(),
            world,
            prevChunk: chunkPda(day, index - 1),
            chunk: addr,
            payer: keeper.publicKey,
            oracleQueue: VRF_BASE_QUEUE,
          })
          .rpc(),
      );
      log(`  requested VRF chunk ${index} (${sig.slice(0, 8)})`);
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      const current: any = await baseProgram.account.chunkDefinition
        .fetchNullable(addr)
        .catch(() => null);
      if (current && "revealed" in (current.status as object)) {
        log(`  VRF revealed chunk ${index}`);
        return;
      }
      await sleep(1_000);
    }
    throw new Error(`VRF callback for chunk ${index} was not observed within 30s`);
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
              .accountsPartial({
                config: configPda(),
                payer: keeper.publicKey,
                pda: sectorPda(world, sx, sy),
              })
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

  async function ensureChunkDelegated(day: bigint, index: number) {
    const chunk = chunkPda(day, index);
    const info = await withRetry(`read chunk owner ${index}`, () =>
      baseConn.getAccountInfo(chunk),
    );
    if (!info) throw new Error(`chunk ${index} disappeared before delegation`);
    if (info.owner.equals(PROGRAM_ID)) {
      await withRetry(`delegate chunk ${index}`, () =>
        baseProgram.methods
          .delegateChunk(new BN(day.toString()), index)
          .accountsPartial({ config: configPda(), payer: keeper.publicKey, pda: chunk })
          .rpc(),
      );
      log(`  delegated chunk ${index}`);
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      const erInfo = await erConn.getAccountInfo(chunk, "processed").catch(() => null);
      if (erInfo) return;
      await sleep(500);
    }
    throw new Error(`chunk ${index} was not available on the ER after delegation`);
  }

  async function markChunkReady(world: web3.PublicKey, day: bigint, index: number) {
    const firstSectorY = (index * CHUNK_ROWS) / SECTOR_EDGE;
    const sectors = Array.from({ length: CHUNK_ROWS / SECTOR_EDGE }, (_, band) =>
      Array.from({ length: 8 }, (_, sx) => ({
        pubkey: sectorPda(world, sx, firstSectorY + band),
        isSigner: false,
        isWritable: false,
      })),
    ).flat();
    const signature = await erProgram.methods
      .markChunkReady(index)
      .accountsPartial({
        world,
        chunk: chunkPda(day, index),
        signer: keeper.publicKey,
      })
      .remainingAccounts(sectors)
      .rpc({ skipPreflight: true, commitment: "processed" });
    log(`  chunk ${index} ready (${signature.slice(0, 8)})`);
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
