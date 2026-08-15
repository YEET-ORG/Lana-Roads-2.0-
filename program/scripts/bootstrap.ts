/**
 * Bring a freshly deployed program up to a usable chain.
 *
 * A deployed program owns nothing. Until `initialize_config` runs there is no
 * config PDA, so every other instruction fails its `seeds`/`bump` check and
 * nothing else can be created — no season, no day, no world, no keeper. This
 * was only ever done inside the integration tests, which meant a real
 * deployment had no operator path at all.
 *
 * Each step checks the chain first and skips what already exists, so the
 * script is safe to re-run after a partial failure. Every value it writes is
 * read back and compared before the script reports success: a config with a
 * wrong mint or validator is not something to discover from a failing game.
 *
 *   npx tsx scripts/bootstrap.ts
 *   DRY_RUN=1 npx tsx scripts/bootstrap.ts
 *   COLLECTION=<pubkey> npx tsx scripts/bootstrap.ts   # reuse a collection
 *
 * The Core collection is the one part that cannot be recovered by re-running.
 * Its update authority is the program's ["mint_authority"] PDA, which is
 * derived from the PROGRAM ID — so a collection created under a previous
 * deployment is permanently orphaned once that program is closed, and a new
 * one must be created here. If this script creates a collection and then
 * fails before `initialize_config`, it writes the keypair to
 * `.bootstrap/collection-keypair.json` and prints the address; pass it back
 * via COLLECTION= rather than minting a second one.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import {
  getMint,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createCollectionV2 } from "@metaplex-foundation/mpl-core";
import { createSignerFromKeypair, generateSigner, signerIdentity } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { fromWeb3JsKeypair, toWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters";
import { publicKey as umiPk } from "@metaplex-foundation/umi";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PROGRAM_ID = new web3.PublicKey("5FBMHsiUcRZ5RiKYWd6XhRGkA3FifP4nji9RKijLYuLx");
const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
/** Test USDC on devnet: six decimals, classic SPL, mint authority is ours. */
const USDC_MINT = new web3.PublicKey(
  process.env.USDC_MINT ?? "4TLcFzJ8KEJCmxKLnsFRF7fWEMuRE27kqBYdChYV9J6E",
);
/** Region id -> MagicBlock validator. Must match apps/web/src/lib/regions.ts. */
const REGION_VALIDATOR = [
  "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
  "MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e",
  "MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd",
];

/**
 * Every region this deployment opens, in region-id order.
 *
 * `initialize_config` seeds region 0 only, so a fresh chain would otherwise
 * have exactly one playable region and `prepare_day` would refuse the rest.
 */
const REGIONS: { id: number; key: string; validator: web3.PublicKey }[] = [
  { id: 0, key: "as", validator: new web3.PublicKey(REGION_VALIDATOR[0]) },
  { id: 1, key: "eu", validator: new web3.PublicKey(REGION_VALIDATOR[1]) },
  { id: 2, key: "us", validator: new web3.PublicKey(REGION_VALIDATOR[2]) },
];
const VALIDATOR = REGIONS[0].validator;
const MAX_PAID_PLAYERS = Number(process.env.MAX_PAID_PLAYERS ?? 500);
const MAX_CASUAL_PLAYERS = Number(process.env.MAX_CASUAL_PLAYERS ?? 500);
const COLLECTION_NAME = process.env.COLLECTION_NAME ?? "Lana Roads Agents";
const COLLECTION_URI =
  process.env.COLLECTION_URI ?? "https://lanaroads.xyz/agents/collection.json";

const pda = (...seeds: Buffer[]) =>
  web3.PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ok = (label: string, value: unknown) => console.log(`  ✓ ${label}: ${value}`);

/** Devnet public RPC rate-limits hard; nothing here is worth failing over. */
async function withRetry<T>(what: string, fn: () => Promise<T>, tries = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      const msg = String(e?.transactionMessage ?? e?.message ?? e);
      if (/already in use/.test(msg)) throw e;
      const wait = Math.min(8_000, 700 * 2 ** i);
      console.log(`  retry ${what} in ${wait}ms (${msg.slice(0, 90)})`);
      await sleep(wait);
    }
  }
  throw last;
}

