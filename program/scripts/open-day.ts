/**
 * Bring a UTC day online, end to end.
 *
 * A day is not a config value — it is a set of accounts. `prepare_day` mints
 * the competition, both worlds and the spawn chunk; the spawn sectors have to
 * exist before anyone can stand on them; and none of it is playable until the
 * world and those sectors are delegated to the ephemeral rollup. Miss any one
 * step and the client sees exactly what an outage looks like: a world that
 * isn't there, zero players, and a Play button that falls back to practice.
 *
 * The frontier keeper imports `ensureDayReady` so the roll into a new day
 * happens on its own; running this file does the same thing by hand.
 *
 *   npx tsx scripts/open-day.ts            # today
 *   DAY=20680 npx tsx scripts/open-day.ts  # a specific day
 *   MODES=0,1 npx tsx scripts/open-day.ts  # paid as well as casual
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PROGRAM_ID = new web3.PublicKey(
  "GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX",
);
const DELEGATION_PROGRAM = new web3.PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
const TOKEN_PROGRAM = new web3.PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
/** Chunk 0 covers rows 0-15, i.e. sector bands y=0 and y=1. */
const SPAWN_BANDS = 2;
const SECTORS_WIDE = 8;

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
const pda = (...s: (Buffer | Uint8Array)[]) =>
  web3.PublicKey.findProgramAddressSync(s as Buffer[], PROGRAM_ID)[0];

export const worldPda = (mode: number, day: bigint) =>
  pda(Buffer.from("world"), Buffer.from([mode]), le8(day));
export const dailyPda = (day: bigint) => pda(Buffer.from("daily"), le8(day));
export const chunkPda = (day: bigint, index: number) =>
  pda(Buffer.from("chunk"), le8(day), le2(index));
export const sectorPda = (world: web3.PublicKey, sx: number, sy: number) =>
  pda(Buffer.from("sector"), world.toBuffer(), Buffer.from([sx]), le2(sy));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Public devnet RPC throttles hard, and day setup is a burst of writes right
 * when the keeper is also busy. A 429 says "later", not "no" — treat it as
 * such, and let anything else fail loudly.
 */
async function withRetry<T>(what: string, fn: () => Promise<T>, tries = 8): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!/429|Too Many Requests|blockhash not found|Blockhash/i.test(msg)) throw e;
      last = e;
      await sleep(Math.min(8000, 700 * 2 ** i));
    }
  }
  throw new Error(`${what}: gave up after ${tries} tries (${last?.message ?? last})`);
}

export interface DaySetupResult {
  day: bigint;
  prepared: boolean;
  sectorsCreated: number;
  delegated: number[];
  opened: boolean;
  notes: string[];
}

/**
 * Make `day` playable, doing only what is still missing.
 *
 * Every step is idempotent so this is safe to call on a schedule: the day may
 * already be prepared, some sectors may already exist, and the world may
 * already be delegated. What matters is the end state, not who got there.
 */
