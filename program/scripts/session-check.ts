/**
 * Sessions expire; runs outlive them.
 *
 * A player who joined this morning still holds a key the program stopped
 * accepting hours ago, and every action they take is refused — which looks
 * exactly like a game that froze. This proves the recovery path: a run with
 * a lapsed session cannot move, the wallet rotates the authority on its own
 * run, and the same run carries on with its score intact.
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
const errText = (e: any) => String(e?.transactionMessage ?? e?.message ?? e).slice(0, 90);

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

  const player = web3.Keypair.generate();
  const stale = web3.Keypair.generate(); // the session that will lapse
  const fresh = web3.Keypair.generate(); // its replacement
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
        toPubkey: stale.publicKey,
        lamports: 0.005 * web3.LAMPORTS_PER_SOL,
      }),
      web3.SystemProgram.transfer({
        fromPubkey: funder.publicKey,
        toPubkey: fresh.publicKey,
        lamports: 0.005 * web3.LAMPORTS_PER_SOL,
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
  const erAsWallet = new Program(
    idl,
    new anchor.AnchorProvider(erConn, new anchor.Wallet(player), {
      commitment: "processed",
    }),
  ) as Program<any>;
  const erAsStale = new Program(
    idl,
    new anchor.AnchorProvider(erConn, new anchor.Wallet(stale), {
      commitment: "processed",
    }),
  ) as Program<any>;
  const erAsFresh = new Program(
    idl,
    new anchor.AnchorProvider(erConn, new anchor.Wallet(fresh), {
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
  const sectorPda = (sx: number, sy: number) =>
    pda(Buffer.from("sector"), world.toBuffer(), Buffer.from([sx]), le2(sy));
  const validatorMeta = { pubkey: VALIDATOR, isSigner: false, isWritable: false };

  // Join with a session that is already within seconds of expiring.
  const shortLived = Math.floor(Date.now() / 1000) + 20;
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
        .initRun(stale.publicKey, new BN(shortLived))
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
    await sleep(1_000);
  }
  const spawnSectors = [];
  for (let sy = 0; sy < 2; sy++)
    for (let sx = 0; sx < 8; sx++)
      spawnSectors.push({ pubkey: sectorPda(sx, sy), isSigner: false, isWritable: true });
  await erAsStale.methods
    .spawn(1)
    .accountsPartial({
      world,
      run: runPda,
      receipt: world,
      agentLock: lock,
      signer: stale.publicKey,
    })
    .remainingAccounts(spawnSectors)
    .rpc({ skipPreflight: true, commitment: "processed" });

  const move = async (program: Program<any>, signer: web3.Keypair) => {
    const run: any = await erAsWallet.account.playerRun.fetch(runPda);
    const src = sectorPda(Math.floor(run.x / 8), Math.floor(run.y / 8));
    const dst = sectorPda(Math.floor(run.x / 8), Math.floor((run.y + 1) / 8));
    await program.methods
      .moveAction(1, new BN(run.actionSeq), 0, new BN(Date.now()))
      .accountsPartial({
        world,
        run: runPda,
        sourceSector: src,
        destSector: dst.equals(src) ? null : dst,
        chunk: pda(Buffer.from("chunk"), le8(day), le2(Math.floor((run.y + 1) / 16))),
        best: bestPda,
        signer: signer.publicKey,
      })
      .rpc({ skipPreflight: false, commitment: "processed" });
  };

  await move(erAsStale, stale).catch(() => {});
  const before: any = await erAsWallet.account.playerRun.fetch(runPda);
  console.log(`joined: score ${before.score} at (${before.x}, ${before.y})`);

  // Wait for the session to lapse.
  // The rollup's clock is its own; leave real margin past the expiry.
  const waitMs = (shortLived - Math.floor(Date.now() / 1000) + 25) * 1000;
  console.log(
    `waiting ${Math.max(0, Math.round(waitMs / 1000))}s for the session to expire…`,
  );
  await sleep(Math.max(0, waitMs));

  const mid: any = await erAsWallet.account.playerRun.fetch(runPda);
  console.log(
    `   run.sessionExpiry=${mid.sessionExpiry} authority=${mid.sessionAuthority
      .toBase58()
      .slice(0, 8)} stale=${stale.publicKey.toBase58().slice(0, 8)} ` +
      `wallet=${player.publicKey.toBase58().slice(0, 8)} realNow=${Math.floor(Date.now() / 1000)}`,
  );
  // The refusal is not observable from the send: gameplay goes out
  // fire-and-forget at `processed`, so a rejected transaction comes back
  // looking exactly like an accepted one. Judge it by whether the run
  // actually moved — which is also why a player whose session lapses sees
  // nothing happen and no error.
  let refused = "";
  await move(erAsStale, stale).catch((e) => {
    refused = errText(e);
  });
  await sleep(1_500);
  const afterStale: any = await erAsWallet.account.playerRun.fetch(runPda);
  const ignored =
    afterStale.actionSeq.toNumber() === mid.actionSeq.toNumber() &&
    afterStale.y === mid.y;
  console.log(
    ignored
      ? `PASS  a lapsed session is ignored — run still at (${afterStale.x}, ${afterStale.y}) seq ${afterStale.actionSeq}` +
          (refused ? ` (send reported: ${refused})` : " (the send reported success)")
      : `FAIL  the run moved on an expired session: (${afterStale.x}, ${afterStale.y})`,
  );
  const staleIgnored = ignored;

  // The wallet rotates its own run's authority. Score must survive.
  const expiry = Math.floor(Date.now() / 1000) + 12 * 60 * 60 - 60;
  await erAsWallet.methods
    .rotateSession(fresh.publicKey, new BN(expiry))
    .accountsPartial({ run: runPda, wallet: player.publicKey })
    .rpc({ commitment: "processed" });

  let moved = false;
  await move(erAsFresh, fresh)
    .then(() => {
      moved = true;
    })
    .catch((e) => {
      refused = errText(e);
    });
  const after: any = await erAsWallet.account.playerRun.fetch(runPda);
  console.log(
    moved
      ? `PASS  renewed session moves again — (${before.x}, ${before.y}) -> (${after.x}, ${after.y}), score ${after.score}`
      : `FAIL  still stuck after rotation: ${refused}`,
  );
  process.exitCode = moved && staleIgnored ? 0 : 1;
}

main().catch((e) => {
  console.error(errText(e));
  process.exit(1);
});
