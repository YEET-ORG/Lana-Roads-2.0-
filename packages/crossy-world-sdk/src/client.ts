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
  MAX_SESSION_SECONDS,
  Direction,
  ENTRY_PRICE,
  ReceiptKind,
  SESSION_SCOPE,
  WorldMode,
} from "./constants.js";
import { pda, sectorForTile, sectorOf, spawnSectors } from "./pda.js";
import { MAX_CARRY_TILES } from "./hazards.js";
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
  /**
   * Magic Router URL (e.g. https://devnet-router.magicblock.app). When set,
   * `resolveErForWorld` resolves the ER that actually holds the delegated
   * world via `getDelegationStatus` and re-targets the ER connection —
   * subscriptions then go DIRECTLY to that ER's websocket (the router's own
   * WS binds to an arbitrary ER, so it is only used for resolution).
   */
  routerUrl?: string;
  wallet: WalletSigner;
}

/** One entry of the router's live ER directory (`getRoutes`). */
export interface ErRoute {
  identity: string;
  fqdn: string;
  baseFee: number;
  blockTimeMs: number;
  countryCode: string;
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
  erProgram: Program<CrossyWorld>;
  readonly connection: Connection;
  erConnection: Connection;
  erProgramResolved: Program<CrossyWorld> | null = null;
  readonly wallet: WalletSigner;
  readonly validator?: PublicKey;
  readonly routerUrl?: string;
  subscriptions: SubscriptionHub;

