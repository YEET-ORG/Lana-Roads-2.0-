/**
 * Give the season something worth opening.
 *
 * A pack that can only contain one common agent is not a pack. This
 * configures the classes and the variant spread the pull screen shows:
 * every rarity reachable, each variant bound to a distinct agent model, and
 * supply caps that make a legendary actually scarce.
 *
 * Idempotent — it creates only what is missing, so it is safe to re-run
 * after adding to the roster.
 *
 *   npx tsx scripts/seed-gacha.ts
 *   DRY_RUN=1 npx tsx scripts/seed-gacha.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3, BN } from "@coral-xyz/anchor";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROGRAM_ID = new web3.PublicKey("AuCk8jXEWWDiSunY5LgdmjR1p2qFB9vESCyNtMj6qWha");
const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
const SEASON = Number(process.env.SEASON ?? 1);
const BANNER_WEIGHTS = [
  [70, 22, 7, 1],
  [50, 32, 15, 3],
  [30, 40, 24, 6],
] as const;
/**
 * Where an agent's metadata will live. The variant commits to the hash of
 * this exact string and the claim instruction enforces the commitment.
 */
const METADATA_BASE = process.env.METADATA_BASE ?? "https://lanaroads.xyz/agents/season1";

const le2 = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
};
const pda = (...s: Buffer[]) => web3.PublicKey.findProgramAddressSync(s, PROGRAM_ID)[0];

/** Ability ids, matching `AbilityKind` declaration order. */
const ABILITY = {
  none: { none: {} },
  dash: { dash: {} },
  shield: { shield: {} },
  anchor: { anchor: {} },
  ram: { ram: {} },
  hook: { hook: {} },
  leap: { leap: {} },
} as const;

/**
 * Classes, weakest first. `minRarity` is the disclosed relationship between
 * what a class can do and how rare it has to be — the program enforces it
 * when a variant is bound, so the pay-to-win ladder cannot be quietly
 * broken by configuration.
 */
const CLASSES = [
  {
    id: 1,
    ability: ABILITY.dash,
    cooldown: 12,
    range: 2,
    duration: 0,
    displacement: 2,
    minRarity: 0,
    label: "Dash",
  },
  {
    id: 2,
    ability: ABILITY.shield,
    cooldown: 25,
    range: 0,
    duration: 6,
    displacement: 0,
    minRarity: 1,
    label: "Shield",
  },
  {
    id: 3,
    ability: ABILITY.leap,
    cooldown: 18,
    range: 2,
    duration: 0,
    displacement: 2,
    minRarity: 2,
    label: "Leap",
  },
  {
    id: 4,
    ability: ABILITY.hook,
    cooldown: 30,
    range: 3,
    duration: 0,
    displacement: 1,
    minRarity: 3,
    label: "Hook",
  },
] as const;

/**
 * The season's roster. `model` is the agent index the client draws, so a
 * pulled variant IS a recognisable animal rather than a number. Supply
 * falls with rarity: commons are effectively unlimited, one legendary per
 * hundred packs' worth.
 */
const VARIANTS = [
  // id, rarity, class, model (agent index), supply
  { id: 2, rarity: 0, cls: 1, model: 5, supply: 5000, name: "FROG" },
  { id: 3, rarity: 0, cls: 1, model: 11, supply: 5000, name: "DUCK" },
  { id: 4, rarity: 0, cls: 1, model: 12, supply: 5000, name: "CHICK" },
  { id: 5, rarity: 0, cls: 1, model: 20, supply: 5000, name: "PEEP" },
  { id: 6, rarity: 1, cls: 2, model: 7, supply: 1200, name: "PUP" },
  { id: 7, rarity: 1, cls: 2, model: 18, supply: 1200, name: "PENGUIN" },
  { id: 8, rarity: 1, cls: 2, model: 23, supply: 1200, name: "FOX" },
  { id: 9, rarity: 2, cls: 3, model: 21, supply: 300, name: "LION" },
  { id: 10, rarity: 2, cls: 3, model: 26, supply: 300, name: "TIGER" },
  { id: 11, rarity: 2, cls: 3, model: 8, supply: 300, name: "PANDA" },
  { id: 12, rarity: 3, cls: 4, model: 0, supply: 60, name: "UNICORN" },
  { id: 13, rarity: 3, cls: 4, model: 28, supply: 60, name: "WHALE" },
] as const;

export const metadataUri = (season: number, variantId: number) =>
  `${METADATA_BASE}/${variantId}.json`;

const uriHash = (uri: string): number[] => [...createHash("sha256").update(uri).digest()];

