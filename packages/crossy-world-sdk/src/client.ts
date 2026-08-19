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
  type SessionClaim,
  DEFAULT_VRF_BASE_QUEUE,
  MAX_SESSION_SECONDS,
  MPL_CORE_PROGRAM_ID,
  Direction,
  ENTRY_PRICE,
  MAX_MOVE_BATCH,
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
  /**
   * Rollup region this client plays in. Defaults to 0.
   *
   * A world is delegated to exactly one validator, so a region is not a
   * preference layered over a shared game — it selects WHICH world, pot and
   * leaderboard you are in. Every region-scoped PDA below reads it, which is
   * why it lives on the client rather than being threaded through forty call
   * signatures that would all have to agree.
   */
  region?: number;
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

/**
 * Where a transaction is in its life.
 *
 * `sent` is a real terminal state here, not a way-station: gameplay goes to
 * the rollup with `skipPreflight` at `processed`, which returns a signature
 * for a transaction the program may still refuse. Anything that reports
 * `confirmed` genuinely waited for it.
 */
export type TxStatus = "pending" | "sent" | "confirmed" | "failed";

/** One transaction's progress, for anything that wants to show the player. */
export interface TxActivity {
  id: number;
  /** Human label — "Joining world", not an instruction name. */
  label: string;
  plane: "base" | "er";
  status: TxStatus;
  signature?: string;
  error?: string;
  /**
   * High-frequency gameplay (moves, kicks, hazard cranks). A player hops
   * several times a second, so these must never each claim a slot on
   * screen; the UI collapses them and shows failures.
   */
  quiet?: boolean;
  /**
   * Automated upkeep the player never asked for — the hazard crank fires
   * several times a second and its refusals are routine (a stale nonce
   * means somebody else already resolved that tile). Never worth a toast,
   * least of all a red one.
   */
  background?: boolean;
  at: number;
  /** When the send started — the anchor every later update measures from. */
  startedAt: number;
  /**
   * Round trip in milliseconds, once the transaction has a verdict.
   *
   * This is the number that tells a player whether the game is slow or
   * their input was wrong, so it is measured from the moment the send
   * began, not from the moment a signature came back.
   */
  durationMs?: number;
}

/** Where a pack is in its life. */
/**
 * Mirrors `state::gacha::PullState`.
 *
 * `randomnessReady` is the window between MagicBlock's VRF callback landing
 * and `assign_pull` drawing the variant from it. A pull is still open there —
 * paid for, not yet resolved — and the profile allows only one open pull, so
 * a client that treats it as terminal shows a buy button that can only fail.
 */
export type PullState =
  | "pending"
  | "randomnessReady"
  | "assigned"
  | "claimed"
  | "refundable"
  | "refunded";

/** One variant of a season's roster, with what is left of it. */
export interface VariantSummary {
  address: PublicKey;
  variantId: number;
  classId: number;
  rarity: number;
  /** Agent index the client draws for this variant. */
  modelId: number;
  supplyCap: number;
  reserved: number;
  minted: number;
  active: boolean;
  remaining: number;
}

/** One pack a wallet has bought. */
export interface PullSummary {
  address: PublicKey;
  pullNonce: number;
  season: number;
  tier: number;
  price: bigint;
  state: PullState;
  assignedRarity: number;
  assignedVariant: number;
  mintedAsset: PublicKey;
  requestedAt: number;
}

/** Banner tiers, in the order the program numbers them. */
export const TIER_NAMES = ["standard", "enhanced", "premium"] as const;

/** A player's chosen, on-chain display identity. */
export interface PlayerIdentity {
  wallet: PublicKey;
  /** Sanitised by the program; safe to render as-is. */
  name: string;
  /** Cosmetic agent index — what every other client should draw them as. */
  agent: number;
}

/** One row of a day's standings. */
export interface LeaderboardEntry {
  wallet: PublicKey;
  /** Best row reached today, across every attempt. */
  bestScore: number;
  attemptNonce: number;
  /** Slot the best was reached — the program's own tiebreak. */
  reachedSlot: bigint;
  classId: number;
  /** Still out there right now. */
  live: boolean;
  state: string;
  /** Score of the attempt in progress (0 when not playing). */
  currentScore: number;
}

/** One player's run as seen from outside: enough to draw and to count. */
export interface RunSummary {
  wallet: PublicKey;
  x: number;
  y: number;
  score: number;
  state: string;
  hazardNonce: number;
  /** Monotonic counter of authoritative mutations (`PlayerRun.state_seq`). */
  stateSeq: bigint;
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
  /** Rollup region this client plays in; see `CrossyClientOptions.region`. */
  region: number;
  /** Account subscriptions on the active ER connection. */
  subscriptions: SubscriptionHub;
  /** Immutable map chunks remain on base and use its websocket. */
  readonly baseSubscriptions: SubscriptionHub;
  /** Raw ER slot/program subscriptions that must move with the connection. */
  private erRealtimeDisposers = new Set<() => void>();

  constructor(opts: CrossyClientOptions) {
    this.connection = opts.connection;
    this.erConnection = opts.erConnection ?? opts.connection;
    this.wallet = opts.wallet;
    this.validator = opts.validator;
    this.routerUrl = opts.routerUrl;
    this.region = opts.region ?? 0;
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
    this.baseSubscriptions = new SubscriptionHub(this.connection);
  }

  /** Register an idempotent disposer tied to the current ER connection. */
  private trackErSubscription(dispose: () => void): () => void {
    let disposed = false;
    const tracked = () => {
      if (disposed) return;
      disposed = true;
      this.erRealtimeDisposers.delete(tracked);
      dispose();
    };
    this.erRealtimeDisposers.add(tracked);
    return tracked;
  }

  /** Close raw listeners before replacing the ER connection. */
  private closeErRealtimeSubscriptions(): void {
    for (const dispose of [...this.erRealtimeDisposers]) dispose();
  }

  // ---- transaction activity ---------------------------------------------

