/**
 * MagicBlock Ephemeral Rollup delegation E2E (devnet).
 *
 * Uses the config/day prepared by the devnet run of crossy-nft.ts and a
 * FRESH player wallet, then proves the full cross-plane cycle on the real
 * MagicBlock devnet ER:
 *
 *  1. init casual run + starter lock on base;
 *  2. delegate casual world + spawn sectors + run + best to the ER
 *     (pinned validator identity);
 *  3. wait for the router/ER clone, verifying ER-side ownership;
 *  4. spawn + move on the ER (session-signed, processed commitment),
 *     measuring acceptance latency;
 *  5. commit run+world state back to base and verify the committed data;
 *  6. undelegate and verify base ownership returns to the program.
 *
 * Endpoints/validator identity follow the solsocket devnet defaults and are
 * overridable via EPHEMERAL_PROVIDER_ENDPOINT / EPHEMERAL_WS_ENDPOINT /
 * VALIDATOR.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3, BN } from "@coral-xyz/anchor";
import assert from "node:assert/strict";
import type { CrossyWorld } from "../target/types/crossy_world";

const DELEGATION_PROGRAM = new web3.PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);

const S = {
  config: Buffer.from("config"),
  player: Buffer.from("player"),
  daily: Buffer.from("daily"),
  agentLock: Buffer.from("agent_lock"),
  world: Buffer.from("world"),
  chunk: Buffer.from("chunk"),
  sector: Buffer.from("sector"),
  run: Buffer.from("run"),
  best: Buffer.from("best"),
};
const le16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const le32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const le64 = (n: number | bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

describe("crossy-world MagicBlock ER delegation (devnet)", () => {
  const base = new anchor.AnchorProvider(
    new web3.Connection(
      process.env.PROVIDER_ENDPOINT || "https://api.devnet.solana.com",
      {
        wsEndpoint: process.env.WS_ENDPOINT || "wss://api.devnet.solana.com",
        commitment: "confirmed",
      },
    ),
    anchor.Wallet.local(),
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  anchor.setProvider(base);
  const program = anchor.workspace.CrossyWorld as Program<CrossyWorld>;
  const admin = (base.wallet as anchor.Wallet).payer;

  // ER connection at `processed`: the ER doesn't reliably emit `confirmed`
  // websocket notifications, while `processed` fires at slot time (~50ms).
  const erConnection = new web3.Connection(
    process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-as.magicblock.app",
    {
      wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app",
      commitment: "processed",
    },
  );
  const validator = new web3.PublicKey(
    process.env.VALIDATOR || "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
  );

  const player = web3.Keypair.generate();
  const erProvider = new anchor.AnchorProvider(erConnection, new anchor.Wallet(player), {
    commitment: "processed",
    skipPreflight: true,
  });
  const erProgram = new anchor.Program(
    program.idl,
    erProvider,
  ) as unknown as Program<CrossyWorld>;

  const pda = (...seeds: (Buffer | Uint8Array)[]) =>
    web3.PublicKey.findProgramAddressSync(seeds as Buffer[], program.programId)[0];
  const configPda = pda(S.config);

  let day: number;
  let world: web3.PublicKey; // casual world
  let spawnChunk: web3.PublicKey;
  const runPda = () => pda(S.run, world.toBuffer(), player.publicKey.toBuffer());
  const bestPda = () => pda(S.best, world.toBuffer(), player.publicKey.toBuffer());
  const profilePda = () => pda(S.player, player.publicKey.toBuffer());
  const lockPda = (attempt: number) =>
    pda(S.agentLock, world.toBuffer(), player.publicKey.toBuffer(), le32(attempt));
  const sectorPda = (sx: number, sy: number) =>
    pda(S.sector, world.toBuffer(), Buffer.from([sx]), le16(sy));

  const spawnSectors = () => {
    const out = [];
    for (let sy = 0; sy < 2; sy++)
      for (let sx = 0; sx < 8; sx++)
        out.push({ pubkey: sectorPda(sx, sy), isSigner: false, isWritable: true });
    return out;
  };

  async function waitFor<T>(
    what: string,
    f: () => Promise<T | null | false>,
    timeoutMs = 90_000,
    intervalMs = 1_500,
  ): Promise<T> {
    const started = Date.now();
    for (;;) {
      const v = await f().catch(() => null);
      if (v) return v as T;
      if (Date.now() - started > timeoutMs)
        throw new Error(`timeout waiting for ${what}`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  before(async function () {
    this.timeout(120_000);
    // Fund the fresh player from the provider wallet (devnet faucet is
    // rate-limited).
    const tx = new web3.Transaction().add(
      web3.SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: player.publicKey,
        lamports: 0.4 * web3.LAMPORTS_PER_SOL,
      }),
    );
    await base.sendAndConfirm(tx);

    // Locate today's prepared casual world (set up by the devnet NFT run).
    const slot = await base.connection.getSlot("confirmed");
    const ts = await base.connection.getBlockTime(slot);
    day = Math.floor(ts! / 86400);
    world = pda(S.world, Buffer.from([1]), le64(day));
    spawnChunk = pda(S.chunk, le64(day), le16(0));
    const worldAcc = await base.connection.getAccountInfo(world);
    assert.ok(
      worldAcc,
      `casual world for day ${day} exists (run crossy-nft.ts on devnet first)`,
    );
  });

  it("prepares the player's run + starter lock on base", async function () {
    this.timeout(120_000);
    await program.methods
      .ensureProfile()
      .accountsPartial({ profile: profilePda(), wallet: player.publicKey })
      .signers([player])
      .rpc();
    await program.methods
      .claimStarter()
      .accountsPartial({ profile: profilePda(), wallet: player.publicKey })
      .signers([player])
      .rpc();
    await program.methods
      .initRun(player.publicKey, new BN(Math.floor(Date.now() / 1000) + 6 * 3600))
      .accountsPartial({
        world,
        run: runPda(),
        best: bestPda(),
        wallet: player.publicKey,
      })
      .signers([player])
      .rpc();
    await program.methods
      .lockStarter(1)
      .accountsPartial({
        profile: profilePda(),
        world,
        lock: lockPda(1),
        wallet: player.publicKey,
      })
      .signers([player])
      .rpc();
    const run = await program.account.playerRun.fetch(runPda());
    assert.deepEqual(run.state, { idle: {} });
  });

  it("delegates world + sectors + run + best to the ER", async function () {
    this.timeout(300_000);
    const worldAccBefore = await base.connection.getAccountInfo(world);
    const alreadyDelegated = worldAccBefore!.owner.equals(DELEGATION_PROGRAM);

    const validatorMeta = { pubkey: validator, isSigner: false, isWritable: false };
    if (!alreadyDelegated) {
      await program.methods
        .delegateWorld(1, new BN(day))
        .accountsPartial({ payer: admin.publicKey, pda: world })
        .remainingAccounts([validatorMeta])
        .rpc();
      // Sectors in pairs to stay under tx limits.
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 8; sx++) {
          await program.methods
            .delegateSector(world, sx, sy)
            .accountsPartial({ payer: admin.publicKey, pda: sectorPda(sx, sy) })
            .remainingAccounts([validatorMeta])
            .rpc();
        }
      }
    }
    await program.methods
      .delegateRun(world, player.publicKey)
      .accountsPartial({ payer: admin.publicKey, pda: runPda() })
      .remainingAccounts([validatorMeta])
      .rpc();
    await program.methods
      .delegateBest(world, player.publicKey)
      .accountsPartial({ payer: admin.publicKey, pda: bestPda() })
      .remainingAccounts([validatorMeta])
      .rpc();

    // Base owner flips to the delegation program.
    const worldAcc = await base.connection.getAccountInfo(world);
    assert.ok(worldAcc!.owner.equals(DELEGATION_PROGRAM), "world delegated on base");
    const runAcc = await base.connection.getAccountInfo(runPda());
    assert.ok(runAcc!.owner.equals(DELEGATION_PROGRAM), "run delegated on base");

    // ER clone appears with program ownership on the rollup.
    await waitFor("ER clone of world", async () => {
      const acc = await erConnection.getAccountInfo(world, "processed");
      return acc && acc.owner.equals(program.programId) ? acc : null;
    });
    await waitFor("ER clone of run", async () => {
      const acc = await erConnection.getAccountInfo(runPda(), "processed");
      return acc && acc.owner.equals(program.programId) ? acc : null;
    });
  });

  it("spawns and moves on the ER at realtime latency", async function () {
    this.timeout(300_000);
    // Casual spawn on the ER (receipt slot takes the world account).
    await erProgram.methods
      .spawn(1)
      .accountsPartial({
        world,
        run: runPda(),
        receipt: world,
        agentLock: lockPda(1),
        signer: player.publicKey,
      })
      .remainingAccounts(spawnSectors())
      .signers([player])
      .rpc();
    let run = await erProgram.account.playerRun.fetch(runPda());
    assert.deepEqual(run.state, { active: {} });

    // Three forward/back moves, measuring send->processed acceptance.
    const latencies: number[] = [];
    for (let i = 0; i < 3; i++) {
      run = await erProgram.account.playerRun.fetch(runPda());
      const dir = run.y >= 15 ? 1 : 0;
      const ny = dir === 0 ? run.y + 1 : run.y - 1;
      const src = sectorPda(Math.floor(run.x / 8), Math.floor(run.y / 8));
      const dst = sectorPda(Math.floor(run.x / 8), Math.floor(ny / 8));
      const t0 = Date.now();
      await erProgram.methods
        .moveAction(1, new BN(run.actionSeq), dir, new BN(Date.now()))
        .accountsPartial({
          world,
          run: runPda(),
          sourceSector: src,
          destSector: dst.equals(src) ? null : dst,
          chunk: spawnChunk,
          best: bestPda(),
          signer: player.publicKey,
        })
        .signers([player])
        .rpc();
      latencies.push(Date.now() - t0);
      await new Promise((r) => setTimeout(r, 400)); // one move per ER slot
    }
    // eslint-disable-next-line no-console
    console.log("      ER move acceptance latencies (ms):", latencies.join(", "));
    const after = await erProgram.account.playerRun.fetch(runPda());
    assert.ok(after.actionSeq.toNumber() >= 3, "three moves accepted on the ER");
  });

  it("commits ER state to base and verifies the committed data", async function () {
    this.timeout(300_000);
    const erRun = await erProgram.account.playerRun.fetch(runPda());

    await erProgram.methods
      .commitState()
      .accountsPartial({ payer: player.publicKey })
      .remainingAccounts([
        { pubkey: runPda(), isSigner: false, isWritable: true },
        { pubkey: world, isSigner: false, isWritable: true },
      ])
      .signers([player])
      .rpc();

    // The committed run appears on base (still delegated: owner stays the
    // delegation program, data reflects the ER state).
    await waitFor(
      "committed run on base",
      async () => {
        const acc = await base.connection.getAccountInfo(runPda(), "confirmed");
        if (!acc) return null;
        const committed = program.coder.accounts.decode("playerRun", acc.data);
        return committed.actionSeq.toNumber() === erRun.actionSeq.toNumber() &&
          committed.x === erRun.x &&
          committed.y === erRun.y
          ? acc
          : null;
      },
      120_000,
    );
    assert.ok(true, "base sees the committed ER position and action sequence");
  });

  it("undelegates the run back to base ownership", async function () {
    this.timeout(300_000);
    await erProgram.methods
      .undelegateState()
      .accountsPartial({ payer: player.publicKey })
      .remainingAccounts([{ pubkey: runPda(), isSigner: false, isWritable: true }])
      .signers([player])
      .rpc();

    await waitFor(
      "base ownership restored",
      async () => {
        const acc = await base.connection.getAccountInfo(runPda(), "confirmed");
        return acc && acc.owner.equals(program.programId) ? acc : null;
      },
      180_000,
    );
    const run = await program.account.playerRun.fetch(runPda());
    assert.deepEqual(run.state, { active: {} });
    assert.ok(run.actionSeq.toNumber() >= 3, "undelegated run keeps the ER progress");
  });
});
