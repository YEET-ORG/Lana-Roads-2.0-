/**
 * Assign pending gacha pulls.
 *
 * MagicBlock VRF writes verified randomness into a pull, after which this
 * permissionless crank completes deterministic rarity/variant assignment.
 *
 * The awkward part is `selected_variant`: the program re-derives the
 * selection from the randomness and requires the passed account to be
 * exactly the one it chose. Rather than transcribe `kernel::sampling` and
 * `kernel::pity` into TypeScript — a fourth copy of logic that has already
 * rotted out of sync twice in this project — this SIMULATES the assignment
 * against each candidate and sends the one the program accepts. The program
 * stays the only implementation of the selection.
 *
 *   npx tsx scripts/assign-pulls.ts          # one sweep
 *   WATCH=1 npx tsx scripts/assign-pulls.ts  # keep assigning
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROGRAM_ID = new web3.PublicKey("5FBMHsiUcRZ5RiKYWd6XhRGkA3FifP4nji9RKijLYuLx");
const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
const TOKEN_PROGRAM = new web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

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
const rarityPool = (season: number, rarity: number) =>
  pda(Buffer.from("rarity_pool"), le2(season), Buffer.from([rarity]));
const pda = (...s: (Buffer | Uint8Array)[]) =>
  web3.PublicKey.findProgramAddressSync(s as Buffer[], PROGRAM_ID)[0];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AssignResult {
  assigned: number;
  refundable: number;
  failed: string[];
}

/**
 * Assign every pull currently waiting. Idempotent: a pull that another
 * caller already assigned simply is not Pending any more.
 */
export async function assignPendingPulls(opts: {
  program: Program<any>;
  authority: web3.Keypair;
  log?: (...a: any[]) => void;
}): Promise<AssignResult> {
  const { program, authority } = opts;
  const log = opts.log ?? (() => {});
  const conn = program.provider.connection;
  const out: AssignResult = { assigned: 0, refundable: 0, failed: [] };

  const pulls: any[] = await program.account.gachaPull
    .all()
    .then((rows: any[]) =>
      rows.filter((r) => Object.keys(r.account.state)[0] === "randomnessReady"),
    )
    .catch(() => []);
  if (!pulls.length) return out;

  const config: any = await program.account.globalConfig.fetch(
    pda(Buffer.from("config")),
  );

  for (const { publicKey: pullKey, account: pull } of pulls) {
    const seasonIndex = pull.season as number;
    const season = pda(Buffer.from("season"), le2(seasonIndex));
    const seasonAcc: any = await program.account.season.fetch(season);

    // The full season inventory, in variant_id order — the program checks
    // both the count and the ordering, so no subset and no cherry-picking.
    const variants: any[] = (await program.account.variantInventory.all())
      .filter((v: any) => v.account.season === seasonIndex)
      .sort((a: any, b: any) => a.account.variantId - b.account.variantId);
    if (variants.length !== seasonAcc.variantCount) {
      out.failed.push(
        `season ${seasonIndex}: ${variants.length} variants on chain but ` +
          `season says ${seasonAcc.variantCount}`,
      );
      continue;
    }
    const base = {
      config: pda(Buffer.from("config")),
      season,
      banner: pda(Buffer.from("banner"), le2(seasonIndex), Buffer.from([pull.tier])),
      profile: pda(Buffer.from("player"), pull.player.toBuffer()),
      pull: pullKey,
      commonPool: rarityPool(seasonIndex, 0),
      rarePool: rarityPool(seasonIndex, 1),
      epicPool: rarityPool(seasonIndex, 2),
      legendaryPool: rarityPool(seasonIndex, 3),
      teamTreasury: config.teamTreasury,
      gachaVaultAuthority: pda(Buffer.from("gacha_vault_authority")),
      gachaVault: pda(Buffer.from("gacha_vault")),
      usdcMint: config.usdcMint,
      tokenProgram: TOKEN_PROGRAM,
    };

    // Ask the program which variant its own selection lands on, by trying.
    // A wrong guess fails in simulation: no fee, no state change.
    let sent = false;
    for (const candidate of variants) {
      const build = program.methods
        .assignPull()
        .accountsPartial({ ...base, selectedVariant: candidate.publicKey });
      try {
        await build.simulate();
      } catch {
        continue; // not the one the program chose
      }
      try {
        await build.rpc();
        const after: any = await program.account.gachaPull.fetch(pullKey);
        const state = Object.keys(after.state)[0];
        if (state === "refundable") {
          out.refundable += 1;
          log(`  pull ${pullKey.toBase58().slice(0, 8)}… became refundable`);
        } else {
          out.assigned += 1;
          const v: any = candidate.account;
          log(
            `  pull ${pullKey.toBase58().slice(0, 8)}… -> variant ${v.variantId} ` +
              `(rarity ${after.assignedRarity}, class ${v.classId}, model ${v.modelId})`,
          );
        }
        sent = true;
        break;
      } catch (e: any) {
        out.failed.push(
          `${pullKey.toBase58().slice(0, 8)}: ${String(e?.message ?? e).slice(0, 80)}`,
        );
        sent = true;
        break;
      }
    }
    if (!sent) {
      // Every candidate was refused: the selection landed on a rarity with
      // nothing left, which the program turns into a refund rather than a
      // downgrade. Simulating cannot reach that path, so say so plainly.
      out.failed.push(
        `${pullKey.toBase58().slice(0, 8)}: no variant accepted — inventory may be exhausted`,
      );
    }
  }
  return out;
}

async function main() {
  const authority = web3.Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        readFileSync(
          process.env.VRF_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`,
          "utf8",
        ),
      ),
    ),
  );
  const idl = JSON.parse(
    readFileSync(resolve(__dirname, "../target/idl/crossy_world.json"), "utf8"),
  );
  const program = new Program(
    idl,
    new anchor.AnchorProvider(
      new web3.Connection(BASE_RPC, "confirmed"),
      new anchor.Wallet(authority),
      { commitment: "confirmed" },
    ),
  ) as Program<any>;

  const once = async () => {
    const out = await assignPendingPulls({
      program,
      authority,
      log: (...a) => console.log(...a),
    });
    if (out.assigned || out.refundable || out.failed.length) {
      console.log(
        `assigned ${out.assigned}, refundable ${out.refundable}` +
          (out.failed.length ? `, failed: ${out.failed.join("; ")}` : ""),
      );
    }
  };

  if (process.env.WATCH !== "1") return once();
  for (;;) {
    await once().catch((e) => console.error("sweep failed:", e?.message ?? e));
    await sleep(3000);
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

void le4;
