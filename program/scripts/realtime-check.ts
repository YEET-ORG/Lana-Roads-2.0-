/**
 * Is multiplayer actually realtime?
 *
 * The client watches other players two ways: a websocket subscription that
 * should fire the moment a run changes, and a 5 s roster sweep that exists
 * only to heal gaps. If the subscription never delivers, everything still
 * works — remote players just move in 5 s jumps, which is exactly what
 * "multiplayer is not realtime" looks like and is invisible to any test that
 * only checks final positions.
 *
 * So measure it from a second connection, the way another player's browser
 * sees it: move a player, and record when each notification arrives.
 *
 *   npx tsx scripts/realtime-check.ts
 *   HOPS=8 npx tsx scripts/realtime-check.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3, BN } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROGRAM_ID = new web3.PublicKey("5FBMHsiUcRZ5RiKYWd6XhRGkA3FifP4nji9RKijLYuLx");
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
const HOPS = Number(process.env.HOPS ?? 6);
const GAP_MS = Number(process.env.GAP_MS ?? 900);

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

interface Hit {
  at: number;
  /**
   * `state_seq`, not position. A blocked destination is now ACCEPTED as a
   * turn in place: the run is rewritten, `action_seq` is consumed, and the
   * player does not move. Matching on y would score those as lost
   * notifications when they are the opposite — proof the feed is live.
   */
  seq: number;
}

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
  const baseConn = new web3.Connection(BASE_RPC, "confirmed");
  const erConn = new web3.Connection(ER_RPC, "processed");
  const idl = JSON.parse(
    readFileSync(resolve(__dirname, "../target/idl/crossy_world.json"), "utf8"),
  );
  const chunkPda = (i: number) => pda(Buffer.from("chunk"), Buffer.from([REGION]), le8(day), le4(i));
  const sectorPda = (sx: number, sy: number) =>
    pda(Buffer.from("sector"), world.toBuffer(), Buffer.from([sx]), le4(sy));

  const player = web3.Keypair.generate();
  const session = web3.Keypair.generate();
  console.log(`mover ${player.publicKey.toBase58()}`);
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
        .instruction(),
      await base.methods
        .delegateBest(world, player.publicKey)
        .accountsPartial({ worldAccount: world, payer: player.publicKey, pda: bestPda })
        .instruction(),
    ),
    [player],
  );
  for (let i = 0; i < 60; i++) {
    const acc = await erConn.getAccountInfo(runPda, "processed");
    if (acc?.owner.equals(PROGRAM_ID)) break;
    await sleep(1000);
  }

  // ---- the observer: a second connection, like another player's browser --
  const watchConn = new web3.Connection(ER_RPC, {
    wsEndpoint: ER_RPC.replace(/^http/, "ws"),
    commitment: "processed",
  });
  const programHits: Hit[] = [];
  const accountHits: Hit[] = [];
  const decodeSeq = (data: Buffer, key?: web3.PublicKey): number => {
    if (key && !key.equals(runPda)) return -1;
    try {
      const run = er.coder.accounts.decode("playerRun", data);
      if (!run.wallet.equals(player.publicKey)) return -1;
      return Number(run.stateSeq ?? run.actionSeq);
    } catch {
      return -1;
    }
  };

  // Exactly what the SDK's subscribeWorldRealtime does.
  const programSub = watchConn.onProgramAccountChange(
    PROGRAM_ID,
    (keyed) => {
      const seq = decodeSeq(Buffer.from(keyed.accountInfo.data), keyed.accountId);
      if (seq >= 0) programHits.push({ at: Date.now(), seq });
    },
    {
      commitment: "processed",
      filters: [{ memcmp: { offset: 8, bytes: world.toBase58() } }],
    },
  );
  // The control: a plain single-account subscription on the same socket.
  const accountSub = watchConn.onAccountChange(
    runPda,
    (info) => {
      const seq = decodeSeq(Buffer.from(info.data));
      if (seq >= 0) accountHits.push({ at: Date.now(), seq });
    },
    { commitment: "processed" },
  );
  // Let both subscriptions register before anything moves.
  await sleep(2500);

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

  let run: any = await er.account.playerRun.fetch(runPda);
  console.log(`spawned at (${run.x}, ${run.y})\n`);

  const sends: Hit[] = [];
  for (let i = 0; i < HOPS; i++) {
    run = await er.account.playerRun.fetch(runPda);
    const x = Number(run.x);
    const y = Number(run.y);
    const seq = Number(run.actionSeq);
    const src = sectorPda(Math.floor(x / 8), Math.floor(y / 8));
    const dst = sectorPda(Math.floor(x / 8), Math.floor((y + 1) / 8));
    const before = Number(run.stateSeq ?? run.actionSeq);
    const sentAt = Date.now();
    await er.methods
      .moveAction(1, new BN(seq), 0, new BN(Date.now() * 8))
      .accountsPartial({
        world,
        run: runPda,
        sourceSector: src,
        destSector: dst.equals(src) ? null : dst,
        chunk: chunkPda(Math.floor((y + 1) / 16)),
        best: bestPda,
        signer: session.publicKey,
      })
      .rpc({ skipPreflight: true, commitment: "processed" });
    sends.push({ at: sentAt, seq: before + 1 });
    console.log(`  hop ${i + 1}: sent from y ${y}, state_seq ${before} -> ${before + 1}`);
    await sleep(GAP_MS);
  }
  await sleep(2500);

  void programSub;
  void accountSub;

  // ---- report ----------------------------------------------------------
  const report = (label: string, hits: Hit[]) => {
    console.log(`\n${label}: ${hits.length} notification(s)`);
    if (!hits.length) {
      console.log("  NOTHING ARRIVED — this feed is not delivering.");
      return;
    }
    const latencies: number[] = [];
    for (const send of sends) {
      const hit = hits.find((h) => h.seq >= send.seq && h.at >= send.at);
      if (hit) latencies.push(hit.at - send.at);
    }
    if (!latencies.length) {
      console.log("  notifications arrived but none matched a hop.");
      return;
    }
    latencies.sort((a, b) => a - b);
    const median = latencies[Math.floor(latencies.length / 2)];
    console.log(
      `  matched ${latencies.length}/${sends.length} hops; ` +
        `median ${median} ms, worst ${latencies[latencies.length - 1]} ms`,
    );
  };

  report("programSubscribe (what remote players use)", programHits);
  report("accountSubscribe (control, same socket)", accountHits);

  console.log(
    "\nIf the control delivers and programSubscribe does not, the rollup does " +
      "not serve program-wide subscriptions and remote players can only move " +
      "as often as the roster sweep polls.",
  );
  await watchConn.removeProgramAccountChangeListener(programSub).catch(() => {});
  await watchConn.removeAccountChangeListener(accountSub).catch(() => {});
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
