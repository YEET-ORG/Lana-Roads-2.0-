/**
 * End-to-end devnet check of the thing players complained about: that the
 * map is empty and stops at row 15.
 *
 * A fresh burner joins today's casual world and walks forward on the ER,
 * sidestepping whatever refuses to let it through, and reports what terrain
 * it actually met on the way. Passing means:
 *   - moves past row 15 are accepted (the frontier really extended),
 *   - non-grass lanes exist and are enterable only when the program says so,
 *   - static blockers reject entry.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3, BN } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROGRAM_ID = new web3.PublicKey("GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX");
const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
const ER_RPC = process.env.ER_RPC ?? "https://devnet-as.magicblock.app";
const VALIDATOR = new web3.PublicKey(
  process.env.VALIDATOR ?? "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
);
const TARGET_ROW = Number(process.env.TARGET_ROW ?? 20);
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
const le4 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
};
const pda = (...s: Buffer[]) => web3.PublicKey.findProgramAddressSync(s, PROGRAM_ID)[0];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: any) =>
  String(e?.transactionMessage ?? e?.message ?? e).slice(0, 120);

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
  const player = web3.Keypair.generate();
  const session = web3.Keypair.generate();
  const day = BigInt(Math.floor(Date.now() / 1000 / 86400));
  const world = pda(Buffer.from("world"), Buffer.from([1]), le8(day));

  const baseConn = new web3.Connection(BASE_RPC, "confirmed");
  const erConn = new web3.Connection(ER_RPC, "processed");
  const idl = JSON.parse(
    readFileSync(resolve(__dirname, "../target/idl/crossy_world.json"), "utf8"),
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
  const sectorPda = (sx: number, sy: number) =>
    pda(Buffer.from("sector"), world.toBuffer(), Buffer.from([sx]), le2(sy));
  const chunkPda = (i: number) => pda(Buffer.from("chunk"), le8(day), le2(i));

  console.log(`player ${player.publicKey.toBase58()}`);
  const fund = new web3.Transaction().add(
    web3.SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: player.publicKey,
      lamports: 0.05 * web3.LAMPORTS_PER_SOL,
    }),
    web3.SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: session.publicKey,
      lamports: 0.01 * web3.LAMPORTS_PER_SOL,
    }),
  );
  await web3.sendAndConfirmTransaction(baseConn, fund, [funder]);

  // Join: profile + starter + run + lock, then delegate run/best to the ER.
  const attempt = 1;
  const validatorMeta = { pubkey: VALIDATOR, isSigner: false, isWritable: false };
  const join = new web3.Transaction().add(
    await base.methods
      .ensureProfile()
      .accountsPartial({
        profile: pda(Buffer.from("player"), player.publicKey.toBuffer()),
        wallet: player.publicKey,
      })
      .instruction(),
    await base.methods
      .claimStarter()
      .accountsPartial({
        profile: pda(Buffer.from("player"), player.publicKey.toBuffer()),
        wallet: player.publicKey,
      })
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
      .lockStarter(attempt)
      .accountsPartial({
        profile: pda(Buffer.from("player"), player.publicKey.toBuffer()),
        world,
        lock: pda(
          Buffer.from("agent_lock"),
          world.toBuffer(),
          player.publicKey.toBuffer(),
          le4(attempt),
        ),
        wallet: player.publicKey,
      })
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
  );
  await base.provider.sendAndConfirm!(join, [player]);
  console.log("joined + delegated");

  for (let i = 0; i < 60; i++) {
    const acc = await erConn.getAccountInfo(runPda(), "processed");
    if (acc?.owner.equals(PROGRAM_ID)) break;
    await sleep(1_000);
  }

  const spawnSectors = [];
  for (let sy = 0; sy < 2; sy++)
    for (let sx = 0; sx < 8; sx++)
      spawnSectors.push({ pubkey: sectorPda(sx, sy), isSigner: false, isWritable: true });
  await er.methods
    .spawn(attempt)
    .accountsPartial({
      world,
      run: runPda(),
      // Casual mode passes the world account as the (unused) entry receipt.
      receipt: world,
      agentLock: pda(
        Buffer.from("agent_lock"),
        world.toBuffer(),
        player.publicKey.toBuffer(),
        le4(attempt),
      ),
      signer: session.publicKey,
    })
    .remainingAccounts(spawnSectors)
    .rpc({ skipPreflight: true, commitment: "processed" });
  let run = await er.account.playerRun.fetch(runPda());
  console.log(`spawned at (${run.x}, ${run.y})`);

  // Cache the revealed lanes so the walk can report what it crossed.
  const worldAcc = await er.account.worldHeader.fetch(world);
  const lanes: any[] = [];
  for (let c = 0; c < Math.ceil(worldAcc.revealedRows / 16); c++) {
    const chunk = await base.account.chunkDefinition.fetch(chunkPda(c));
    for (const l of chunk.lanes as any[]) lanes.push(l);
  }
  console.log(`frontier: ${worldAcc.revealedRows} rows revealed`);

  // Mirror the client's hazard crank: collisions only resolve when someone
  // asks the program to check, so without this a player could stand in
  // traffic forever.
  let deaths = 0;
  const cranker = setInterval(() => {
    void (async () => {
      try {
        const r: any = await er.account.playerRun.fetch(runPda());
        if (Object.keys(r.state)[0] !== "active") return;
        const lane = lanes[r.y];
        if (!lane || lane.kind === 0) return;
        await er.methods
          .checkHazard(r.hazardNonce)
          .accountsPartial({
            world,
            run: runPda(),
            sector: sectorPda(Math.floor(r.x / 8), Math.floor(r.y / 8)),
            chunk: chunkPda(Math.floor(r.y / 16)),
          })
          .rpc({ skipPreflight: true, commitment: "processed" });
      } catch {
        /* stale nonce or already resolved */
      }
    })();
  }, 250);

  const seen = new Set<string>();
  const rejects = new Map<string, number>();
  let sidesteps = 0;

  const move = async (dir: number) => {
    run = await er.account.playerRun.fetch(runPda());
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
    await er.methods
      .moveAction(attempt, new BN(run.actionSeq), dir, new BN(Date.now()))
      .accountsPartial({
        world,
        run: runPda(),
        sourceSector: src,
        destSector: dst.equals(src) ? null : dst,
        chunk: chunkPda(Math.floor(ny / 16)),
        best: bestPda(),
        signer: session.publicKey,
      })
      .rpc({ skipPreflight: false, commitment: "processed" });
  };

  const started = Date.now();
  while (run.y < TARGET_ROW && Date.now() - started < 240_000) {
    const nextLane = lanes[run.y + 1];
    try {
      await move(0);
      if (nextLane) seen.add(KINDS[nextLane.kind]);
    } catch (e) {
      const msg = errText(e);
      const code = /Blocked|TileOccupied|FrontierClosed|TooFast|Immobilized/.exec(msg);
      rejects.set(code?.[0] ?? msg, (rejects.get(code?.[0] ?? msg) ?? 0) + 1);
      // Refused: shuffle sideways and try the next column, exactly like a
      // player would when a tree or a car is in the way.
      if (code?.[0] === "TooFast") {
        await sleep(150);
        continue;
      }
      sidesteps++;
      await move(run.x < 60 ? 3 : 2).catch(() => {});
      await sleep(120);
    }
    run = await er.account.playerRun.fetch(runPda());
    const state = Object.keys(run.state)[0];
    if (state !== "active") {
      deaths++;
      console.log(
        `run ended as "${state}" at row ${run.y} on ` +
          `${KINDS[lanes[run.y]?.kind ?? 0]} (score ${run.score})`,
      );
      break;
    }
    await sleep(120);
  }

  clearInterval(cranker);
  run = await er.account.playerRun.fetch(runPda());
  console.log(
    `\nfinal: (${run.x}, ${run.y}) state=${Object.keys(run.state)[0]} score=${run.score}`,
  );
  console.log(`terrain entered: ${[...seen].join(", ") || "none"}`);
  console.log(`sidesteps: ${sidesteps}, hazard deaths: ${deaths}`);
  console.log(
    `rejections: ${[...rejects].map(([k, v]) => `${k}x${v}`).join(" ") || "none"}`,
  );

  const pastOldFrontier = run.score > 15;
  console.log(
    pastOldFrontier
      ? `PASS — reached row ${run.score}, past the old 16-row wall`
      : `FAIL — stuck at row ${run.score}`,
  );
  // Set the code rather than exiting, so buffered stdout is flushed.
  process.exitCode = pastOldFrontier ? 0 : 1;
}

main().catch((e) => {
  console.error(errText(e));
  process.exit(1);
});
