/**
 * 100-player concurrency/load suite (local validator).
 *
 * One shared casual world, 100 independent wallets:
 *  - batched onboarding (profile + starter + run + lock in one tx each);
 *  - 100 deterministic spawns into the 64x16 safe zone (wrapped-scan
 *    collision handling at scale);
 *  - occupancy audit: sector bitsets sum exactly to the active population,
 *    and no two runs ever share a tile;
 *  - several rounds of CONCURRENT movement from all 100 players at once,
 *    counting acceptances vs contention rejections;
 *  - post-round invariant audits + world active_players accounting.
 *
 * This is a correctness-under-concurrency gate, not an ER latency gate —
 * the realtime path is covered by the devnet ER suites.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3, BN } from "@coral-xyz/anchor";
import assert from "node:assert/strict";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createMint, createAccount } from "@solana/spl-token";
import type { CrossyWorld } from "../target/types/crossy_world";

const PLAYERS = 100;
const MOVE_ROUNDS = 5;
const CHUNK = 20; // concurrent rpc fan-out

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

async function inChunks<T, R>(
  items: T[],
  size: number,
  f: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(f))));
  }
  return out;
}

describe(`crossy-world ${PLAYERS}-player concurrency`, () => {
  const provider = new anchor.AnchorProvider(
    new web3.Connection(process.env.PROVIDER_ENDPOINT || "http://localhost:8899", {
      wsEndpoint: process.env.WS_ENDPOINT || "ws://localhost:8900",
      commitment: "confirmed",
    }),
    anchor.Wallet.local(),
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  anchor.setProvider(provider);
  const program = anchor.workspace.CrossyWorld as Program<CrossyWorld>;
  const conn = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const vrfAuthority = web3.Keypair.generate();

  const players: web3.Keypair[] = Array.from({ length: PLAYERS }, () =>
    web3.Keypair.generate(),
  );

  const pda = (...seeds: (Buffer | Uint8Array)[]) =>
    web3.PublicKey.findProgramAddressSync(seeds as Buffer[], program.programId)[0];
  const configPda = pda(S.config);
  let day: number;
  let world: web3.PublicKey;
  let spawnChunk: web3.PublicKey;
  const runPda = (w: web3.PublicKey) => pda(S.run, world.toBuffer(), w.toBuffer());
  const bestPda = (w: web3.PublicKey) => pda(S.best, world.toBuffer(), w.toBuffer());
  const profilePda = (w: web3.PublicKey) => pda(S.player, w.toBuffer());
  const lockPda = (w: web3.PublicKey) =>
    pda(S.agentLock, world.toBuffer(), w.toBuffer(), le32(1));
  const sectorPda = (sx: number, sy: number) =>
    pda(S.sector, world.toBuffer(), Buffer.from([sx]), le32(sy));
  const spawnSectorMetas = () => {
    const out = [];
    for (let sy = 0; sy < 2; sy++)
      for (let sx = 0; sx < 8; sx++)
        out.push({ pubkey: sectorPda(sx, sy), isSigner: false, isWritable: true });
    return out;
  };

  /** Fetch every run + audit the one-player-per-tile invariant. */
  async function auditOccupancy(expectActive: number) {
    const runs = await inChunks(players, CHUNK, (p) =>
      program.account.playerRun.fetch(runPda(p.publicKey)),
    );
    const active = runs.filter((r) => "active" in (r.state as object));
    assert.equal(active.length, expectActive, "active run count");
    const tiles = new Set(active.map((r) => `${r.x},${r.y}`));
    assert.equal(tiles.size, active.length, "no two live players share a tile");

    let occupancyBits = 0n;
    for (let sy = 0; sy < 2; sy++) {
      for (let sx = 0; sx < 8; sx++) {
        const sector = await program.account.occupancySector.fetch(sectorPda(sx, sy));
        occupancyBits += BigInt(
          BigInt(sector.occupancy.toString()).toString(2).split("1").length - 1,
        );
      }
    }
    assert.equal(
      Number(occupancyBits),
      active.length,
      "sector bitsets sum to population",
    );

    const worldAcc = await program.account.worldHeader.fetch(world);
    assert.equal(worldAcc.activePlayers, active.length, "world population counter");
    return runs;
  }

  before(async function () {
    this.timeout(300_000);
    // Fund all players from the (genesis-rich) local wallet: batched
    // transfers, 12 per tx.
    for (let i = 0; i < players.length; i += 12) {
      const tx = new web3.Transaction();
      for (const p of players.slice(i, i + 12)) {
        tx.add(
          web3.SystemProgram.transfer({
            fromPubkey: admin.publicKey,
            toPubkey: p.publicKey,
            lamports: 0.05 * web3.LAMPORTS_PER_SOL,
          }),
        );
      }
      await provider.sendAndConfirm(tx);
    }

    // Config (fresh validator) + day.
    const usdcMint = await createMint(conn, admin, admin.publicKey, null, 6);
    const treasury = await createAccount(conn, admin, usdcMint, admin.publicKey);
    await program.methods
      .initializeConfig(500, 500)
      .accounts({
        usdcMint,
        teamTreasury: treasury,
        collection: web3.Keypair.generate().publicKey,
        collectionAuthority: admin.publicKey,
        vrfAuthority: vrfAuthority.publicKey,
        validator: admin.publicKey,
        admin: admin.publicKey,
      } as any)
      .rpc();

    const slot = await conn.getSlot("confirmed");
    day = Math.floor((await conn.getBlockTime(slot))! / 86400);
    world = pda(S.world, Buffer.from([1]), le64(day));
    spawnChunk = pda(S.chunk, le64(day), le32(0));
    await program.methods
      .prepareDay(new BN(day))
      .accountsPartial({
        config: configPda,
        daily: pda(S.daily, le64(day)),
        vaultAuthority: pda(S.dailyVault, le64(day)),
        vault: pda(S.dailyVault, le64(day), Buffer.from("ata")),
        usdcMint,
        paidWorld: pda(S.world, Buffer.from([0]), le64(day)),
        casualWorld: world,
        spawnChunk,
        commitPayer: admin.publicKey,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    for (let sy = 0; sy < 2; sy++) {
      for (let sx = 0; sx < 8; sx++) {
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
  });

  it(`onboards ${PLAYERS} players (profile+starter+run+lock, one tx each)`, async function () {
    this.timeout(600_000);
    const t0 = Date.now();
    await inChunks(players, CHUNK, async (p) => {
      const tx = new web3.Transaction().add(
        await program.methods
          .ensureProfile()
          .accountsPartial({ profile: profilePda(p.publicKey), wallet: p.publicKey })
          .instruction(),
        await program.methods
          .claimStarter()
          .accountsPartial({ profile: profilePda(p.publicKey), wallet: p.publicKey })
          .instruction(),
        await program.methods
          .initRun(p.publicKey, new BN(Math.floor(Date.now() / 1000) + 3600))
          .accountsPartial({
            world,
            run: runPda(p.publicKey),
            best: bestPda(p.publicKey),
            wallet: p.publicKey,
          })
          .instruction(),
        await program.methods
          .lockStarter(1)
          .accountsPartial({
            profile: profilePda(p.publicKey),
            world,
            lock: lockPda(p.publicKey),
            wallet: p.publicKey,
          })
          .instruction(),
      );
      tx.feePayer = p.publicKey;
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      tx.sign(p);
      const sig = await conn.sendRawTransaction(tx.serialize());
      await conn.confirmTransaction(sig, "confirmed");
    });
    console.log(
      `      onboarded ${PLAYERS} players in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  });

  it(`spawns ${PLAYERS} players into the 1024-tile safe zone`, async function () {
    this.timeout(600_000);
    const t0 = Date.now();
    const results = await inChunks(players, CHUNK, async (p) => {
      try {
        await program.methods
          .spawn(1)
          .accountsPartial({
            world,
            run: runPda(p.publicKey),
            receipt: world, // casual
            agentLock: lockPda(p.publicKey),
            signer: p.publicKey,
          })
          .remainingAccounts(spawnSectorMetas())
          .signers([p])
          .rpc();
        return "ok";
      } catch (e) {
        return `${e}`.slice(0, 120);
      }
    });
    const ok = results.filter((r) => r === "ok").length;
    console.log(
      `      ${ok}/${PLAYERS} spawned in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
    const failures = results.filter((r) => r !== "ok");
    assert.equal(
      ok,
      PLAYERS,
      `all spawns succeed (failures: ${failures.slice(0, 3).join(" | ")})`,
    );
    await auditOccupancy(PLAYERS);
  });

  it(`runs ${MOVE_ROUNDS} rounds of concurrent movement from all ${PLAYERS} players`, async function () {
    this.timeout(900_000);
    let totalAccepted = 0;
    let totalContention = 0;
    let totalOther = 0;
    let totalTransport = 0;
    for (let round = 0; round < MOVE_ROUNDS; round++) {
      const t0 = Date.now();
      // Everyone tries a pseudo-random direction simultaneously.
      const results = await inChunks(players, CHUNK, async (p, idx = 0) => {
        try {
          const run = await program.account.playerRun.fetch(runPda(p.publicKey));
          const prefs = [0, 3, 2, 1];
          // Deterministic-ish per player+round direction choice.
          const dir = prefs[(p.publicKey.toBytes()[0] + round) % 4];
          let [nx, ny] = [run.x, run.y];
          if (dir === 0) ny += 1;
          else if (dir === 1) ny -= 1;
          else if (dir === 2) nx -= 1;
          else nx += 1;
          if (nx < 0 || nx > 63 || ny < 0 || ny > 15) return "oob-skip";
          const src = sectorPda(Math.floor(run.x / 8), Math.floor(run.y / 8));
          const dst = sectorPda(Math.floor(nx / 8), Math.floor(ny / 8));
          await program.methods
            .moveAction(
              1,
              new BN(run.actionSeq),
              dir,
              new BN(Date.now() + Math.random() * 1e9),
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
          const msg = `${e}`;
          const code = msg.match(/Error Code: (\w+)/)?.[1];
          // No program error code => client/RPC transport artifact (confirm
          // timeout, socket reset) — the tx never reached the program or its
          // outcome was simply not observed.
          return code ?? `transport:${msg.slice(0, 60)}`;
        }
      });
      const accepted = results.filter((r) => r === "ok").length;
      const contention = results.filter((r) => r === "TileOccupied").length;
      const cadence = results.filter(
        (r) => r === "TooFast" || r === "BadActionSequence",
      ).length;
      const transport = results.filter((r) => r.startsWith("transport:"));
      const otherCodes = results.filter(
        (r) =>
          !["ok", "TileOccupied", "TooFast", "BadActionSequence", "oob-skip"].includes(
            r,
          ) && !r.startsWith("transport:"),
      );
      const other = otherCodes.length;
      if (other)
        console.log(
          `      unexpected program errors: ${otherCodes.join(" | ").slice(0, 300)}`,
        );
      if (transport.length)
        console.log(
          `      transport (${transport.length}): ${transport[0].slice(0, 100)}`,
        );
      totalAccepted += accepted;
      totalContention += contention;
      totalOther += other;
      totalTransport += transport.length;
      console.log(
        `      round ${round + 1}: ${accepted} accepted, ${contention} contention, ` +
          `${cadence} cadence, ${other} other in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      // The core invariant must hold after every concurrent round.
      await auditOccupancy(PLAYERS);
      await new Promise((r) => setTimeout(r, 600));
    }
    console.log(
      `      totals: ${totalAccepted} accepted, ${totalContention} contention rejections`,
    );
    assert.ok(totalAccepted > PLAYERS * MOVE_ROUNDS * 0.5, "majority of moves accepted");
    assert.equal(totalOther, 0, "no unexpected PROGRAM errors under concurrency");
    assert.ok(
      totalTransport <= PLAYERS * MOVE_ROUNDS * 0.02,
      `client transport artifacts within 2% (${totalTransport})`,
    );
  });

  it("keeps per-wallet DailyBest scores consistent", async function () {
    this.timeout(300_000);
    const runs = await inChunks(players, CHUNK, (p) =>
      program.account.playerRun.fetch(runPda(p.publicKey)),
    );
    const bests = await inChunks(players, CHUNK, (p) =>
      program.account.dailyBest.fetch(bestPda(p.publicKey)),
    );
    for (let i = 0; i < PLAYERS; i++) {
      assert.equal(bests[i].bestScore, runs[i].score, `best==score for player ${i}`);
    }
  });
});
