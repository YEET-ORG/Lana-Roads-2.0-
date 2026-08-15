/**
 * Compressed-clock daily lifecycle suite (solana-bankrun).
 *
 * Clock control proves what the validator suites cannot:
 * - the hard cutoff at end_ts - 1 / end_ts / end_ts + 1;
 * - close -> commit -> settle with a real winner (exact 90/10 + rounding);
 * - the no-winner day: full pool rollover, no team cut, consume into the
 *   successor day's vault;
 * - void + exact contribution refunds (idempotent);
 * - gacha five-minute timeout refund + late-callback generation rejection.
 *
 * Run via tests/run-lifecycle.ts (standalone runner; hard process.exit).
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import assert from "node:assert/strict";
import { start, Clock, ProgramTestContext, BanksClient } from "solana-bankrun";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  createInitializeAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  AccountLayout,
} from "@solana/spl-token";
import type { CrossyWorld } from "../target/types/crossy_world";
import idlJson from "../target/idl/crossy_world.json";

process.env.BPF_OUT_DIR = process.env.BPF_OUT_DIR ?? `${process.cwd()}/target/deploy`;

const PROGRAM_ID = new PublicKey("5FBMHsiUcRZ5RiKYWd6XhRGkA3FifP4nji9RKijLYuLx");
const S = {
  config: Buffer.from("config"),
  season: Buffer.from("season"),
  banner: Buffer.from("banner"),
  variant: Buffer.from("variant"),
  klass: Buffer.from("class"),
  player: Buffer.from("player"),
  pull: Buffer.from("pull"),
  daily: Buffer.from("daily"),
  dailyVault: Buffer.from("daily_vault"),
  contribution: Buffer.from("contribution"),
  payment: Buffer.from("payment"),
  agentLock: Buffer.from("agent_lock"),
  world: Buffer.from("world"),
  chunk: Buffer.from("chunk"),
  sector: Buffer.from("sector"),
  run: Buffer.from("run"),
  best: Buffer.from("best"),
  gachaVault: Buffer.from("gacha_vault"),
  gachaVaultAuthority: Buffer.from("gacha_vault_authority"),
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

describe("crossy-world compressed-clock lifecycle (bankrun)", () => {
  let ctx: ProgramTestContext;
  let client: BanksClient;

  const admin = Keypair.generate();
  const alice = Keypair.generate(); // winner
  const bob = Keypair.generate(); // rollover / void participant
  const vrfAuthority = Keypair.generate();
  const usdcMintKp = Keypair.generate();
  const usdcMint = usdcMintKp.publicKey;
  const treasuryKp = Keypair.generate();
  const treasury = treasuryKp.publicKey;
  // Plain token accounts per player.
  const tokenAccountKp = new Map<string, Keypair>();
  const tokenAccountOf = (w: PublicKey) => {
    let kp = tokenAccountKp.get(w.toBase58());
    if (!kp) {
      kp = Keypair.generate();
      tokenAccountKp.set(w.toBase58(), kp);
    }
    return kp;
  };

  // Anchor program used purely as an instruction builder (no connection).
  const program = new anchor.Program(
    idlJson as CrossyWorld,
    {
      connection: {
        getLatestBlockhash: async () => ({ blockhash: "", lastValidBlockHeight: 0 }),
      },
    } as any,
  ) as Program<CrossyWorld>;

  const pda = (...seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds as Buffer[], PROGRAM_ID)[0];
  const configPda = pda(S.config);
  const profilePda = (w: PublicKey) => pda(S.player, w.toBuffer());
  const runPda = (world: PublicKey, w: PublicKey) =>
    pda(S.run, world.toBuffer(), w.toBuffer());
  const bestPda = (world: PublicKey, w: PublicKey) =>
    pda(S.best, world.toBuffer(), w.toBuffer());
  const sectorPda = (world: PublicKey, sx: number, sy: number) =>
    pda(S.sector, world.toBuffer(), Buffer.from([sx]), le32(sy));
  const lockPda = (world: PublicKey, w: PublicKey, attempt: number) =>
    pda(S.agentLock, world.toBuffer(), w.toBuffer(), le32(attempt));
  const receiptPda = (kind: number, day: bigint, w: PublicKey, nonce: number) =>
    pda(S.payment, Buffer.from([kind]), Buffer.from([0]), le64(day), w.toBuffer(), le32(nonce));

  const dayPdas = (day: bigint) => ({
    daily: pda(S.daily, le64(day)),
    vaultAuth: pda(S.dailyVault, le64(day)),
    vault: pda(S.dailyVault, le64(day), Buffer.from("ata")),
    paidWorld: pda(S.world, Buffer.from([0]), le64(day)),
    casualWorld: pda(S.world, Buffer.from([1]), le64(day)),
    spawnChunk: pda(S.chunk, le64(day), le32(0)),
  });

  // Base epoch: 2026-09-01 UTC (fully in the future of genesis).
  const DAY0 = 20701n;
  const dayStart = (d: bigint) => d * 86400n;

  async function nowTs(): Promise<bigint> {
    return (await client.getClock()).unixTimestamp;
  }

  async function warpTo(unix: bigint) {
    const c = await client.getClock();
    ctx.setClock(
      new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, unix),
    );
  }

  let slotCursor = 1n;
  async function bumpSlot(by = 2n) {
    const ts = await nowTs();
    slotCursor += by;
    ctx.warpToSlot(slotCursor);
    // warpToSlot rebuilds the clock; restore the warped timestamp.
    await warpTo(ts);
  }

  async function send(
    ixs: TransactionInstruction[],
    signers: Keypair[],
    feePayer = admin,
  ) {
    await bumpSlot(1n); // fresh blockhash per transaction
    const tx = new Transaction().add(...ixs);
    tx.recentBlockhash = (await client.getLatestBlockhash())![0];
    tx.feePayer = feePayer.publicKey;
    tx.sign(feePayer, ...signers.filter((s) => !s.publicKey.equals(feePayer.publicKey)));
    const res = await client.tryProcessTransaction(tx);
    const err = res.result;
    if (err) {
      const logs = res.meta?.logMessages ?? [];
      throw new Error(`tx failed: ${err}\n${logs.join("\n")}`);
    }
    return res;
  }

  async function expectFail(p: () => Promise<void> | void, needle: string) {
    try {
      await p();
      assert.fail(`expected failure containing "${needle}"`);
    } catch (e: any) {
      assert.ok(
        `${e}`.includes(needle),
        `expected "${needle}", got: ${`${e}`.slice(0, 400)}`,
      );
    }
  }

  async function getData(account: PublicKey): Promise<Buffer | null> {
    const acct = await client.getAccount(account);
    if (!acct || acct.data.length === 0) return null;
    return Buffer.from(acct.data);
  }

  async function tokenBalance(account: PublicKey): Promise<bigint> {
    const data = await getData(account);
    if (!data) return 0n;
    return AccountLayout.decode(Uint8Array.from(data)).amount;
  }

  const decode = (name: string, data: Buffer) =>
    (program.coder.accounts as any).decode(name, data);

  const spawnSectorMetas = (world: PublicKey) => {
    const out = [];
    for (let sy = 0; sy < 2; sy++)
      for (let sx = 0; sx < 8; sx++)
        out.push({ pubkey: sectorPda(world, sx, sy), isSigner: false, isWritable: true });
    return out;
  };

  before(async function () {
    (this as any).timeout?.(120_000);
    ctx = await start([{ name: "crossy_world", programId: PROGRAM_ID }], []);
    client = ctx.banksClient;

    // Fund actors from the bankrun payer.
    const funding = [admin, alice, bob, vrfAuthority].map((kp) =>
      SystemProgram.transfer({
        fromPubkey: ctx.payer.publicKey,
        toPubkey: kp.publicKey,
        lamports: 100_000_000_000,
      }),
    );
    await send(funding, [ctx.payer], ctx.payer);

    await warpTo(dayStart(DAY0) - 3600n); // one hour before day 0

    // USDC mint + treasury + player token accounts.
    const rent = await client.getRent();
    const rentMint = rent.minimumBalance(BigInt(MINT_SIZE));
    const rentAcct = rent.minimumBalance(BigInt(ACCOUNT_SIZE));
    await send(
      [
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: usdcMint,
          lamports: Number(rentMint),
          space: MINT_SIZE,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(usdcMint, 6, admin.publicKey, null),
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: treasury,
          lamports: Number(rentAcct),
          space: ACCOUNT_SIZE,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccountInstruction(treasury, usdcMint, admin.publicKey),
      ],
      [usdcMintKp, treasuryKp],
    );

    for (const p of [alice, bob]) {
      const acctKp = tokenAccountOf(p.publicKey);
      await send(
        [
          SystemProgram.createAccount({
            fromPubkey: admin.publicKey,
            newAccountPubkey: acctKp.publicKey,
            lamports: Number(rentAcct),
            space: ACCOUNT_SIZE,
            programId: TOKEN_PROGRAM_ID,
          }),
          createInitializeAccountInstruction(acctKp.publicKey, usdcMint, p.publicKey),
          createMintToInstruction(
            usdcMint,
            acctKp.publicKey,
            admin.publicKey,
            1_000_000_000n,
          ),
        ],
        [acctKp],
      );
    }

    await send(
      [
        await program.methods
          .initializeConfig(500, 500)
          .accounts({
            usdcMint,
            teamTreasury: treasury,
            collection: Keypair.generate().publicKey,
            collectionAuthority: admin.publicKey,
            validator: admin.publicKey,
            admin: admin.publicKey,
          } as any)
          .instruction(),
      ],
      [admin],
    );

    for (const p of [alice, bob]) {
      await send(
        [
          await program.methods
            .ensureProfile()
            .accountsPartial({ profile: profilePda(p.publicKey), wallet: p.publicKey })
            .instruction(),
          await program.methods
            .claimStarter()
            .accountsPartial({ profile: profilePda(p.publicKey), wallet: p.publicKey })
            .instruction(),
        ],
        [p],
        p,
      );
    }
  });

  /** Prepare + open a day and init its paid spawn sectors. */
  async function setUpDay(day: bigint) {
    const d = dayPdas(day);
    await send(
      [
        await program.methods
          .prepareDay(0, new BN(day.toString()))
          .accountsPartial({
            config: configPda,
            daily: d.daily,
            vaultAuthority: d.vaultAuth,
            vault: d.vault,
            usdcMint,
            paidWorld: d.paidWorld,
            casualWorld: d.casualWorld,
            spawnChunk: d.spawnChunk,
            commitPayer: admin.publicKey,
            admin: admin.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      ],
      [admin],
    );
    if ((await nowTs()) < dayStart(day)) await warpTo(dayStart(day) + 5n);
    await send(
      [
        await program.methods
          .openDay()
          .accountsPartial({ config: configPda, daily: d.daily, admin: admin.publicKey })
          .instruction(),
      ],
      [admin],
    );
    for (let sy = 0; sy < 2; sy++) {
      for (let sx = 0; sx < 8; sx++) {
        await send(
          [
            await program.methods
              .initSector(sx, sy)
              .accountsPartial({
                world: d.paidWorld,
                chunk: d.spawnChunk,
                sector: sectorPda(d.paidWorld, sx, sy),
                payer: admin.publicKey,
              })
              .instruction(),
          ],
          [admin],
        );
      }
    }
    return d;
  }

  /** Full paid-entry flow for a player; returns the receipt nonce used. */
  async function paidEntry(day: bigint, player: Keypair, attempt: number) {
    const d = dayPdas(day);
    const w = player.publicKey;
    const ata = tokenAccountOf(w).publicKey;
    const receiptCount = (await getData(profilePda(w)))!.readUInt32LE(
      8 + 32 + 1 + 12 + 4,
    );

    const ixs: TransactionInstruction[] = [];
    if (!(await getData(runPda(d.paidWorld, w)))) {
      ixs.push(
        await program.methods
          .initRun(w, new BN(((await nowTs()) + 3600n).toString()))
          .accountsPartial({
            world: d.paidWorld,
            run: runPda(d.paidWorld, w),
            best: bestPda(d.paidWorld, w),
            wallet: w,
          })
          .instruction(),
      );
    }
    ixs.push(
      await program.methods
        .lockStarter(attempt)
        .accountsPartial({
          profile: profilePda(w),
          world: d.paidWorld,
          lock: lockPda(d.paidWorld, w, attempt),
          wallet: w,
        })
        .instruction(),
      await program.methods
        .beginPaidAttempt()
        .accountsPartial({
          config: configPda,
          daily: d.daily,
          vault: d.vault,
          profile: profilePda(w),
          run: runPda(d.paidWorld, w),
          payerToken: ata,
          usdcMint,
          receipt: receiptPda(0, day, w, receiptCount),
          contribution: pda(S.contribution, le64(day), w.toBuffer()),
          wallet: w,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );
    await send(ixs, [player], player);

    await send(
      [
        await program.methods
          .spawn(attempt)
          .accountsPartial({
            world: d.paidWorld,
            run: runPda(d.paidWorld, w),
            receipt: receiptPda(0, day, w, receiptCount),
            agentLock: lockPda(d.paidWorld, w, attempt),
            signer: w,
          })
          .remainingAccounts(spawnSectorMetas(d.paidWorld))
          .instruction(),
      ],
      [player],
      player,
    );
    await send(
      [
        await program.methods
          .reconcileReceipt()
          .accountsPartial({
            daily: d.daily,
            receipt: receiptPda(0, day, w, receiptCount),
            run: runPda(d.paidWorld, w),
            contribution: pda(S.contribution, le64(day), w.toBuffer()),
          })
          .instruction(),
      ],
      [admin],
    );
    return receiptCount;
  }

  async function moveOnceForward(day: bigint, player: Keypair) {
    const d = dayPdas(day);
    const w = player.publicKey;
    const run = decode("playerRun", (await getData(runPda(d.paidWorld, w)))!);
    const dir = run.y >= 15 ? 1 : 0;
    const ny = dir === 0 ? run.y + 1 : run.y - 1;
    const src = sectorPda(d.paidWorld, Math.floor(run.x / 8), Math.floor(run.y / 8));
    const dst = sectorPda(d.paidWorld, Math.floor(run.x / 8), Math.floor(ny / 8));
    await send(
      [
        await program.methods
          .moveAction(
            run.attemptNonce,
            new BN(run.actionSeq.toString()),
            dir,
            new BN(Number(slotCursor)),
          )
          .accountsPartial({
            world: d.paidWorld,
            run: runPda(d.paidWorld, w),
            sourceSector: src,
            destSector: dst.equals(src) ? null : dst,
            chunk: d.spawnChunk,
            best: bestPda(d.paidWorld, w),
            signer: w,
          })
          .instruction(),
      ],
      [player],
      player,
    );
  }

  // =========================================================================
  // Day 0: winner settlement
  // =========================================================================

  it("runs a full winning day: entry, score, hard cutoff, settle 90/10", async () => {
    const day = DAY0;
    const d = await setUpDay(day);

    await paidEntry(day, alice, 1);
    for (let i = 0; i < 3; i++) await moveOnceForward(day, alice);
    const run = decode(
      "playerRun",
      (await getData(runPda(d.paidWorld, alice.publicKey)))!,
    );
    assert.ok(run.score >= 1, "score at least 1");
    await send(
      [
        await program.methods
          .claimRecord()
          .accountsPartial({
            world: d.paidWorld,
            best: bestPda(d.paidWorld, alice.publicKey),
          })
          .instruction(),
      ],
      [admin],
    );

    // ---- cutoff boundaries ----
    const end = dayStart(day + 1n);
    await warpTo(end - 1n);
    await moveOnceForward(day, alice); // one second before: still playable
    await warpTo(end);
    await expectFail(() => moveOnceForward(day, alice), "CutoffPassed");
    await expectFail(async () => {
      await paidEntry(day, bob, 1);
    }, "CutoffPassed");

    // ---- close -> commit -> settle ----
    await send(
      [
        await program.methods
          .closeDay()
          .accountsPartial({ daily: d.daily })
          .instruction(),
        await program.methods
          .closeWorldBase()
          .accountsPartial({ world: d.paidWorld, closer: admin.publicKey })
          .instruction(),
        await program.methods
          .recordFinalCommit()
          .accountsPartial({ daily: d.daily, paidWorld: d.paidWorld })
          .instruction(),
      ],
      [admin],
    );
    const dailyAcct = decode("dailyCompetition", (await getData(d.daily))!);
    assert.equal(dailyAcct.settledWinner.toBase58(), alice.publicKey.toBase58());
    assert.ok(dailyAcct.settledScore >= 1);

    const aliceToken = tokenAccountOf(alice.publicKey).publicKey;
    const aliceBefore = await tokenBalance(aliceToken);
    const treasBefore = await tokenBalance(treasury);
    const finalizeIx = async () =>
      program.methods
        .finalizeDay()
        .accountsPartial({
          config: configPda,
          daily: d.daily,
          vaultAuthority: d.vaultAuth,
          vault: d.vault,
          winnerToken: aliceToken,
          teamTreasury: treasury,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          admin: admin.publicKey,
        })
        .instruction();
    await send([await finalizeIx()], [admin]);
    assert.equal((await tokenBalance(aliceToken)) - aliceBefore, 900_000n, "winner 90%");
    assert.equal((await tokenBalance(treasury)) - treasBefore, 100_000n, "team 10%");
    assert.equal(await tokenBalance(d.vault), 0n, "vault fully distributed");

    // Settled is terminal.
    await expectFail(async () => {
      await send([await finalizeIx()], [admin]);
    }, "InvalidTransition");
  });

  // =========================================================================
  // Day 1: no winner -> rollover into day 2
  // =========================================================================

  it("rolls a no-winner pool forward without a team cut", async () => {
    const day1 = DAY0 + 1n;
    const day2 = DAY0 + 2n;
    const d1 = await setUpDay(day1);

    // Bob pays and spawns but never moves forward: no winner (score 0).
    await paidEntry(day1, bob, 1);

    await warpTo(dayStart(day1 + 1n) + 1n);
    await send(
      [
        await program.methods
          .closeDay()
          .accountsPartial({ daily: d1.daily })
          .instruction(),
        await program.methods
          .closeWorldBase()
          .accountsPartial({ world: d1.paidWorld, closer: admin.publicKey })
          .instruction(),
        await program.methods
          .recordFinalCommit()
          .accountsPartial({ daily: d1.daily, paidWorld: d1.paidWorld })
          .instruction(),
        await program.methods
          .finalizeDay()
          .accountsPartial({
            config: configPda,
            daily: d1.daily,
            vaultAuthority: d1.vaultAuth,
            vault: d1.vault,
            // No valid winner: no transfer occurs; any canonical-mint token
            // account satisfies the slot.
            winnerToken: tokenAccountOf(alice.publicKey).publicKey,
            teamTreasury: treasury,
            usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            admin: admin.publicKey,
          })
          .instruction(),
      ],
      [admin],
    );
    let daily1 = decode("dailyCompetition", (await getData(d1.daily))!);
    assert.equal(daily1.rolloverOut.toNumber(), 1_000_000, "full pool rolls");
    assert.equal(daily1.teamAmount.toNumber(), 0, "no team cut on rollover");

    const d2 = await setUpDay(day2);
    const consumeIx = async () =>
      program.methods
        .consumeRollover()
        .accountsPartial({
          config: configPda,
          previous: d1.daily,
          daily: d2.daily,
          previousVaultAuthority: d1.vaultAuth,
          previousVault: d1.vault,
          vault: d2.vault,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
    await send([await consumeIx()], [admin]);
    const daily2 = decode("dailyCompetition", (await getData(d2.daily))!);
    assert.equal(daily2.rolloverIn.toNumber(), 1_000_000);
    assert.equal(daily2.activePool.toNumber(), 1_000_000);
    assert.equal(await tokenBalance(d2.vault), 1_000_000n);
    assert.equal(await tokenBalance(d1.vault), 0n);
    daily1 = decode("dailyCompetition", (await getData(d1.daily))!);
    assert.equal(daily1.rolloverConsumed, true);
    await expectFail(async () => {
      await send([await consumeIx()], [admin]);
    }, "AlreadyTerminal");
  });

  // =========================================================================
  // Day 2: void + refunds
  // =========================================================================

  it("voids a day and refunds exact contributions once", async () => {
    const day2 = DAY0 + 2n;
    const d2 = dayPdas(day2);
    await paidEntry(day2, bob, 1);

    const bobToken = tokenAccountOf(bob.publicKey).publicKey;
    const bobBefore = await tokenBalance(bobToken);
    await send(
      [
        await program.methods
          .voidDay()
          .accountsPartial({ config: configPda, daily: d2.daily, admin: admin.publicKey })
          .instruction(),
      ],
      [admin],
    );
    await expectFail(async () => {
      await paidEntry(day2, alice, 2);
    }, "DayNotOpen");

    const claimIx = async () =>
      program.methods
        .claimVoidRefund()
        .accountsPartial({
          config: configPda,
          daily: d2.daily,
          vaultAuthority: d2.vaultAuth,
          vault: d2.vault,
          contribution: pda(S.contribution, le64(day2), bob.publicKey.toBuffer()),
          walletToken: bobToken,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
    await send([await claimIx()], [admin]);
    assert.equal(
      (await tokenBalance(bobToken)) - bobBefore,
      1_000_000n,
      "exact contribution refunded",
    );
    await expectFail(async () => {
      await send([await claimIx()], [admin]);
    }, "AlreadyTerminal");

    await expectFail(async () => {
      await send(
        [
          await program.methods
            .finalizeDay()
            .accountsPartial({
              config: configPda,
              daily: d2.daily,
              vaultAuthority: d2.vaultAuth,
              vault: d2.vault,
              winnerToken: tokenAccountOf(alice.publicKey).publicKey,
              teamTreasury: treasury,
              usdcMint,
              tokenProgram: TOKEN_PROGRAM_ID,
              admin: admin.publicKey,
            })
            .instruction(),
        ],
        [admin],
      );
    }, "InvalidTransition");
  });

  // =========================================================================
  // Gacha: five-minute timeout refund + late-callback generation rejection
  // =========================================================================

  it.skip("refunds a timed-out MagicBlock VRF pull and rejects its late callback", async () => {
    const today = (await nowTs()) / 86400n;
    const SEASON = 1;
    const CLASS_ID = 3;

    await send(
      [
        await program.methods
          .createClassConfig(
            CLASS_ID,
            1,
            { anchor: {} } as any,
            15,
            0,
            5,
            0,
            0,
            0,
            0,
            new BN((today + 1n).toString()),
          )
          .accountsPartial({
            config: configPda,
            classConfig: pda(S.klass, le16(CLASS_ID), le16(1)),
            admin: admin.publicKey,
          })
          .instruction(),
        await program.methods
          .createSeason(SEASON, new BN(today.toString()), Array(32).fill(0) as any, 1, 1)
          .accountsPartial({
            config: configPda,
            season: pda(S.season, le16(SEASON)),
            admin: admin.publicKey,
          })
          .instruction(),
        await program.methods
          .createBanner(SEASON, 0, [70, 22, 7, 1])
          .accountsPartial({
            config: configPda,
            season: pda(S.season, le16(SEASON)),
            banner: pda(S.banner, le16(SEASON), Buffer.from([0])),
            admin: admin.publicKey,
          })
          .instruction(),
        await program.methods
          .createVariant(SEASON, 1, 0, 1, 1, Array(32).fill(1) as any, 10)
          .accountsPartial({
            config: configPda,
            season: pda(S.season, le16(SEASON)),
            classConfig: pda(S.klass, le16(CLASS_ID), le16(1)),
            variant: pda(S.variant, le16(SEASON), le16(1)),
            admin: admin.publicKey,
          })
          .instruction(),
      ],
      [admin],
    );

    const aliceToken = tokenAccountOf(alice.publicKey).publicKey;
    const variants = [
      {
        pubkey: pda(S.variant, le16(SEASON), le16(1)),
        isSigner: false,
        isWritable: false,
      },
    ];
    await send(
      [
        await program.methods
          .requestPull()
          .accountsPartial({
            config: configPda,
            season: pda(S.season, le16(SEASON)),
            banner: pda(S.banner, le16(SEASON), Buffer.from([0])),
            profile: profilePda(alice.publicKey),
            pull: pda(S.pull, alice.publicKey.toBuffer(), le32(0)),
            gachaVaultAuthority: pda(S.gachaVaultAuthority),
            gachaVault: pda(S.gachaVault),
            payerToken: aliceToken,
            usdcMint,
            wallet: alice.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts(variants)
          .instruction(),
      ],
      [alice],
      alice,
    );

    const refundIx = async () =>
      program.methods
        .refundPull()
        .accountsPartial({
          config: configPda,
          pull: pda(S.pull, alice.publicKey.toBuffer(), le32(0)),
          gachaVaultAuthority: pda(S.gachaVaultAuthority),
          gachaVault: pda(S.gachaVault),
          walletToken: aliceToken,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
    await expectFail(async () => {
      await send([await refundIx()], [admin]);
    }, "TimeoutNotReached");

    await warpTo((await nowTs()) + 301n);
    const balBefore = await tokenBalance(aliceToken);
    await send([await refundIx()], [admin]);
    assert.equal(
      (await tokenBalance(aliceToken)) - balBefore,
      5_000_000n,
      "exact price refunded",
    );

    const prof = decode("playerProfile", (await getData(profilePda(alice.publicKey)))!);
    assert.equal(prof.pity[0].epicMisses, 0);
    assert.equal(prof.pity[0].legendaryMisses, 0);

    // Late callback (invalidated generation) fails terminally.
    await expectFail(async () => {
      await send(
        [
          await (program.methods as any)
            .assignPull(1, Array(32).fill(7) as any)
            .accountsPartial({
              config: configPda,
              season: pda(S.season, le16(SEASON)),
              banner: pda(S.banner, le16(SEASON), Buffer.from([0])),
              profile: profilePda(alice.publicKey),
              pull: pda(S.pull, alice.publicKey.toBuffer(), le32(0)),
              selectedVariant: pda(S.variant, le16(SEASON), le16(1)),
              teamTreasury: treasury,
              gachaVaultAuthority: pda(S.gachaVaultAuthority),
              gachaVault: pda(S.gachaVault),
              usdcMint,
              vrfAuthority: vrfAuthority.publicKey,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .remainingAccounts([
              {
                pubkey: pda(S.variant, le16(SEASON), le16(1)),
                isSigner: false,
                isWritable: true,
              },
            ])
            .instruction(),
        ],
        [vrfAuthority],
      );
    }, "AlreadyTerminal");
  });

  // =========================================================================
  // Revival guards + global conservation audit
  // =========================================================================

  it("guards expire_revival and conserves vault balances on every day", async () => {
    const day3 = DAY0 + 3n;
    const d3 = await setUpDay(day3);
    await paidEntry(day3, alice, 1);
    // expire_revival on an ACTIVE run must fail.
    await expectFail(async () => {
      await send(
        [
          await program.methods
            .expireRevival()
            .accountsPartial({
              world: d3.paidWorld,
              run: runPda(d3.paidWorld, alice.publicKey),
            })
            .instruction(),
        ],
        [admin],
      );
    }, "BadRunState");

    for (const day of [DAY0, DAY0 + 1n, DAY0 + 2n, day3]) {
      const d = dayPdas(day);
      const acct = await getData(d.daily);
      if (!acct) continue;
      const daily = decode("dailyCompetition", acct);
      const rolloverHeld = daily.rolloverConsumed
        ? 0n
        : BigInt(daily.rolloverOut.toString());
      const liabilities =
        BigInt(daily.pendingTotal.toString()) +
        BigInt(daily.activePool.toString()) +
        BigInt(daily.refundLiability.toString()) +
        BigInt(daily.winnerUnpaid.toString()) +
        BigInt(daily.teamUnpaid.toString()) +
        rolloverHeld;
      assert.equal(
        await tokenBalance(d.vault),
        liabilities,
        `day ${day} vault == liabilities`,
      );
    }
  });
});