  constructor(opts: CrossyClientOptions) {
    this.connection = opts.connection;
    this.erConnection = opts.erConnection ?? opts.connection;
    this.wallet = opts.wallet;
    this.validator = opts.validator;
    this.routerUrl = opts.routerUrl;
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

  private async routerRpc<T>(method: string, params: unknown[]): Promise<T> {
    if (!this.routerUrl) throw new Error("no routerUrl configured");
    const res = await fetch(this.routerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const json = (await res.json()) as { result?: T; error?: { message?: string } };
    if (json.error) throw new Error(`router ${method}: ${json.error.message}`);
    return json.result as T;
  }

  /** The router's live ER directory. */
  async getRoutes(): Promise<ErRoute[]> {
    return this.routerRpc<ErRoute[]>("getRoutes", []);
  }

  /**
   * Resolve which ER holds the delegated world via the Magic Router and
   * re-target the ER connection/program/subscriptions to that FQDN.
   * Falls back to the constructor-provided ER when not delegated.
   * Returns the resolved status.
   */
  async resolveErForWorld(world: PublicKey): Promise<{
    isDelegated: boolean;
    fqdn?: string;
    validator?: string;
  }> {
    const status = await this.routerRpc<{
      isDelegated: boolean;
      fqdn?: string;
      delegationRecord?: { authority: string };
    }>("getDelegationStatus", [world.toBase58()]);
    if (status.isDelegated && status.fqdn) {
      const rpc = status.fqdn.replace(/\/$/, "");
      const current = (this.erConnection as { rpcEndpoint?: string }).rpcEndpoint ?? "";
      if (!current.startsWith(rpc)) {
        const ws = rpc.replace(/^http/, "ws");
        await this.subscriptions.close().catch(() => {});
        this.erConnection = new Connection(rpc, {
          wsEndpoint: ws,
          commitment: "processed",
        });
        const erProvider = new anchor.AnchorProvider(
          this.erConnection,
          this.wallet as anchor.Wallet,
          { commitment: "processed", skipPreflight: true },
        );
        this.erProgram = new Program(idl as CrossyWorld, erProvider);
        this.subscriptions = new SubscriptionHub(this.erConnection);
        this.erBlockhashCache = null;
      }
    }
    return {
      isDelegated: status.isDelegated,
      fqdn: status.fqdn,
      validator: status.delegationRecord?.authority,
    };
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
          .accountsPartial({
            profile: pda.profile(wallet),
            world,
            lock: lockAddr,
            wallet,
          })
          .instruction(),
      );
    }
    // Delegate the player's run + best unless already delegated.
    const runInfo = await this.connection.getAccountInfo(runAddr);
    const runDelegated = runInfo != null && !runInfo.owner.equals(this.program.programId);
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
    // A run created earlier today may still hold an expired session key;
    // without this the player joins successfully and then cannot act.
    await this.ensureSession({
      day: params.day,
      mode: WorldMode.Casual,
      sessionAuthority: params.sessionAuthority,
    }).catch(() => false);
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
  private erBlockhashTimer: ReturnType<typeof setInterval> | null = null;

  private async erBlockhash(): Promise<string> {
    const now = Date.now();
    if (!this.erBlockhashCache || now - this.erBlockhashCache.fetchedAt > 15_000) {
      const { blockhash } = await this.erConnection.getLatestBlockhash("processed");
      this.erBlockhashCache = { value: blockhash, fetchedAt: now };
    }
    return this.erBlockhashCache.value;
  }

  /**
   * Prewarm the ER hot path: opens/keeps the HTTP connection (so the first
   * move never pays TLS setup) and refreshes the blockhash proactively in
   * the background (so no move ever pays a blockhash round trip). Returns a
   * disposer that stops the refresher.
   */
  async prewarmEr(): Promise<() => void> {
    // Two sequential requests: the first performs the TLS handshake, the
    // second confirms the connection is reused and hot.
    await this.erConnection.getSlot("processed").catch(() => {});
    const { blockhash } = await this.erConnection.getLatestBlockhash("processed");
    this.erBlockhashCache = { value: blockhash, fetchedAt: Date.now() };
    if (this.erBlockhashTimer) clearInterval(this.erBlockhashTimer);
    this.erBlockhashTimer = setInterval(async () => {
      try {
        const { blockhash: b } = await this.erConnection.getLatestBlockhash("processed");
        this.erBlockhashCache = { value: b, fetchedAt: Date.now() };
      } catch {
        /* next tick retries */
      }
    }, 10_000);
    return () => {
      if (this.erBlockhashTimer) clearInterval(this.erBlockhashTimer);
      this.erBlockhashTimer = null;
    };
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
      maxRetries: 0,
    });
  }

  /**
   * Fire-and-forget Kick (same hot path as sendMove): the caller supplies
   * its own state and the target's tile from the live push mirror — no
   * fetches. Displacement lands as a push on the target's run.
   */
  async sendKick(params: {
    day: bigint;
    mode?: WorldMode;
    session: Keypair;
    attemptNonce: number;
    actionSeq: number;
    facing: Direction;
    /** Omit to swing at empty space — a legal, wasted kick. */
    target?: { wallet: PublicKey; x: number; y: number };
  }): Promise<string> {
    const wallet = this.wallet.publicKey;
    const world = pda.world(params.mode ?? WorldMode.Paid, params.day);
    // Knockback destination: one tile beyond the target, same direction.
    // Without a target the program is handed nothing to displace and simply
    // burns the swing, so the client never has to be sure a target is there.
    let accounts: Record<string, PublicKey | null> = {
      target: null,
      targetSector: null,
      destSector: null,
      chunk: null,
    };
    if (params.target) {
      let [dx, dy] = [params.target.x, params.target.y];
      if (params.facing === Direction.Forward) dy += 1;
      else if (params.facing === Direction.Backward) dy -= 1;
      else if (params.facing === Direction.Left) dx -= 1;
      else dx += 1;
      if (dx >= 0 && dx <= 63 && dy >= 0) {
        const targetSector = sectorForTile(world, params.target.x, params.target.y);
        const destSector = sectorForTile(world, dx, dy);
        accounts = {
          target: pda.run(world, params.target.wallet),
          targetSector,
          destSector: destSector.equals(targetSector) ? null : destSector,
          chunk: pda.chunk(params.day, Math.floor(dy / 16)),
        };
      }
    }
    const ix = await this.erProgram.methods
      .kick(params.attemptNonce, new BN(params.actionSeq), new BN(Date.now()))
      .accountsPartial({
        world,
        kicker: pda.run(world, wallet),
        ...accounts,
        signer: params.session.publicKey,
      })
      .instruction();
    const tx = new anchor.web3.Transaction().add(ix);
    tx.recentBlockhash = await this.erBlockhash();
    tx.feePayer = params.session.publicKey;
    tx.sign(params.session);
    return this.erConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 0,
    });
  }

  /**
   * Keep the gameplay session usable.
   *
   * Sessions expire — the program refuses every action from a stale one —
   * and a run outlives them: a player who joined this morning is still on
   * the board this afternoon holding a key the program no longer accepts,
   * looking for all the world like a game that stopped responding. The
   * wallet may always rotate the authority on its own run, which changes
   * nothing about score or ownership, so top it up before it lapses.
   *
   * The run lives in the ER once delegated, so the rotation goes there.
   * Returns true when it actually rotated.
   */
  async ensureSession(params: {
    day: bigint;
    mode?: WorldMode;
    sessionAuthority: PublicKey;
    /** Rotate when less than this much life is left. Default 30 minutes. */
    minRemainingSeconds?: number;
  }): Promise<boolean> {
    const wallet = this.wallet.publicKey;
    const world = pda.world(params.mode ?? WorldMode.Paid, params.day);
    const runAddr = pda.run(world, wallet);
    const run = await this.erProgram.account.playerRun
      .fetchNullable(runAddr)
      .catch(() => null);
    if (!run) return false;
    const now = Math.floor(Date.now() / 1000);
    const margin = params.minRemainingSeconds ?? 30 * 60;
    const authorityMatches = run.sessionAuthority.equals(params.sessionAuthority);
    const healthy = authorityMatches && run.sessionExpiry.toNumber() > now + margin;
    if (healthy) return false;
    // The program caps how far ahead a session may run; stay inside it.
    const expiry = now + MAX_SESSION_SECONDS - 60;
    await this.erProgram.methods
      .rotateSession(params.sessionAuthority, new BN(expiry))
      .accountsPartial({ run: runAddr, wallet })
      .rpc({ commitment: "processed" });
    return true;
  }

  /**
   * Hand gameplay authority back to the wallet.
   *
   * The session key sits in browser storage and keeps working until it
   * expires, so leaving the game, dying, or walking away all leave a live
   * credential behind. Ending it costs one wallet-signed transaction and
   * makes every session-signed action fail immediately; `ensureSession`
   * mints a fresh one when the player comes back.
   */
  async endSession(params: { day: bigint; mode?: WorldMode }): Promise<boolean> {
    const wallet = this.wallet.publicKey;
    const world = pda.world(params.mode ?? WorldMode.Paid, params.day);
    const runAddr = pda.run(world, wallet);
    const run = await this.erProgram.account.playerRun
      .fetchNullable(runAddr)
      .catch(() => null);
    // Nothing to revoke if the run never existed or is already handed back.
    if (!run || run.sessionAuthority.equals(PublicKey.default)) return false;
    await this.erProgram.methods
      .endSession()
      .accountsPartial({ run: runAddr, wallet })
      .rpc({ commitment: "processed" });
    return true;
  }

  /**
   * Fire-and-forget record claim. Movement deliberately does not touch the
   * world's record field (it would make every move contend on one hot
   * account), so a client that beats the record publishes it separately.
   */
  async sendClaimRecord(params: {
    day: bigint;
    mode?: WorldMode;
    session: Keypair;
  }): Promise<string> {
    const world = pda.world(params.mode ?? WorldMode.Paid, params.day);
    const ix = await this.erProgram.methods
      .claimRecord()
      .accountsPartial({ world, run: pda.run(world, this.wallet.publicKey) })
      .instruction();
    const tx = new anchor.web3.Transaction().add(ix);
    tx.recentBlockhash = await this.erBlockhash();
    tx.feePayer = params.session.publicKey;
    tx.sign(params.session);
    return this.erConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 0,
    });
  }

  /**
   * Fire-and-forget hazard crank. Collision is only resolved when someone
   * asks the program to check, so every client cranks its own run and the
   * runs it can see: one honest watcher is enough to make traffic lethal for
   * everybody. A stale nonce is rejected harmlessly on chain.
   */
  async sendCheckHazard(params: {
    day: bigint;
    mode?: WorldMode;
    session: Keypair;
    wallet?: PublicKey;
    x: number;
    y: number;
    hazardNonce: number;
    /** +1 / -1 when standing on a river, so a log can carry the player. */
    driftDirection?: number;
  }): Promise<string> {
    const world = pda.world(params.mode ?? WorldMode.Paid, params.day);
    // A river carries the player downstream, by as many tiles as the log
    // moved since it last checked — so hand over the sector at the far end
    // of the longest carry it could make. Together with the player's own
    // sector that covers every tile the carry could land on.
    const sector = sectorForTile(world, params.x, params.y);
    const drift = params.driftDirection ?? 0;
    const driftX = Math.max(0, Math.min(63, params.x + drift * MAX_CARRY_TILES));
    const driftSector = drift !== 0 ? sectorForTile(world, driftX, params.y) : sector;
    const ix = await this.erProgram.methods
      .checkHazard(params.hazardNonce)
      .accountsPartial({
        world,
        run: pda.run(world, params.wallet ?? this.wallet.publicKey),
        sector,
        driftSector: driftSector.equals(sector) ? null : driftSector,
        chunk: pda.chunk(params.day, Math.floor(params.y / 16)),
      })
      .instruction();
    const tx = new anchor.web3.Transaction().add(ix);
    tx.recentBlockhash = await this.erBlockhash();
    tx.feePayer = params.session.publicKey;
    tx.sign(params.session);
    return this.erConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 0,
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
            const w = this.program.coder.accounts.decode(
              "worldHeader",
              Buffer.from(info.data),
            );
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
      if (worldSubId != null)
        void this.erConnection.removeAccountChangeListener(worldSubId);
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
