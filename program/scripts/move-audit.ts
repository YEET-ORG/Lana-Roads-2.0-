/**
 * Why a hop lands on screen and then snaps back.
 *
 * Gameplay is fire-and-forget: `sendRawTransaction` with skipPreflight at
 * processed commitment returns a signature for a transaction the program
 * may still refuse. Nothing throws, the toast says the move went out, and
 * the only symptom is the player being dragged back a tile a second later
 * by the reconciler.
 *
 * Two rules make that happen in bursts:
 *   - `TooFast`: at most ONE accepted move per ER slot (50ms).
 *   - `BadActionSequence`: `action_seq` must match EXACTLY, and a refused
 *     move does not consume it — so every later move in the burst, sent
 *     with an optimistic seq, is refused too.
 *
 * This harness plays the same burst two ways and reports what the chain
 * actually did with each signature.
 *
 *   PACING=burst  npx tsx scripts/move-audit.ts   # what the client did
 *   PACING=serial npx tsx scripts/move-audit.ts   # one in flight + retry
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
/** Gap between sends in burst mode — the web client's input debounce. */
const GAP_MS = Number(process.env.GAP_MS ?? 60);
const HOPS = Number(process.env.HOPS ?? 6);
const PACING = process.env.PACING ?? "burst";

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
  const chunkPda = (i: number) => pda(Buffer.from("chunk"), le8(day), le2(i));
  const sectorPda = (sx: number, sy: number) =>
    pda(Buffer.from("sector"), world.toBuffer(), Buffer.from([sx]), le2(sy));

  const player = web3.Keypair.generate();
  const session = web3.Keypair.generate();
  console.log(`player ${player.publicKey.toBase58()} — pacing ${PACING}`);
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
        .accountsPartial({ payer: player.publicKey, pda: runPda })
        .remainingAccounts([validatorMeta])
        .instruction(),
      await base.methods
        .delegateBest(world, player.publicKey)
        .accountsPartial({ payer: player.publicKey, pda: bestPda })
        .remainingAccounts([validatorMeta])
        .instruction(),
    ),
    [player],
  );
  for (let i = 0; i < 60; i++) {
    const acc = await erConn.getAccountInfo(runPda, "processed");
    if (acc?.owner.equals(PROGRAM_ID)) break;
    await sleep(1000);
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

  let run: any = await er.account.playerRun.fetch(runPda);
  console.log(`spawned at (${run.x}, ${run.y}) seq ${run.actionSeq}`);
  const startY = run.y;
  const startSeq = Number(run.actionSeq);

  // Build and send exactly what the web client sends: forward hop, session
  // signed, skipPreflight, no confirmation wait.
  const sendHop = async (x: number, y: number, seq: number) => {
    const src = sectorPda(Math.floor(x / 8), Math.floor(y / 8));
    const dst = sectorPda(Math.floor(x / 8), Math.floor((y + 1) / 8));
    const ix = await er.methods
      .moveAction(
        1,
        new BN(seq),
        0,
        new BN(Date.now() * 8 + Math.floor(Math.random() * 8)),
      )
      .accountsPartial({
        world,
        run: runPda,
        sourceSector: src,
        destSector: dst.equals(src) ? null : dst,
        chunk: chunkPda(Math.floor((y + 1) / 16)),
        best: bestPda,
        signer: session.publicKey,
      })
      .instruction();
    const tx = new web3.Transaction().add(ix);
    tx.recentBlockhash = (await erConn.getLatestBlockhash("processed")).blockhash;
    tx.feePayer = session.publicKey;
    tx.sign(session);
    return erConn.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 0,
    });
  };

  const sent: { sig: string; seq: number }[] = [];

  if (PACING === "burst") {
    // The client's behaviour: predict locally, pipeline the sequence, never
    // wait to hear whether any of it was accepted.
    let x = run.x;
    let y = run.y;
    let seq = startSeq;
    for (let i = 0; i < HOPS; i++) {
      sent.push({ sig: await sendHop(x, y, seq), seq });
      y += 1;
      seq += 1;
      await sleep(GAP_MS);
    }
  } else if (PACING === "double") {
    // The safety property the client's retry rests on: sending the SAME
    // sequence twice must move the player exactly once. If that were not
    // true, every retry would risk a phantom hop into traffic.
    for (let i = 0; i < HOPS; i++) {
      const before: any = await er.account.playerRun.fetch(runPda);
      const seq = Number(before.actionSeq);
      sent.push({ sig: await sendHop(before.x, before.y, seq), seq });
      sent.push({ sig: await sendHop(before.x, before.y, seq), seq });
      for (let w = 0; w < 12; w++) {
        await sleep(80);
        const now: any = await er.account.playerRun.fetch(runPda);
        if (Number(now.actionSeq) > seq) break;
      }
    }
  } else {
    // One in flight at a time. A refused move leaves `action_seq` untouched,
    // so RESENDING THE SAME SEQUENCE is idempotent by construction: if the
    // original did land, the retry is refused for the seq it claims.
    let applied = 0;
    for (let i = 0; i < HOPS; i++) {
      const before: any = await er.account.playerRun.fetch(runPda);
      const seq = Number(before.actionSeq);
      let landed = false;
      for (let attempt = 0; attempt < 4 && !landed; attempt++) {
        sent.push({ sig: await sendHop(before.x, before.y, seq), seq });
        for (let w = 0; w < 8 && !landed; w++) {
          await sleep(60);
          const now: any = await er.account.playerRun.fetch(runPda);
          landed = Number(now.actionSeq) > seq;
        }
      }
      if (landed) applied += 1;
    }
    console.log(`serial pacing: ${applied}/${HOPS} hops confirmed as they went`);
  }

  await sleep(4000);
  run = await er.account.playerRun.fetch(runPda);
  const advanced = run.y - startY;
  console.log(
    `\nintended ${HOPS} hops, chain advanced ${advanced} row(s) ` +
      `(seq ${startSeq} -> ${run.actionSeq})`,
  );

  const statuses = await erConn.getSignatureStatuses(sent.map((s) => s.sig));
  const tally = new Map<string, number>();
  sent.forEach(({ sig, seq }, i) => {
    const st = statuses.value[i];
    const why = !st ? "never included" : st.err ? decodeErr(st.err, idl) : "applied";
    tally.set(why, (tally.get(why) ?? 0) + 1);
    console.log(`  seq ${seq} ${sig.slice(0, 8)}… -> ${why}`);
  });
  console.log("\nsummary:", [...tally].map(([k, v]) => `${k} x${v}`).join(", "));
}

/** Turn a raw instruction error into the program's own error name. */
function decodeErr(err: any, idl: any): string {
  const code = err?.InstructionError?.[1]?.Custom;
  if (code == null) return JSON.stringify(err).slice(0, 60);
  const named = idl.errors?.find((e: any) => e.code === code);
  return named ? named.name : `custom ${code}`;
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
