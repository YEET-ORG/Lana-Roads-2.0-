/**
 * Settle a finished day, end to end.
 *
 * Opening a day is one transaction; closing one is a pipeline across both
 * planes, and every stage is blocked by the one before it:
 *
 *   ER   close_world           mark Closed, commit + undelegate to base
 *   ER   commit_state          runs behind unreconciled payments
 *   base close_day             Open -> Closed (permissionless, after cutoff)
 *   base reconcile_receipt     every Pending payment -> Consumed/Refundable
 *   base record_final_commit   Closed -> Committed (reads the final record)
 *   base finalize_day          Committed -> Settled; pays winner + team
 *   base consume_rollover      a no-winner pool moves into the next day
 *
 * Until this runs, a paid competition takes entry money and pays nobody:
 * the vault holds it, `daily.status` stays Open, and the world stays
 * delegated forever. The frontier keeper imports `ensureDaySettled` so
 * yesterday closes itself; running this file settles a day by hand.
 *
 *   npx tsx scripts/settle-day.ts             # yesterday
 *   DAY=20678 npx tsx scripts/settle-day.ts   # a specific day
 *   DRY_RUN=1 npx tsx scripts/settle-day.ts   # report, change nothing
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROGRAM_ID = new web3.PublicKey("GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX");
const TOKEN_PROGRAM = new web3.PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM = new web3.PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
/** Accounts per commit/undelegate bundle — the program caps it at 8. */
const BUNDLE = 8;

const le8 = (v: bigint | number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};
const pda = (...s: Buffer[]) => web3.PublicKey.findProgramAddressSync(s, PROGRAM_ID)[0];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const configPda = () => pda(Buffer.from("config"));
export const dailyPda = (day: bigint) => pda(Buffer.from("daily"), le8(day));
export const worldPda = (mode: number, day: bigint) =>
  pda(Buffer.from("world"), Buffer.from([mode]), le8(day));
export const vaultAuthorityPda = (day: bigint) =>
  pda(Buffer.from("daily_vault"), le8(day));
export const contributionPda = (day: bigint, wallet: web3.PublicKey) =>
  pda(Buffer.from("contribution"), le8(day), wallet.toBuffer());

const statusOf = (v: any) => Object.keys(v ?? {})[0] ?? "?";

/** Day id of the UTC day containing `unixSeconds`. */
export const dayOf = (unixSeconds: number) => BigInt(Math.floor(unixSeconds / 86400));
/** Exclusive end of a day — the hard cutoff, mirroring kernel::time. */
export const dayEnd = (day: bigint) => (day + 1n) * 86400n;

export interface SettleResult {
  day: bigint;
  status: string;
  /** What this pass actually did, in order. */
  did: string[];
  /** What it could not do yet, and why. */
  blocked: string[];
  winner?: string;
  winnerAmount?: bigint;
  teamAmount?: bigint;
  rolloverOut?: bigint;
}

async function withRetry<T>(what: string, fn: () => Promise<T>, tries = 6): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const msg = String(e?.transactionMessage ?? e?.message ?? e);
      if (!/429|Too Many Requests|blockhash/i.test(msg)) throw e;
      last = e;
      await sleep(Math.min(8000, 600 * 2 ** i));
    }
  }
  throw new Error(`${what}: gave up (${last?.message ?? last})`);
}

const errText = (e: any) => {
  const code = (e?.transactionLogs as string[] | undefined)
    ?.map((l) => l.match(/Error Code: (\w+)/)?.[1])
    .find(Boolean);
  return code ?? String(e?.transactionMessage ?? e?.message ?? e).slice(0, 120);
};

/**
 * Push a day as far towards Settled as its current state allows.
 *
 * Every stage is idempotent and independently skippable, so this is safe to
 * call on a schedule and safe to call twice: a half-finished settlement (a
 * paid winner but an unpaid team leg, say) resumes exactly where it stopped.
 */
