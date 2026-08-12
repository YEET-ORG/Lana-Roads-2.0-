/**
 * NFT / mpl-core verification suite — runs against the REAL mpl-core program
 * binary (tests/fixtures/mpl_core.so, dumped from devnet via
 * `solana program dump CoRE...NhX7d`, loaded into a FRESH local validator:
 * `solana-test-validator --reset --bpf-program <crossy_world> target/deploy/crossy_world.so
 *   --bpf-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d tests/fixtures/mpl_core.so`).
 * One suite per ledger — the config account is a singleton. Exercises
 * every hand-rolled CPI in external/mpl_core.rs:
 *
 * - gacha claim  -> CreateV2 (mint into collection, PDA authority)
 * - lock_agent   -> AddPluginV1 FreezeDelegate (fresh asset)
 * - unlock_agent -> UpdatePluginV1 thaw (delegate-signed)
 * - re-lock      -> UpdatePluginV1 freeze (plugin exists, authority = PDA)
 * - list_agent   -> AddPluginV1 TransferDelegate + freeze
 * - buy_listing  -> thaw + TransferV1 via transfer delegate + 90/10 split
 * - post-buy lock-> ApprovePluginAuthorityV1 (authorities reset on transfer)
 *
 * Plus: spawn with an NFT-locked class, Sprinter Dash ability, kick, and
 * hazard-death/revival E2E (chunk request + reveal via the VRF identity).
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3, BN } from "@coral-xyz/anchor";
import assert from "node:assert/strict";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  generateSigner,
  keypairIdentity,
  publicKey as umiPk,
} from "@metaplex-foundation/umi";
import { createCollectionV2, fetchAssetV1, mplCore } from "@metaplex-foundation/mpl-core";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import type { CrossyWorld } from "../target/types/crossy_world";

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
  assetMap: Buffer.from("asset_map"),
  listing: Buffer.from("listing"),
  world: Buffer.from("world"),
  chunk: Buffer.from("chunk"),
  sector: Buffer.from("sector"),
  run: Buffer.from("run"),
  best: Buffer.from("best"),
  gachaVault: Buffer.from("gacha_vault"),
  gachaVaultAuthority: Buffer.from("gacha_vault_authority"),
  mintAuthority: Buffer.from("mint_authority"),
  freezeAuthority: Buffer.from("freeze_authority"),
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

describe("crossy-world NFT + gameplay E2E (real mpl-core)", () => {
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
  const playerC = web3.Keypair.generate(); // NFT protagonist
  const playerD = web3.Keypair.generate(); // buyer / kick target

  let usdcMint: web3.PublicKey;
  let treasury: web3.PublicKey;
  let tokenC: web3.PublicKey;
  let tokenD: web3.PublicKey;
  let collection: web3.PublicKey;
  let asset: web3.PublicKey; // the minted agent NFT

  const pda = (...seeds: (Buffer | Uint8Array)[]) =>
    web3.PublicKey.findProgramAddressSync(seeds as Buffer[], program.programId)[0];
  const configPda = pda(S.config);
  const mintAuthPda = pda(S.mintAuthority);
  const freezeAuthPda = pda(S.freezeAuthority);
  const profilePda = (w: web3.PublicKey) => pda(S.player, w.toBuffer());
  const runPda = (world: web3.PublicKey, w: web3.PublicKey) =>
    pda(S.run, world.toBuffer(), w.toBuffer());
  const bestPda = (world: web3.PublicKey, w: web3.PublicKey) =>
    pda(S.best, world.toBuffer(), w.toBuffer());
  const sectorPda = (world: web3.PublicKey, sx: number, sy: number) =>
    pda(S.sector, world.toBuffer(), Buffer.from([sx]), le16(sy));
  const lockPda = (world: web3.PublicKey, w: web3.PublicKey, attempt: number) =>
    pda(S.agentLock, world.toBuffer(), w.toBuffer(), le32(attempt));
  const receiptPda = (kind: number, day: number, w: web3.PublicKey, nonce: number) =>
    pda(S.payment, Buffer.from([kind]), le64(day), w.toBuffer(), le32(nonce));

  let day: number;
  let dailyPda: web3.PublicKey;
  let vaultAuthPda: web3.PublicKey;
  let vaultPda: web3.PublicKey;
  let paidWorld: web3.PublicKey;
  let casualWorld: web3.PublicKey;
  let spawnChunk: web3.PublicKey;

  const umi = createUmi(process.env.PROVIDER_ENDPOINT || "http://localhost:8899", "confirmed").use(mplCore());
  umi.use(keypairIdentity(fromWeb3JsKeypair(admin)));

  const SEASON = 1;
  const CLASS_SPRINTER = 7;

  async function airdrop(to: web3.PublicKey, sol = 10) {
    // Devnet: faucets are rate-limited — fund from the provider wallet.
    if (process.env.FUND_FROM_WALLET) {
      const lamports = Math.floor(Number(process.env.FUND_SOL ?? "0.4") * web3.LAMPORTS_PER_SOL);
      const tx = new web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: to,
          lamports,
        }),
      );
      await provider.sendAndConfirm(tx);
      return;
    }
    // Local validator: retry — airdrops right after genesis are flaky.
    for (let attempt = 0; ; attempt++) {
      try {
        const sig = await conn.requestAirdrop(to, sol * web3.LAMPORTS_PER_SOL);
        await conn.confirmTransaction(sig, "confirmed");
        if ((await conn.getBalance(to)) > 0) return;
      } catch (e) {
        if (attempt >= 5) throw e;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  async function expectFail(p: Promise<unknown>, needle: string) {
    try {
      await p;
      assert.fail(`expected failure containing "${needle}"`);
    } catch (e: any) {
      assert.ok(
        `${e}`.includes(needle),
        `expected "${needle}", got: ${`${e}`.slice(0, 300)}`,
      );
    }
  }

  const spawnSectors = (world: web3.PublicKey) => {
    const out = [];
    for (let sy = 0; sy < 2; sy++)
      for (let sx = 0; sx < 8; sx++)
        out.push({ pubkey: sectorPda(world, sx, sy), isSigner: false, isWritable: true });
    return out;
  };

  before(async function () {
    this.timeout(120_000);
    // Wait out genesis warmup: umi submits with finalized-commitment
    // blockhashes, which need the root to advance past genesis first.
    if (!process.env.FUND_FROM_WALLET) {
      for (let i = 0; i < 90; i++) {
        const slot = await conn.getSlot("finalized").catch(() => 0);
        if (slot > 5) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (
      !process.env.FUND_FROM_WALLET &&
      (await conn.getBalance(admin.publicKey)) < 5 * web3.LAMPORTS_PER_SOL
    ) {
      await airdrop(admin.publicKey, 100);
    }
    await Promise.all([
      airdrop(playerC.publicKey),
      airdrop(playerD.publicKey),
      airdrop(vrfAuthority.publicKey, 2),
    ]);
    usdcMint = await createMint(conn, admin, admin.publicKey, null, 6);
    treasury = await createAccount(conn, admin, usdcMint, admin.publicKey);
    tokenC = await createAccount(conn, playerC, usdcMint, playerC.publicKey);
    tokenD = await createAccount(conn, playerD, usdcMint, playerD.publicKey);
    await mintTo(conn, admin, usdcMint, tokenC, admin, 1_000_000_000);
    await mintTo(conn, admin, usdcMint, tokenD, admin, 1_000_000_000);
  });

  it("creates the Core collection with the mint-authority PDA as update authority", async () => {
    const collectionSigner = generateSigner(umi);
    for (let attempt = 0; ; attempt++) {
      try {
        await createCollectionV2(umi, {
          collection: collectionSigner,
          name: "Crossy World Agents",
          uri: "https://example.invalid/collection.json",
          updateAuthority: umiPk(mintAuthPda.toBase58()),
        }).sendAndConfirm(umi);
        break;
      } catch (e: any) {
        if (typeof e.getLogs === "function") {
          console.log("createCollection logs:", await e.getLogs().catch(() => "n/a"));
        }
        if (attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    collection = new web3.PublicKey(collectionSigner.publicKey.toString());
    assert.ok(collection);
  });

  it("initializes config + season + Sprinter class + variant + day", async () => {
    await program.methods
      .initializeConfig(500, 500)
      .accounts({
        usdcMint,
        teamTreasury: treasury,
        collection,
        collectionAuthority: mintAuthPda,
        vrfAuthority: vrfAuthority.publicKey,
        admin: admin.publicKey,
      })
      .rpc();

    const now = Math.floor(Date.now() / 1000);
    const today = Math.floor(now / 86400);
    day = today;
    const classPda = pda(S.klass, le16(CLASS_SPRINTER), le16(1));
    await program.methods
      .createClassConfig(
        CLASS_SPRINTER,
        1,
        { dash: {} },
        10,
        0,
        0,
        2,
        0,
        0,
        0,
        new BN(today + 1),
      )
      .accountsPartial({
        config: configPda,
        classConfig: classPda,
        admin: admin.publicKey,
      })
      .rpc();
    await program.methods
      .createSeason(SEASON, new BN(today), Array(32).fill(0), 1, 1)
      .accountsPartial({
        config: configPda,
        season: pda(S.season, le16(SEASON)),
        admin: admin.publicKey,
      })
      .rpc();
    await program.methods
      .createBanner(SEASON, 0, [70, 22, 7, 1])
      .accountsPartial({
        config: configPda,
        season: pda(S.season, le16(SEASON)),
        banner: pda(S.banner, le16(SEASON), Buffer.from([0])),
        admin: admin.publicKey,
      })
      .rpc();
    await program.methods
      .createVariant(SEASON, 1, 0, 1, 1, Array(32).fill(1), 100)
      .accountsPartial({
        config: configPda,
        season: pda(S.season, le16(SEASON)),
        classConfig: classPda,
        variant: pda(S.variant, le16(SEASON), le16(1)),
        admin: admin.publicKey,
      })
      .rpc();

    dailyPda = pda(S.daily, le64(day));
    vaultAuthPda = pda(S.dailyVault, le64(day));
    vaultPda = pda(S.dailyVault, le64(day), Buffer.from("ata"));
    paidWorld = pda(S.world, Buffer.from([0]), le64(day));
    casualWorld = pda(S.world, Buffer.from([1]), le64(day));
    spawnChunk = pda(S.chunk, le64(day), le16(0));
    await program.methods
      .prepareDay(new BN(day))
      .accountsPartial({
        config: configPda,
        daily: dailyPda,
        vaultAuthority: vaultAuthPda,
        vault: vaultPda,
        usdcMint,
        paidWorld,
        casualWorld,
        spawnChunk,
        commitPayer: admin.publicKey,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    await program.methods
      .openDay()
      .accountsPartial({ config: configPda, daily: dailyPda, admin: admin.publicKey })
      .rpc();
    for (const world of [paidWorld, casualWorld]) {
      for (let sy = 0; sy < 2; sy++)
        for (let sx = 0; sx < 8; sx++)
          await program.methods
            .initSector(sx, sy)
            .accountsPartial({
              world,
              chunk: spawnChunk,
              sector: sectorPda(world, sx, sy),
              payer: admin.publicKey,
            })
            .rpc();
    }
    for (const p of [playerC, playerD]) {
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
    }
  });

  // -------------------------------------------------------------------------
  // gacha claim: CreateV2 against real mpl-core
  // -------------------------------------------------------------------------

  it("claims an assigned pull: mints a real Core asset into the collection", async () => {
    // Request + assign (single variant => deterministic selection).
    await program.methods
      .requestPull()
      .accountsPartial({
        config: configPda,
        season: pda(S.season, le16(SEASON)),
        banner: pda(S.banner, le16(SEASON), Buffer.from([0])),
        profile: profilePda(playerC.publicKey),
        pull: pda(S.pull, playerC.publicKey.toBuffer(), le32(0)),
        gachaVaultAuthority: pda(S.gachaVaultAuthority),
        gachaVault: pda(S.gachaVault),
        payerToken: tokenC,
        usdcMint,
        wallet: playerC.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        {
          pubkey: pda(S.variant, le16(SEASON), le16(1)),
          isSigner: false,
          isWritable: false,
        },
      ])
      .signers([playerC])
      .rpc();
    await program.methods
      .assignPull(1, Array(32).fill(9))
      .accountsPartial({
        config: configPda,
        season: pda(S.season, le16(SEASON)),
        banner: pda(S.banner, le16(SEASON), Buffer.from([0])),
        profile: profilePda(playerC.publicKey),
        pull: pda(S.pull, playerC.publicKey.toBuffer(), le32(0)),
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
      .signers([vrfAuthority])
      .rpc();

    // Claim: mints via CreateV2 CPI (permissionless payer, fixed owner).
    const assetKp = web3.Keypair.generate();
    asset = assetKp.publicKey;
    await program.methods
      .claimPull("Sprinter #1", "https://example.invalid/1.json")
      .accountsPartial({
        config: configPda,
        pull: pda(S.pull, playerC.publicKey.toBuffer(), le32(0)),
        variant: pda(S.variant, le16(SEASON), le16(1)),
        asset: assetKp.publicKey,
        assetMap: pda(S.assetMap, assetKp.publicKey.toBuffer()),
        collection,
        mintAuthority: mintAuthPda,
        owner: playerC.publicKey,
        payer: admin.publicKey,
        coreProgram: new web3.PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"),
      })
      .signers([assetKp])
      .rpc();

    // Verify with the official client against the real program.
    const fetched = await fetchAssetV1(umi, umiPk(asset.toBase58()));
    assert.equal(fetched.owner.toString(), playerC.publicKey.toBase58());
    assert.equal(fetched.name, "Sprinter #1");
    const map = await program.account.assetMap.fetch(pda(S.assetMap, asset.toBuffer()));
    assert.equal(map.classId, CLASS_SPRINTER);
    const variant = await program.account.variantInventory.fetch(
      pda(S.variant, le16(SEASON), le16(1)),
    );
    assert.equal(variant.minted, 1);
    assert.equal(variant.reserved, 0);
    const pull = await program.account.gachaPull.fetch(
      pda(S.pull, playerC.publicKey.toBuffer(), le32(0)),
    );
    assert.deepEqual(pull.state, { claimed: {} });
    // Claim is terminal: double-claim (with a fresh asset keypair, so the
    // pull-state constraint is what fires) is rejected.
    const freshKp = web3.Keypair.generate();
    await expectFail(
      program.methods
        .claimPull("Sprinter #1", "u")
        .accountsPartial({
          config: configPda,
          pull: pda(S.pull, playerC.publicKey.toBuffer(), le32(0)),
          variant: pda(S.variant, le16(SEASON), le16(1)),
          asset: freshKp.publicKey,
          assetMap: pda(S.assetMap, freshKp.publicKey.toBuffer()),
          collection,
          mintAuthority: mintAuthPda,
          owner: playerC.publicKey,
          payer: admin.publicKey,
          coreProgram: new web3.PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"),
        })
        .signers([freshKp])
        .rpc(),
      "BadReceiptState",
    );
  });

  // -------------------------------------------------------------------------
  // lock / spawn with class / dash / unlock cycle
  // -------------------------------------------------------------------------

  const CORE = new web3.PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

  it("locks the NFT (AddPluginV1 freeze) and blocks double-lock", async () => {
    await program.methods
      .lockAgent(1)
      .accountsPartial({
        config: configPda,
        world: casualWorld,
        asset,
        collection,
        assetMap: pda(S.assetMap, asset.toBuffer()),
        listing: pda(S.listing, asset.toBuffer()),
        lock: lockPda(casualWorld, playerC.publicKey, 1),
        freezeAuthority: freezeAuthPda,
        wallet: playerC.publicKey,
        coreProgram: CORE,
      })
      .signers([playerC])
      .rpc();
    const fetched = await fetchAssetV1(umi, umiPk(asset.toBase58()));
    assert.equal((fetched as any).freezeDelegate?.frozen, true);
    const lock = await program.account.agentLock.fetch(
      lockPda(casualWorld, playerC.publicKey, 1),
    );
    assert.equal(lock.classId, CLASS_SPRINTER);
    assert.equal(lock.frozen, true);

    // Locking the same frozen asset again (new attempt) fails: AgentLocked.
    await expectFail(
      program.methods
        .lockAgent(2)
        .accountsPartial({
          config: configPda,
          world: casualWorld,
          asset,
          collection,
          assetMap: pda(S.assetMap, asset.toBuffer()),
          listing: pda(S.listing, asset.toBuffer()),
          lock: lockPda(casualWorld, playerC.publicKey, 2),
          freezeAuthority: freezeAuthPda,
          wallet: playerC.publicKey,
          coreProgram: CORE,
        })
        .signers([playerC])
        .rpc(),
      "AgentLocked",
    );
  });

  it("spawns with the NFT class and dashes (Sprinter ability)", async () => {
    const w = playerC.publicKey;
    await program.methods
      .initRun(playerC.publicKey, new BN(Math.floor(Date.now() / 1000) + 3600))
      .accountsPartial({
        world: casualWorld,
        run: runPda(casualWorld, w),
        best: bestPda(casualWorld, w),
        wallet: w,
      })
      .signers([playerC])
      .rpc();
    await program.methods
      .spawn(1)
      .accountsPartial({
        world: casualWorld,
        run: runPda(casualWorld, w),
        receipt: casualWorld, // casual: unused
        agentLock: lockPda(casualWorld, w, 1),
        signer: w,
      })
      .remainingAccounts(spawnSectors(casualWorld))
      .signers([playerC])
      .rpc();
    let run = await program.account.playerRun.fetch(runPda(casualWorld, w));
    assert.equal(run.classId, CLASS_SPRINTER);
    assert.equal(run.agentAsset.toBase58(), asset.toBase58());

    // Spawn row is randomized: walk back below row 14 so the dash target
    // stays inside the initialized spawn-zone sectors (sy 0..1).
    while (run.y > 13) {
      const src = sectorPda(casualWorld, Math.floor(run.x / 8), Math.floor(run.y / 8));
      const dst = sectorPda(casualWorld, Math.floor(run.x / 8), Math.floor((run.y - 1) / 8));
      try {
        await program.methods
          .moveAction(1, new BN(run.actionSeq), 1, new BN(Date.now()))
          .accountsPartial({
            world: casualWorld,
            run: runPda(casualWorld, w),
            sourceSector: src,
            destSector: dst.equals(src) ? null : dst,
            chunk: spawnChunk,
            best: bestPda(casualWorld, w),
            signer: w,
          })
          .signers([playerC])
          .rpc();
      } catch (e) {
        if (!`${e}`.includes("TooFast")) throw e;
        await new Promise((r) => setTimeout(r, 600));
      }
      run = await program.account.playerRun.fetch(runPda(casualWorld, w));
    }

    // Dash: 2 tiles forward, all-or-nothing, counts score.
    const [sx, sy] = [Math.floor(run.x / 8), Math.floor(run.y / 8)];
    const destSy = Math.floor((run.y + 2) / 8);
    const casterSector = sectorPda(casualWorld, sx, sy);
    const destSector = destSy === sy ? null : sectorPda(casualWorld, sx, destSy);
    await program.methods
      .useAbility(
        1,
        new BN(run.actionSeq),
        { direction: 0, targetX: 0, targetY: 0 },
        new BN(1),
      )
      .accountsPartial({
        world: casualWorld,
        caster: runPda(casualWorld, w),
        classConfig: pda(S.klass, le16(CLASS_SPRINTER), le16(1)),
        target: null,
        casterSector,
        destSector,
        chunk: spawnChunk,
        signer: w,
      })
      .signers([playerC])
      .rpc();
    const after = await program.account.playerRun.fetch(runPda(casualWorld, w));
    assert.equal(after.y, run.y + 2);
    assert.ok(after.score >= Math.max(run.score, run.y + 2) || after.score === run.score);
    // Cooldown enforced.
    await expectFail(
      program.methods
        .useAbility(
          1,
          new BN(after.actionSeq),
          { direction: 0, targetX: 0, targetY: 0 },
          new BN(2),
        )
        .accountsPartial({
          world: casualWorld,
          caster: runPda(casualWorld, w),
          classConfig: pda(S.klass, le16(CLASS_SPRINTER), le16(1)),
          target: null,
          casterSector: sectorPda(casualWorld, sx, Math.floor(after.y / 8)),
          destSector: null,
          chunk: spawnChunk,
          signer: w,
        })
        .signers([playerC])
        .rpc(),
      "Cooldown",
    );
  });

  it("kicks an adjacent player one tile with a 5s cooldown", async () => {
    const c = playerC.publicKey;
    const d = playerD.publicKey;
    // D joins casual with the starter.
    await program.methods
      .lockStarter(1)
      .accountsPartial({
        profile: profilePda(d),
        world: casualWorld,
        lock: lockPda(casualWorld, d, 1),
        wallet: d,
      })
      .signers([playerD])
      .rpc();
    await program.methods
      .initRun(d, new BN(Math.floor(Date.now() / 1000) + 3600))
      .accountsPartial({
        world: casualWorld,
        run: runPda(casualWorld, d),
        best: bestPda(casualWorld, d),
        wallet: d,
      })
      .signers([playerD])
      .rpc();
    await program.methods
      .spawn(1)
      .accountsPartial({
        world: casualWorld,
        run: runPda(casualWorld, d),
        receipt: casualWorld,
        agentLock: lockPda(casualWorld, d, 1),
        signer: d,
      })
      .remainingAccounts(spawnSectors(casualWorld))
      .signers([playerD])
      .rpc();

    // Walk C adjacent to D, facing D, then kick.
    const moveTo = async (player: web3.Keypair, targetX: number, targetY: number) => {
      for (let i = 0; i < 160; i++) {
        const run = await program.account.playerRun.fetch(
          runPda(casualWorld, player.publicKey),
        );
        if (run.x === targetX && run.y === targetY) return run;
        let dir: number;
        if (run.x < targetX) dir = 3;
        else if (run.x > targetX) dir = 2;
        else if (run.y < targetY) dir = 0;
        else dir = 1;
        let [nx, ny] = [run.x, run.y];
        if (dir === 0) ny += 1;
        else if (dir === 1) ny -= 1;
        else if (dir === 2) nx -= 1;
        else nx += 1;
        const src = sectorPda(casualWorld, Math.floor(run.x / 8), Math.floor(run.y / 8));
        const dst = sectorPda(casualWorld, Math.floor(nx / 8), Math.floor(ny / 8));
        try {
          await program.methods
            .moveAction(1, new BN(run.actionSeq), dir, new BN(Date.now() + i))
            .accountsPartial({
              world: casualWorld,
              run: runPda(casualWorld, player.publicKey),
              sourceSector: src,
              destSector: dst.equals(src) ? null : dst,
              chunk: spawnChunk,
              best: bestPda(casualWorld, player.publicKey),
              signer: player.publicKey,
            })
            .signers([player])
            .rpc();
        } catch (e) {
          const msg = `${e}`;
          // Recoverable: cadence, a stale action sequence from a
          // late-confirming rpc, or transient occupancy. Refetch and retry.
          if (
            msg.includes("TooFast") ||
            msg.includes("BadActionSequence") ||
            msg.includes("TileOccupied")
          ) {
            await new Promise((r) => setTimeout(r, 600));
          } else throw e;
        }
      }
      throw new Error("moveTo did not converge");
    };

    const runD = await program.account.playerRun.fetch(runPda(casualWorld, d));
    // Stand left of D, facing right.
    const standX = runD.x > 0 ? runD.x - 1 : runD.x + 1;
    const facing = runD.x > 0 ? 3 : 2; // right : left
    const runC = await moveTo(playerC, standX, runD.y);
    // Ensure facing by a no-op? facing is set by last accepted move; force it:
    // step away and back along the kick axis when needed.
    let kicker = runC;
    if (kicker.facing !== facing) {
      // Move one tile along the axis toward D's column and back if possible;
      // simplest: move backward then forward along x-axis to set facing.
      const backX = facing === 3 ? standX - 1 : standX + 1;
      if (backX >= 0 && backX < 64) {
        await moveTo(playerC, backX, runD.y);
        kicker = await moveTo(playerC, standX, runD.y);
      }
    }
    kicker = await program.account.playerRun.fetch(runPda(casualWorld, c));
    assert.equal(kicker.facing, facing, "kicker must face the target");

    const kickAt = Math.floor(Date.now() / 1000);
    const dxDest = facing === 3 ? runD.x + 1 : runD.x - 1;
    const targetSector = sectorPda(
      casualWorld,
      Math.floor(runD.x / 8),
      Math.floor(runD.y / 8),
    );
    const destSector = sectorPda(
      casualWorld,
      Math.floor(dxDest / 8),
      Math.floor(runD.y / 8),
    );
    await program.methods
      .kick(1, new BN(kicker.actionSeq), new BN(Date.now()))
      .accountsPartial({
        world: casualWorld,
        kicker: runPda(casualWorld, c),
        target: runPda(casualWorld, d),
        targetSector,
        destSector: destSector.equals(targetSector) ? null : destSector,
        chunk: spawnChunk,
        signer: c,
      })
      .signers([playerC])
      .rpc();
    const kicked = await program.account.playerRun.fetch(runPda(casualWorld, d));
    assert.equal(kicked.x, dxDest, "target displaced one tile");
    const afterKick = await program.account.playerRun.fetch(runPda(casualWorld, c));
    assert.ok(afterKick.kickReadyTs.toNumber() >= kickAt + 4, "5s cooldown armed");

    // Immediate second kick: cooldown rejection.
    await expectFail(
      program.methods
        .kick(1, new BN(afterKick.actionSeq), new BN(Date.now() + 1))
        .accountsPartial({
          world: casualWorld,
          kicker: runPda(casualWorld, c),
          target: runPda(casualWorld, d),
          targetSector: sectorPda(
            casualWorld,
            Math.floor(kicked.x / 8),
            Math.floor(kicked.y / 8),
          ),
          destSector: null,
          chunk: spawnChunk,
          signer: c,
        })
        .signers([playerC])
        .rpc(),
      "Cooldown",
    );
  });

  it("ends the attempt and unlocks (UpdatePluginV1 thaw), idempotence guarded", async () => {
    const w = playerC.publicKey;
    const run = await program.account.playerRun.fetch(runPda(casualWorld, w));
    await program.methods
      .endAttempt()
      .accountsPartial({
        world: casualWorld,
        run: runPda(casualWorld, w),
        sector: sectorPda(casualWorld, Math.floor(run.x / 8), Math.floor(run.y / 8)),
        signer: w,
      })
      .signers([playerC])
      .rpc();

    await program.methods
      .unlockAgent()
      .accountsPartial({
        config: configPda,
        lock: lockPda(casualWorld, w, 1),
        run: runPda(casualWorld, w),
        world: casualWorld,
        asset,
        collection,
        freezeAuthority: freezeAuthPda,
        payer: admin.publicKey,
        coreProgram: CORE,
      })
      .rpc();
    const fetched = await fetchAssetV1(umi, umiPk(asset.toBase58()));
    assert.equal((fetched as any).freezeDelegate?.frozen, false, "thawed");
    // Second unlock call: blocked by lock state.
    await expectFail(
      program.methods
        .unlockAgent()
        .accountsPartial({
          config: configPda,
          lock: lockPda(casualWorld, w, 1),
          run: runPda(casualWorld, w),
          world: casualWorld,
          asset,
          collection,
          freezeAuthority: freezeAuthPda,
          payer: admin.publicKey,
          coreProgram: CORE,
        })
        .rpc(),
      "AlreadyTerminal",
    );
  });

  it("re-locks for a new attempt (UpdatePluginV1 freeze path)", async () => {
    const w = playerC.publicKey;
    await program.methods
      .lockAgent(2)
      .accountsPartial({
        config: configPda,
        world: casualWorld,
        asset,
        collection,
        assetMap: pda(S.assetMap, asset.toBuffer()),
        listing: pda(S.listing, asset.toBuffer()),
        lock: lockPda(casualWorld, w, 2),
        freezeAuthority: freezeAuthPda,
        wallet: w,
        coreProgram: CORE,
      })
      .signers([playerC])
      .rpc();
    let fetched = await fetchAssetV1(umi, umiPk(asset.toBase58()));
    assert.equal((fetched as any).freezeDelegate?.frozen, true);

    // Marketplace listing must reject a frozen asset.
    await expectFail(
      program.methods
        .listAgent(new BN(50_000_000), new BN(0))
        .accountsPartial({
          config: configPda,
          asset,
          collection,
          assetMap: pda(S.assetMap, asset.toBuffer()),
          listing: pda(S.listing, asset.toBuffer()),
          freezeAuthority: freezeAuthPda,
          seller: w,
          coreProgram: CORE,
        })
        .signers([playerC])
        .rpc(),
      "AgentLocked",
    );

    // Thaw again for the marketplace tests: spawn attempt 2 then end it.
    await program.methods
      .spawn(2)
      .accountsPartial({
        world: casualWorld,
        run: runPda(casualWorld, w),
        receipt: casualWorld,
        agentLock: lockPda(casualWorld, w, 2),
        signer: w,
      })
      .remainingAccounts(spawnSectors(casualWorld))
      .signers([playerC])
      .rpc();
    const run = await program.account.playerRun.fetch(runPda(casualWorld, w));
    await program.methods
      .endAttempt()
      .accountsPartial({
        world: casualWorld,
        run: runPda(casualWorld, w),
        sector: sectorPda(casualWorld, Math.floor(run.x / 8), Math.floor(run.y / 8)),
        signer: w,
      })
      .signers([playerC])
      .rpc();
    await program.methods
      .unlockAgent()
      .accountsPartial({
        config: configPda,
        lock: lockPda(casualWorld, w, 2),
        run: runPda(casualWorld, w),
        world: casualWorld,
        asset,
        collection,
        freezeAuthority: freezeAuthPda,
        payer: admin.publicKey,
        coreProgram: CORE,
      })
      .rpc();
    fetched = await fetchAssetV1(umi, umiPk(asset.toBase58()));
    assert.equal((fetched as any).freezeDelegate?.frozen, false);
  });

  // -------------------------------------------------------------------------
  // marketplace: list -> buy (delegate transfer + 90/10) -> post-buy lock
  // -------------------------------------------------------------------------

  it("lists, then sells with delegate transfer and exact 90/10 split", async () => {
    const w = playerC.publicKey;
    await program.methods
      .listAgent(new BN(50_000_000), new BN(0)) // 50 USDC
      .accountsPartial({
        config: configPda,
        asset,
        collection,
        assetMap: pda(S.assetMap, asset.toBuffer()),
        listing: pda(S.listing, asset.toBuffer()),
        freezeAuthority: freezeAuthPda,
        seller: w,
        coreProgram: CORE,
      })
      .signers([playerC])
      .rpc();
    let fetched = await fetchAssetV1(umi, umiPk(asset.toBase58()));
    assert.equal((fetched as any).freezeDelegate?.frozen, true, "listing freezes");
    // Locking while listed is rejected.
    await expectFail(
      program.methods
        .lockAgent(3)
        .accountsPartial({
          config: configPda,
          world: casualWorld,
          asset,
          collection,
          assetMap: pda(S.assetMap, asset.toBuffer()),
          listing: pda(S.listing, asset.toBuffer()),
          lock: lockPda(casualWorld, w, 3),
          freezeAuthority: freezeAuthPda,
          wallet: w,
          coreProgram: CORE,
        })
        .signers([playerC])
        .rpc(),
      "AgentListed",
    );

    const sellerBefore = (await getAccount(conn, tokenC)).amount;
    const treasuryBefore = (await getAccount(conn, treasury)).amount;
    await program.methods
      .buyListing()
      .accountsPartial({
        config: configPda,
        asset,
        collection,
        listing: pda(S.listing, asset.toBuffer()),
        buyerToken: tokenD,
        sellerToken: tokenC,
        teamTreasury: treasury,
        usdcMint,
        freezeAuthority: freezeAuthPda,
        buyer: playerD.publicKey,
        coreProgram: CORE,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([playerD])
      .rpc();

    assert.equal(
      (await getAccount(conn, tokenC)).amount - sellerBefore,
      45_000_000n,
      "seller 90%",
    );
    assert.equal(
      (await getAccount(conn, treasury)).amount - treasuryBefore,
      5_000_000n,
      "team 10%",
    );
    fetched = await fetchAssetV1(umi, umiPk(asset.toBase58()));
    assert.equal(
      fetched.owner.toString(),
      playerD.publicKey.toBase58(),
      "asset transferred to buyer",
    );
    const listing = await program.account.marketplaceListing.fetch(
      pda(S.listing, asset.toBuffer()),
    );
    assert.deepEqual(listing.status, { sold: {} });
  });

  it("post-transfer lock by the buyer (ApprovePluginAuthorityV1 path)", async () => {
    // TransferV1 reset plugin authorities to Owner — locking now exercises
    // the re-approve branch.
    const d = playerD.publicKey;
    await program.methods
      .lockAgent(2)
      .accountsPartial({
        config: configPda,
        world: casualWorld,
        asset,
        collection,
        assetMap: pda(S.assetMap, asset.toBuffer()),
        listing: pda(S.listing, asset.toBuffer()),
        lock: lockPda(casualWorld, d, 2),
        freezeAuthority: freezeAuthPda,
        wallet: d,
        coreProgram: CORE,
      })
      .signers([playerD])
      .rpc();
    const fetched = await fetchAssetV1(umi, umiPk(asset.toBase58()));
    assert.equal((fetched as any).freezeDelegate?.frozen, true);
    // The old owner cannot lock it (owner check).
    await expectFail(
      program.methods
        .lockAgent(4)
        .accountsPartial({
          config: configPda,
          world: casualWorld,
          asset,
          collection,
          assetMap: pda(S.assetMap, asset.toBuffer()),
          listing: pda(S.listing, asset.toBuffer()),
          lock: lockPda(casualWorld, playerC.publicKey, 4),
          freezeAuthority: freezeAuthPda,
          wallet: playerC.publicKey,
          coreProgram: CORE,
        })
        .signers([playerC])
        .rpc(),
      "WrongAssetOwner",
    );
  });

  // -------------------------------------------------------------------------
  // chunk reveal + hazard death + paid revival E2E
  // -------------------------------------------------------------------------

  it("requests + reveals chunk 1 via the VRF identity and initializes its sectors", async () => {
    // Frontier rule: record within 8 rows of revealed boundary (16). Get a
    // paid player to row >= 8. Use playerC with a fresh paid attempt.
    const c = playerC.publicKey;
    await program.methods
      .initRun(c, new BN(Math.floor(Date.now() / 1000) + 3600))
      .accountsPartial({
        world: paidWorld,
        run: runPda(paidWorld, c),
        best: bestPda(paidWorld, c),
        wallet: c,
      })
      .signers([playerC])
      .rpc();
    await program.methods
      .lockStarter(1)
      .accountsPartial({
        profile: profilePda(c),
        world: paidWorld,
        lock: lockPda(paidWorld, c, 1),
        wallet: c,
      })
      .signers([playerC])
      .rpc();
    await program.methods
      .beginPaidAttempt()
      .accountsPartial({
        config: configPda,
        daily: dailyPda,
        vault: vaultPda,
        profile: profilePda(c),
        run: runPda(paidWorld, c),
        payerToken: tokenC,
        usdcMint,
        receipt: receiptPda(
          0,
          day,
          c,
          (await program.account.playerProfile.fetch(profilePda(c))).receiptCount,
        ),
        contribution: pda(S.contribution, le64(day), c.toBuffer()),
        wallet: c,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([playerC])
      .rpc();
    const receiptNonce =
      (await program.account.playerProfile.fetch(profilePda(c))).receiptCount - 1;
    await program.methods
      .spawn(1)
      .accountsPartial({
        world: paidWorld,
        run: runPda(paidWorld, c),
        receipt: receiptPda(0, day, c, receiptNonce),
        agentLock: lockPda(paidWorld, c, 1),
        signer: c,
      })
      .remainingAccounts(spawnSectors(paidWorld))
      .signers([playerC])
      .rpc();

    // March until SCORE >= 8 (spawn row is randomized; score only counts
    // strictly-forward progress, so back up first when spawned high).
    const moveForward = async () => {
      for (let i = 0; i < 300; i++) {
        const run = await program.account.playerRun.fetch(runPda(paidWorld, c));
        if (run.score >= 8) return;
        const dir = run.y >= 15 ? 1 : 0; // at the frontier edge: step back
        const ny = dir === 0 ? run.y + 1 : run.y - 1;
        const src = sectorPda(paidWorld, Math.floor(run.x / 8), Math.floor(run.y / 8));
        const dst = sectorPda(paidWorld, Math.floor(run.x / 8), Math.floor(ny / 8));
        try {
          await program.methods
            .moveAction(1, new BN(run.actionSeq), dir, new BN(Date.now() + i))
            .accountsPartial({
              world: paidWorld,
              run: runPda(paidWorld, c),
              sourceSector: src,
              destSector: dst.equals(src) ? null : dst,
              chunk: spawnChunk,
              best: bestPda(paidWorld, c),
              signer: c,
            })
            .signers([playerC])
            .rpc();
        } catch (e) {
          if (`${e}`.includes("TooFast") || `${e}`.includes("TileOccupied")) {
            await new Promise((r) => setTimeout(r, 500));
          } else throw e;
        }
      }
      throw new Error("did not reach score 8");
    };
    await moveForward();
    await program.methods
      .claimRecord()
      .accountsPartial({ world: paidWorld, run: runPda(paidWorld, c) })
      .rpc();

    // Request chunk 1 (frontier margin reached), reveal with the VRF key.
    await program.methods
      .requestChunk(1)
      .accountsPartial({
        world: paidWorld,
        chunk: pda(S.chunk, le64(day), le16(1)),
        payer: admin.publicKey,
      })
      .rpc();
    // Wrong identity rejected.
    await expectFail(
      program.methods
        .revealChunk(1, Array(32).fill(5))
        .accountsPartial({
          config: configPda,
          world: paidWorld,
          chunk: pda(S.chunk, le64(day), le16(1)),
          vrfAuthority: playerD.publicKey,
        })
        .signers([playerD])
        .rpc(),
      "BadVrfAuthority",
    );
    await program.methods
      .revealChunk(1, Array(32).fill(5))
      .accountsPartial({
        config: configPda,
        world: paidWorld,
        chunk: pda(S.chunk, le64(day), le16(1)),
        vrfAuthority: vrfAuthority.publicKey,
      })
      .signers([vrfAuthority])
      .rpc();

    const world = await program.account.worldHeader.fetch(paidWorld);
    assert.equal(world.revealedRows, 32);
    assert.equal(world.nextChunkIndex, 2);
    const chunk = await program.account.chunkDefinition.fetch(
      pda(S.chunk, le64(day), le16(1)),
    );
    assert.deepEqual(chunk.status, { revealed: {} });
    // First row of the revealed chunk is safe grass (generator guarantee).
    assert.equal(chunk.lanes[0].kind, 0);

    // Duplicate reveal is idempotently rejected.
    await expectFail(
      program.methods
        .revealChunk(1, Array(32).fill(6))
        .accountsPartial({
          config: configPda,
          world: paidWorld,
          chunk: pda(S.chunk, le64(day), le16(1)),
          vrfAuthority: vrfAuthority.publicKey,
        })
        .signers([vrfAuthority])
        .rpc(),
      "BadChunkState",
    );

    // Sectors for rows 16..24 (sector_y = 2).
    for (let sx = 0; sx < 8; sx++) {
      await program.methods
        .initSector(sx, 2)
        .accountsPartial({
          world: paidWorld,
          chunk: pda(S.chunk, le64(day), le16(1)),
          sector: sectorPda(paidWorld, sx, 2),
          payer: admin.publicKey,
        })
        .rpc();
    }
  });

  it("dies to a hazard via check_hazard and revives for exactly 10 USDC", async function () {
    this.timeout(120_000);
    const c = playerC.publicKey;
    const chunk1 = pda(S.chunk, le64(day), le16(1));
    const chunkAcc = await program.account.chunkDefinition.fetch(chunk1);
    // Find the first hazardous lane (road/river/rail) in chunk 1.
    const hazardRowLocal = chunkAcc.lanes.findIndex((l: any) => l.kind !== 0);
    assert.ok(hazardRowLocal > 0, "chunk 1 contains a hazard lane");
    const hazardRow = 16 + hazardRowLocal;
    const laneKind = chunkAcc.lanes[hazardRowLocal].kind;

    // Walk up to the row just below the hazard, then step onto it (rivers
    // reject entry without support, so retry columns/timing until accepted).
    const moveOnce = async (dir: number) => {
      const run = await program.account.playerRun.fetch(runPda(paidWorld, c));
      let [nx, ny] = [run.x, run.y];
      if (dir === 0) ny += 1;
      else if (dir === 1) ny -= 1;
      else if (dir === 2) nx -= 1;
      else nx += 1;
      const src = sectorPda(paidWorld, Math.floor(run.x / 8), Math.floor(run.y / 8));
      const dst = sectorPda(paidWorld, Math.floor(nx / 8), Math.floor(ny / 8));
      const chunkFor = ny >= 16 ? chunk1 : spawnChunk;
      await program.methods
        .moveAction(
          1,
          new BN(run.actionSeq),
          dir,
          new BN(Date.now() + Math.random() * 1e6),
        )
        .accountsPartial({
          world: paidWorld,
          run: runPda(paidWorld, c),
          sourceSector: src,
          destSector: dst.equals(src) ? null : dst,
          chunk: chunkFor,
          best: bestPda(paidWorld, c),
          signer: c,
        })
        .signers([playerC])
        .rpc();
    };
    // March to hazardRow - 1.
    for (let guard = 0; guard < 300; guard++) {
      const run = await program.account.playerRun.fetch(runPda(paidWorld, c));
      if (run.y >= hazardRow - 1) break;
      try {
        await moveOnce(0);
      } catch (e) {
        if (
          `${e}`.includes("TooFast") ||
          `${e}`.includes("Blocked") ||
          `${e}`.includes("TileOccupied")
        ) {
          // Blocked by a tree: sidestep.
          try {
            await moveOnce(3);
          } catch {
            await new Promise((r) => setTimeout(r, 400));
          }
        } else throw e;
      }
    }

    // Step onto the hazard row (retrying until terrain admits us — for
    // roads that's any gap; rivers need a log window).
    let onHazard = false;
    for (let guard = 0; guard < 120 && !onHazard; guard++) {
      try {
        await moveOnce(0);
        onHazard = true;
      } catch (e) {
        const s = `${e}`;
        if (s.includes("Blocked") || s.includes("TooFast")) {
          await new Promise((r) => setTimeout(r, 300));
          // Occasionally sidestep to try another column.
          if (guard % 5 === 4) {
            try {
              await moveOnce(guard % 10 === 9 ? 2 : 3);
            } catch {
              /* keep trying */
            }
          }
        } else throw e;
      }
    }
    assert.ok(onHazard, `stepped onto hazard row ${hazardRow} (kind ${laneKind})`);

    // Spam check_hazard until the environment kills the run.
    let dead = false;
    for (let guard = 0; guard < 120 && !dead; guard++) {
      const run = await program.account.playerRun.fetch(runPda(paidWorld, c));
      if (Object.keys(run.state)[0] === "deadAwaitingRevive") {
        dead = true;
        break;
      }
      try {
        await program.methods
          .checkHazard(run.hazardNonce)
          .accountsPartial({
            world: paidWorld,
            run: runPda(paidWorld, c),
            sector: sectorPda(paidWorld, Math.floor(run.x / 8), Math.floor(run.y / 8)),
            chunk: run.y >= 16 ? chunk1 : spawnChunk,
          })
          .rpc();
      } catch {
        /* stale nonce / already safe: retry */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const deadRun = await program.account.playerRun.fetch(runPda(paidWorld, c));
    assert.equal(
      Object.keys(deadRun.state)[0],
      "deadAwaitingRevive",
      "environment killed the run",
    );
    assert.ok(deadRun.reviveDeadline.toNumber() > 0);
    const scoreAtDeath = deadRun.score;

    // Occupancy released at death.
    const deathSector = await program.account.occupancySector.fetch(
      sectorPda(paidWorld, Math.floor(deadRun.x / 8), Math.floor(deadRun.y / 8)),
    );
    const bit = BigInt((deadRun.y % 8) * 8 + (deadRun.x % 8));
    assert.equal((BigInt(deathSector.occupancy.toString()) >> bit) & 1n, 0n);

    // Revive: exactly 10 USDC, then complete on the saved safe tile.
    const profile = await program.account.playerProfile.fetch(profilePda(c));
    const balBefore = (await getAccount(conn, tokenC)).amount;
    await program.methods
      .beginRevive()
      .accountsPartial({
        config: configPda,
        daily: dailyPda,
        vault: vaultPda,
        profile: profilePda(c),
        run: runPda(paidWorld, c),
        payerToken: tokenC,
        usdcMint,
        receipt: receiptPda(1, day, c, profile.receiptCount),
        wallet: c,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([playerC])
      .rpc();
    assert.equal(
      balBefore - (await getAccount(conn, tokenC)).amount,
      10_000_000n,
      "first revival = 10 USDC",
    );

    await program.methods
      .completeRevive()
      .accountsPartial({
        world: paidWorld,
        run: runPda(paidWorld, c),
        receipt: receiptPda(1, day, c, profile.receiptCount),
        safeSector: sectorPda(
          paidWorld,
          Math.floor(deadRun.safeX / 8),
          Math.floor(deadRun.safeY / 8),
        ),
        signer: c,
      })
      .signers([playerC])
      .rpc();
    const revived = await program.account.playerRun.fetch(runPda(paidWorld, c));
    assert.equal(Object.keys(revived.state)[0], "active");
    assert.equal(revived.score, scoreAtDeath, "score preserved through revival");
    assert.equal(revived.successfulRevives, 1);
    assert.equal(revived.y, deadRun.safeY, "revived on the saved safe row");

    // Reconcile the revival receipt into the pool.
    await program.methods
      .reconcileReceipt()
      .accountsPartial({
        daily: dailyPda,
        receipt: receiptPda(1, day, c, profile.receiptCount),
        run: runPda(paidWorld, c),
        contribution: pda(S.contribution, le64(day), c.toBuffer()),
      })
      .rpc();
    const receipt = await program.account.paymentReceipt.fetch(
      receiptPda(1, day, c, profile.receiptCount),
    );
    assert.deepEqual(receipt.state, { consumed: {} });

    // Vault conservation still holds.
    const daily = await program.account.dailyCompetition.fetch(dailyPda);
    const vault = await getAccount(conn, vaultPda);
    const liabilities =
      BigInt(daily.pendingTotal.toString()) +
      BigInt(daily.activePool.toString()) +
      BigInt(daily.refundLiability.toString()) +
      BigInt(daily.winnerUnpaid.toString()) +
      BigInt(daily.teamUnpaid.toString());
    assert.equal(vault.amount, liabilities);
  });
});