  private txListeners = new Set<(a: TxActivity) => void>();
  private txSeq = 0;
  /**
   * Signature -> the activity it belongs to, so a later verdict lands on
   * the SAME entry instead of opening a second one. Bounded: gameplay
   * produces a signature every hop and this must not grow all session.
   */
  private txBySignature = new Map<string, TxActivity>();

  /**
   * Watch every transaction this client sends. Returns an unsubscribe.
   *
   * The client is the only place that knows a send happened, when its
   * signature came back, and whether it settled — so it reports, and the UI
   * decides what deserves the player's attention.
   */
  onTx(listener: (a: TxActivity) => void): () => void {
    this.txListeners.add(listener);
    return () => this.txListeners.delete(listener);
  }

  private emitTx(a: TxActivity) {
    for (const l of this.txListeners) {
      try {
        l(a);
      } catch {
        // A listener that throws must not take a transaction down with it.
      }
    }
  }

  /**
   * Run a send and report its progress.
   *
   * `settles` says what resolution means for this call: base transactions go
   * through `sendAndConfirm` and are genuinely confirmed, while rollup sends
   * return as soon as the validator accepts the bytes.
   */
  private async track<T>(
    label: string,
    plane: "base" | "er",
    fn: () => Promise<T>,
    opts: { quiet?: boolean; background?: boolean; settles?: TxStatus } = {},
  ): Promise<T> {
    const id = ++this.txSeq;
    const startedAt = Date.now();
    const stamp = (rest: Partial<TxActivity>): TxActivity => ({
      id,
      label,
      plane,
      quiet: opts.quiet,
      background: opts.background,
      at: Date.now(),
      startedAt,
      status: "pending",
      ...rest,
    });
    this.emitTx(stamp({ status: "pending" }));
    try {
      const out = await fn();
      const signature = typeof out === "string" ? out : undefined;
      const settled = stamp({
        status: opts.settles ?? (plane === "base" ? "confirmed" : "sent"),
        signature,
        durationMs: Date.now() - startedAt,
      });
      if (signature) {
        if (this.txBySignature.size > 64) this.txBySignature.clear();
        this.txBySignature.set(signature, settled);
      }
      this.emitTx(settled);
      return out;
    } catch (e: any) {
      // anchor@0.32 + web3.js@1.98 disagree on SendTransactionError's shape,
      // so `message` is often "Unknown action 'undefined'". The useful text
      // is in the transaction fields.
      const code = (e?.transactionLogs as string[] | undefined)
        ?.map((l) => l.match(/Error Code: (\w+)/)?.[1])
        .find(Boolean);
      const error = code ?? `${e?.transactionMessage ?? e?.message ?? e}`.slice(0, 140);
      // "Already processed" is the cluster saying THIS EXACT transaction is
      // on chain — the work happened. Reporting it as a failure would be a
      // lie the player has no way to check.
      if (/already been processed/i.test(error)) {
        this.emitTx(
          stamp({
            status: plane === "base" ? "confirmed" : "sent",
            durationMs: Date.now() - startedAt,
          }),
        );
        throw e;
      }
      this.emitTx(stamp({ status: "failed", error, durationMs: Date.now() - startedAt }));
      throw e;
    }
  }

  /**
   * Correct a transaction's story after the fact.
   *
   * A rollup send returns a signature the instant the validator takes the
   * bytes, which is BEFORE the program has judged it. Only the caller
   * watching authoritative state knows whether the action actually
   * happened, so it can say so here and whatever is on screen updates
   * rather than leaving a cheerful receipt for something that never
   * occurred.
   */
  markTx(signature: string, status: TxStatus, error?: string, label?: string) {
    const seen = this.txBySignature.get(signature);
    const startedAt = seen?.startedAt ?? Date.now();
    this.emitTx({
      id: seen?.id ?? ++this.txSeq,
      label: label ?? seen?.label ?? "Action",
      plane: seen?.plane ?? "er",
      quiet: seen?.quiet,
      background: seen?.background,
      status,
      signature,
      error,
      at: Date.now(),
      startedAt,
      // Measured from the original send: a verdict that arrives late is
      // exactly the case where the elapsed time is worth knowing.
      durationMs: Date.now() - startedAt,
    });
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
        this.closeErRealtimeSubscriptions();
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
    return this.program.account.dailyCompetition.fetch(pda.daily(this.region, day));
  }

  async getWorld(mode: WorldMode, day: bigint) {
    return this.erProgram.account.worldHeader.fetch(pda.world(this.region, mode, day));
  }

  /**
   * A world header from whichever plane still has it.
   *
   * While a day is live the header is delegated and only the rollup is
   * current; once it has been closed and undelegated, only base has it at
   * all. A screen that shows past days has to ask both.
   */
  async getWorldAnywhere(mode: WorldMode, day: bigint) {
    const address = pda.world(this.region, mode, day);
    const live = await this.erProgram.account.worldHeader
      .fetchNullable(address)
      .catch(() => null);
    if (live) return live;
    return this.program.account.worldHeader.fetchNullable(address).catch(() => null);
  }

  /**
   * Follow the rollup's slot, which IS world time.
   *
   * Hazards advance on `Clock::slot`, so this is the only clock that
   * agrees with the program. A subscription rather than a poll: the
   * validator publishes every slot (~50ms), and between notifications the
   * caller can carry the value forward with a monotonic timer.
   */
  subscribeSlot(onSlot: (slot: number) => void): () => void {
    const connection = this.erConnection;
    const id = connection.onSlotChange((info) => onSlot(info.slot));
    return this.trackErSubscription(() => {
      void connection.removeSlotChangeListener(id);
    });
  }

  /**
   * The rollup's own wall clock, in milliseconds.
   *
   * Hazards are evaluated against `Clock::unix_timestamp` on the validator,
   * so a client that anchors its animation to the BROWSER clock is one
   * whole hazard tick out of step for every second of skew — and browser
   * clocks are routinely off by that much. Ask the chain what time it is.
   *
   * `getBlockTime` reports the slot's production time, so the answer is a
   * touch stale; that lands the client slightly BEHIND the program, which
   * is the direction that cannot get a player killed. Null when the
   * endpoint does not answer, in which case the caller keeps its own clock.
   */
  async chainTimeMs(): Promise<number | null> {
    try {
      const slot = await this.erConnection.getSlot("processed");
      const seconds = await this.erConnection.getBlockTime(slot);
      return seconds == null ? null : seconds * 1000;
    } catch {
      return null;
    }
  }

