/**
 * Concurrent multiplayer on the real MagicBlock devnet ER.
 *
 * Two independent wallets in ONE delegated casual world:
 *  - production-order day prep: prepare the next UTC day, init runs while
 *    the world is still undelegated, then delegate world + sectors + runs;
 *  - both players spawn on the ER on distinct tiles;
 *  - CONCURRENT session-signed movement (Promise.all) across several
 *    rounds, each player's action sequence advancing independently;
 *  - occupancy contention: moving onto the other player's tile is rejected
 *    by the ER sequencer's first-claim rule (TileOccupied);
 *  - PvP: an adjacent facing Kick displaces the other player one tile;
 *  - both runs committed to base; committed data matches the ER state.
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
  dailyVault: Buffer.from("daily_vault"),
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

describe("crossy-world concurrent multiplayer on the ER (devnet)", () => {
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

  const playerA = web3.Keypair.generate();
  const playerB = web3.Keypair.generate();
  const erProgramFor = (kp: web3.Keypair) =>
    new anchor.Program(
      program.idl,
      new anchor.AnchorProvider(erConnection, new anchor.Wallet(kp), {
        commitment: "processed",
        skipPreflight: true,
      }),
    ) as unknown as Program<CrossyWorld>;
  const erA = erProgramFor(playerA);
  const erB = erProgramFor(playerB);

  const pda = (...seeds: (Buffer | Uint8Array)[]) =>
    web3.PublicKey.findProgramAddressSync(seeds as Buffer[], program.programId)[0];
  const configPda = pda(S.config);

  let day: number;
  let world: web3.PublicKey;
  let spawnChunk: web3.PublicKey;
  const runPda = (w: web3.PublicKey) => pda(S.run, world.toBuffer(), w.toBuffer());
  const bestPda = (w: web3.PublicKey) => pda(S.best, world.toBuffer(), w.toBuffer());
  const profilePda = (w: web3.PublicKey) => pda(S.player, w.toBuffer());
  const lockPda = (w: web3.PublicKey, attempt: number) =>
    pda(S.agentLock, world.toBuffer(), w.toBuffer(), le32(attempt));
  const sectorPda = (sx: number, sy: number) =>
    pda(S.sector, world.toBuffer(), Buffer.from([sx]), le32(sy));
  const spawnSectors = () => {
    const out = [];
    for (let sy = 0; sy < 2; sy++)
      for (let sx = 0; sx < 8; sx++)
        out.push({ pubkey: sectorPda(sx, sy), isSigner: false, isWritable: true });
    return out;
  };

  async function chainNow(): Promise<number> {
    const slot = await base.connection.getSlot("confirmed");
    return (await base.connection.getBlockTime(slot))!;
  }

  before(async function () {
    this.timeout(600_000);
    for (const p of [playerA, playerB]) {
      await base.sendAndConfirm(
        new web3.Transaction().add(
          web3.SystemProgram.transfer({
            fromPubkey: admin.publicKey,
            toPubkey: p.publicKey,
            lamports: 0.12 * web3.LAMPORTS_PER_SOL,
          }),
        ),
      );
    }

    // Late in a UTC day, target the NEXT day (production day-prep order:
    // prepare + init runs + delegate before the day starts).
    const now = await chainNow();
    day = Math.floor(now / 86400) + (now % 86400 > 82_000 ? 1 : 0);
    world = pda(S.world, Buffer.from([1]), le64(day));
    spawnChunk = pda(S.chunk, le64(day), le32(0));
  });

  it("prepares the day and both players (base), then delegates everything", async function () {
    this.timeout(600_000);
    // Prepare the daily competition when missing.
    if (!(await base.connection.getAccountInfo(pda(S.daily, le64(day))))) {
      const config = await program.account.globalConfig.fetch(configPda);
      await program.methods
        .prepareDay(0, new BN(day))
        .accountsPartial({
          config: configPda,
          daily: pda(S.daily, le64(day)),
          vaultAuthority: pda(S.dailyVault, le64(day)),
          vault: pda(S.dailyVault, le64(day), Buffer.from("ata")),
          usdcMint: config.usdcMint,
          paidWorld: pda(S.world, Buffer.from([0]), le64(day)),
          casualWorld: world,
          spawnChunk,
          commitPayer: admin.publicKey,
          admin: admin.publicKey,
          tokenProgram: new web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        })
        .rpc();
    }
    for (let sy = 0; sy < 2; sy++) {
      for (let sx = 0; sx < 8; sx++) {
        if (await base.connection.getAccountInfo(sectorPda(sx, sy))) continue;
        await program.methods
          .initSector(sx, sy)
          .accountsPartial({
            world,
            chunk: spawnChunk,
            sector: sectorPda(sx, sy),
            payer: admin.publicKey,
          })
          .rpc();
      }
    }

    // Players join while the world is undelegated.
    for (const p of [playerA, playerB]) {
      await program.methods
        .ensureProfile()
        .accountsPartial({ profile: profilePda(p.publicKey), wallet: p.publicKey })
        .signers([p])
        .rpc();
      await program.methods
        .claimStarter()
        .accountsPartial({ profile: profilePda(p.publicKey), wallet: p.publicKey })
        .signers([p])
        .rpc();
      await program.methods
        .initRun(p.publicKey, new BN(Math.floor(Date.now() / 1000) + 8 * 3600))
        .accountsPartial({
          world,
          run: runPda(p.publicKey),
          best: bestPda(p.publicKey),
          wallet: p.publicKey,
        })
        .signers([p])
        .rpc();
      await program.methods
        .lockStarter(1)
        .accountsPartial({
          profile: profilePda(p.publicKey),
          world,
          lock: lockPda(p.publicKey, 1),
          wallet: p.publicKey,
        })
        .signers([p])
        .rpc();
    }

    // Delegate world + sectors + both runs + bests.
    const validatorMeta = { pubkey: validator, isSigner: false, isWritable: false };
    const worldOwner = (await base.connection.getAccountInfo(world))!.owner;
    if (!worldOwner.equals(DELEGATION_PROGRAM)) {
      await program.methods
        .delegateWorld(0, 1, new BN(day))
        .accountsPartial({ payer: admin.publicKey, pda: world })
        .remainingAccounts([validatorMeta])
        .rpc();
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 8; sx++) {
          await program.methods
            .delegateSector(world, sx, sy)
            .accountsPartial({ worldAccount: world, payer: admin.publicKey, pda: sectorPda(sx, sy) })
            .remainingAccounts([validatorMeta])
            .rpc();
        }
      }
    }
    for (const p of [playerA, playerB]) {
      await program.methods
        .delegateRun(world, p.publicKey)
        .accountsPartial({ worldAccount: world, payer: admin.publicKey, pda: runPda(p.publicKey) })
        .remainingAccounts([validatorMeta])
        .rpc();
      await program.methods
        .delegateBest(world, p.publicKey)
        .accountsPartial({ worldAccount: world, payer: admin.publicKey, pda: bestPda(p.publicKey) })
        .remainingAccounts([validatorMeta])
        .rpc();
    }

    // ER clones appear.
    const waitClone = async (addr: web3.PublicKey, what: string) => {
      const started = Date.now();
      for (;;) {
        const acc = await erConnection
          .getAccountInfo(addr, "processed")
          .catch(() => null);
        if (acc && acc.owner.equals(program.programId)) return;
        if (Date.now() - started > 120_000)
          throw new Error(`timeout: ER clone of ${what}`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    await waitClone(world, "world");
    await waitClone(runPda(playerA.publicKey), "run A");
    await waitClone(runPda(playerB.publicKey), "run B");
  });

  it("waits for the day to open, then both players spawn on the ER", async function () {
    this.timeout(2_400_000);
    // Wait for the day's start on the authoritative clock.
    for (;;) {
      const now = await chainNow();
      if (now >= day * 86400 + 2) break;
      await new Promise((r) => setTimeout(r, 10_000));
    }

    for (const [p, er] of [
      [playerA, erA],
      [playerB, erB],
    ] as const) {
      await er.methods
        .spawn(1)
        .accountsPartial({
          world,
          run: runPda(p.publicKey),
          receipt: world,
          agentLock: lockPda(p.publicKey, 1),
          signer: p.publicKey,
        })
        .remainingAccounts(spawnSectors())
        .signers([p])
        .rpc();
    }
    const runA = await erA.account.playerRun.fetch(runPda(playerA.publicKey));
    const runB = await erB.account.playerRun.fetch(runPda(playerB.publicKey));
    assert.deepEqual(runA.state, { active: {} });
    assert.deepEqual(runB.state, { active: {} });
    assert.ok(runA.x !== runB.x || runA.y !== runB.y, "distinct spawn tiles");
    const world_ = await erA.account.worldHeader.fetch(world);
    assert.equal(world_.activePlayers, 2, "two live players in one world");
  });

  async function moveOnce(
    p: web3.Keypair,
    er: Program<CrossyWorld>,
    dir: number,
  ): Promise<"ok" | string> {
    const run = await er.account.playerRun.fetch(runPda(p.publicKey));
    let [nx, ny] = [run.x, run.y];
    if (dir === 0) ny += 1;
    else if (dir === 1) ny -= 1;
    else if (dir === 2) nx -= 1;
    else nx += 1;
    if (nx < 0 || nx > 63 || ny < 0 || ny > 15) return "OutOfBounds";
    const src = sectorPda(Math.floor(run.x / 8), Math.floor(run.y / 8));
    const dst = sectorPda(Math.floor(nx / 8), Math.floor(ny / 8));
    try {
      await er.methods
        .moveAction(
          1,
          new BN(run.actionSeq),
          dir,
          new BN(Date.now() + Math.random() * 1e6),
        )
        .accountsPartial({
          world,
          run: runPda(p.publicKey),
          sourceSector: src,
          destSector: dst.equals(src) ? null : dst,
          chunk: spawnChunk,
          best: bestPda(p.publicKey),
          signer: p.publicKey,
        })
        .signers([p])
        .rpc();
      return "ok";
    } catch (e) {
      const code = `${e}`.match(/Error Code: (\w+)/)?.[1];
      return code ?? `${e}`.slice(0, 80);
    }
  }

  it("moves both players CONCURRENTLY on the ER", async function () {
    this.timeout(300_000);
    const seqA0 = (
      await erA.account.playerRun.fetch(runPda(playerA.publicKey))
    ).actionSeq.toNumber();
    const seqB0 = (
      await erB.account.playerRun.fetch(runPda(playerB.publicKey))
    ).actionSeq.toNumber();
    let okA = 0;
    let okB = 0;
    for (let round = 0; round < 4; round++) {
      const dir = round % 2 === 0 ? 0 : 1; // forward, back, forward, back
      const [ra, rb] = await Promise.all([
        moveOnce(playerA, erA, dir),
        moveOnce(playerB, erB, dir),
      ]);
      if (ra === "ok") okA++;
      if (rb === "ok") okB++;
      await new Promise((r) => setTimeout(r, 500)); // one move per ER slot
    }
    assert.ok(
      okA >= 2 && okB >= 2,
      `both players moved concurrently (A ${okA}, B ${okB})`,
    );
    const seqA = (
      await erA.account.playerRun.fetch(runPda(playerA.publicKey))
    ).actionSeq.toNumber();
    const seqB = (
      await erB.account.playerRun.fetch(runPda(playerB.publicKey))
    ).actionSeq.toNumber();
    assert.equal(seqA - seqA0, okA, "A's sequence advanced exactly per accepted move");
    assert.equal(seqB - seqB0, okB, "B's sequence advanced exactly per accepted move");
  });

  it("walks A adjacent to B, proves tile contention, and kicks B on the ER", async function () {
    this.timeout(600_000);
    const runB = await erB.account.playerRun.fetch(runPda(playerB.publicKey));
    // Stand beside B, facing B along x.
    const standX = runB.x > 0 ? runB.x - 1 : runB.x + 1;
    const facing = runB.x > 0 ? 3 : 2;

    // Walk A to (standX, runB.y).
    for (let guard = 0; guard < 200; guard++) {
      const runA = await erA.account.playerRun.fetch(runPda(playerA.publicKey));
      if (runA.x === standX && runA.y === runB.y) break;
      let dir: number;
      if (runA.x < standX) dir = 3;
      else if (runA.x > standX) dir = 2;
      else if (runA.y < runB.y) dir = 0;
      else dir = 1;
      // Never step onto B's tile while routing.
      let [nx, ny] = [runA.x, runA.y];
      if (dir === 0) ny += 1;
      else if (dir === 1) ny -= 1;
      else if (dir === 2) nx -= 1;
      else nx += 1;
      if (nx === runB.x && ny === runB.y) {
        dir = runA.y > 0 ? 1 : 0;
      }
      const res = await moveOnce(playerA, erA, dir);
      if (res !== "ok") await new Promise((r) => setTimeout(r, 500));
    }
    let runA = await erA.account.playerRun.fetch(runPda(playerA.publicKey));
    assert.equal(runA.x, standX);
    assert.equal(runA.y, runB.y);

    // Ensure facing toward B (facing = last accepted move direction).
    if (runA.facing !== facing) {
      const backDir = facing === 3 ? 2 : 3;
      if ((await moveOnce(playerA, erA, backDir)) === "ok") {
        await new Promise((r) => setTimeout(r, 600));
      }
      for (let i = 0; i < 5; i++) {
        if ((await moveOnce(playerA, erA, facing)) === "ok") break;
        await new Promise((r) => setTimeout(r, 600));
      }
      runA = await erA.account.playerRun.fetch(runPda(playerA.publicKey));
    }
    assert.equal(runA.facing, facing, "A faces B");

    // Contention: A moving onto B's occupied tile is rejected.
    await new Promise((r) => setTimeout(r, 700));
    const contention = await moveOnce(playerA, erA, facing);
    assert.equal(contention, "TileOccupied", "one live player per tile on the ER");

    // Kick: B is displaced exactly one tile.
    const bBefore = await erB.account.playerRun.fetch(runPda(playerB.publicKey));
    const dxDest = facing === 3 ? bBefore.x + 1 : bBefore.x - 1;
    const targetSector = sectorPda(Math.floor(bBefore.x / 8), Math.floor(bBefore.y / 8));
    const destSector = sectorPda(Math.floor(dxDest / 8), Math.floor(bBefore.y / 8));
    runA = await erA.account.playerRun.fetch(runPda(playerA.publicKey));
    await erA.methods
      .kick(1, new BN(runA.actionSeq), new BN(Date.now()))
      .accountsPartial({
        world,
        kicker: runPda(playerA.publicKey),
        target: runPda(playerB.publicKey),
        targetSector,
        destSector: destSector.equals(targetSector) ? null : destSector,
        chunk: spawnChunk,
        signer: playerA.publicKey,
      })
      .signers([playerA])
      .rpc();
    const bAfter = await erB.account.playerRun.fetch(runPda(playerB.publicKey));
    assert.equal(bAfter.x, dxDest, "B knocked back one tile by A's kick");
  });

  it("commits both runs and the world; base matches the ER state", async function () {
    this.timeout(300_000);
    const erRunA = await erA.account.playerRun.fetch(runPda(playerA.publicKey));
    const erRunB = await erB.account.playerRun.fetch(runPda(playerB.publicKey));
    await erA.methods
      .commitState()
      .accountsPartial({ payer: playerA.publicKey })
      .remainingAccounts([
        { pubkey: runPda(playerA.publicKey), isSigner: false, isWritable: true },
        { pubkey: runPda(playerB.publicKey), isSigner: false, isWritable: true },
        { pubkey: world, isSigner: false, isWritable: true },
      ])
      .signers([playerA])
      .rpc();

    const started = Date.now();
    for (;;) {
      const a = await base.connection.getAccountInfo(
        runPda(playerA.publicKey),
        "confirmed",
      );
      const b = await base.connection.getAccountInfo(
        runPda(playerB.publicKey),
        "confirmed",
      );
      if (a && b) {
        const ca = program.coder.accounts.decode("playerRun", a.data);
        const cb = program.coder.accounts.decode("playerRun", b.data);
        if (
          ca.actionSeq.toNumber() === erRunA.actionSeq.toNumber() &&
          cb.x === erRunB.x &&
          cb.y === erRunB.y
        ) {
          break;
        }
      }
      if (Date.now() - started > 120_000)
        throw new Error("timeout: committed multiplayer state");
      await new Promise((r) => setTimeout(r, 2000));
    }
    assert.ok(
      true,
      "base reflects both players' ER positions, including the kick displacement",
    );
  });
});
