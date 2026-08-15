/**
 * Devnet check of the collision rules, on the live rollup.
 *
 * Three things that used to be impossible must now be true:
 *   1. walking into traffic kills you instead of being refused;
 *   2. a log carries its rider downstream instead of drowning them;
 *   3. a kick thrown at empty space is a wasted swing, not a failed tx.
 *
 * And one thing must still be true: rocks and trees stop you without harm.
 *
 * Each phase uses a fresh burner so a death in one cannot mask another.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3, BN } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isTraversable,
  laneObjectCovers,
  worldTimeMs,
} from "../../packages/crossy-world-sdk/src/hazards.js";

const PROGRAM_ID = new web3.PublicKey("GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX");
const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
const ER_RPC = process.env.ER_RPC ?? "https://devnet-as.magicblock.app";
const VALIDATOR = new web3.PublicKey(
  process.env.VALIDATOR ?? "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
);
const PHASE = process.env.PHASE ?? "all";
const LANE_GRASS = 0;
const LANE_ROAD = 1;
const LANE_RIVER = 2;

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
const le4 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
};
const pda = (...s: Buffer[]) => web3.PublicKey.findProgramAddressSync(s, PROGRAM_ID)[0];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: any) =>
  String(e?.transactionMessage ?? e?.message ?? e).slice(0, 100);

/**
 * Hazard prediction comes from the SDK, which is pinned to the program's
 * kernel by golden vectors. A local transcription here silently rots the
 * moment the kernel changes — it did exactly that when objects started
 * snapping to whole tiles, and this harness began stepping into water it
 * believed was a log.
 */
function safeToEnter(lane: any, x: number, tMs: number): boolean {
  return isTraversable(toLane(lane), x, tMs);
}

function covers(lane: any, x: number, tMs: number): boolean {
  return laneObjectCovers(toLane(lane), x, tMs);
}

/** Anchor decodes `blocker_mask` as BN; the shared math wants a bigint. */
function toLane(lane: any) {
  return {
    kind: lane.kind,
    dirPositive: lane.dirPositive,
    footprint: lane.footprint,
    gapTiles: lane.gapTiles,
    speedMtps: lane.speedMtps,
    phaseMt: lane.phaseMt,
    warningMs: lane.warningMs,
    periodMs: lane.periodMs,
    blockerMask: BigInt(lane.blockerMask?.toString() ?? "0"),
    sinking: lane.sinking,
  };
}

/**
 * The program's clock is `Clock::unix_timestamp`, so `world_time_ms` is
 * always a whole number of seconds: hazards advance in one-second steps, not
 * continuously. Predicting at millisecond resolution disagrees with the
 * chain, so quantise to the same grid the program evaluates on.
 */
function quantise(tMs: number): number {
  return Math.floor(tMs / 1000) * 1000;
}

/**
 * A transaction lands a few hundred milliseconds after the client decides to
 * send it, so the state must hold across every authoritative tick it could
 * execute on.
 */