  /**
   * Publish this wallet's display name and chosen agent.
   *
   * Wallet-signed and on the base layer: it is who you are, not what your
   * run is doing, so a session key has no business changing it.
   */
  async setIdentity(params: { name: string; agent: number }): Promise<string> {
    return this.track("Saving your name", "base", () =>
      this.program.methods
        .setIdentity(params.name, params.agent)
        .accountsPartial({
          identity: pda.identity(this.wallet.publicKey),
          wallet: this.wallet.publicKey,
        })
        .rpc(),
    );
  }

  /**
   * Display identities for a set of wallets, in one request.
   *
   * The leaderboard needs twenty of these and the world needs one per
   * visible player, so they are fetched together rather than one at a
   * time. A wallet without an identity is simply absent from the map — it
   * has not chosen a name, and the caller falls back to its address.
   */
  async getIdentities(wallets: PublicKey[]): Promise<Map<string, PlayerIdentity>> {
    const out = new Map<string, PlayerIdentity>();
    if (!wallets.length) return out;
    const addresses = wallets.map((w) => pda.identity(w));
    // getMultipleAccounts caps at 100 per request.
    for (let i = 0; i < addresses.length; i += 100) {
      const slice = addresses.slice(i, i + 100);
      const infos = await this.connection.getMultipleAccountsInfo(slice).catch(() => []);
      infos.forEach((info, j) => {
        if (!info) return;
        try {
          const acc: any = this.program.coder.accounts.decode(
            "playerIdentity",
            Buffer.from(info.data),
          );
          const len = acc.nameLen as number;
          const name = Buffer.from(acc.name.slice(0, len)).toString("utf8");
          out.set(wallets[i + j].toBase58(), {
            wallet: acc.wallet as PublicKey,
            name,
            agent: acc.agent as number,
          });
        } catch {
          /* not an identity account */
        }
      });
    }
    return out;
  }

  async getIdentity(wallet = this.wallet.publicKey): Promise<PlayerIdentity | null> {
    return (await this.getIdentities([wallet])).get(wallet.toBase58()) ?? null;
  }

  async getProfile(wallet = this.wallet.publicKey) {
    return this.program.account.playerProfile.fetchNullable(pda.profile(wallet));
  }

  async getRun(world: PublicKey, wallet = this.wallet.publicKey) {
    return this.erProgram.account.playerRun.fetchNullable(pda.run(world, wallet));
  }

  /**
   * Every run account attached to a world, straight from the ER.
   *
   * The realtime subscription only reports runs that CHANGE, so a client
   * that just connected cannot see anyone standing still — it learns of
   * them the moment they hop, and not before. A roster snapshot is how the
   * "who is here" question gets an answer that is true at connect time
   * rather than eventually.
   */
  async listRuns(world: PublicKey): Promise<RunSummary[]> {
    const rows = await this.erProgram.account.playerRun.all([
      { memcmp: { offset: 8, bytes: world.toBase58() } },
    ]);
    return rows.map(({ account }: { account: any }) => ({
      wallet: account.wallet as PublicKey,
      x: account.x as number,
      y: account.y as number,
      score: account.score as number,
      state: (Object.keys(account.state)[0] ?? "?") as string,
      hazardNonce: account.hazardNonce as number,
      // Every authoritative mutation bumps this, including ones that change
      // nothing a client can see. Comparing it against what the realtime
      // feed last reported is how a caller proves the feed missed something,
      // rather than guessing from a silence that may just be a quiet world.
      stateSeq: BigInt(account.stateSeq?.toString() ?? account.actionSeq.toString()),
    }));
  }

  /**
   * The day's standings for a world.
   *
   * `DailyBest` is the authoritative per-player high water mark: the run
   * account only holds the CURRENT attempt, so a player who died at row 40
   * and respawned would otherwise appear to be worth 3. Live run state is
   * merged in so the board can say who is still out there.
   *
   * Reads the rollup first and falls back to base. Both are right at
   * different times: while the day is live the bests are delegated and only
   * the rollup has the current numbers; once the day is settled and the
   * accounts have come home, only base still has them.
   */
  async leaderboard(world: PublicKey): Promise<LeaderboardEntry[]> {
    const decode = (rows: any[]): LeaderboardEntry[] =>
      rows.map(({ account }: any) => ({
        wallet: account.wallet as PublicKey,
        bestScore: account.bestScore as number,
        attemptNonce: account.attemptNonce as number,
        reachedSlot: BigInt(account.reachedSlot.toString()),
        classId: account.classId as number,
        live: false,
        state: "idle",
        currentScore: 0,
      }));
    const filter = [{ memcmp: { offset: 8, bytes: world.toBase58() } }];

    let bests: LeaderboardEntry[] = [];
    try {
      bests = decode(await this.erProgram.account.dailyBest.all(filter));
    } catch {
      bests = [];
    }
    if (!bests.length) {
      try {
        bests = decode(await this.program.account.dailyBest.all(filter));
      } catch {
        bests = [];
      }
    }

    const runs = await this.listRuns(world).catch(() => [] as RunSummary[]);
    const byWallet = new Map(runs.map((r) => [r.wallet.toBase58(), r]));
    for (const e of bests) {
      const run = byWallet.get(e.wallet.toBase58());
      if (!run) continue;
      e.state = run.state;
      e.live = run.state === "active";
      e.currentScore = run.score;
      // A run in progress can already be past the recorded best: the best
      // is written as it is beaten, and a client reading mid-hop would see
      // a board that disagrees with the score on the player's own screen.
      if (run.score > e.bestScore) e.bestScore = run.score;
    }
    // Same score: whoever got there first ranks higher. `reached_slot` is
    // the program's own record of when, so the order is not this client's
    // opinion.
    return bests.sort(
      (a, b) =>
        b.bestScore - a.bestScore ||
        (a.reachedSlot < b.reachedSlot ? -1 : a.reachedSlot > b.reachedSlot ? 1 : 0),
    );
  }