const weightsHash = (seasonIndex: number): number[] => {
  const seasonBytes = Buffer.alloc(2);
  seasonBytes.writeUInt16LE(seasonIndex);
  const weights = Buffer.alloc(3 * 4 * 2);
  let offset = 0;
  for (const banner of BANNER_WEIGHTS) {
    for (const weight of banner) {
      weights.writeUInt16LE(weight, offset);
      offset += 2;
    }
  }
  return [
    ...createHash("sha256")
      .update(Buffer.from("lana-roads-season-weights-v1"))
      .update(seasonBytes)
      .update(weights)
      .digest(),
  ];
};

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
  const idl = JSON.parse(
    readFileSync(resolve(__dirname, "../target/idl/crossy_world.json"), "utf8"),
  );
  const conn = new web3.Connection(BASE_RPC, "confirmed");
  const program = new Program(
    idl,
    new anchor.AnchorProvider(conn, new anchor.Wallet(admin), {
      commitment: "confirmed",
    }),
  ) as Program<any>;

  const config = pda(Buffer.from("config"));
  const season = pda(Buffer.from("season"), le2(SEASON));
  const today = BigInt(Math.floor(Date.now() / 1000 / 86400));
  const startDay = BigInt(process.env.START_DAY ?? (today + 1n).toString());
  let seasonAcc: any = await program.account.season.fetchNullable(season);
  if (!seasonAcc) {
    if (startDay <= today) {
      throw new Error("START_DAY must be a future UTC day so the season can be frozen first");
    }
    if (dry) {
      console.log(`would create season ${SEASON}, starting UTC day ${startDay}`);
      return;
    }
    await program.methods
      .createSeason(SEASON, new BN(startDay.toString()), weightsHash(SEASON), 1, 1)
      .accountsPartial({
        config,
        season,
        commonPool: pda(Buffer.from("rarity_pool"), le2(SEASON), Buffer.from([0])),
        rarePool: pda(Buffer.from("rarity_pool"), le2(SEASON), Buffer.from([1])),
        epicPool: pda(Buffer.from("rarity_pool"), le2(SEASON), Buffer.from([2])),
        legendaryPool: pda(Buffer.from("rarity_pool"), le2(SEASON), Buffer.from([3])),
        admin: admin.publicKey,
      })
      .rpc();
    seasonAcc = await program.account.season.fetch(season);
  }
  console.log(
    `season ${SEASON}: days ${seasonAcc.startDay}-${seasonAcc.endDay}, ` +
      `${seasonAcc.variantCount} variant(s) configured`,
  );

  const activationDay = BigInt(seasonAcc.startDay.toString());

  for (let tier = 0; tier < BANNER_WEIGHTS.length; tier++) {
    const address = pda(Buffer.from("banner"), le2(SEASON), Buffer.from([tier]));
    if (await conn.getAccountInfo(address)) continue;
    if (dry) {
      console.log(`  would create tier ${tier} banner`);
      continue;
    }
    await program.methods
      .createBanner(SEASON, tier, [...BANNER_WEIGHTS[tier]])
      .accountsPartial({ config, season, banner: address, admin: admin.publicKey })
      .rpc();
    console.log(`  created tier ${tier} banner`);
  }
  for (const c of CLASSES) {
    const address = pda(Buffer.from("class"), le2(c.id), le2(1));
    if (await conn.getAccountInfo(address)) {
      console.log(`  class ${c.id} (${c.label}) already configured`);
      continue;
    }
    if (dry) {
      console.log(`  would create class ${c.id} (${c.label})`);
      continue;
    }
    await program.methods
      .createClassConfig(
        c.id,
        1,
        c.ability,
        c.cooldown,
        c.range,
        c.duration,
        c.displacement,
        0,
        0,
        c.minRarity,
        // Class balance may only take effect at a FUTURE day boundary, so
        // nothing changes under a run in progress. Variants can be bound to
        // the class immediately; the ability simply starts working tomorrow.
        new BN(activationDay.toString()),
      )
      .accountsPartial({ config, classConfig: address, admin: admin.publicKey })
      .rpc();
    console.log(`  created class ${c.id} (${c.label}), min rarity ${c.minRarity}`);
  }

  const RARITY = ["common", "rare", "epic", "legendary"];
  for (const v of VARIANTS) {
    const address = pda(Buffer.from("variant"), le2(SEASON), le2(v.id));
    if (await conn.getAccountInfo(address)) {
      console.log(`  variant ${v.id} (${v.name}) already configured`);
      continue;
    }
    if (dry) {
      console.log(`  would create variant ${v.id} ${v.name} (${RARITY[v.rarity]})`);
      continue;
    }
    await program.methods
      .createVariant(
        SEASON,
        v.id,
        v.rarity,
        v.model,
        0,
        uriHash(metadataUri(SEASON, v.id)),
        v.supply,
      )
      .accountsPartial({
        config,
        season,
        classConfig: pda(Buffer.from("class"), le2(v.cls), le2(1)),
        rarityPool: pda(Buffer.from("rarity_pool"), le2(SEASON), Buffer.from([v.rarity])),
        variant: address,
        admin: admin.publicKey,
      })
      .rpc();
    console.log(
      `  created variant ${v.id} ${v.name}: ${RARITY[v.rarity]}, class ${v.cls}, ` +
        `agent ${v.model}, supply ${v.supply}`,
    );
  }

  const after: any = await program.account.season.fetch(season);
  console.log(`season now holds ${after.variantCount} variants`);
  if ("configured" in after.status) {
    if (dry) {
      console.log("would activate and permanently freeze the season configuration");
      return;
    }
    await program.methods
      .activateSeason(SEASON)
      .accountsPartial({
        config,
        season,
        standardBanner: pda(Buffer.from("banner"), le2(SEASON), Buffer.from([0])),
        enhancedBanner: pda(Buffer.from("banner"), le2(SEASON), Buffer.from([1])),
        premiumBanner: pda(Buffer.from("banner"), le2(SEASON), Buffer.from([2])),
        commonPool: pda(Buffer.from("rarity_pool"), le2(SEASON), Buffer.from([0])),
        rarePool: pda(Buffer.from("rarity_pool"), le2(SEASON), Buffer.from([1])),
        epicPool: pda(Buffer.from("rarity_pool"), le2(SEASON), Buffer.from([2])),
        legendaryPool: pda(Buffer.from("rarity_pool"), le2(SEASON), Buffer.from([3])),
        admin: admin.publicKey,
      })
      .rpc();
    console.log("season activated; banners and variants are now immutable");
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