export async function ensureDayReady(opts: {
  baseProgram: Program<any>;
  admin: web3.Keypair;
  validator: web3.PublicKey;
  day: bigint;
  modes?: number[];
  log?: (...args: any[]) => void;
}): Promise<DaySetupResult> {
  const { baseProgram, admin, validator, day } = opts;
  const modes = opts.modes ?? [1];
  const log = opts.log ?? (() => {});
  const conn = baseProgram.provider.connection;
  const result: DaySetupResult = {
    day,
    prepared: false,
    sectorsCreated: 0,
    delegated: [],
    opened: false,
    notes: [],
  };

  const config = await withRetry("fetch config", () =>
    baseProgram.account.globalConfig.fetch(pda(Buffer.from("config"))),
  );
  if (!config.admin.equals(admin.publicKey)) {
    throw new Error(
      `config.admin is ${config.admin.toBase58()} but this keypair is ` +
        `${admin.publicKey.toBase58()}; day setup is admin-only`,
    );
  }

  const daily = dailyPda(day);
  if (!(await withRetry("fetch daily", () => conn.getAccountInfo(daily)))) {
    log(`day ${day}: preparing (daily + both worlds + spawn chunk)`);
    await withRetry("prepare_day", () =>
      baseProgram.methods
      .prepareDay(new BN(day.toString()))
      .accountsPartial({
        config: pda(Buffer.from("config")),
        daily,
        vaultAuthority: pda(Buffer.from("daily_vault"), le8(day)),
        vault: pda(Buffer.from("daily_vault"), le8(day), Buffer.from("ata")),
        usdcMint: config.usdcMint,
        paidWorld: worldPda(0, day),
        casualWorld: worldPda(1, day),
        spawnChunk: chunkPda(day, 0),
        commitPayer: admin.publicKey,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .rpc(),
    );
    result.prepared = true;
  }

  const validatorMeta = { pubkey: validator, isSigner: false, isWritable: false };
  for (const mode of modes) {
    const world = worldPda(mode, day);

    // Spawn sectors must exist while the world is still on base: init_sector
    // reads the world, and a delegated world cannot be read as a typed
    // account there. Create first, delegate second — never the other way.
    for (let sy = 0; sy < SPAWN_BANDS; sy++) {
      const addrs = Array.from({ length: SECTORS_WIDE }, (_, sx) =>
        sectorPda(world, sx, sy),
      );
      const infos = await withRetry(`scan y=${sy}`, () =>
        conn.getMultipleAccountsInfo(addrs),
      );
      const missing = addrs.map((_, sx) => sx).filter((sx) => !infos[sx]);
      for (let i = 0; i < missing.length; i += 4) {
        const tx = new web3.Transaction();
        for (const sx of missing.slice(i, i + 4)) {
          tx.add(
            await baseProgram.methods
              .initSector(sx, sy)
              .accountsPartial({
                world,
                chunk: chunkPda(day, 0),
                sector: sectorPda(world, sx, sy),
                payer: admin.publicKey,
              })
              .instruction(),
          );
        }
        await withRetry(`init sectors y=${sy}`, () =>
          baseProgram.provider.sendAndConfirm!(tx),
        );
      }
      if (missing.length) {
        result.sectorsCreated += missing.length;
        log(`  mode ${mode}: created sectors y=${sy} x=[${missing.join(",")}]`);
      }
    }

    const worldInfo = await withRetry("fetch world", () => conn.getAccountInfo(world));
    if (worldInfo && worldInfo.owner.equals(PROGRAM_ID)) {
      log(`  mode ${mode}: delegating the world`);
      await withRetry("delegate_world", () =>
        baseProgram.methods
          .delegateWorld(mode, new BN(day.toString()))
          .accountsPartial({ payer: admin.publicKey, pda: world })
          .remainingAccounts([validatorMeta])
          .rpc(),
      );
      result.delegated.push(mode);
    } else if (!worldInfo) {
      result.notes.push(`mode ${mode}: world missing after prepare`);
      continue;
    }

    for (let sy = 0; sy < SPAWN_BANDS; sy++) {
      const addrs = Array.from({ length: SECTORS_WIDE }, (_, sx) =>
        sectorPda(world, sx, sy),
      );
      const infos = await withRetry(`rescan y=${sy}`, () =>
        conn.getMultipleAccountsInfo(addrs),
      );
      const toDelegate = addrs
        .map((_, sx) => sx)
        .filter((sx) => infos[sx] && infos[sx]!.owner.equals(PROGRAM_ID));
      // Two delegation CPIs per transaction: cheap on calls, safe on compute.
      for (let i = 0; i < toDelegate.length; i += 2) {
        const tx = new web3.Transaction();
        for (const sx of toDelegate.slice(i, i + 2)) {
          tx.add(
            await baseProgram.methods
              .delegateSector(world, sx, sy)
              .accountsPartial({ payer: admin.publicKey, pda: sectorPda(world, sx, sy) })
              .remainingAccounts([validatorMeta])
              .instruction(),
          );
        }
        await withRetry(`delegate y=${sy}`, () =>
          baseProgram.provider.sendAndConfirm!(tx),
        );
      }
      if (toDelegate.length)
        log(`  mode ${mode}: delegated sectors y=${sy} x=[${toDelegate.join(",")}]`);
    }
  }

  // Paid admission also needs the competition itself marked Open. Casual
  // play does not, so a failure here must not take the day down with it.
  const dailyAcc: any = await baseProgram.account.dailyCompetition
    .fetchNullable(daily)
    .catch(() => null);
  if (dailyAcc && Object.keys(dailyAcc.status)[0] === "prepared") {
    try {
      await baseProgram.methods
        .openDay()
        .accountsPartial({
          config: pda(Buffer.from("config")),
          daily,
          admin: admin.publicKey,
        })
        .rpc();
      result.opened = true;
      log(`  day ${day}: open for paid entry`);
    } catch (e: any) {
      const why = String(e?.transactionMessage ?? e?.message ?? e).slice(0, 120);
      result.notes.push(`open_day: ${why}`);
      log(`  day ${day}: not opened yet (${why})`);
    }
  }

  return result;
}

export function loadKeypair(path: string) {
  return web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
  );
}

async function main() {
  const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
  const validator = new web3.PublicKey(
    process.env.VALIDATOR ?? "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
  );
  const admin = loadKeypair(
    process.env.ADMIN_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`,
  );
  const day = BigInt(process.env.DAY ?? Math.floor(Date.now() / 1000 / 86400));
  const modes = (process.env.MODES ?? "1").split(",").map(Number);
  const idl = JSON.parse(
    readFileSync(resolve(__dirname, "../target/idl/crossy_world.json"), "utf8"),
  );
  const baseProgram = new Program(
    idl,
    new anchor.AnchorProvider(
      new web3.Connection(BASE_RPC, "confirmed"),
      new anchor.Wallet(admin),
      { commitment: "confirmed" },
    ),
  ) as Program<any>;

  const out = await ensureDayReady({
    baseProgram,
    admin,
    validator,
    day,
    modes,
    log: (...a) => console.log(...a),
  });
  console.log(JSON.stringify({ ...out, day: out.day.toString() }, null, 2));
}

if (require.main === module) {
  // web3.js keeps a websocket alive for the provider; a throttled devnet can
  // fail it seconds AFTER the work is finished, which would otherwise turn a
  // successful setup into a non-zero exit. Report and leave on our own terms.
  process.on("unhandledRejection", (e) => console.error("(ignored, post-run)", e));
  process.on("uncaughtException", (e) => console.error("(ignored, post-run)", e));
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