  async getChunk(day: bigint, chunkIndex: number) {
    // Visible chunks are delegated with the live world, so map bootstrap has
    // one authoritative low-latency source.
    const address = pda.chunk(this.region, day, chunkIndex);
    const er = await this.erProgram.account.chunkDefinition
      .fetchNullable(address)
      .catch(() => null);
    if (this.isRevealedChunk(er, day, chunkIndex)) return er;
    // Base is a propagation fallback for freshly published chunks.
    const base = await this.program.account.chunkDefinition
      .fetchNullable(address)
      .catch(() => null);
    return this.isRevealedChunk(base, day, chunkIndex) ? base : null;
  }

  private isRevealedChunk(chunk: any, day: bigint, chunkIndex: number): boolean {
    if (!chunk) return false;
    try {
      return (
        BigInt(chunk.day.toString()) === day &&
        chunk.chunkIndex === chunkIndex &&
        chunk.rowStart === chunkIndex * 16 &&
        chunk.rowCount === 16 &&
        chunk.status != null &&
        "revealed" in chunk.status
      );
    } catch {
      return false;
    }
  }

  /**
   * Read a contiguous ER-local map snapshot in bounded RPC batches.
   *
   * Cold start used to issue one request per chunk. A throttled public RPC
   * could therefore return a mixture of generations/holes and leave the
   * scene waiting on several independent retries. One multiple-account read
   * gives the renderer a consistent contiguous prefix and is substantially
   * cheaper during reloads. Solana limits this RPC to 100 addresses.
   */
  async getChunks(
    day: bigint,
    fromIndex: number,
    count: number,
  ): Promise<Array<any | null>> {
    if (!Number.isInteger(fromIndex) || fromIndex < 0)
      throw new Error("invalid first chunk index");
    if (!Number.isInteger(count) || count < 0) throw new Error("invalid chunk count");
    const addresses = Array.from({ length: count }, (_, offset) =>
      pda.chunk(this.region, day, fromIndex + offset),
    );
    const chunks: Array<any | null> = [];
    for (let start = 0; start < addresses.length; start += 100) {
      const batchAddresses = addresses.slice(start, start + 100);
      const infos = await this.erConnection
        .getMultipleAccountsInfo(batchAddresses, { commitment: "confirmed" })
        .catch(() => batchAddresses.map(() => null));
      const decoded = infos.map((info, offset) => {
        if (!info) return null;
        try {
          const chunk = this.program.coder.accounts.decode(
            "chunkDefinition",
            Buffer.from(info.data),
          );
          return this.isRevealedChunk(chunk, day, fromIndex + start + offset)
            ? chunk
            : null;
        } catch {
          return null;
        }
      });
      const missing = decoded
        .map((chunk, offset) => (chunk == null ? offset : -1))
        .filter((offset) => offset >= 0);
      if (missing.length) {
        const fallbackInfos = await this.connection
          .getMultipleAccountsInfo(
            missing.map((offset) => batchAddresses[offset]),
            { commitment: "processed" },
          )
          .catch(() => missing.map(() => null));
        fallbackInfos.forEach((info, fallbackIndex) => {
          if (!info) return;
          const offset = missing[fallbackIndex];
          try {
            const chunk = this.program.coder.accounts.decode(
              "chunkDefinition",
              Buffer.from(info.data),
            );
            if (this.isRevealedChunk(chunk, day, fromIndex + start + offset))
              decoded[offset] = chunk;
          } catch {
            // Remains missing; the map subscription/retry path will heal it.
          }
        });
      }
      chunks.push(...decoded);
    }
    return chunks;
  }

  /** Push notification for an immutable base-layer map chunk. */
  subscribeChunk(
    day: bigint,
    chunkIndex: number,
    onChunk: (chunk: any, slot: number) => void,
  ): () => void {
    return this.baseSubscriptions.onAccount(pda.chunk(this.region, day, chunkIndex), (info, slot) => {
      try {
        const chunk = this.program.coder.accounts.decode(
          "chunkDefinition",
          Buffer.from(info.data),
        );
        onChunk(chunk, slot);
      } catch {
        // The account may be observed between creation and valid decoding;
        // the confirmed read/retry path will heal it.
      }
    });
  }

  async getSector(world: PublicKey, sx: number, sy: number) {
    return this.erProgram.account.occupancySector.fetchNullable(
      pda.sector(world, sx, sy),
    );
  }

  // ---- gacha ------------------------------------------------------------

  async getSeason(seasonIndex: number) {
    return this.program.account.season.fetchNullable(pda.season(seasonIndex));
  }

  async getBanner(seasonIndex: number, tier: number) {
    return this.program.account.banner.fetchNullable(pda.banner(seasonIndex, tier));
  }

  /**
   * Every variant of a season, in `variant_id` order.
   *
   * The order is not cosmetic: `request_pull` and `assign_pull` both demand
   * the FULL inventory in ascending id, so nobody can improve their odds by
   * presenting a favourable subset.
   */
  async listVariants(seasonIndex: number): Promise<VariantSummary[]> {
    const rows = await this.program.account.variantInventory.all();
    return rows
      .filter(({ account }: any) => account.season === seasonIndex)
      .map(({ publicKey, account }: any) => ({
        address: publicKey as PublicKey,
        variantId: account.variantId as number,
        classId: account.classId as number,
        rarity: account.rarity as number,
        modelId: account.modelId as number,
        supplyCap: account.supplyCap as number,
        reserved: account.reserved as number,
        minted: account.minted as number,
        active: account.active as boolean,
        remaining: (account.supplyCap - account.reserved - account.minted) as number,
      }))
      .sort((a, b) => a.variantId - b.variantId);
  }