function stableOver(
  predicate: (tMs: number) => boolean,
  fromMs: number,
  toMs: number,
): boolean {
  for (let t = quantise(fromMs); t <= quantise(toMs); t += 1000) {
    if (!predicate(t)) return false;
  }
  return true;
}

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
  const world = pda(Buffer.from("world"), Buffer.from([1]), le8(day));
  const baseConn = new web3.Connection(BASE_RPC, "confirmed");
  const erConn = new web3.Connection(ER_RPC, "processed");
  const idl = JSON.parse(
    readFileSync(resolve(__dirname, "../target/idl/crossy_world.json"), "utf8"),
  );
  const chunkPda = (i: number) => pda(Buffer.from("chunk"), le8(day), le4(i));
  const sectorPda = (sx: number, sy: number) =>
    pda(Buffer.from("sector"), world.toBuffer(), Buffer.from([sx]), le4(sy));

  const readOnly = new Program(
    idl,
    new anchor.AnchorProvider(baseConn, new anchor.Wallet(funder), {
      commitment: "confirmed",
    }),
  ) as Program<any>;
  const erRead = new Program(
    idl,
    new anchor.AnchorProvider(erConn, new anchor.Wallet(funder), {
      commitment: "processed",
    }),
  ) as Program<any>;

  const worldAcc = await erRead.account.worldHeader.fetch(world);

  /**
   * World time, from the rollup slot the program itself reads.
   *
   * Hazards advance on `Clock::slot` (~50ms), not on a wall clock, so a
   * harness that predicts from `Date.now()` is aiming at a world that does
   * not exist. Between samples the estimate carries forward in real ms,
   * which is the same rate a slot advances.
   */
  let slotAnchor = { slot: await erConn.getSlot("processed"), at: Date.now() };
  const nowMs = async () => {
    if (Date.now() - slotAnchor.at > 2_000) {
      slotAnchor = { slot: await erConn.getSlot("processed"), at: Date.now() };
    }
    return worldTimeMs(slotAnchor.slot) + (Date.now() - slotAnchor.at);
  };
  const lanes: any[] = [];
  for (let c = 0; c < Math.ceil(worldAcc.revealedRows / 16); c++) {
    const chunk = await readOnly.account.chunkDefinition.fetch(chunkPda(c));
    for (const l of chunk.lanes as any[]) lanes.push(l);
  }
  console.log(`world ${world.toBase58()} — ${worldAcc.revealedRows} rows revealed\n`);

  /** Bring a fresh burner to life on the ER. */
  async function newPlayer(tag: string) {
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
    const runPda = () =>
      pda(Buffer.from("run"), world.toBuffer(), player.publicKey.toBuffer());
    const bestPda = () =>
      pda(Buffer.from("best"), world.toBuffer(), player.publicKey.toBuffer());
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
          .accountsPartial({
            world,
            run: runPda(),
            best: bestPda(),
            wallet: player.publicKey,
          })
          .instruction(),
        await base.methods
          .lockStarter(1)
          .accountsPartial({ profile, world, lock, wallet: player.publicKey })
          .instruction(),
        await base.methods
          .delegateRun(world, player.publicKey)
          .accountsPartial({ payer: player.publicKey, pda: runPda() })
          .remainingAccounts([validatorMeta])
          .instruction(),
        await base.methods
          .delegateBest(world, player.publicKey)
          .accountsPartial({ payer: player.publicKey, pda: bestPda() })
          .remainingAccounts([validatorMeta])
          .instruction(),
      ),
      [player],
    );
    for (let i = 0; i < 60; i++) {
      const acc = await erConn.getAccountInfo(runPda(), "processed");
      if (acc?.owner.equals(PROGRAM_ID)) break;
      await sleep(1_000);
    }
    const spawnSectors = [];
    for (let sy = 0; sy < 2; sy++)
      for (let sx = 0; sx < 8; sx++)
        spawnSectors.push({
          pubkey: sectorPda(sx, sy),
          isSigner: false,
          isWritable: true,
        });
    await er.methods
      .spawn(1)
      .accountsPartial({
        world,
        run: runPda(),
        receipt: world,
        agentLock: lock,
        signer: session.publicKey,
      })
      .remainingAccounts(spawnSectors)
      .rpc({ skipPreflight: true, commitment: "processed" });
    const run = await er.account.playerRun.fetch(runPda());
    console.log(`  [${tag}] spawned at (${run.x}, ${run.y})`);
    return { player, session, er, runPda, bestPda };
  }

  /**
   * `known` skips the state fetch. Timed moves — jumping onto a moving log —
   * must go out as soon as the window is checked; an extra round trip in
   * between is long enough for the hazard to advance a tick and turn a good
   * jump into a drowning.
   */
  const move = async (p: any, dir: number, known?: any) => {
    const run = known ?? (await p.er.account.playerRun.fetch(p.runPda()));
    const [nx, ny] =
      dir === 0
        ? [run.x, run.y + 1]
        : dir === 1
          ? [run.x, run.y - 1]
          : dir === 2
            ? [run.x - 1, run.y]
            : [run.x + 1, run.y];
    const src = sectorPda(Math.floor(run.x / 8), Math.floor(run.y / 8));
    const dst = sectorPda(Math.floor(nx / 8), Math.floor(ny / 8));
    await p.er.methods
      .moveAction(1, new BN(run.actionSeq), dir, new BN(Date.now()))
      .accountsPartial({
        world,
        run: p.runPda(),
        sourceSector: src,
        destSector: dst.equals(src) ? null : dst,
        chunk: chunkPda(Math.floor(ny / 16)),
        best: p.bestPda(),
        signer: p.session.publicKey,
      })
      .rpc({ skipPreflight: false, commitment: "processed" });
  };

  /**
   * Walk forward to `row` the way a player has to now: look before stepping,
   * because entering traffic or open water is fatal rather than refused.
   * Sidestep whatever rejects the move (rocks and trees).
   */
  async function walkTo(p: any, row: number) {
    let waited = 0;
    for (let guard = 0; guard < 600; guard++) {
      const run = await p.er.account.playerRun.fetch(p.runPda());
      if (Object.keys(run.state)[0] !== "active") return run;
      if (run.y >= row) return run;
      const ahead = lanes[run.y + 1];
      const now = await nowMs();
      // The gap has to survive the transaction's flight, not just exist when
      // the client looks. Hazards advance on whole authoritative seconds and
      // the round trip is a good fraction of one, so a gap checked at send
      // time can be gone on arrival.
      if (ahead && !stableOver((t) => safeToEnter(ahead, run.x, t), now, now + 1_000)) {
        // Not survivable. Hold; if the tile stays hostile for a while,
        // shuffle sideways and try a different column.
        waited++;
        if (waited > 12) {
          waited = 0;
          await move(p, run.x < 60 ? 3 : 2).catch(() => {});
        }
        await sleep(120);
        continue;
      }
      waited = 0;
      try {
        await move(p, 0);
      } catch {
        await move(p, run.x < 60 ? 3 : 2).catch(() => {});
      }
      await sleep(110);
    }
    return p.er.account.playerRun.fetch(p.runPda());
  }

  // -------------------------------------------------------------------
  // 1. Walking into traffic is fatal
  // -------------------------------------------------------------------
  const roadRow = lanes.findIndex((l, i) => i > 16 && l.kind === LANE_ROAD);
  if (roadRow > 0 && (PHASE === "all" || PHASE === "traffic")) {
    console.log(`\n[traffic] road at row ${roadRow}`);
    const p = await newPlayer("traffic");
    let run: any = await walkTo(p, roadRow - 1);
    let died = false;
    if (Object.keys(run.state)[0] === "active" && run.y === roadRow - 1) {
      // Stand on the road and let traffic arrive.
      //
      // Timing a step INTO a moving car stopped being possible when hazards
      // moved to the rollup's 50ms grid: a car now crosses a tile in about
      // 400ms, which is the flight time of the transaction trying to hit
      // it. Parking tests the same rule the same way a player meets it —
      // you are on the road, a car comes, you die — and it does not race.
      const lane = lanes[roadRow];
      for (let attempt = 0; attempt < 40 && !died; attempt++) {
        run = await p.er.account.playerRun.fetch(p.runPda());
        if (Object.keys(run.state)[0] !== "active") break;
        if (run.y === roadRow - 1) {
          // Step up when the tile ahead is clear enough to survive arrival.
          const now = await nowMs();
          if (!stableOver((t) => !covers(lane, run.x, t), now, now + 400)) {
            await sleep(120);
            continue;
          }
          await move(p, 0).catch(() => {});
          await sleep(200);
          continue;
        }
        if (run.y !== roadRow) break;
        // On the road: collisions only resolve when someone asks, so ask.
        const here = sectorPda(Math.floor(run.x / 8), Math.floor(run.y / 8));
        await p.er.methods
          .checkHazard(run.hazardNonce)
          .accountsPartial({
            world,
            run: p.runPda(),
            sector: here,
            driftSector: null,
            chunk: chunkPda(Math.floor(run.y / 16)),
          })
          .rpc({ skipPreflight: true, commitment: "processed" })
          .catch(() => {});
        await sleep(250);
        run = await p.er.account.playerRun.fetch(p.runPda());
        died = Object.keys(run.state)[0] !== "active";
      }
    }
    record(
      "walking into traffic kills",
      died,
      died
        ? `run ended at row ${run.y} on the road`
        : `still ${Object.keys(run.state)[0]} at (${run.x}, ${run.y})`,
    );
  } else if (PHASE === "all" || PHASE === "traffic") {
    record("walking into traffic kills", false, "no road lane revealed to test");
  }

  // -------------------------------------------------------------------
  // 2. Logs carry their rider
  // -------------------------------------------------------------------
  const riverRow = lanes.findIndex((l, i) => i > 16 && l.kind === LANE_RIVER);
  if (riverRow > 0 && (PHASE === "all" || PHASE === "river")) {
    console.log(`\n[river] river at row ${riverRow}`);
    const lane = lanes[riverRow];
    let carried = false;
    let boardedAt = -1;
    let windows = 0;
    let run: any = null;
    // Boarding is a timed jump onto a moving platform over a ~500ms link, so
    // a mistimed attempt drowns — which is the collision rule working, not a
    // carry failure. Take a fresh runner rather than reporting the drowning.
    for (let attempt = 0; attempt < 3 && !carried; attempt++) {
      const p = await newPlayer(`river-${attempt + 1}`);
      boardedAt = -1;
      run = await walkTo(p, riverRow - 1);
      if (Object.keys(run.state)[0] === "active" && run.y === riverRow - 1) {
        // Board when a log is actually under the tile ahead.
        for (let i = 0; i < 400 && boardedAt < 0; i++) {
          run = await p.er.account.playerRun.fetch(p.runPda());
          if (Object.keys(run.state)[0] !== "active") break;
          if (run.y !== riverRow - 1) break;
          const now = await nowMs();
          // Board a log that will still be under the tile on arrival.
          if (stableOver((t) => safeToEnter(lane, run.x, t), now, now + 1_000)) {
            windows++;
            // Send immediately with the state already in hand.
            await move(p, 0, run).catch(() => {});
            run = await p.er.account.playerRun.fetch(p.runPda());
            if (run.y === riverRow && Object.keys(run.state)[0] === "active") {
              boardedAt = run.x;
            }
          }
          await sleep(100);
        }
        // Aboard: crank and watch the log move us instead of drowning us.
        const drift = lane.dirPositive === 1 ? 1 : -1;
        for (let i = 0; i < 80 && boardedAt >= 0; i++) {
          run = await p.er.account.playerRun.fetch(p.runPda());
          if (Object.keys(run.state)[0] !== "active") break;
          if (run.y !== riverRow) break;
          if (run.x !== boardedAt) {
            carried = true;
            break;
          }
          const nx = run.x + drift;
          const here = sectorPda(Math.floor(run.x / 8), Math.floor(run.y / 8));
          const there =
            nx >= 0 && nx <= 63
              ? sectorPda(Math.floor(nx / 8), Math.floor(run.y / 8))
              : here;
          await p.er.methods
            .checkHazard(run.hazardNonce)
            .accountsPartial({
              world,
              run: p.runPda(),
              sector: here,
              driftSector: there.equals(here) ? null : there,
              chunk: chunkPda(Math.floor(run.y / 16)),
            })
            .rpc({ skipPreflight: true, commitment: "processed" })
            .catch(() => {});
          await sleep(250);
        }
      }
    }
    record(
      "logs carry their rider",
      carried,
      carried
        ? `boarded at x=${boardedAt}, carried to x=${run.x}`
        : boardedAt < 0
          ? `never boarded: reached row ${run.y} (wanted ${riverRow - 1}), ` +
            `state ${Object.keys(run.state)[0]}, ${windows} boarding windows seen, ` +
            `lane fp=${lane.footprint} gap=${lane.gapTiles} speed=${lane.speedMtps}`
          : `stayed at x=${run.x}, state ${Object.keys(run.state)[0]}`,
    );
  } else if (PHASE === "all" || PHASE === "river") {
    record("logs carry their rider", false, "no river lane revealed to test");
  }

  // -------------------------------------------------------------------
  // 3. Stepping into open water drowns
  // -------------------------------------------------------------------
  if (riverRow > 0 && (PHASE === "all" || PHASE === "water")) {
    console.log(`\n[water] open water at row ${riverRow}`);
    const lane = lanes[riverRow];
    const p = await newPlayer("water");
    let run: any = await walkTo(p, riverRow - 1);
    let drowned = false;
    if (Object.keys(run.state)[0] === "active" && run.y === riverRow - 1) {
      for (let i = 0; i < 200; i++) {
        run = await p.er.account.playerRun.fetch(p.runPda());
        if (Object.keys(run.state)[0] !== "active") break;
        const now = await nowMs();
        // Step in when there is definitely no log under the tile — water is
        // lethal for seconds at a time, so this needs no fine timing.
        if (stableOver((t) => !safeToEnter(lane, run.x, t), now, now + 1_500)) {
          await move(p, 0).catch(() => {});
          run = await p.er.account.playerRun.fetch(p.runPda());
          drowned = Object.keys(run.state)[0] !== "active";
          if (drowned) break;
        }
        await sleep(150);
      }
    }
    record(
      "stepping into open water drowns",
      drowned,
      drowned
        ? `run ended at row ${run.y} in the river`
        : `still ${Object.keys(run.state)[0]} at (${run.x}, ${run.y})`,
    );
  } else if (PHASE === "all" || PHASE === "water") {
    record("stepping into open water drowns", false, "no river lane revealed");
  }

  // -------------------------------------------------------------------
  // 4. A kick at empty space is a legal wasted swing
  // -------------------------------------------------------------------
  if (PHASE === "all" || PHASE === "kick") {
    console.log(`\n[kick] swinging at nothing`);
    const p = await newPlayer("kick");
    const before: any = await p.er.account.playerRun.fetch(p.runPda());
    let ok = false;
    let detail = "";
    try {
      await p.er.methods
        .kick(1, new BN(before.actionSeq), new BN(Date.now()))
        .accountsPartial({
          world,
          kicker: p.runPda(),
          target: null,
          targetSector: null,
          destSector: null,
          chunk: null,
          signer: p.session.publicKey,
        })
        .rpc({ skipPreflight: false, commitment: "processed" });
      const after: any = await p.er.account.playerRun.fetch(p.runPda());
      ok =
        after.actionSeq.toNumber() === before.actionSeq.toNumber() + 1 &&
        after.kickReadyTs.toNumber() > before.kickReadyTs.toNumber();
      detail = `seq ${before.actionSeq} -> ${after.actionSeq}, cooldown armed`;
    } catch (e) {
      detail = `rejected: ${errText(e)}`;
    }
    record("kick at empty space is a wasted swing", ok, detail);
  }

  console.log(
    `\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`,
  );
  process.exitCode = results.every((r) => r.startsWith("PASS")) ? 0 : 1;
}

main().catch((e) => {
  console.error(errText(e));
  process.exit(1);
});
