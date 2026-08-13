/**
 * CrossyClient: typed, narrow workflows over the generated program client.
 * No generic state writes; financial methods build reviewable transactions
 * separately from submission. Base-layer money flows keep preflight; ER
 * gameplay uses processed commitment.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { CrossyWorld } from "./generated/crossy_world.js";
import idl from "./generated/crossy_world.json" with { type: "json" };
import {
  Direction,
  ENTRY_PRICE,
  ReceiptKind,
  SESSION_SCOPE,
  WorldMode,
} from "./constants.js";
import { pda, sectorForTile, sectorOf, spawnSectors } from "./pda.js";
import { revivePrice, utcDayFromUnix } from "./time.js";
import { SubscriptionHub } from "./subscriptions.js";

export interface WalletSigner {
  publicKey: PublicKey;
  signTransaction<T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(
    tx: T,
  ): Promise<T>;
  signAllTransactions<
    T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction,
  >(
    txs: T[],
  ): Promise<T[]>;
}

export interface CrossyClientOptions {
  /** Base-layer connection (confirmed commitment for finance). */
  connection: Connection;
  /** Ephemeral-rollup connection (processed commitment for gameplay). */
  erConnection?: Connection;
  /** ER validator identity — pins delegation to that rollup. */
  validator?: PublicKey;
  wallet: WalletSigner;
}

/** Human-readable review returned before any financial signature. */
export interface TransactionReview {
  action: string;
  usdcTransfers: { from: string; to: string; amount: bigint }[];
  assets: { address: string; effect: "freeze" | "thaw" | "mint" | "transfer" }[];
  warnings: string[];
  instructions: TransactionInstruction[];
}

export class CrossyClient {
  readonly program: Program<CrossyWorld>;
  /** Program client bound to the ER connection for delegated gameplay. */
  readonly erProgram: Program<CrossyWorld>;
  readonly connection: Connection;
  readonly erConnection: Connection;
  readonly wallet: WalletSigner;
  readonly validator?: PublicKey;
  readonly subscriptions: SubscriptionHub;

  constructor(opts: CrossyClientOptions) {
    this.connection = opts.connection;
    this.erConnection = opts.erConnection ?? opts.connection;
    this.wallet = opts.wallet;
    this.validator = opts.validator;
    const baseProvider = new anchor.AnchorProvider(
      this.connection,
      opts.wallet as anchor.Wallet,
      { commitment: "confirmed", preflightCommitment: "confirmed" },
    );
    const erProvider = new anchor.AnchorProvider(
      this.erConnection,
      opts.wallet as anchor.Wallet,
      { commitment: "processed", skipPreflight: true },
    );
    this.program = new Program(idl as CrossyWorld, baseProvider);
    this.erProgram = new Program(idl as CrossyWorld, erProvider);
    this.subscriptions = new SubscriptionHub(this.erConnection);
  }

  // ---- readers ----------------------------------------------------------

  async getConfig() {
    return this.program.account.globalConfig.fetch(pda.config());
  }

  async getCurrentDay(): Promise<bigint> {
    // Authoritative on-chain clock, never the browser clock.
    const slot = await this.connection.getSlot("confirmed");
    const ts = await this.connection.getBlockTime(slot);
    if (ts == null) throw new Error("block time unavailable");
    const day = utcDayFromUnix(ts);
    if (day == null) throw new Error("pre-epoch clock");
    return day;
  }

  async getDaily(day: bigint) {
    return this.program.account.dailyCompetition.fetch(pda.daily(day));
  }

  async getWorld(mode: WorldMode, day: bigint) {
    return this.erProgram.account.worldHeader.fetch(pda.world(mode, day));
  }

  async getProfile(wallet = this.wallet.publicKey) {
    return this.program.account.playerProfile.fetchNullable(pda.profile(wallet));
  }

  async getRun(world: PublicKey, wallet = this.wallet.publicKey) {
    return this.erProgram.account.playerRun.fetchNullable(pda.run(world, wallet));
  }

  async getChunk(day: bigint, chunkIndex: number) {
    return this.erProgram.account.chunkDefinition.fetchNullable(
      pda.chunk(day, chunkIndex),
    );
  }