  /** Every pull this wallet has ever made, newest first. */
  async listPulls(wallet = this.wallet.publicKey): Promise<PullSummary[]> {
    const rows = await this.program.account.gachaPull.all([
      { memcmp: { offset: 8, bytes: wallet.toBase58() } },
    ]);
    return rows
      .map(({ publicKey, account }: any) => ({
        address: publicKey as PublicKey,
        pullNonce: account.pullNonce as number,
        season: account.season as number,
        tier: account.tier as number,
        price: BigInt(account.price.toString()),
        state: (Object.keys(account.state)[0] ?? "?") as PullState,
        assignedRarity: account.assignedRarity as number,
        assignedVariant: account.assignedVariant as number,
        mintedAsset: account.mintedAsset as PublicKey,
        requestedAt: Number(account.requestedAt.toString()),
      }))
      .sort((a, b) => b.pullNonce - a.pullNonce);
  }

  /**
   * Build the reviewable "open a pack" transaction.
   *
   * Money leaves the wallet here, so it follows the same rule as paid
   * entry: the player sees exactly what will move before anything is
   * signed. The pull is NOT decided by this transaction — it only pays and
   * snapshots the odds; MagicBlock VRF supplies authenticated randomness.
   */
  async reviewPull(params: {
    seasonIndex: number;
    tier: number;
    payerToken: PublicKey;
    oracleQueue?: PublicKey;
  }): Promise<TransactionReview & { pullNonce: number }> {
    const wallet = this.wallet.publicKey;
    const config: any = await this.getConfig();
    const season: any = await this.getSeason(params.seasonIndex);
    if (!season || !("active" in season.status)) throw new Error("season is not active");
    const banner: any = await this.getBanner(params.seasonIndex, params.tier);
    if (!banner) throw new Error("banner not configured");
    if (season.variantCount === 0) throw new Error("season has no variants");

    const instructions: TransactionInstruction[] = [];
    const profile: any = await this.getProfile();
    if (profile && !new PublicKey(profile.pendingPull).equals(PublicKey.default)) {
      throw new Error("finish or refund the current pack before opening another");
    }
    if (!profile) {
      instructions.push(
        await this.program.methods
          .ensureProfile()
          .accountsPartial({ profile: pda.profile(wallet), wallet })
          .instruction(),
      );
    }
    const pullNonce = profile?.pullCount ?? 0;

    instructions.push(
      await this.program.methods
        .requestPull()
        .accountsPartial({
          config: pda.config(),
          season: pda.season(params.seasonIndex),
          banner: pda.banner(params.seasonIndex, params.tier),
          profile: pda.profile(wallet),
          commonPool: pda.rarityPool(params.seasonIndex, 0),
          rarePool: pda.rarityPool(params.seasonIndex, 1),
          epicPool: pda.rarityPool(params.seasonIndex, 2),
          legendaryPool: pda.rarityPool(params.seasonIndex, 3),
          pull: pda.pull(wallet, pullNonce),
          gachaVaultAuthority: pda.gachaVaultAuthority(),
          gachaVault: pda.gachaVault(),
          payerToken: params.payerToken,
          usdcMint: config.usdcMint,
          wallet,
          oracleQueue:
            params.oracleQueue ?? DEFAULT_VRF_BASE_QUEUE,
          tokenProgram: config.tokenProgram,
        })
        .instruction(),
    );

    const price = BigInt(banner.price.toString());
    return {
      action: `Open a ${TIER_NAMES[params.tier] ?? "standard"} pack`,
      usdcTransfers: [
        {
          from: params.payerToken.toBase58(),
          to: pda.gachaVault().toBase58(),
          amount: price,
        },
      ],
      assets: [],
      warnings: [
        "The pack is decided after payment, by the season's published odds.",
        "If the rarity it lands on has sold out, the pull becomes refundable.",
      ],
      instructions,
      pullNonce,
    };
  }

  /**
   * Mint the assigned agent.
   *
   * The asset keypair is generated here and signs its own creation; the
   * owner is fixed to the pull's player by the program, so it cannot be
   * redirected by whoever pays.
   */
  async claimPull(params: {
    pullNonce: number;
    uri: string;
  }): Promise<{ signature: string; asset: PublicKey }> {
    const wallet = this.wallet.publicKey;
    const config: any = await this.getConfig();
    const pullAddress = pda.pull(wallet, params.pullNonce);
    const pull: any = await this.program.account.gachaPull.fetch(pullAddress);
    const asset = Keypair.generate();
    const signature = await this.track("Minting your agent", "base", () =>
      this.program.methods
        .claimPull(params.uri)
        .accountsPartial({
          config: pda.config(),
          pull: pullAddress,
          variant: pda.variant(pull.season, pull.assignedVariant),
          asset: asset.publicKey,
          assetMap: pda.assetMap(asset.publicKey),
          collection: config.collection,
          mintAuthority: pda.mintAuthority(),
          owner: wallet,
          payer: wallet,
          coreProgram: MPL_CORE_PROGRAM_ID,
        })
        .signers([asset])
        .rpc(),
    );
    return { signature, asset: asset.publicKey };
  }