async function main() {
  const dry = process.env.DRY_RUN === "1";
  const admin = web3.Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        readFileSync(
          process.env.ADMIN_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`,
          "utf8",
        ),
      ),
    ),
  );
  const conn = new web3.Connection(BASE_RPC, "confirmed");
  const idl = JSON.parse(
    readFileSync(resolve(__dirname, "../target/idl/crossy_world.json"), "utf8"),
  );
  const program = new Program(
    idl,
    new anchor.AnchorProvider(conn, new anchor.Wallet(admin), {
      commitment: "confirmed",
    }),
  ) as Program<any>;

  const configPda = pda(Buffer.from("config"));
  const mintAuthority = pda(Buffer.from("mint_authority"));

  console.log(`program        ${PROGRAM_ID.toBase58()}`);
  console.log(`admin          ${admin.publicKey.toBase58()}`);
  console.log(`mint authority ${mintAuthority.toBase58()}  (collection update authority)`);
  console.log(`balance        ${(await conn.getBalance(admin.publicKey)) / 1e9} SOL`);

  // The program must actually be deployed; an executable-less ID produces
  // confusing "Unsupported program id" failures several steps later.
  const programInfo = await conn.getAccountInfo(PROGRAM_ID);
  if (!programInfo?.executable) {
    throw new Error(`${PROGRAM_ID.toBase58()} is not a deployed executable on ${BASE_RPC}`);
  }

  // ---- 1. config -------------------------------------------------------
  const existing = await program.account.globalConfig.fetchNullable(configPda);
  if (existing) {
    console.log("\nconfig already initialized — verifying it");
    await verifyConfig(program, configPda, existing, mintAuthority);
    // Regions can be opened after the fact, so a re-run tops up any that are
    // missing rather than reporting a bootstrapped chain that cannot host
    // two thirds of its worlds.
    for (const region of REGIONS) {
      const current: web3.PublicKey = existing.validators[region.id];
      if (current && current.equals(region.validator)) {
        ok(`region ${region.id} (${region.key})`, "already open");
        continue;
      }
      if (dry) {
        console.log(`  would open region ${region.id} (${region.key})`);
        continue;
      }
      await withRetry(`set_validator ${region.key}`, () =>
        program.methods
          .setValidator(region.id, region.validator)
          .accountsPartial({ config: configPda, admin: admin.publicKey })
          .rpc(),
      );
      ok(`region ${region.id} (${region.key})`, region.validator.toBase58());
    }
    console.log("\nchain is already bootstrapped.");
    return;
  }

  // ---- 2. USDC mint ----------------------------------------------------
  console.log("\nchecking the mint");
  const mint = await getMint(conn, USDC_MINT, "confirmed", TOKEN_PROGRAM_ID).catch(
    (e) => {
      throw new Error(
        `${USDC_MINT.toBase58()} is not a classic SPL mint on this cluster: ${e.message}`,
      );
    },
  );
  if (mint.decimals !== 6) {
    throw new Error(`mint has ${mint.decimals} decimals; the program requires 6`);
  }
  ok("mint", `${USDC_MINT.toBase58()} (6 decimals, classic SPL)`);

  // ---- 3. team treasury ------------------------------------------------
  // The canonical ATA rather than a loose token account: it is derivable, so
  // an operator can always find where the team's 10% lands.
  console.log("\nensuring the team treasury");
  if (dry) {
    console.log("  would create/reuse the admin's USDC associated token account");
  }
  const treasury = dry
    ? admin.publicKey
    : (
        await withRetry("treasury ATA", () =>
          getOrCreateAssociatedTokenAccount(conn, admin, USDC_MINT, admin.publicKey),
        )
      ).address;
  ok("treasury", treasury.toBase58());

  // ---- 4. Core collection ---------------------------------------------
  console.log("\nensuring the Core collection");
  let collection: web3.PublicKey;
  if (process.env.COLLECTION) {
    collection = new web3.PublicKey(process.env.COLLECTION);
    const info = await conn.getAccountInfo(collection);
    if (!info) throw new Error(`COLLECTION ${collection.toBase58()} does not exist`);
    // Byte 0 is the Core account discriminant; bytes 1..33 the update
    // authority. A collection the program cannot sign for is useless: every
    // claim would fail at the mpl-core CPI, after the player has paid.
    const authority = new web3.PublicKey(info.data.subarray(1, 33));
    if (!authority.equals(mintAuthority)) {
      throw new Error(
        `collection update authority is ${authority.toBase58()}, but this program ` +
          `signs as ${mintAuthority.toBase58()} — claims would fail`,
      );
    }
    ok("collection (reused)", collection.toBase58());
  } else if (dry) {
    console.log("  would create a new Core collection");
    collection = web3.PublicKey.default;
  } else {
    const umi = createUmi(BASE_RPC, { commitment: "confirmed" });
    umi.use(signerIdentity(createSignerFromKeypair(umi, fromWeb3JsKeypair(admin))));
    const signer = generateSigner(umi);
    // Save before sending: a collection that lands on chain after the client
    // gives up is otherwise unrecoverable, and its keypair is the only proof
    // of which one this run made.
    const dir = resolve(__dirname, "../.bootstrap");
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, "collection-keypair.json");
    writeFileSync(path, JSON.stringify([...signer.secretKey]));
    await withRetry("create collection", () =>
      createCollectionV2(umi, {
        collection: signer,
        name: COLLECTION_NAME,
        uri: COLLECTION_URI,
        updateAuthority: umiPk(mintAuthority.toBase58()),
      }).sendAndConfirm(umi),
    );
    collection = toWeb3JsPublicKey(signer.publicKey);
    ok("collection (created)", `${collection.toBase58()}  [keypair: ${path}]`);
  }

  // ---- 5. initialize_config -------------------------------------------
  console.log("\ninitializing config");
  if (dry) {
    console.log(
      `  would call initialize_config(${MAX_PAID_PLAYERS}, ${MAX_CASUAL_PLAYERS})`,
    );
    console.log("\ndry run complete; nothing was written.");
    return;
  }
  await withRetry("initialize_config", () =>
    program.methods
      .initializeConfig(MAX_PAID_PLAYERS, MAX_CASUAL_PLAYERS)
      .accountsPartial({
        config: configPda,
        usdcMint: USDC_MINT,
        teamTreasury: treasury,
        collection,
        collectionAuthority: mintAuthority,
        validator: VALIDATOR,
        admin: admin.publicKey,
      })
      .rpc(),
  );

  // ---- 6. open the remaining regions -----------------------------------
  // Each region runs its own world on its own rollup, so every one needs a
  // validator before a day can be prepared there.
  console.log("\nopening regions");
  for (const region of REGIONS.slice(1)) {
    await withRetry(`set_validator ${region.key}`, () =>
      program.methods
        .setValidator(region.id, region.validator)
        .accountsPartial({ config: configPda, admin: admin.publicKey })
        .rpc(),
    );
    ok(`region ${region.id} (${region.key})`, region.validator.toBase58());
  }

  // ---- 7. read back ----------------------------------------------------
  console.log("\nverifying what landed on chain");
  const written = await program.account.globalConfig.fetch(configPda);
  await verifyConfig(program, configPda, written, mintAuthority, {
    treasury,
    collection,
  });

  console.log("\nbootstrapped. Next:");
  console.log("  npx tsx scripts/seed-gacha.ts     # season, banners, pools, variants");
  console.log("  npx tsx scripts/open-day.ts       # prepare + delegate + open today");
  console.log("  ./scripts/run-keeper.sh           # frontier, hazards, settlement");
}

/**
 * Compare every field against what it must be. Reading the account back is
 * the only way to know the deployment is configured rather than merely
 * transacted against — a wrong validator or mint would surface much later,
 * as delegation or payment failures with no obvious cause.
 */
async function verifyConfig(
  _program: Program<any>,
  configPda: web3.PublicKey,
  config: any,
  mintAuthority: web3.PublicKey,
  expected?: { treasury: web3.PublicKey; collection: web3.PublicKey },
) {
  const problems: string[] = [];
  const check = (label: string, actual: any, want: any) => {
    const a = actual?.toBase58?.() ?? String(actual);
    const w = want?.toBase58?.() ?? String(want);
    if (a !== w) problems.push(`${label}: on chain ${a}, expected ${w}`);
    else ok(label, a);
  };

  console.log(`  config pda: ${configPda.toBase58()}`);
  check("usdc mint", config.usdcMint, USDC_MINT);
  check("token program", config.tokenProgram, TOKEN_PROGRAM_ID);
  check("validator (region 0)", config.validators[0], VALIDATOR);
  check("collection authority", config.collectionAuthority, mintAuthority);
  check("winner bps", config.winnerBps, 9000);
  check("team bps", config.teamBps, 1000);
  check("max paid players", config.maxPaidPlayers, MAX_PAID_PLAYERS);
  check("max casual players", config.maxCasualPlayers, MAX_CASUAL_PLAYERS);
  check("pause flags", config.pauseFlags, 0);
  if (expected) {
    check("team treasury", config.teamTreasury, expected.treasury);
    check("collection", config.collection, expected.collection);
  } else {
    ok("team treasury", config.teamTreasury.toBase58());
    ok("collection", config.collection.toBase58());
  }
  ok("admin", config.admin.toBase58());

  if (problems.length) {
    throw new Error(`config does not match intent:\n  - ${problems.join("\n  - ")}`);
  }
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
