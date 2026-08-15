/**
 * Real MagicBlock scoped-VRF smoke test for a freshly deployed program.
 *
 * This script never supplies randomness. It submits one real request to the
 * official base queue and waits for the authenticated callback to change the
 * program-owned account.
 *
 * Gacha:
 *   VRF_SMOKE_KIND=gacha VRF_SMOKE_SEASON=1 VRF_SMOKE_TIER=0 \
 *   VRF_SMOKE_PAYER_TOKEN=<wallet USDC account> pnpm vrf:smoke
 *
 * Chunk (world must already be checkpointed and JIT-eligible):
 *   VRF_SMOKE_KIND=chunk VRF_SMOKE_DAY=<utc-day> VRF_SMOKE_MODE=0 \
 *   pnpm vrf:smoke
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import type { CrossyWorld } from "../target/types/crossy_world";

const QUEUE = new web3.PublicKey(
  process.env.VRF_BASE_QUEUE ?? "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
);
const TIMEOUT_MS = Number(process.env.VRF_SMOKE_TIMEOUT_MS ?? 180_000);
const POLL_MS = 2_000;

const S = {
  config: Buffer.from("config"),
  season: Buffer.from("season"),
  banner: Buffer.from("banner"),
  rarityPool: Buffer.from("rarity_pool"),
  player: Buffer.from("player"),
  pull: Buffer.from("pull"),
  gachaVault: Buffer.from("gacha_vault"),
  gachaVaultAuthority: Buffer.from("gacha_vault_authority"),
  world: Buffer.from("world"),
  chunk: Buffer.from("chunk"),
} as const;

const le16 = (value: number) => {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
};
const le32 = (value: number) => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
};
const le64 = (value: bigint) => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
};

async function waitFor<T>(label: string, read: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`${label} did not complete within ${TIMEOUT_MS}ms`);
}

function enumName(value: unknown): string {
  if (!value || typeof value !== "object") return String(value);
  return Object.keys(value as Record<string, unknown>)[0] ?? "unknown";
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CrossyWorld as Program<CrossyWorld>;
  const wallet = provider.wallet.publicKey;
  const pda = (...seeds: Buffer[]) =>
    web3.PublicKey.findProgramAddressSync(seeds, program.programId)[0];

  const configuredProgram = process.env.VRF_SMOKE_PROGRAM_ID;
  if (configuredProgram) {
    const expected = new web3.PublicKey(configuredProgram);
    if (!program.programId.equals(expected)) {
      throw new Error(
        `workspace program ${program.programId.toBase58()} != VRF_SMOKE_PROGRAM_ID ${expected.toBase58()}`,
      );
    }
  }
  const queueInfo = await provider.connection.getAccountInfo(QUEUE, "confirmed");
  if (!queueInfo)
    throw new Error(
      `MagicBlock queue ${QUEUE.toBase58()} does not exist on this cluster`,
    );

  const kind = process.env.VRF_SMOKE_KIND ?? "gacha";
  if (kind === "gacha") {
    const seasonIndex = Number(process.env.VRF_SMOKE_SEASON);
    const tier = Number(process.env.VRF_SMOKE_TIER ?? 0);
    const payerTokenText = process.env.VRF_SMOKE_PAYER_TOKEN;
    if (!Number.isInteger(seasonIndex) || seasonIndex < 0 || seasonIndex > 65_535) {
      throw new Error("VRF_SMOKE_SEASON must be a u16 season index");
    }
    if (!Number.isInteger(tier) || tier < 0 || tier > 2) {
      throw new Error("VRF_SMOKE_TIER must be 0, 1, or 2");
    }
    if (!payerTokenText)
      throw new Error("VRF_SMOKE_PAYER_TOKEN is required for a paid pull");

    const configPda = pda(S.config);
    const seasonPda = pda(S.season, le16(seasonIndex));
    const bannerPda = pda(S.banner, le16(seasonIndex), Buffer.from([tier]));
    const profilePda = pda(S.player, wallet.toBuffer());
    let profile = await program.account.playerProfile.fetchNullable(profilePda);
    if (!profile) {
      await program.methods
        .ensureProfile()
        .accountsPartial({ profile: profilePda, wallet })
        .rpc();
      profile = await program.account.playerProfile.fetch(profilePda);
    }
    const pending = new web3.PublicKey(profile.pendingPull);
    if (!pending.equals(web3.PublicKey.default)) {
      throw new Error(`profile already has pending pull ${pending.toBase58()}`);
    }
    const nonce = Number(profile.pullCount);
    const pullPda = pda(S.pull, wallet.toBuffer(), le32(nonce));
    const config: any = await program.account.globalConfig.fetch(configPda);

    const signature = await program.methods
      .requestPull()
      .accountsPartial({
        config: configPda,
        season: seasonPda,
        banner: bannerPda,
        profile: profilePda,
        commonPool: pda(S.rarityPool, le16(seasonIndex), Buffer.from([0])),
        rarePool: pda(S.rarityPool, le16(seasonIndex), Buffer.from([1])),
        epicPool: pda(S.rarityPool, le16(seasonIndex), Buffer.from([2])),
        legendaryPool: pda(S.rarityPool, le16(seasonIndex), Buffer.from([3])),
        pull: pullPda,
        gachaVaultAuthority: pda(S.gachaVaultAuthority),
        gachaVault: pda(S.gachaVault),
        payerToken: new web3.PublicKey(payerTokenText),
        usdcMint: config.usdcMint,
        wallet,
        oracleQueue: QUEUE,
        tokenProgram: config.tokenProgram,
      })
      .rpc();

    const completed: any = await waitFor("gacha VRF callback", async () => {
      const pull: any = await program.account.gachaPull.fetchNullable(pullPda);
      return pull && enumName(pull.state) !== "pending" ? pull : null;
    });
    console.log(
      JSON.stringify(
        {
          kind,
          requestSignature: signature,
          pull: pullPda.toBase58(),
          state: enumName(completed.state),
          generation: completed.requestGeneration,
          callbackAuthenticated: true,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (kind === "chunk") {
    const day = BigInt(process.env.VRF_SMOKE_DAY ?? "-1");
    const mode = Number(process.env.VRF_SMOKE_MODE ?? 0);
    if (day < 0n) throw new Error("VRF_SMOKE_DAY is required");
    if (mode !== 0 && mode !== 1) throw new Error("VRF_SMOKE_MODE must be 0 or 1");

    const worldPda = pda(S.world, Buffer.from([REGION]), Buffer.from([mode]), le64(day));
    const worldInfo = await provider.connection.getAccountInfo(worldPda, "confirmed");
    if (!worldInfo)
      throw new Error(`world ${worldPda.toBase58()} does not exist on base`);
    const world: any = program.coder.accounts.decode("worldHeader", worldInfo.data);
    const index = Number(world.nextChunkIndex);
    if (Number(world.recordScore) + 8 < Number(world.revealedRows)) {
      throw new Error(
        `world is not JIT-eligible: record ${world.recordScore}, revealed ${world.revealedRows}`,
      );
    }
    const chunkPda = pda(S.chunk, Buffer.from([REGION]), le64(day), le32(index));
    const signature = await program.methods
      .requestChunk(REGION, new BN(day.toString()), index)
      .accountsPartial({
        config: pda(S.config),
        world: worldPda,
        prevChunk: pda(S.chunk, Buffer.from([REGION]), le64(day), le32(index - 1)),
        chunk: chunkPda,
        payer: wallet,
        oracleQueue: QUEUE,
      })
      .rpc();

    const completed: any = await waitFor("chunk VRF callback", async () => {
      const chunk: any = await program.account.chunkDefinition.fetchNullable(chunkPda);
      return chunk && enumName(chunk.status) === "revealed" ? chunk : null;
    });
    console.log(
      JSON.stringify(
        {
          kind,
          requestSignature: signature,
          chunk: chunkPda.toBase58(),
          index,
          generation: completed.generation,
          randomnessHash: Buffer.from(completed.randomnessHash).toString("hex"),
          callbackAuthenticated: true,
        },
        null,
        2,
      ),
    );
    return;
  }

  throw new Error("VRF_SMOKE_KIND must be gacha or chunk");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