  async getSector(world: PublicKey, sx: number, sy: number) {
    return this.erProgram.account.occupancySector.fetchNullable(
      pda.sector(world, sx, sy),
    );
  }

  async getPull(wallet: PublicKey, pullNonce: number) {
    return this.program.account.gachaPull.fetchNullable(pda.pull(wallet, pullNonce));
  }

  // ---- entry workflow ---------------------------------------------------

  /**
   * Build the reviewable paid-entry bundle: ensure profile, init run (first
   * time), starter lock, 1 USDC payment + receipt. The caller shows the
   * review, then submits; ER spawn follows as its own step.
   */
  async reviewPaidEntry(params: {
    day: bigint;
    payerToken: PublicKey;
    usdcMint: PublicKey;
    sessionAuthority: PublicKey;
    sessionExpiry: number;
  }): Promise<TransactionReview & { attemptNonce: number }> {
    const wallet = this.wallet.publicKey;
    const world = pda.world(WorldMode.Paid, params.day);
    const runAddr = pda.run(world, wallet);
    const instructions: TransactionInstruction[] = [];

    const profile = await this.getProfile();
    if (!profile) {
      instructions.push(
        await this.program.methods
          .ensureProfile()
          .accountsPartial({ profile: pda.profile(wallet), wallet })
          .instruction(),
      );
    }
    if (!profile?.starterClaimed) {
      instructions.push(
        await this.program.methods
          .claimStarter()
          .accountsPartial({ profile: pda.profile(wallet), wallet })
          .instruction(),
      );
    }

    const run = await this.getRun(world);
    if (!run) {
      instructions.push(
        await this.program.methods
          .initRun(params.sessionAuthority, new BN(params.sessionExpiry))
          .accountsPartial({
            world,
            run: runAddr,
            best: pda.best(world, wallet),
            wallet,
          })
          .instruction(),
      );
    }
    const attemptNonce = (run?.attemptNonce ?? 0) + 1;
    const receiptNonce = profile?.receiptCount ?? 0;

    instructions.push(
      await this.program.methods
        .lockStarter(attemptNonce)
        .accountsPartial({
          profile: pda.profile(wallet),
          world,
          lock: pda.agentLock(world, wallet, attemptNonce),
          wallet,
        })
        .instruction(),
    );

    const daily = pda.daily(params.day);
    instructions.push(
      await this.program.methods
        .beginPaidAttempt()
        .accountsPartial({
          config: pda.config(),
          daily,
          vault: pda.dailyVault(params.day),
          profile: pda.profile(wallet),
          run: runAddr,
          payerToken: params.payerToken,
          usdcMint: params.usdcMint,
          receipt: pda.receipt(ReceiptKind.Entry, params.day, wallet, receiptNonce),
          contribution: pda.contribution(params.day, wallet),
          wallet,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );

    return {
      action: "Enter today's paid competition",
      usdcTransfers: [
        {
          from: params.payerToken.toBase58(),
          to: pda.dailyVault(params.day).toBase58(),
          amount: ENTRY_PRICE,
        },
      ],
      assets: [],
      warnings: [
        "Winner-takes-all: 90% to the daily winner, 10% to the team.",
        "The entry is refundable only if spawning fails.",
      ],
      instructions,
      attemptNonce,
    };
  }

  /** Submit a reviewed transaction on the base layer. */
  async submitReviewed(review: TransactionReview): Promise<string> {
    const tx = new anchor.web3.Transaction().add(...review.instructions);
    const provider = this.program.provider as anchor.AnchorProvider;
    return provider.sendAndConfirm(tx);
  }

  /** ER spawn for a paid attempt (session- or wallet-signed). */
  async spawn(params: {
    day: bigint;
    attemptNonce: number;
    receiptNonce: number;
    session?: Keypair;
    mode?: WorldMode;
  }): Promise<string> {
    const wallet = this.wallet.publicKey;
    const mode = params.mode ?? WorldMode.Paid;
    const world = pda.world(mode, params.day);
    const receipt =
      mode === WorldMode.Paid
        ? pda.receipt(ReceiptKind.Entry, params.day, wallet, params.receiptNonce)
        : world;
    const builder = this.erProgram.methods
      .spawn(params.attemptNonce)
      .accountsPartial({
        world,
        run: pda.run(world, wallet),
        receipt,
        agentLock: pda.agentLock(world, wallet, params.attemptNonce),
        signer: params.session?.publicKey ?? wallet,
      })
      .remainingAccounts(
        spawnSectors(world).map((pubkey) => ({
          pubkey,
          isSigner: false,
          isWritable: true,
        })),
      );
    if (params.session) builder.signers([params.session]);
    return builder.rpc();
  }

  /** Permissionless entry/revival receipt reconciliation on base. */
  async reconcileReceipt(params: {
    day: bigint;
    wallet: PublicKey;
    kind: ReceiptKind;
    receiptNonce: number;
  }): Promise<string> {
    const world = pda.world(WorldMode.Paid, params.day);
    return this.program.methods
      .reconcileReceipt()
      .accountsPartial({
        daily: pda.daily(params.day),
        receipt: pda.receipt(params.kind, params.day, params.wallet, params.receiptNonce),
        run: pda.run(world, params.wallet),
        contribution: pda.contribution(params.day, params.wallet),
      })
      .rpc();
  }

  /** Poll the ER until the delegated account is cloned there. */
  async waitForEr(address: PublicKey, timeoutMs = 90_000): Promise<void> {
    const started = Date.now();
    for (;;) {
      const acc = await this.erConnection
        .getAccountInfo(address, "processed")
        .catch(() => null);
      if (acc && acc.owner.equals(this.program.programId)) return;
      if (Date.now() - started > timeoutMs) {
        throw new Error(`timeout waiting for ER clone of ${address.toBase58()}`);
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  /**
   * Casual join, solsocket-style: profile + starter + run + lock + DELEGATE
   * run/best in ONE base transaction (validator pinned), then wait for the
   * ER clones. Gameplay continues on the ER afterwards.
   */
  async joinCasual(params: {
    day: bigint;
    sessionAuthority: PublicKey;
    sessionExpiry: number;
  }): Promise<{ attemptNonce: number }> {
    const wallet = this.wallet.publicKey;
    const world = pda.world(WorldMode.Casual, params.day);
    const runAddr = pda.run(world, wallet);
    const bestAddr = pda.best(world, wallet);
    const validatorAccounts = this.validator
      ? [{ pubkey: this.validator, isSigner: false, isWritable: false }]
      : [];

    const instructions: TransactionInstruction[] = [];
    const profile = await this.getProfile();
    if (!profile) {
      instructions.push(
        await this.program.methods
          .ensureProfile()
          .accountsPartial({ profile: pda.profile(wallet), wallet })
          .instruction(),
      );
    }
    if (!profile?.starterClaimed) {
      instructions.push(
        await this.program.methods
          .claimStarter()
          .accountsPartial({ profile: pda.profile(wallet), wallet })
          .instruction(),
      );
    }
    // The run may already exist (later attempts); the world may already be
    // delegated — init_run validates it via committed state.
    const existingRun = await this.getRun(world).catch(() => null);
    if (!existingRun) {
      instructions.push(
        await this.program.methods
          .initRun(params.sessionAuthority, new BN(params.sessionExpiry))
          .accountsPartial({ world, run: runAddr, best: bestAddr, wallet })
          .instruction(),
      );
    }
    const attemptNonce = (existingRun?.attemptNonce ?? 0) + 1;
    const lockAddr = pda.agentLock(world, wallet, attemptNonce);
    const lockInfo = await this.connection.getAccountInfo(lockAddr);
    if (!lockInfo) {
      instructions.push(
        await this.program.methods
          .lockStarter(attemptNonce)
          .accountsPartial({ profile: pda.profile(wallet), world, lock: lockAddr, wallet })
          .instruction(),
      );
    }
    // Delegate the player's run + best unless already delegated.
    const runInfo = await this.connection.getAccountInfo(runAddr);
    const runDelegated =
      runInfo != null && !runInfo.owner.equals(this.program.programId);
    if (!runDelegated) {
      instructions.push(
        await this.program.methods
          .delegateRun(world, wallet)
          .accountsPartial({ payer: wallet, pda: runAddr })
          .remainingAccounts(validatorAccounts)
          .instruction(),
        await this.program.methods
          .delegateBest(world, wallet)
          .accountsPartial({ payer: wallet, pda: bestAddr })
          .remainingAccounts(validatorAccounts)
          .instruction(),
      );
    }
    if (instructions.length > 0) {
      const tx = new anchor.web3.Transaction().add(...instructions);
      const provider = this.program.provider as anchor.AnchorProvider;
      await provider.sendAndConfirm(tx);
    }
    await this.waitForEr(runAddr);
    return { attemptNonce };
  }

  // ---- revival ----------------------------------------------------------

  /** Quote the exact next revival price from committed run state. */
  async quoteRevive(day: bigint): Promise<{
    price: bigint;
    deathNonce: number;
    deadline: number;
  } | null> {
    const world = pda.world(WorldMode.Paid, day);
    const run = await this.getRun(world);
    if (!run || !("deadAwaitingRevive" in (run.state as object))) return null;
    const price = revivePrice(run.successfulRevives);
    if (price == null) return null;
    return {
      price,
      deathNonce: run.deathNonce,
      deadline: run.reviveDeadline.toNumber(),
    };
  }

  async reviewRevive(params: {
    day: bigint;
    payerToken: PublicKey;
    usdcMint: PublicKey;
  }): Promise<TransactionReview & { receiptNonce: number }> {
    const wallet = this.wallet.publicKey;
    const quote = await this.quoteRevive(params.day);
    if (!quote) throw new Error("run is not awaiting revival");
    const profile = await this.getProfile();
    const receiptNonce = profile?.receiptCount ?? 0;
    const world = pda.world(WorldMode.Paid, params.day);
    const ix = await this.program.methods
      .beginRevive()
      .accountsPartial({
        config: pda.config(),
        daily: pda.daily(params.day),
        vault: pda.dailyVault(params.day),
        profile: pda.profile(wallet),
        run: pda.run(world, wallet),
        payerToken: params.payerToken,
        usdcMint: params.usdcMint,
        receipt: pda.receipt(ReceiptKind.Revival, params.day, wallet, receiptNonce),
        wallet,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .instruction();
    return {
      action: `Revive (death #${quote.deathNonce})`,
      usdcTransfers: [
        {
          from: params.payerToken.toBase58(),
          to: pda.dailyVault(params.day).toBase58(),
          amount: quote.price,
        },
      ],
      assets: [],
      warnings: [
        "Revival prices double after each successful revival.",
        "The payment is refundable if the revival cannot complete in time.",
      ],
      instructions: [ix],
      receiptNonce,
    };
  }

  /** ER revival completion against the paid receipt. */
  async completeRevive(params: {
    day: bigint;
    receiptNonce: number;
    session?: Keypair;
  }): Promise<string> {
    const wallet = this.wallet.publicKey;
    const world = pda.world(WorldMode.Paid, params.day);
    const run = await this.getRun(world);
    if (!run) throw new Error("run missing");
    const builder = this.erProgram.methods.completeRevive().accountsPartial({
      world,
      run: pda.run(world, wallet),
      receipt: pda.receipt(ReceiptKind.Revival, params.day, wallet, params.receiptNonce),
      safeSector: sectorForTile(world, run.safeX, run.safeY),
      signer: params.session?.publicKey ?? wallet,
    });
    if (params.session) builder.signers([params.session]);
    return builder.rpc();
  }

  // ---- gameplay actions (session-signed, ER) ----------------------------

  /** One-tile movement; derives all accounts from canonical coordinates. */
  async move(params: {
    day: bigint;
    mode?: WorldMode;
    direction: Direction;
    session: Keypair;
  }): Promise<string> {
    const wallet = this.wallet.publicKey;
    const world = pda.world(params.mode ?? WorldMode.Paid, params.day);
    const run = await this.getRun(world);
    if (!run) throw new Error("run missing");
    let [nx, ny] = [run.x, run.y];
    if (params.direction === Direction.Forward) ny += 1;
    else if (params.direction === Direction.Backward) ny -= 1;
    else if (params.direction === Direction.Left) nx -= 1;
    else nx += 1;
    if (nx < 0 || nx > 63 || ny < 0) throw new Error("out of bounds");

    const src = sectorForTile(world, run.x, run.y);
    const dst = sectorForTile(world, nx, ny);
    const [chunkIndex] = [Math.floor(ny / 16)];
    return this.erProgram.methods
      .moveAction(
        run.attemptNonce,
        run.actionSeq,
        params.direction,
        // Uniqueness memo: distinct logical actions never share bytes even
        // under a cached blockhash.
        new BN(Date.now() * 8 + params.direction),
      )
      .accountsPartial({
        world,
        run: pda.run(world, wallet),
        sourceSector: src,
        destSector: dst.equals(src) ? null : dst,
        chunk: pda.chunk(params.day, chunkIndex),
        best: pda.best(world, wallet),
        signer: params.session.publicKey,
      })
      .signers([params.session])
      .rpc();
  }

  /** Kick the facing-adjacent target. */
  async kick(params: {
    day: bigint;
    mode?: WorldMode;
    targetWallet: PublicKey;
    session: Keypair;
  }): Promise<string> {
    const wallet = this.wallet.publicKey;
    const world = pda.world(params.mode ?? WorldMode.Paid, params.day);
    const run = await this.getRun(world);
    const target = await this.getRun(world, params.targetWallet);
    if (!run || !target) throw new Error("run missing");
    // Knockback destination: one tile beyond the target in facing direction.
    const d = run.facing as Direction;
    let [dx, dy] = [target.x, target.y];
    if (d === Direction.Forward) dy += 1;
    else if (d === Direction.Backward) dy -= 1;
    else if (d === Direction.Left) dx -= 1;
    else dx += 1;
    const targetSector = sectorForTile(world, target.x, target.y);
    const destSector = sectorForTile(
      world,
      Math.max(0, Math.min(63, dx)),
      Math.max(0, dy),
    );
    return this.erProgram.methods
      .kick(run.attemptNonce, run.actionSeq, new BN(Date.now()))
      .accountsPartial({
        world,
        kicker: pda.run(world, wallet),
        target: pda.run(world, params.targetWallet),
        targetSector,
        destSector: destSector.equals(targetSector) ? null : destSector,
        chunk: pda.chunk(params.day, Math.floor(Math.max(0, dy) / 16)),
        signer: params.session.publicKey,
      })
      .signers([params.session])
      .rpc();
  }

  /** Propagate a record-beating score into the world header. */
  async claimRecord(day: bigint, mode: WorldMode = WorldMode.Paid): Promise<string> {
    const world = pda.world(mode, day);
    return this.erProgram.methods
      .claimRecord()
      .accountsPartial({ world, run: pda.run(world, this.wallet.publicKey) })
      .rpc();
  }

  /** Cached ER blockhash for the zero-fee fire-and-forget hot path. */
  private erBlockhashCache: { value: string; fetchedAt: number } | null = null;

  private async erBlockhash(): Promise<string> {
    const now = Date.now();
    if (!this.erBlockhashCache || now - this.erBlockhashCache.fetchedAt > 15_000) {
      const { blockhash } = await this.erConnection.getLatestBlockhash("processed");
      this.erBlockhashCache = { value: blockhash, fetchedAt: now };
    }
    return this.erBlockhashCache.value;
  }

  /**
   * Fire-and-forget movement (the solsocket hot path): the SESSION key is
   * the fee payer (ER transactions are zero-fee, so it never needs SOL) and
   * the only signer; the transaction is sent with skipPreflight and NOT
   * awaited — authority arrives via the realtime subscription, and the
   * caller supplies current position/sequence instead of refetching.
   */
  async sendMove(params: {
    day: bigint;
    mode?: WorldMode;
    direction: Direction;
    session: Keypair;
    x: number;
    y: number;
    attemptNonce: number;
    actionSeq: number;
  }): Promise<string> {
    const wallet = this.wallet.publicKey;
    const world = pda.world(params.mode ?? WorldMode.Paid, params.day);
    let [nx, ny] = [params.x, params.y];
    if (params.direction === Direction.Forward) ny += 1;
    else if (params.direction === Direction.Backward) ny -= 1;
    else if (params.direction === Direction.Left) nx -= 1;
    else nx += 1;
    if (nx < 0 || nx > 63 || ny < 0) throw new Error("out of bounds");
    const src = sectorForTile(world, params.x, params.y);
    const dst = sectorForTile(world, nx, ny);
    const ix = await this.erProgram.methods
      .moveAction(
        params.attemptNonce,
        new BN(params.actionSeq),
        params.direction,
        new BN(Date.now() * 8 + params.direction),
      )
      .accountsPartial({
        world,
        run: pda.run(world, wallet),
        sourceSector: src,
        destSector: dst.equals(src) ? null : dst,
        chunk: pda.chunk(params.day, Math.floor(ny / 16)),
        best: pda.best(world, wallet),
        signer: params.session.publicKey,
      })
      .instruction();
    const tx = new anchor.web3.Transaction().add(ix);
    tx.recentBlockhash = await this.erBlockhash();
    tx.feePayer = params.session.publicKey;
    tx.sign(params.session);
    return this.erConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
  }

  /**
   * Solsocket-style realtime feed: ONE processed-commitment programSubscribe
   * on the ER websocket, filtered by the world address at offset 8 — which
   * matches every PlayerRun, OccupancySector, and DailyBest of that world.
   * Decoded pushes arrive at ER slot time (~50ms); a separate account
   * subscription covers the WorldHeader itself.
   */
  subscribeWorldRealtime(params: {
    world: PublicKey;
    onRun?: (run: any, slot: number) => void;
    onSector?: (sector: any, slot: number) => void;
    onWorld?: (world: any, slot: number) => void;
  }): () => void {
    const subId = this.erConnection.onProgramAccountChange(
      this.program.programId,
      (keyed, ctx) => {
        const data = Buffer.from(keyed.accountInfo.data);
        try {
          const run = this.program.coder.accounts.decode("playerRun", data);
          params.onRun?.(run, ctx.slot);
          return;
        } catch {
          /* not a run */
        }
        try {
          const sector = this.program.coder.accounts.decode("occupancySector", data);
          params.onSector?.(sector, ctx.slot);
          return;
        } catch {
          /* not a sector */
        }
      },
      {
        commitment: "processed",
        filters: [{ memcmp: { offset: 8, bytes: params.world.toBase58() } }],
      },
    );
    let worldSubId: number | null = null;
    if (params.onWorld) {
      worldSubId = this.erConnection.onAccountChange(
        params.world,
        (info, ctx) => {
          try {
            const w = this.program.coder.accounts.decode("worldHeader", Buffer.from(info.data));
            params.onWorld?.(w, ctx.slot);
          } catch {
            /* not yet initialized on this plane */
          }
        },
        { commitment: "processed" },
      );
    }
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      void this.erConnection.removeProgramAccountChangeListener(subId);
      if (worldSubId != null) void this.erConnection.removeAccountChangeListener(worldSubId);
    };
  }

  // ---- interest management ---------------------------------------------

  /**
   * Subscribe to the sectors within `radius` sectors of the player plus the
   * run and world; returns a single disposer that releases everything.
   */
  subscribeNearby(params: {
    world: PublicKey;
    x: number;
    y: number;
    radius?: number;
    onUpdate: (address: PublicKey, data: Buffer, slot: number) => void;
  }): () => void {
    const radius = params.radius ?? 1;
    const disposers: (() => void)[] = [];
    const [csx, csy] = sectorOf(params.x, params.y);
    for (let sy = Math.max(0, csy - radius); sy <= csy + radius; sy++) {
      for (let sx = Math.max(0, csx - radius); sx <= Math.min(7, csx + radius); sx++) {
        const addr = pda.sector(params.world, sx, sy);
        disposers.push(
          this.subscriptions.onAccount(addr, (info, slot) =>
            params.onUpdate(addr, info.data, slot),
          ),
        );
      }
    }
    disposers.push(
      this.subscriptions.onAccount(params.world, (info, slot) =>
        params.onUpdate(params.world, info.data, slot),
      ),
    );
    const runAddr = pda.run(params.world, this.wallet.publicKey);
    disposers.push(
      this.subscriptions.onAccount(runAddr, (info, slot) =>
        params.onUpdate(runAddr, info.data, slot),
      ),
    );
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      for (const d of disposers) d();
    };
  }

  /** Release all subscriptions. */
  async close(): Promise<void> {
    await this.subscriptions.close();
  }
}