export async function ensureDaySettled(opts: {
  baseProgram: Program<any>;
  erProgram: Program<any>;
  admin: web3.Keypair;
  day: bigint;
  dryRun?: boolean;
  /** Allow voiding a day that was prepared but never opened (no deposits). */
  voidStale?: boolean;
  /** Seconds to wait for an undelegation to land on base. */
  undelegateTimeoutMs?: number;
  log?: (...a: any[]) => void;
}): Promise<SettleResult> {
  const { baseProgram, erProgram, admin, day } = opts;
  const log = opts.log ?? (() => {});
  const dry = opts.dryRun ?? false;
  const conn = baseProgram.provider.connection;
  const out: SettleResult = { day, status: "?", did: [], blocked: [] };

  const daily: any = await withRetry("fetch daily", () =>
    baseProgram.account.dailyCompetition.fetchNullable(dailyPda(day)),
  );
  if (!daily) {
    out.status = "missing";
    out.blocked.push("no daily competition for this day");
    return out;
  }
  out.status = statusOf(daily.status);

  const now = Math.floor(Date.now() / 1000);
  if (BigInt(now) < dayEnd(day)) {
    out.blocked.push(`cutoff not reached (${Number(dayEnd(day)) - now}s to go)`);
    return out;
  }
  if (out.status === "settled" || out.status === "voided") {
    // Nothing left but the rollover hand-off, which has its own stage.
    await consumeRollover();
    return out;
  }

  // ---- stage A: close both worlds and get them back onto base ----------
  // Which plane a world lives on is decided by OWNERSHIP, not by which RPC
  // can read it: the rollup happily serves an undelegated account it has
  // cloned, and writing to it there fails with "modified data of a
  // read-only account". Base ownership means the world never left, or has
  // already come back, and `close_world_base` is the instruction for it.
  for (const mode of [0, 1]) {
    const world = worldPda(mode, day);
    const baseInfo = await withRetry("fetch world", () =>
      conn.getAccountInfo(world),
    ).catch(() => null);
    if (!baseInfo) continue; // no such world for this day
    const delegated = !baseInfo.owner.equals(PROGRAM_ID);

    if (delegated) {
      const live: any = await erProgram.account.worldHeader
        .fetchNullable(world)
        .catch(() => null);
      if (!live) {
        out.blocked.push(`mode ${mode}: delegated but not readable on the ER`);
        continue;
      }
      if (statusOf(live.status) === "closed") continue;
      if (dry) {
        out.did.push(`would close world (mode ${mode}) on the ER`);
        continue;
      }
      try {
        await withRetry(`close_world mode ${mode}`, () =>
          erProgram.methods
            .closeWorld()
            .accountsPartial({ payer: admin.publicKey, world })
            .rpc({ commitment: "processed" }),
        );
        out.did.push(`closed world (mode ${mode}) on the ER`);
      } catch (e) {
        out.blocked.push(`close_world mode ${mode}: ${errText(e)}`);
      }
    } else {
      const onBase: any = await baseProgram.account.worldHeader
        .fetchNullable(world)
        .catch(() => null);
      if (!onBase || statusOf(onBase.status) === "closed") continue;
      if (dry) {
        out.did.push(`would close world (mode ${mode}) on base`);
        continue;
      }
      try {
        await withRetry(`close_world_base mode ${mode}`, () =>
          baseProgram.methods.closeWorldBase().accountsPartial({ world }).rpc(),
        );
        out.did.push(`closed world (mode ${mode}) on base`);
      } catch (e) {
        out.blocked.push(`close_world_base mode ${mode}: ${errText(e)}`);
      }
    }
  }

  // Undelegation is asynchronous: the ER commits, then the delegation
  // program hands ownership back. Settlement reads the world as a typed
  // base account, so it cannot proceed until that has actually landed.
  const paidWorld = worldPda(0, day);
  if (!dry) {
    const deadline = Date.now() + (opts.undelegateTimeoutMs ?? 90_000);
    for (;;) {
      const info = await conn.getAccountInfo(paidWorld).catch(() => null);
      if (info?.owner.equals(PROGRAM_ID)) break;
      if (Date.now() > deadline) {
        out.blocked.push("paid world has not come back to base yet");
        break;
      }
      await sleep(3000);
    }
  }

  // ---- stage B: close the day -----------------------------------------
  // A day that was prepared but never opened cannot be closed — `close_day`
  // only accepts Open. Nobody could have paid into it either, since paid
  // entry requires an Open day, so voiding is the honest end for it. That
  // is still an irreversible money-state change, so it needs asking for.
  if (statusOf(daily.status) === "prepared") {
    const deposited = BigInt(daily.totalDeposited.toString());
    if (!opts.voidStale) {
      out.blocked.push(
        `day is Prepared and was never opened; run with VOID_STALE=1 to void it ` +
          `(deposits: ${deposited})`,
      );
    } else if (deposited > 0n) {
      out.blocked.push(
        `refusing to auto-void: ${deposited} was deposited into this day`,
      );
    } else if (dry) {
      out.did.push("would void the unopened day");
    } else {
      try {
        await withRetry("void_day", () =>
          baseProgram.methods
            .voidDay()
            .accountsPartial({
              config: configPda(),
              daily: dailyPda(day),
              admin: admin.publicKey,
            })
            .rpc(),
        );
        out.did.push("voided the unopened day");
      } catch (e) {
        out.blocked.push(`void_day: ${errText(e)}`);
      }
    }
  }

  if (statusOf(daily.status) === "open") {
    if (dry) out.did.push("would close the day");
    else {
      try {
        await withRetry("close_day", () =>
          baseProgram.methods
            .closeDay()
            .accountsPartial({ daily: dailyPda(day) })
            .rpc(),
        );
        out.did.push("closed the day");
      } catch (e) {
        out.blocked.push(`close_day: ${errText(e)}`);
      }
    }
  }

  // ---- stage C: reconcile every pending payment ------------------------
  // `pending_total != 0` blocks settlement outright, and each pending
  // receipt is judged against its run's COMMITTED state — so the runs have
  // to be pushed to base before anything can be decided about them.
  const receipts: any[] = await withRetry("list receipts", () =>
    baseProgram.account.paymentReceipt.all([
      // 8 discriminator + 1 kind + 1 state, then the day.
      { memcmp: { offset: 10, bytes: anchor.utils.bytes.bs58.encode(le8(day)) } },
    ]),
  ).catch(() => []);
  const pending = receipts.filter(
    ({ account }: any) => statusOf(account.state) === "pending",
  );
  if (pending.length) {
    const runs = [...new Set(pending.map(({ account }: any) => account.run.toBase58()))];
    if (dry) {
      out.did.push(`would reconcile ${pending.length} pending receipt(s)`);
    } else {
      // Commit the ER's view of those runs first; a stale committed copy
      // makes a revival receipt undecidable and the day unsettleable. Only
      // DELEGATED runs can be committed — one that already came back to
      // base is final by definition, and asking the rollup to commit it is
      // rejected outright ("provided owner is not allowed").
      const infos = await withRetry("scan runs", () =>
        conn.getMultipleAccountsInfo(runs.map((r) => new web3.PublicKey(r))),
      ).catch(() => runs.map(() => null));
      const delegatedRuns = runs.filter(
        (_r, i) => infos[i] && !infos[i]!.owner.equals(PROGRAM_ID),
      );
      for (let i = 0; i < delegatedRuns.length; i += BUNDLE) {
        const batch = delegatedRuns.slice(i, i + BUNDLE).map((r) => ({
          pubkey: new web3.PublicKey(r),
          isSigner: false,
          isWritable: true,
        }));
        try {
          await withRetry("commit_state", () =>
            erProgram.methods
              .commitState()
              .accountsPartial({ payer: admin.publicKey })
              .remainingAccounts(batch)
              .rpc({ commitment: "processed" }),
          );
        } catch (e) {
          out.blocked.push(`commit_state: ${errText(e)}`);
        }
      }
      // Only wait when something was actually committed.
      if (delegatedRuns.length) await sleep(4000);
      let done = 0;
      for (const { publicKey, account } of pending as any[]) {
        try {
          await withRetry("reconcile_receipt", () =>
            baseProgram.methods
              .reconcileReceipt()
              .accountsPartial({
                daily: dailyPda(day),
                receipt: publicKey,
                run: account.run,
                contribution: contributionPda(day, account.wallet),
              })
              .rpc(),
          );
          done += 1;
        } catch (e) {
          out.blocked.push(`receipt ${publicKey.toBase58().slice(0, 8)}: ${errText(e)}`);
        }
      }
      if (done) out.did.push(`reconciled ${done}/${pending.length} pending receipt(s)`);
    }
  }

  // ---- stage D: record the final committed record ----------------------
  let fresh: any = await baseProgram.account.dailyCompetition.fetch(dailyPda(day));
  if (statusOf(fresh.status) === "closed") {
    if (dry) out.did.push("would record the final commit");
    else {
      try {
        await withRetry("record_final_commit", () =>
          baseProgram.methods
            .recordFinalCommit()
            .accountsPartial({ daily: dailyPda(day), paidWorld })
            .rpc(),
        );
        out.did.push("recorded the final commit");
        fresh = await baseProgram.account.dailyCompetition.fetch(dailyPda(day));
      } catch (e) {
        out.blocked.push(`record_final_commit: ${errText(e)}`);
      }
    }
  }

  // ---- stage E: settle -------------------------------------------------
  if (statusOf(fresh.status) === "committed") {
    const config: any = await baseProgram.account.globalConfig.fetch(configPda());
    const hasWinner = fresh.settledScore !== 0;
    const winner: web3.PublicKey = fresh.settledWinner;
    // A winner who never held a USDC account still has to be paid, so the
    // account is created here rather than the payout failing on their
    // behalf. With no winner the slot is unused but still type-checked, so
    // the treasury stands in.
    let winnerToken = config.teamTreasury as web3.PublicKey;
    if (hasWinner) {
      winnerToken = ataFor(config.usdcMint, winner);
      const exists = await conn.getAccountInfo(winnerToken).catch(() => null);
      if (!exists) {
        if (dry) out.did.push("would create the winner's USDC account");
        else {
          try {
            await withRetry("create winner ATA", () =>
              (baseProgram.provider as anchor.AnchorProvider).sendAndConfirm!(
                new web3.Transaction().add(
                  createAtaIx(admin.publicKey, winner, config.usdcMint, winnerToken),
                ),
              ),
            );
            out.did.push("created the winner's USDC account");
          } catch (e) {
            out.blocked.push(`winner ATA: ${errText(e)}`);
          }
        }
      }
    }

    if (dry) {
      out.did.push("would finalize the day");
    } else {
      try {
        await withRetry("finalize_day", () =>
          baseProgram.methods
            .finalizeDay()
            .accountsPartial({
              config: configPda(),
              daily: dailyPda(day),
              vaultAuthority: vaultAuthorityPda(day),
              vault: fresh.vault,
              winnerToken,
              teamTreasury: config.teamTreasury,
              usdcMint: config.usdcMint,
              tokenProgram: config.tokenProgram,
              admin: admin.publicKey,
            })
            .rpc(),
        );
        fresh = await baseProgram.account.dailyCompetition.fetch(dailyPda(day));
        out.did.push("settled the day");
      } catch (e) {
        out.blocked.push(`finalize_day: ${errText(e)}`);
      }
    }
  }

  out.status = statusOf(fresh.status);
  out.winner = fresh.settledScore !== 0 ? fresh.settledWinner.toBase58() : undefined;
  out.winnerAmount = BigInt(fresh.winnerAmount.toString());
  out.teamAmount = BigInt(fresh.teamAmount.toString());
  out.rolloverOut = BigInt(fresh.rolloverOut.toString());

  await consumeRollover();
  return out;

  /**
   * A no-winner day's pool belongs to the next day, and only the next day's
   * account can receive it — so this runs last, and quietly does nothing
   * until tomorrow exists.
   */
  async function consumeRollover() {
    const d: any = await baseProgram.account.dailyCompetition
      .fetchNullable(dailyPda(day))
      .catch(() => null);
    if (!d || statusOf(d.status) !== "settled") return;
    if (d.rolloverConsumed) return;
    const amount = BigInt(d.rolloverOut.toString());
    if (amount === 0n) return;
    const next: any = await baseProgram.account.dailyCompetition
      .fetchNullable(dailyPda(day + 1n))
      .catch(() => null);
    if (!next) {
      out.blocked.push("rollover waiting: the next day is not prepared yet");
      return;
    }
    if (dry) {
      out.did.push(`would roll ${amount} into day ${day + 1n}`);
      return;
    }
    const config: any = await baseProgram.account.globalConfig.fetch(configPda());
    try {
      await withRetry("consume_rollover", () =>
        baseProgram.methods
          .consumeRollover()
          .accountsPartial({
            config: configPda(),
            previous: dailyPda(day),
            daily: dailyPda(day + 1n),
            previousVaultAuthority: vaultAuthorityPda(day),
            previousVault: d.vault,
            vault: next.vault,
            usdcMint: config.usdcMint,
            tokenProgram: config.tokenProgram,
          })
          .rpc(),
      );
      out.did.push(`rolled ${amount} into day ${day + 1n}`);
    } catch (e) {
      out.blocked.push(`consume_rollover: ${errText(e)}`);
    }
  }
}