  /** Take the money back when a pull landed on sold-out inventory. */
  async refundPull(params: {
    pullNonce: number;
    walletToken: PublicKey;
  }): Promise<string> {
    const config: any = await this.getConfig();
    return this.track("Refunding the pack", "base", () =>
      this.program.methods
        .refundPull()
        .accountsPartial({
          config: pda.config(),
          pull: pda.pull(this.wallet.publicKey, params.pullNonce),
          profile: pda.profile(this.wallet.publicKey),
          gachaVaultAuthority: pda.gachaVaultAuthority(),
          gachaVault: pda.gachaVault(),
          walletToken: params.walletToken,
          usdcMint: config.usdcMint,
          tokenProgram: config.tokenProgram,
        })
        .rpc(),
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
    const world = pda.world(this.region, WorldMode.Paid, params.day);
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

    const daily = pda.daily(this.region, params.day);
    instructions.push(
      await this.program.methods
        .beginPaidAttempt()
        .accountsPartial({
          config: pda.config(),
          daily,
          vault: pda.dailyVault(this.region, params.day),
          profile: pda.profile(wallet),
          run: runAddr,
          payerToken: params.payerToken,
          usdcMint: params.usdcMint,
          receipt: pda.receipt(ReceiptKind.Entry, this.region, params.day, wallet, receiptNonce),
          contribution: pda.contribution(this.region, params.day, wallet),
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
          to: pda.dailyVault(this.region, params.day).toBase58(),
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
    return this.track(review.action, "base", () => provider.sendAndConfirm(tx));
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
    const world = pda.world(this.region, mode, params.day);
    const receipt =
      mode === WorldMode.Paid
        ? pda.receipt(ReceiptKind.Entry, this.region, params.day, wallet, params.receiptNonce)
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
    return this.track("Entering the world", "er", () => builder.rpc());
  }

  /** Permissionless entry/revival receipt reconciliation on base. */
  async reconcileReceipt(params: {
    day: bigint;
    wallet: PublicKey;
    kind: ReceiptKind;
    receiptNonce: number;
  }): Promise<string> {
    const world = pda.world(this.region, WorldMode.Paid, params.day);
    return this.track("Receipt", "base", () =>
      this.program.methods
        .reconcileReceipt()
        .accountsPartial({
          daily: pda.daily(this.region, params.day),
          receipt: pda.receipt(params.kind, this.region,
            params.day,
            params.wallet,
            params.receiptNonce,
          ),
          run: pda.run(world, params.wallet),
          contribution: pda.contribution(this.region, params.day, params.wallet),
        })
        .rpc(),
    );
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
  }): Promise<{ attemptNonce: number; sessionRotation?: number }> {
    const wallet = this.wallet.publicKey;
    const world = pda.world(this.region, WorldMode.Casual, params.day);
    const runAddr = pda.run(world, wallet);
    const bestAddr = pda.best(world, wallet);

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
          // The world is read on chain to decide which rollup this run is
          // delegated to; a run on a different validator than its world is an
          // account nobody can play.
          .accountsPartial({
            config: pda.config(),
            worldAccount: world,
            payer: wallet,
            pda: runAddr,
          })
          .instruction(),
        await this.program.methods
          .delegateBest(world, wallet)
          .accountsPartial({
            config: pda.config(),
            worldAccount: world,
            payer: wallet,
            pda: bestAddr,
          })
          .instruction(),
      );
    }
    if (instructions.length > 0) {
      const tx = new anchor.web3.Transaction().add(...instructions);
      const provider = this.program.provider as anchor.AnchorProvider;
      await this.track("Joining the world", "base", () => provider.sendAndConfirm(tx));
    }
    await this.waitForEr(runAddr);
    // Joining claims the run outright: a session left behind by an earlier
    // window (or an expired one from this morning) is replaced here, which
    // is what stops the player joining successfully and then not being able
    // to act. No `ownedRotation` — a fresh join always wins.
    const claim = await this.ensureSession({
      day: params.day,
      mode: WorldMode.Casual,
      sessionAuthority: params.sessionAuthority,
    }).catch(() => null);
    return { attemptNonce, sessionRotation: claim?.rotation };
  }

  // ---- revival ----------------------------------------------------------

  /** Quote the exact next revival price from committed run state. */
  async quoteRevive(day: bigint): Promise<{
    price: bigint;
    deathNonce: number;
    deadline: number;
  } | null> {
    const world = pda.world(this.region, WorldMode.Paid, day);
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
    const world = pda.world(this.region, WorldMode.Paid, params.day);
    const ix = await this.program.methods
      .beginRevive()
      .accountsPartial({
        config: pda.config(),
        daily: pda.daily(this.region, params.day),
        vault: pda.dailyVault(this.region, params.day),
        profile: pda.profile(wallet),
        run: pda.run(world, wallet),
        payerToken: params.payerToken,
        usdcMint: params.usdcMint,
        receipt: pda.receipt(ReceiptKind.Revival, this.region, params.day, wallet, receiptNonce),
        wallet,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .instruction();
    return {
      action: `Revive (death #${quote.deathNonce})`,
      usdcTransfers: [
        {
          from: params.payerToken.toBase58(),
          to: pda.dailyVault(this.region, params.day).toBase58(),
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
    const world = pda.world(this.region, WorldMode.Paid, params.day);
    const run = await this.getRun(world);
    if (!run) throw new Error("run missing");
    const builder = this.erProgram.methods.completeRevive().accountsPartial({
      world,
      run: pda.run(world, wallet),
      receipt: pda.receipt(ReceiptKind.Revival, this.region, params.day, wallet, params.receiptNonce),
      safeSector: sectorForTile(world, run.safeX, run.safeY),
      signer: params.session?.publicKey ?? wallet,
    });
    if (params.session) builder.signers([params.session]);
    return this.track("Reviving", "er", () => builder.rpc());
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
    const world = pda.world(this.region, params.mode ?? WorldMode.Paid, params.day);
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
        chunk: pda.chunk(this.region, params.day, chunkIndex),
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
    const world = pda.world(this.region, params.mode ?? WorldMode.Paid, params.day);
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
        chunk: pda.chunk(this.region, params.day, Math.floor(Math.max(0, dy) / 16)),
        signer: params.session.publicKey,
      })
      .signers([params.session])
      .rpc();
  }

  /** Propagate a record-beating score into the world header. */
  async claimRecord(day: bigint, mode: WorldMode = WorldMode.Paid): Promise<string> {
    const world = pda.world(this.region, mode, day);
    return this.erProgram.methods
      .claimRecord()
      .accountsPartial({ world, best: pda.best(world, this.wallet.publicKey) })
      .rpc();
  }

  /** Cached ER blockhash for the zero-fee fire-and-forget hot path. */
  private erBlockhashCache: { value: string; fetchedAt: number } | null = null;
  private erBlockhashTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * How long a rollup blockhash may be reused.
   *
   * Solana drops a transaction whose blockhash is older than 150 blocks. On
   * the base layer that is about a minute; on an ephemeral rollup, where a
   * block is ~50ms, it is roughly SEVEN SECONDS. A cache tuned for base
   * timings therefore hands out dead blockhashes for part of every cycle,
   * and the failure is invisible: `sendRawTransaction` still returns a
   * signature, the toast still says the move went out, and the move simply
   * never happens. Stay far inside the window.
   */
  private static readonly ER_BLOCKHASH_MAX_AGE_MS = 3_000;
  private static readonly ER_BLOCKHASH_REFRESH_MS = 1_500;

  private async erBlockhash(): Promise<string> {
    const now = Date.now();
    if (
      !this.erBlockhashCache ||
      now - this.erBlockhashCache.fetchedAt > CrossyClient.ER_BLOCKHASH_MAX_AGE_MS
    ) {
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
    }, CrossyClient.ER_BLOCKHASH_REFRESH_MS);
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
    const world = pda.world(this.region, params.mode ?? WorldMode.Paid, params.day);
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
        chunk: pda.chunk(this.region, params.day, Math.floor(ny / 16)),
        best: pda.best(world, wallet),
        signer: params.session.publicKey,
      })
      .instruction();
    const tx = new anchor.web3.Transaction().add(ix);
    tx.recentBlockhash = await this.erBlockhash();
    tx.feePayer = params.session.publicKey;
    tx.sign(params.session);
    return this.track(
      "Move",
      "er",
      () =>
        this.erConnection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 0,
        }),
      { quiet: true },
    );
  }



  /**
   * Casual movement: send it and forget it.
   *
   * `move_free` carries no sequence and observes no cadence, so nothing this
   * sends can come back refused for ordering or rate — which means the caller
   * never has to wait for one hop before sending the next, and never has to
   * roll a prediction back because a hop was refused. That rollback is what a
   * player sees as rubberbanding.
   *
   * This is solsocket's `broadcast`: the subscription carries the truth, the
   * transaction is not awaited, and the chain assigns the sequence itself.
   * The chain still simulates — traffic kills, rocks stop you — it simply
   * never says no. Paid keeps `sendMove`/`sendMoveBatch`.
   */
  async sendMoveFree(params: {
    day: bigint;
    direction: Direction;
    session: Keypair;
    x: number;
    y: number;
    attemptNonce: number;
  }): Promise<string> {
    const wallet = this.wallet.publicKey;
    const world = pda.world(this.region, WorldMode.Casual, params.day);
    let [nx, ny] = [params.x, params.y];
    if (params.direction === Direction.Forward) ny += 1;
    else if (params.direction === Direction.Backward) ny -= 1;
    else if (params.direction === Direction.Left) nx -= 1;
    else nx += 1;
    if (nx < 0 || nx > 63 || ny < 0) throw new Error("out of bounds");
    const src = sectorForTile(world, params.x, params.y);
    const dst = sectorForTile(world, nx, ny);
    const ix = await this.erProgram.methods
      .moveFree(
        params.attemptNonce,
        params.direction,
        new BN(Date.now() * 8 + params.direction),
      )
      .accountsPartial({
        world,
        run: pda.run(world, wallet),
        sourceSector: src,
        destSector: dst.equals(src) ? null : dst,
        chunk: pda.chunk(this.region, params.day, Math.floor(ny / 16)),
        best: pda.best(world, wallet),
        signer: params.session.publicKey,
      })
      .instruction();
    const tx = new anchor.web3.Transaction().add(ix);
    tx.recentBlockhash = await this.erBlockhash();
    tx.feePayer = params.session.publicKey;
    tx.sign(params.session);
    return this.track(
      "MoveFree",
      "er",
      () =>
        this.erConnection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 0,
        }),
      { quiet: true },
    );
  }

  /**
   * Several hops in ONE transaction — the same hot path as `sendMove`, minus
   * the round trip per hop.
   *
   * `action_seq` must match exactly at execution, so two moves in flight at
   * once can land out of order and the loser is refused. That capped movement
   * at one hop per round trip. A batch carries the hops under a single
   * sequence and the program applies them in order, charging each one its own
   * slot of cadence — so this is a saving in round trips, never in cadence.
   *
   * The program can only apply hops covered by the accounts it was given, so
   * the path is trimmed here to what fits: at most four occupancy sectors and
   * two chunks. Returns the directions actually submitted; anything trimmed is
   * the caller's to send next.
   */
  async sendMoveBatch(params: {
    day: bigint;
    mode?: WorldMode;
    directions: Direction[];
    session: Keypair;
    x: number;
    y: number;
    attemptNonce: number;
    actionSeq: number;
  }): Promise<{ signature: string; sent: Direction[] }> {
    const wallet = this.wallet.publicKey;
    const world = pda.world(this.region, params.mode ?? WorldMode.Paid, params.day);

    const sectors: PublicKey[] = [sectorForTile(world, params.x, params.y)];
    const chunks: number[] = [];
    const sent: Direction[] = [];
    let [x, y] = [params.x, params.y];

    for (const direction of params.directions.slice(0, MAX_MOVE_BATCH)) {
      let [nx, ny] = [x, y];
      if (direction === Direction.Forward) ny += 1;
      else if (direction === Direction.Backward) ny -= 1;
      else if (direction === Direction.Left) nx -= 1;
      else nx += 1;
      if (nx < 0 || nx > 63 || ny < 0) break;

      // A hop the accounts cannot cover would just stop the batch on chain;
      // trimming it here keeps the transaction honest about what it will do.
      const sector = sectorForTile(world, nx, ny);
      const nextSectors = sectors.some((s) => s.equals(sector))
        ? sectors
        : [...sectors, sector];
      const chunk = Math.floor(ny / 16);
      const nextChunks = chunks.includes(chunk) ? chunks : [...chunks, chunk];
      if (nextSectors.length > 4 || nextChunks.length > 2) break;

      sectors.length = 0;
      sectors.push(...nextSectors);
      chunks.length = 0;
      chunks.push(...nextChunks);
      sent.push(direction);
      [x, y] = [nx, ny];
    }

    if (sent.length === 0) throw new Error("no hop fits this batch");
    if (chunks.length === 0) chunks.push(Math.floor(params.y / 16));

    const ix = await this.erProgram.methods
      .moveBatch(
        params.attemptNonce,
        new BN(params.actionSeq),
        Buffer.from(sent),
        new BN(Date.now() * 8 + sent.length),
      )
      .accountsPartial({
        world,
        run: pda.run(world, wallet),
        sectorA: sectors[0],
        sectorB: sectors[1] ?? null,
        sectorC: sectors[2] ?? null,
        sectorD: sectors[3] ?? null,
        chunkA: pda.chunk(this.region, params.day, chunks[0]),
        chunkB: chunks[1] == null ? null : pda.chunk(this.region, params.day, chunks[1]),
        best: pda.best(world, wallet),
        signer: params.session.publicKey,
      })
      .instruction();
    const tx = new anchor.web3.Transaction().add(ix);
    tx.recentBlockhash = await this.erBlockhash();
    tx.feePayer = params.session.publicKey;
    tx.sign(params.session);
    const signature = await this.track(
      "MoveBatch",
      "er",
      () =>
        this.erConnection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 0,
        }),
      { quiet: true },
    );
    return { signature, sent };
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
    const world = pda.world(this.region, params.mode ?? WorldMode.Paid, params.day);
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
          chunk: pda.chunk(this.region, params.day, Math.floor(dy / 16)),
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
    return this.track(
      "Kick",
      "er",
      () =>
        this.erConnection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 0,
        }),
      { quiet: true },
    );
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
    /**
     * The rotation counter this client last owned.
     *
     * A run has exactly one session authority, so a second window signing
     * in takes the key from the first. Without this the loser would see an
     * authority that is not its own and simply take it back, and the two
     * would trade it forever, a transaction apiece. Pass the counter from
     * the last successful claim and a client that has been displaced backs
     * off instead of fighting. Omit it to claim unconditionally.
     */
    ownedRotation?: number;
  }): Promise<SessionClaim> {
    const wallet = this.wallet.publicKey;
    const world = pda.world(this.region, params.mode ?? WorldMode.Paid, params.day);
    const runAddr = pda.run(world, wallet);
    const run = await this.erProgram.account.playerRun
      .fetchNullable(runAddr)
      .catch(() => null);
    if (!run) return { rotated: false, displaced: false, rotation: 0, mine: false };

    const now = Math.floor(Date.now() / 1000);
    const rotation = run.sessionRotation as number;
    const mine = run.sessionAuthority.equals(params.sessionAuthority);
    const margin = params.minRemainingSeconds ?? 30 * 60;
    if (mine && run.sessionExpiry.toNumber() > now + margin) {
      return { rotated: false, displaced: false, rotation, mine: true };
    }
    // Somebody else claimed it after we did: they are the live session.
    if (!mine && params.ownedRotation !== undefined && rotation > params.ownedRotation) {
      return { rotated: false, displaced: true, rotation, mine: false };
    }

    // The program caps how far ahead a session may run; stay inside it.
    const expiry = now + MAX_SESSION_SECONDS - 60;
    await this.track("Session key", "er", () =>
      this.erProgram.methods
        .rotateSession(params.sessionAuthority, new BN(expiry))
        .accountsPartial({ run: runAddr, wallet })
        .rpc({ commitment: "processed" }),
    );
    return { rotated: true, displaced: false, rotation: rotation + 1, mine: true };
  }

  /** Outcome of claiming or checking the gameplay session on a run. */
  // (declared here so the shape stays next to the only thing producing it)

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
    const world = pda.world(this.region, params.mode ?? WorldMode.Paid, params.day);
    const runAddr = pda.run(world, wallet);
    const run = await this.erProgram.account.playerRun
      .fetchNullable(runAddr)
      .catch(() => null);
    // Nothing to revoke if the run never existed or is already handed back.
    if (!run || run.sessionAuthority.equals(PublicKey.default)) return false;
    await this.track("Session ended", "er", () =>
      this.erProgram.methods
        .endSession()
        .accountsPartial({ run: runAddr, wallet })
        .rpc({ commitment: "processed" }),
    );
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
    const world = pda.world(this.region, params.mode ?? WorldMode.Paid, params.day);
    const ix = await this.erProgram.methods
      .claimRecord()
      .accountsPartial({ world, best: pda.best(world, this.wallet.publicKey) })
      .instruction();
    const tx = new anchor.web3.Transaction().add(ix);
    tx.recentBlockhash = await this.erBlockhash();
    tx.feePayer = params.session.publicKey;
    tx.sign(params.session);
    return this.track("New record", "er", () =>
      this.erConnection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 0,
      }),
    );
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
    const world = pda.world(this.region, params.mode ?? WorldMode.Paid, params.day);
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
        chunk: pda.chunk(this.region, params.day, Math.floor(params.y / 16)),
      })
      .instruction();
    const tx = new anchor.web3.Transaction().add(ix);
    tx.recentBlockhash = await this.erBlockhash();
    tx.feePayer = params.session.publicKey;
    tx.sign(params.session);
    return this.track(
      "Hazard check",
      "er",
      () =>
        this.erConnection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 0,
        }),
      { quiet: true, background: true },
    );
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
    const connection = this.erConnection;
    const subId = connection.onProgramAccountChange(
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
      worldSubId = connection.onAccountChange(
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
    return this.trackErSubscription(() => {
      void connection.removeProgramAccountChangeListener(subId);
      if (worldSubId != null) void connection.removeAccountChangeListener(worldSubId);
    });
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
    this.closeErRealtimeSubscriptions();
    if (this.erBlockhashTimer) clearInterval(this.erBlockhashTimer);
    this.erBlockhashTimer = null;
    await Promise.all([this.subscriptions.close(), this.baseSubscriptions.close()]);
  }
}
