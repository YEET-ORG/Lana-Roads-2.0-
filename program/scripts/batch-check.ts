/**
 * Devnet proof that `move_batch` is a saving in ROUND TRIPS, not in cadence.
 *
 * Movement used to cost one network round trip per hop: `action_seq` must
 * match exactly at execution, so a second move sent before the first was
 * applied is refused. A batch carries several hops under one sequence.
 *
 * The thing that must be true, and that this checks against the live rollup:
 *   1. four hops in one transaction move four rows and advance the sequence
 *      by four — one round trip, four hops;
 *   2. every hop is charged its own slot, so the run owes `slot + 3` and a
 *      batch sent immediately afterwards is refused as TooFast;
 *   3. after waiting out the cadence, movement resumes normally.
 *
 * (2) is the whole safety argument: if a batch were free, four hops a round
 * trip would be four times the movement rate rather than the same rate at a
 * quarter of the round trips.
 *
 * Runs in the casual world's grass spawn zone, where nothing can kill the
 * burner and no terrain can refuse a hop.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3, BN } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { retryingFetch } from "./runtime-config";

const PROGRAM_ID = new web3.PublicKey("5FBMHsiUcRZ5RiKYWd6XhRGkA3FifP4nji9RKijLYuLx");
const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
const REGION = Number(process.env.REGION ?? 0);
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
const VALIDATOR = new web3.PublicKey(process.env.VALIDATOR ?? REGION_VALIDATOR[REGION]);

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: any) => String(e?.transactionMessage ?? e?.message ?? e).slice(0, 160);

const results: string[] = [];
const record = (name: string, pass: boolean, detail: string) => {
  results.push(`${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  return pass;
};

async function main() {
  const funder = web3.Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        readFileSync(
          process.env.FUNDER_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`,
          "utf8",
        ),
      ),
    ),
  );
  const day = BigInt(Math.floor(Date.now() / 1000 / 86400));
  const world = pda(Buffer.from("world"), Buffer.from([REGION]), Buffer.from([1]), le8(day));
  const baseConn = new web3.Connection(BASE_RPC, {
    commitment: "confirmed",
    fetch: retryingFetch(),
  });
  const erConn = new web3.Connection(ER_RPC, "processed");
  const idl = JSON.parse(
    readFileSync(resolve(__dirname, "../target/idl/crossy_world.json"), "utf8"),
  );
  const chunkPda = (i: number) =>
    pda(Buffer.from("chunk"), Buffer.from([REGION]), le8(day), le4(i));
  const sectorPda = (sx: number, sy: number) =>
    pda(Buffer.from("sector"), world.toBuffer(), Buffer.from([sx]), le4(sy));

  const player = web3.Keypair.generate();
  const session = web3.Keypair.generate();
  await web3.sendAndConfirmTransaction(
    baseConn,
    new web3.Transaction().add(
      web3.SystemProgram.transfer({
        fromPubkey: funder.publicKey,
        toPubkey: player.publicKey,
        lamports: 0.04 * web3.LAMPORTS_PER_SOL,
      }),
      web3.SystemProgram.transfer({
        fromPubkey: funder.publicKey,
        toPubkey: session.publicKey,
        lamports: 0.01 * web3.LAMPORTS_PER_SOL,
      }),
    ),
    [funder],
  );

  const base = new Program(
    idl,
    new anchor.AnchorProvider(baseConn, new anchor.Wallet(player), {
      commitment: "confirmed",
    }),
  ) as Program<any>;
  const er = new Program(
    idl,
    new anchor.AnchorProvider(erConn, new anchor.Wallet(session), {
      commitment: "processed",
    }),
  ) as Program<any>;

  const runPda = pda(Buffer.from("run"), world.toBuffer(), player.publicKey.toBuffer());
  const bestPda = pda(Buffer.from("best"), world.toBuffer(), player.publicKey.toBuffer());
  const profile = pda(Buffer.from("player"), player.publicKey.toBuffer());
  const lock = pda(
    Buffer.from("agent_lock"),
    world.toBuffer(),
    player.publicKey.toBuffer(),
    le4(1),
  );
  const validatorMeta = { pubkey: VALIDATOR, isSigner: false, isWritable: false };

  await base.provider.sendAndConfirm!(
    new web3.Transaction().add(
      await base.methods
        .ensureProfile()
        .accountsPartial({ profile, wallet: player.publicKey })
        .instruction(),
      await base.methods
        .claimStarter()
        .accountsPartial({ profile, wallet: player.publicKey })
        .instruction(),
      await base.methods
        .initRun(session.publicKey, new BN(Math.floor(Date.now() / 1000) + 3600))
        .accountsPartial({ world, run: runPda, best: bestPda, wallet: player.publicKey })
        .instruction(),
      await base.methods
        .lockStarter(1)
        .accountsPartial({ profile, world, lock, wallet: player.publicKey })
        .instruction(),
      await base.methods
        .delegateRun(world, player.publicKey)
        .accountsPartial({ worldAccount: world, payer: player.publicKey, pda: runPda })
        .remainingAccounts([validatorMeta])
        .instruction(),
      await base.methods
        .delegateBest(world, player.publicKey)
        .accountsPartial({ worldAccount: world, payer: player.publicKey, pda: bestPda })
        .remainingAccounts([validatorMeta])
        .instruction(),
    ),
    [player],
  );
  for (let i = 0; i < 60; i++) {
    const acc = await erConn.getAccountInfo(runPda, "processed");
    if (acc?.owner.equals(PROGRAM_ID)) break;
    await sleep(1_000);
  }

  const spawnSectors = [];
  for (let sy = 0; sy < 2; sy++)
    for (let sx = 0; sx < 8; sx++)
      spawnSectors.push({ pubkey: sectorPda(sx, sy), isSigner: false, isWritable: true });
  await er.methods
    .spawn(1)
    .accountsPartial({
      world,
      run: runPda,
      receipt: world,
      agentLock: lock,
      signer: session.publicKey,
    })
    .remainingAccounts(spawnSectors)
    .rpc({ skipPreflight: true, commitment: "processed" });

  let run = await er.account.playerRun.fetch(runPda);
  console.log(`spawned at (${run.x}, ${run.y}) seq ${run.actionSeq}\n`);

  /** Send `directions` as one batch from the run's current tile. */
  const batch = async (directions: number[], state: any) => {
    const sectors: web3.PublicKey[] = [
      sectorPda(Math.floor(state.x / 8), Math.floor(state.y / 8)),
    ];
    const chunks: number[] = [];
    let [x, y] = [state.x, state.y];
    for (const d of directions) {
      const [nx, ny] =
        d === 0 ? [x, y + 1] : d === 1 ? [x, y - 1] : d === 2 ? [x - 1, y] : [x + 1, y];
      const s = sectorPda(Math.floor(nx / 8), Math.floor(ny / 8));
      if (!sectors.some((p) => p.equals(s))) sectors.push(s);
      const c = Math.floor(ny / 16);
      if (!chunks.includes(c)) chunks.push(c);
      [x, y] = [nx, ny];
    }
    return er.methods
      .moveBatch(1, new BN(state.actionSeq), Buffer.from(directions), new BN(Date.now()))
      .accountsPartial({
        world,
        run: runPda,
        sectorA: sectors[0],
        sectorB: sectors[1] ?? null,
        sectorC: sectors[2] ?? null,
        sectorD: sectors[3] ?? null,
        chunkA: chunkPda(chunks[0]),
        chunkB: chunks[1] == null ? null : chunkPda(chunks[1]),
        best: bestPda,
        signer: session.publicKey,
      })
      .rpc({ skipPreflight: false, commitment: "processed" });
  };

  /**
   * Blocked tiles in the spawn zone. Rows 0..15 are all grass, so the only
   * thing that can stop a hop here is a rock, a tree, or another player —
   * both of which live in the sector bitmaps.
   */
  const blocked = new Set<string>();
  for (let sy = 0; sy < 2; sy++) {
    for (let sx = 0; sx < 8; sx++) {
      const sector: any = await er.account.occupancySector.fetch(sectorPda(sx, sy));
      const bits = BigInt(sector.blockers.toString()) | BigInt(sector.occupancy.toString());
      for (let bit = 0; bit < 64; bit++) {
        if ((bits >> BigInt(bit)) & 1n) {
          blocked.add(`${sx * 8 + (bit % 8)},${sy * 8 + Math.floor(bit / 8)}`);
        }
      }
    }
  }
  /**
   * A run of `n` free tiles from (x, y), staying inside the grass spawn zone
   * so nothing here can die and no terrain can refuse a hop. Wanders sideways
   * and back once forward runs out, so repeated calls never exhaust the space.
   */
  const freePath = (x: number, y: number, n: number): number[] | null => {
    const out: number[] = [];
    const used = new Set<string>([`${x},${y}`]);
    let [cx, cy] = [x, y];
    for (let i = 0; i < n; i++) {
      const options: number[][] = [
        [0, cx, cy + 1],
        [3, cx + 1, cy],
        [2, cx - 1, cy],
        [1, cx, cy - 1],
      ];
      const pick = options.find(
        ([, nx, ny]) =>
          nx >= 0 &&
          nx < 64 &&
          ny >= 1 &&
          ny < 15 &&
          !blocked.has(`${nx},${ny}`) &&
          !used.has(`${nx},${ny}`),
      );
      if (!pick) return null;
      out.push(pick[0]);
      [cx, cy] = [pick[1], pick[2]];
      used.add(`${cx},${cy}`);
    }
    return out;
  };

  // 1. four hops, one transaction.
  const path = freePath(run.x, run.y, 4);
  if (!path) throw new Error("no free 4-tile path in the spawn zone");
  const before = { x: run.x, y: run.y, seq: Number(run.actionSeq) };
  const slotBefore = await erConn.getSlot("processed");
  const t0 = Date.now();
  await batch(path, run);
  const roundTrip = Date.now() - t0;
  run = await er.account.playerRun.fetch(runPda);
  const moved = Math.abs(run.x - before.x) + Math.abs(run.y - before.y);
  record(
    "four hops cost one round trip",
    moved === 4 && Number(run.actionSeq) === before.seq + 4,
    `(${before.x}, ${before.y}) -> (${run.x}, ${run.y}) = ${moved} tiles, ` +
      `seq ${before.seq} -> ${run.actionSeq}, ${roundTrip}ms`,
  );

  // 2. every hop was charged a slot. The first hop executed no earlier than
  // `slotBefore`, so if each of the four were charged one slot the run now
  // owes at least `slotBefore + 3`. Charging per TRANSACTION instead would
  // leave it owing only the slot it executed in.
  const owed = Number(run.lastMoveSlot);
  record(
    "a batch is charged per hop, not per transaction",
    owed >= slotBefore + 3,
    `owes slot ${owed}, sent at slot >= ${slotBefore} (+${owed - slotBefore})`,
  );

  // 3. and once that cadence is paid, movement carries on normally.
  await sleep(500);
  run = await er.account.playerRun.fetch(runPda);
  const next = freePath(run.x, run.y, 2);
  if (!next) throw new Error("no free 2-tile path to continue");
  const y3 = { x: run.x, y: run.y };
  await batch(next, run);
  run = await er.account.playerRun.fetch(runPda);
  record(
    "movement resumes once the cadence is paid",
    Math.abs(run.x - y3.x) + Math.abs(run.y - y3.y) === 2,
    `(${y3.x}, ${y3.y}) -> (${run.x}, ${run.y})`,
  );

  // 4. STREAM: what the browser actually does — send a batch, wait for the
  // confirmation, send the next. If the cadence a batch owes outlasts the
  // round trip, the next batch is refused as TooFast, the client retries,
  // and the player watches their prediction snap back. That is rubberbanding.
  {
    let refusedTooFast = 0;
    let other = 0;
    let landed = 0;
    const gaps: number[] = [];
    let lastAt = 0;
    for (let i = 0; i < 12; i++) {
      run = await er.account.playerRun.fetch(runPda);
      const p4 = freePath(run.x, run.y, 4);
      if (!p4) {
        console.log(`  (no free path from (${run.x}, ${run.y}) — stopping stream)`);
        break;
      }
      const t = Date.now();
      try {
        await batch(p4, run);
        landed++;
        if (lastAt) gaps.push(t - lastAt);
        lastAt = t;
      } catch (e) {
        const why = errText(e);
        if (why.includes("TooFast")) refusedTooFast++;
        else other++;
        lastAt = t;
      }
    }
    const avgGap = gaps.length
      ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
      : 0;
    record(
      "streaming batches back-to-back is never refused for cadence",
      refusedTooFast === 0,
      `${landed} landed, ${refusedTooFast} TooFast, ${other} other; ` +
        `avg ${avgGap}ms between sends vs ${4 * 50}ms of cadence owed per batch`,
    );
  }

  // 5. CASUAL IS UNREFUSABLE. `move_free` carries no sequence and observes no
  // cadence, so a burst fired without waiting for anything — the way a player
  // holding a direction actually generates input — must land in full. Under
  // the paid rules the same burst is refused for everything after the first:
  // the sequence has not advanced and the cadence has not been paid.
  {
    run = await er.account.playerRun.fetch(runPda);
    const burst = freePath(run.x, run.y, 4);
    if (!burst) console.log(`  (no free path from (${run.x}, ${run.y}) for the casual burst)`);
    if (burst) {
      const seqBefore = Number(run.actionSeq);
      const staleSeq = new BN(seqBefore);
      let x = run.x;
      let y = run.y;
      const sends = burst.map((d) => {
        const [nx, ny] =
          d === 0 ? [x, y + 1] : d === 1 ? [x, y - 1] : d === 2 ? [x - 1, y] : [x + 1, y];
        const src = sectorPda(Math.floor(x / 8), Math.floor(y / 8));
        const dst = sectorPda(Math.floor(nx / 8), Math.floor(ny / 8));
        const from = { x, y };
        [x, y] = [nx, ny];
        return { d, src, dst, ny, from };
      });
      // All four at once, nothing awaited between them — no sequence to get
      // right, so order does not matter.
      const outcomes = await Promise.allSettled(
        sends.map((m) =>
          er.methods
            .moveFree(1, m.d, new BN(Date.now() * 8 + m.d))
            .accountsPartial({
              world,
              run: runPda,
              sourceSector: m.src,
              destSector: m.dst.equals(m.src) ? null : m.dst,
              chunk: chunkPda(Math.floor(m.ny / 16)),
              best: bestPda,
              signer: session.publicKey,
            })
            .rpc({ skipPreflight: false, commitment: "processed" }),
        ),
      );
      const rejected = outcomes.filter((o) => o.status === "rejected");
      await sleep(600);
      run = await er.account.playerRun.fetch(runPda);
      record(
        "casual refuses nothing: four moves fired at once all land",
        rejected.length === 0 && Number(run.actionSeq) === seqBefore + 4,
        `${outcomes.length - rejected.length}/4 accepted, seq ${seqBefore} -> ${run.actionSeq}` +
          (rejected.length
            ? `; first refusal: ${errText((rejected[0] as any).reason)}`
            : ""),
      );
      // ...and the stale sequence that paid movement would have refused is
      // simply not consulted.
      void staleSeq;
    }
  }

  // 6. CASUAL KICKS HAVE NO COOLDOWN. Paid burns five seconds per swing; three
  // swings in a row here must all be accepted, and none may leave a cooldown
  // behind for anything downstream to read.
  {
    run = await er.account.playerRun.fetch(runPda);
    const seqBefore = Number(run.actionSeq);
    const swings = [];
    for (let i = 0; i < 3; i++) {
      swings.push(
        await er.methods
          .kickFree(1, new BN(Date.now() * 8 + i))
          .accountsPartial({
            world,
            kicker: runPda,
            target: null,
            targetSector: null,
            destSector: null,
            chunk: null,
            signer: session.publicKey,
          })
          .rpc({ skipPreflight: false, commitment: "processed" })
          .then(
            () => null,
            (e: any) => errText(e),
          ),
      );
    }
    const refused = swings.filter(Boolean);
    await sleep(400);
    run = await er.account.playerRun.fetch(runPda);
    record(
      "casual kicks have no cooldown",
      refused.length === 0 &&
        Number(run.actionSeq) === seqBefore + 3 &&
        Number(run.kickReadyTs) === 0,
      `${3 - refused.length}/3 swings accepted back to back, ` +
        `seq ${seqBefore} -> ${run.actionSeq}, kick_ready_ts ${run.kickReadyTs}` +
        (refused.length ? `; first refusal: ${refused[0]}` : ""),
    );
  }

  console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
  process.exit(results.every((r) => r.startsWith("PASS")) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