function ataFor(mint: web3.PublicKey, owner: web3.PublicKey): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

/** Idempotent ATA creation (`createAssociatedTokenAccountIdempotent`, ix 1). */
function createAtaIx(
  payer: web3.PublicKey,
  owner: web3.PublicKey,
  mint: web3.PublicKey,
  ata: web3.PublicKey,
): web3.TransactionInstruction {
  return new web3.TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export function loadKeypair(path: string) {
  return web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
  );
}

async function main() {
  const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
  const ER_RPC = process.env.ER_RPC ?? "https://devnet-as.magicblock.app";
  const admin = loadKeypair(
    process.env.ADMIN_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`,
  );
  const day = BigInt(process.env.DAY ?? dayOf(Math.floor(Date.now() / 1000)) - 1n);
  const idl = JSON.parse(
    readFileSync(resolve(__dirname, "../target/idl/crossy_world.json"), "utf8"),
  );
  const wallet = new anchor.Wallet(admin);
  const baseProgram = new Program(
    idl,
    new anchor.AnchorProvider(new web3.Connection(BASE_RPC, "confirmed"), wallet, {
      commitment: "confirmed",
    }),
  ) as Program<any>;
  const erProgram = new Program(
    idl,
    new anchor.AnchorProvider(new web3.Connection(ER_RPC, "processed"), wallet, {
      commitment: "processed",
    }),
  ) as Program<any>;

  const out = await ensureDaySettled({
    baseProgram,
    erProgram,
    admin,
    day,
    dryRun: process.env.DRY_RUN === "1",
    voidStale: process.env.VOID_STALE === "1",
    log: (...a) => console.log(...a),
  });
  console.log(
    JSON.stringify(
      out,
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  );
}

if (require.main === module) {
  process.on("unhandledRejection", (e) => console.error("(ignored, post-run)", e));
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
