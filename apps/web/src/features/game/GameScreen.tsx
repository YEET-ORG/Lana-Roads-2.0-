/**
 * The game route: Three.js scene + HUD + death/revival overlay.
 *
 * State ownership: React owns overlays/HUD; the WorldScene owns frame-level
 * rendering. Prediction covers exactly one tile and never touches
 * authoritative score display; rejections snap back to canonical state.
 */
import { useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { Direction, pda, ReceiptKind, revivePrice, WorldMode } from "@crossy-world/sdk";
import { Bootstrapped } from "../../lib/client";
import { deathHeadline, WorldScene, type DeathCause } from "../../game/renderer/scene";
import { preloadAssets } from "../../game/renderer/assets";
import { attachInput } from "../../game/input/keys";
import {
  evaluateTile,
  LANE_RAIL,
  LANE_RIVER,
  tickOf,
} from "../../game/simulation/hazards";
import { Button, Confetti, CountUp, Icon, IconButton, Modal } from "../../design-system";
import { agentModelIdFor } from "../../lib/agent";
import { haptic, useSettings } from "../../lib/settings";
import { SettingsSheet } from "../settings/SettingsSheet";
import { LeaderboardSheet } from "../leaderboard/LeaderboardSheet";
import type { Route } from "../../app/App";

/**
 * anchor@0.32 constructs web3.js@1.98's SendTransactionError with the old
 * positional signature, so `message` renders as "Unknown action 'undefined'".
 * The real diagnostics survive in the error's fields — dig them out.
 */
function errorText(e: unknown): string {
  const any = e as {
    transactionMessage?: string;
    transactionLogs?: string[];
    message?: string;
  };
  const fromLogs = any.transactionLogs
    ?.map((l) => l.match(/Error Code: (\w+)/)?.[1])
    .find(Boolean);
  if (fromLogs) return fromLogs;
  if (any.transactionMessage) return any.transactionMessage.slice(0, 140);
  const msg = `${any.message ?? e}`;
  return msg.includes("Unknown action")
    ? "transaction failed (see console)"
    : msg.slice(0, 140);
}

/** Quiet spell after which the session is handed back to the wallet. */
const IDLE_SESSION_MS = 3 * 60 * 1000;

/**
 * What killed a run, by the same rule the program uses: the kind of lane it
 * died on. `execute_death` records exactly this, so the headline the player
 * reads matches the reason the chain recorded.
 */
function causeOfDeath(scene: WorldScene | null, row: number): DeathCause | undefined {
  const lane = scene?.laneAt(row);
  if (!lane) return undefined; // lane not loaded: let the scene guess
  if (lane.kind === LANE_RIVER) return "water";
  if (lane.kind === LANE_RAIL) return "train";
  return "impact";
}

type PlayRoute = Extract<Route, { name: "play" }>;

interface Hud {
  score: number;
  record: number;
  x: number;
  y: number;
  kickReadyIn: number;
  state: string;
  pending: boolean;
  lastRejection: string | null;
  pingMs: number | null;
  /** Runs currently alive in this world, this player included. */
  players: number;
}

/** Latency bands for the connection chip: playable, laggy, painful. */
function pingTone(ms: number | null): "good" | "fair" | "poor" {
  if (ms == null || ms < 120) return "good";
  return ms < 300 ? "fair" : "poor";
}

interface DeathInfo {
  deathNonce: number;
  deadline: number;
  price: bigint | null;
}

export function GameScreen({
  boot,
  route,
  onExit,
}: {
  boot: Bootstrapped;
  route: PlayRoute;
  onExit: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const busyRef = useRef(false);
  const deathTimerRef = useRef<number>(0);
  const [hud, setHud] = useState<Hud>({
    score: 0,
    record: 0,
    x: 0,
    y: 0,
    kickReadyIn: 0,
    state: "connecting",
    pending: false,
    lastRejection: null,
    pingMs: null,
    players: 0,
  });
  const [death, setDeath] = useState<DeathInfo | null>(null);
  const [reviving, setReviving] = useState(false);
  /** Casual runs end outright on death; the player just goes again. */
  const [endedScore, setEndedScore] = useState<{
    score: number;
    cause: DeathCause;
  } | null>(null);
  const deathCauseRef = useRef<DeathCause>("impact");
  const [respawning, setRespawning] = useState(false);
  /** Another window took this run over; this one is a spectator. */
  const [displaced, setDisplaced] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  /** Where this run left the player on today's board, once it is over. */
  const [rank, setRank] = useState<{ place: number; of: number } | null>(null);
  const settings = useSettings();
  const world = pda.world(route.mode, route.day);

  // Casual: solsocket-style join — ONE base tx (profile + starter + run +
  // lock + delegate run/best to the pinned ER validator), wait for the ER
  // clone, then spawn ON the ER with the session key.
  useEffect(() => {
    let live = true;
    (async () => {
      if (route.mode !== WorldMode.Casual) return;
      try {
        setHud((h) => ({ ...h, state: "resolving ER…" }));
        // Magic Router resolves which ER holds the delegated world; the
        // client re-targets its ER connection + subscriptions to that FQDN.
        if (boot.client.routerUrl) {
          const status = await boot.client.resolveErForWorld(world).catch(() => null);
          if (status?.fqdn) console.log("world ER (router-resolved):", status.fqdn);
        }
        setHud((h) => ({ ...h, state: "joining…" }));
        const { attemptNonce } = await boot.client.joinCasual({
          day: route.day,
          sessionAuthority: boot.session.publicKey,
          sessionExpiry: Math.floor(Date.now() / 1000) + 8 * 3600,
        });
        if (!live) return;
        const run = await boot.client.getRun(world);
        const state = run ? Object.keys(run.state)[0] : "missing";
        if (state === "idle" || state === "ended" || state === "entryFailed") {
          setHud((h) => ({ ...h, state: "spawning…" }));
          await boot.client.spawn({
            day: route.day,
            attemptNonce,
            receiptNonce: 0,
            session: boot.session,
            mode: WorldMode.Casual,
          });
        }
        if (live) setHud((h) => ({ ...h, state: "active" }));
      } catch (e) {
        console.error("join/spawn failed:", e);
        if (live) setHud((h) => ({ ...h, state: `error: ${errorText(e)}` }));
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live state (solsocket-style): authoritative pushes from ONE ER
  // websocket subscription; the local run mirror also advances optimistically
  // so the input hot path never waits on a fetch.
  const liveRun = useRef<{
    x: number;
    y: number;
    seq: number;
    attempt: number;
    state: string;
    score: number;
    facing: number;
  } | null>(null);
  const lastKickAtRef = useRef(0);
  /** Latest authoritative hazard schedule for the local run. */
  const hazardRef = useRef<{ nonce: number; deadlineMs: number }>({
    nonce: 0,
    deadlineMs: 0,
  });
  const claimRecordRef = useRef<(score: number, published: number) => void>(() => {});
  /** Last record published by the world, mirrored for the claim check. */
  const hudRecordRef = useRef(0);
  /** Remote occupancy mirror for prediction (never send a doomed move). */
  const occupiedRef = useRef<
    Map<string, { x: number; y: number; state: string; hazardNonce: number }>
  >(new Map());
  /** Force an immediate authoritative refetch (silence reconciler). */
  const reconcileNowRef = useRef<() => void>(() => {});
  /** Timestamp of the last authoritative push for OUR run. */
  const lastOwnPushRef = useRef(0);
  /**
   * Highest action sequence the chain has accepted for our run.
   *
   * A rejected action produces no state change, so waiting for "a push"
   * cannot detect one — the hazard crank rewrites our run several times a
   * second and would keep resetting that timer. The sequence only advances
   * when the program actually accepted something, so it is the one signal
   * that distinguishes an accepted move from a refused one.
   */
  const lastAuthSeqRef = useRef(-1);
  /** Consecutive actions the chain never accepted. */
  const rejectedRunRef = useRef(0);
  /** Attempt the sequence counter belongs to; a new attempt resets it. */
  const attemptRef = useRef<number | null>(null);
  /** Latest measured rollup round trip, for pacing the action queue. */
  const pingRef = useRef<number | null>(null);
  /** True while gameplay authority is back with the wallet. */
  const sessionEndedRef = useRef(false);
  /** Rotation counter this window last claimed; guards against a takeover war. */
  const ownedRotationRef = useRef<number | undefined>(undefined);
  /** Mirror of `displaced` for callbacks that must not close over stale state. */
  const displacedRef = useRef(false);
  /** Last time the player actually did something. */
  const lastInputAtRef = useRef(performance.now());
  /** Last celebrated score decade (milestone bursts every 10 rows). */
  const scoreDecadeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let scene: WorldScene | null = null;
    let live = true;
    let loadedChunks = 0;
    const me = boot.wallet.publicKey.toBase58();
    // Assets resolve before first paint of the world; missing models fall
    // back to footprint-correct primitives inside the scene.
    void preloadAssets().then(() => {
      if (!live) return;
      scene = new WorldScene(canvas, { wallet: me, modelId: agentModelIdFor(me) });
      sceneRef.current = scene;
      scene.resize();
      // Everything that arrived before the scene existed heals here.
      loadedChunks = 0;
      reconcileNowRef.current();
    });
    const onResize = () => sceneRef.current?.resize();
    window.addEventListener("resize", onResize);
    const remotes = new Map<
      string,
      { x: number; y: number; state: string; hazardNonce: number }
    >();
    occupiedRef.current = remotes;

    /**
     * Headcount for the HUD. `remotes` only ever holds active runs, so the
     * live population is those plus us when we are still standing.
     */
    const syncPresence = () => {
      const online = remotes.size + (liveRun.current?.state === "active" ? 1 : 0);
      setHud((h) => (h.players === online ? h : { ...h, players: online }));
    };

    const applyRun = (run: any, force = false) => {
      const wallet = run.wallet.toBase58();
      const state = Object.keys(run.state)[0] ?? "?";
      if (wallet === me) {
        lastOwnPushRef.current = performance.now();
        // A new attempt restarts the sequence at zero. Carrying the old
        // high-water mark across would make every queued action look
        // instantly accepted, so the counter resets with the attempt.
        const authSeqNow = run.actionSeq.toNumber();
        if (run.attemptNonce !== attemptRef.current) {
          attemptRef.current = run.attemptNonce;
          lastAuthSeqRef.current = authSeqNow;
          outboxRef.current = [];
        }
        lastAuthSeqRef.current = Math.max(lastAuthSeqRef.current, authSeqNow);
        // Nothing queued can apply to a run that is no longer playing.
        if (Object.keys(run.state)[0] !== "active") outboxRef.current = [];
        hazardRef.current = {
          nonce: run.hazardNonce,
          deadlineMs: Number(run.hazardDeadlineMs?.toString() ?? 0),
        };
        const mine = liveRun.current;
        const authSeq = run.actionSeq.toNumber();
        // While optimistic moves are still in flight (our local sequence is
        // ahead of this push), keep the predicted position — snapping to the
        // older authoritative tile rubber-bands every single move. The
        // authoritative position wins when it has caught up (or when the
        // silence reconciler forces a heal).
        const inFlight = !force && mine != null && mine.seq > authSeq;
        if (inFlight) {
          liveRun.current = {
            ...mine!,
            attempt: run.attemptNonce,
            state,
            score: Math.max(run.score, mine!.score),
          };
        } else {
          liveRun.current = {
            x: run.x,
            y: run.y,
            seq: authSeq,
            attempt: run.attemptNonce,
            state,
            score: run.score,
            facing: run.facing,
          };
          scene?.setLocal(run.x, run.y);
        }
        // Death/revive presentation: the world reacts before the overlay.
        if (state === "deadAwaitingRevive" || state === "ended") {
          // The program decides what killed you from the lane the run
          // actually died on, so read the cause from the authoritative
          // tile rather than from wherever the local mesh ended up.
          scene?.killLocal(causeOfDeath(scene, run.y));
          if (scene) deathCauseRef.current = scene.lastDeathCause;
        } else if (state === "active") scene?.reviveLocal();
        // HUD updates only when something visible changed (uncontrolled
        // re-renders on every ~50ms push cause visible jank).
        setHud((h) =>
          h.score === run.score &&
          h.state === state &&
          h.x === liveRun.current!.x &&
          h.y === liveRun.current!.y
            ? h
            : {
                ...h,
                score: liveRun.current!.score,
                x: liveRun.current!.x,
                y: liveRun.current!.y,
                state,
              },
        );
        claimRecordRef.current(liveRun.current!.score, hudRecordRef.current);
        const decade = Math.floor(liveRun.current!.score / 10);
        if (decade > scoreDecadeRef.current && state === "active") scene?.celebrate();
        scoreDecadeRef.current = decade;
        if (state === "deadAwaitingRevive" && route.mode === WorldMode.Paid) {
          // The run can take no further action; hand the key back too.
          void endSession("death");
          // Let the death animation land before the card stamps in.
          const info = {
            deathNonce: run.deathNonce,
            deadline: Number(run.reviveDeadline.toString()),
            price: revivePrice(run.successfulRevives),
          };
          window.clearTimeout(deathTimerRef.current);
          deathTimerRef.current = window.setTimeout(() => live && setDeath(info), 450);
        } else if (state === "active") {
          window.clearTimeout(deathTimerRef.current);
          setDeath(null);
          setEndedScore(null);
        } else if (state === "ended" && route.mode === WorldMode.Casual) {
          void endSession("death");
          const score = liveRun.current!.score;
          window.clearTimeout(deathTimerRef.current);
          deathTimerRef.current = window.setTimeout(
            () => live && setEndedScore({ score, cause: deathCauseRef.current }),
            450,
          );
        }
      } else {
        if (state === "active")
          remotes.set(wallet, {
            x: run.x,
            y: run.y,
            state,
            hazardNonce: run.hazardNonce,
          });
        else remotes.delete(wallet);
        scene?.setRemotes(
          [...remotes.entries()].map(([w, r]) => ({ wallet: w, x: r.x, y: r.y })),
        );
      }
      syncPresence();
    };

    // Chunk/lane loading (repeats when the frontier grows).
    const loadChunks = async (revealedRows: number) => {
      if (!scene) return; // heals via reconcile once the scene exists
      const worldAcc = { revealedRows };
      const chunks = Math.ceil(worldAcc.revealedRows / 16);
      for (let c = loadedChunks; c < chunks; c++) {
        const chunk = await boot.client.getChunk(route.day, c).catch(() => null);
        if (!chunk || !live || !scene) continue;
        chunk.lanes.forEach((lane: any, i: number) => {
          scene!.setLane(
            chunk.rowStart + i,
            {
              kind: lane.kind,
              dirPositive: lane.dirPositive,
              footprint: lane.footprint,
              gapTiles: lane.gapTiles,
              speedMtps: lane.speedMtps,
              phaseMt: lane.phaseMt,
              warningMs: lane.warningMs,
              periodMs: lane.periodMs,
              blockerMask: BigInt(lane.blockerMask.toString()),
              sinking: lane.sinking,
            },
            // The chunk's committed randomness names every car on the row, so
            // all clients draw the same traffic.
            Uint8Array.from(chunk.randomnessHash as number[]),
          );
        });
        loadedChunks = c + 1;
      }
    };

    // The realtime feed: every run/sector of this world + the world header.
    const unsubscribe = boot.client.subscribeWorldRealtime({
      world,
      onRun: (run) => live && applyRun(run),
      onWorld: (w) => {
        if (!live) return;
        hudRecordRef.current = w.recordScore;
        setHud((h) => (h.record === w.recordScore ? h : { ...h, record: w.recordScore }));
        void loadChunks(w.revealedRows);
      },
    });

    // Bootstrap + 5s reconciliation sweep (sequence-gap safety net, per the
    // spec: subscriptions are the fast path, refetch heals any gap).
    const reconcile = async () => {
      const [run, worldAcc] = await Promise.all([
        boot.client.getRun(world).catch(() => null),
        boot.client.getWorld(route.mode, route.day).catch(() => null),
      ]);
      if (!live) return;
      // Heal the run FIRST. This is the only thing that pulls a rejected
      // prediction back to the truth, so it must never sit behind work that
      // can fail: a chunk that will not load would otherwise leave the
      // player standing wherever they predicted, forever.
      // Force-healing snaps the player to the authoritative tile. That is
      // right when a prediction was wrong and WRONG while an action is
      // still legitimately in flight — it would yank the player back a tile
      // and then hop them forward again the moment it lands.
      if (run) applyRun(run, outboxRef.current.length === 0);
      // Who else is here. The subscription only speaks when a run CHANGES,
      // so a player who is standing still is invisible to a client that
      // just connected — and someone who leaves never says so. A roster
      // snapshot is the only thing that makes both true on screen.
      const roster = await boot.client.listRuns(world).catch(() => null);
      if (roster && live) {
        remotes.clear();
        for (const r of roster) {
          if (r.state !== "active") continue;
          const w = r.wallet.toBase58();
          if (w === me) continue;
          remotes.set(w, {
            x: r.x,
            y: r.y,
            state: r.state,
            hazardNonce: r.hazardNonce,
          });
        }
        scene?.setRemotes(
          [...remotes.entries()].map(([w, r]) => ({ wallet: w, x: r.x, y: r.y })),
        );
        syncPresence();
      }
      if (worldAcc) {
        // Anchor the hazard clock to the world's own timeline, measured by
        // the ROLLUP rather than this browser. The program evaluates
        // hazards against the validator's clock, so a second of local skew
        // draws every car a whole tick from where it really is. Falls back
        // to the local clock only if the chain will not say.
        const chainNow = await boot.client.chainTimeMs().catch(() => null);
        scene?.setWorldElapsed(
          (chainNow ?? Date.now()) - Number(worldAcc.startTs.toString()) * 1000,
        );
        hudRecordRef.current = worldAcc.recordScore;
        setHud((h) =>
          h.record === worldAcc.recordScore ? h : { ...h, record: worldAcc.recordScore },
        );
        await loadChunks(worldAcc.revealedRows).catch((e) =>
          console.error("chunk load failed:", e),
        );
      }
    };
    void reconcile();
    reconcileNowRef.current = () => void reconcile();
    const sweep = setInterval(() => void reconcile(), 5000);

    // Publish the record when this run passes it. Movement keeps off the
    // world's record field on purpose, so somebody has to say so.
    let claimedThrough = 0;
    claimRecordRef.current = (score: number, published: number) => {
      if (score <= published || score <= claimedThrough) return;
      claimedThrough = score;
      boot.client
        .sendClaimRecord({ day: route.day, mode: route.mode, session: boot.session })
        .catch(() => {
          claimedThrough = 0;
        });
    };

    // Hazard cranking. Collisions are only resolved when someone asks the
    // program to check, so this client cranks its own run and every run it
    // can see standing on moving terrain. Cranks are ER session txs, and a
    // stale nonce is rejected harmlessly, so over-asking is safe.
    const hazardTimer = setInterval(() => {
      if (!live) return;
      const onMovingTerrain = (y: number) => {
        const lane = scene?.laneAt(y);
        return lane != null && lane.kind !== 0;
      };
      // A river carries its riders downstream; the program needs the sector
      // at the far end of that ride to be able to move them.
      const driftOf = (y: number) => {
        const lane = scene?.laneAt(y);
        if (!lane || lane.kind !== LANE_RIVER) return 0;
        return lane.dirPositive === 1 ? 1 : -1;
      };
      const crank = (
        wallet: PublicKey | undefined,
        x: number,
        y: number,
        nonce: number,
      ) =>
        boot.client
          .sendCheckHazard({
            day: route.day,
            mode: route.mode,
            session: boot.session,
            wallet,
            x,
            y,
            hazardNonce: nonce,
            driftDirection: driftOf(y),
          })
          .catch(() => {
            /* stale nonce / already resolved */
          });

      const mine = liveRun.current;
      if (mine && mine.state === "active" && onMovingTerrain(mine.y)) {
        void crank(undefined, mine.x, mine.y, hazardRef.current.nonce);
      }
      // Watch a bounded number of neighbours per tick.
      let budget = 4;
      for (const [w, r] of occupiedRef.current) {
        if (budget <= 0) break;
        if (r.state !== "active" || !onMovingTerrain(r.y)) continue;
        budget--;
        void crank(new PublicKey(w), r.x, r.y, r.hazardNonce);
      }
    }, 300);

    // Hot-path prewarm: persistent HTTP connection + background blockhash.
    let stopPrewarm: (() => void) | null = null;
    boot.client.prewarmEr().then((stop) => {
      if (live) stopPrewarm = stop;
      else stop();
    });

    // Ping meter: ER RPC round-trip. This is the number that matters for
    // game feel — the rollup is what answers a move, not the base cluster.
    const measurePing = async () => {
      const t0 = performance.now();
      const slot = await boot.client.erConnection.getSlot("processed").catch(() => null);
      if (!live) return;
      const ms = slot == null ? null : Math.round(performance.now() - t0);
      pingRef.current = ms;
      setHud((h) => (h.pingMs === ms ? h : { ...h, pingMs: ms }));
    };
    void measurePing();
    const pingTimer = setInterval(() => void measurePing(), 3000);

    return () => {
      live = false;
      clearInterval(sweep);
      clearInterval(pingTimer);
      clearInterval(hazardTimer);
      window.clearTimeout(deathTimerRef.current);
      stopPrewarm?.();
      unsubscribe();
      window.removeEventListener("resize", onResize);
      scene?.destroy();
      scene = null;
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.day, route.mode]);

  /**
   * The outbound action queue.
   *
   * The program takes at most ONE accepted action per rollup slot and
   * demands an exact `action_seq`; a refused action does not consume it. So
   * firing a burst of optimistically-numbered moves at once means the first
   * one wins and every later one is refused for a sequence that never
   * advanced — and because gameplay is fire-and-forget, none of it reports
   * anything. The player just watches their hops rewind a second later.
   *
   * One action is in flight at a time and the rest wait their turn. A lost
   * one is RESENT WITH THE SAME SEQUENCE, which is idempotent by
   * construction: if the original did land, the retry is refused for the
   * sequence it claims, so a duplicate hop is impossible. Only after the
   * retries are exhausted does the prediction get rolled back.
   */
  type Outbound =
    | {
        kind: "move";
        seq: number;
        attempt: number;
        x: number;
        y: number;
        direction: Direction;
        tries: number;
        sig?: string;
      }
    | {
        kind: "kick";
        seq: number;
        attempt: number;
        x: number;
        y: number;
        facing: Direction;
        target?: { wallet: PublicKey; x: number; y: number };
        tries: number;
        sig?: string;
      };

  /**
   * How long to wait for acceptance before resending.
   *
   * Acceptance travels the send round trip PLUS a block and a push back
   * down the subscription, so a fixed window that suits a 40ms link retries
   * every single move on a 400ms one. Scale it to the latency we are
   * actually measuring, with a floor for a link so fast the measurement is
   * noise and a ceiling so a truly refused action still gives up promptly.
   */
  const ACTION_TRIES = 3;
  function ackWindowMs() {
    const ping = pingRef.current ?? 250;
    return Math.min(1100, Math.max(450, Math.round(ping * 2.2)));
  }

  const outboxRef = useRef<Outbound[]>([]);
  const ackTimerRef = useRef(0);

  function enqueueAction(action: Outbound) {
    outboxRef.current.push(action);
    if (outboxRef.current.length === 1) void pumpOutbox();
  }

  async function pumpOutbox() {
    const head = outboxRef.current[0];
    if (!head) return;
    head.tries += 1;
    const common = { day: route.day, mode: route.mode, session: boot.session };
    try {
      head.sig =
        head.kind === "move"
          ? await boot.client.sendMove({
              ...common,
              direction: head.direction,
              x: head.x,
              y: head.y,
              attemptNonce: head.attempt,
              actionSeq: head.seq,
            })
          : await boot.client.sendKick({
              ...common,
              attemptNonce: head.attempt,
              actionSeq: head.seq,
              facing: head.facing,
              target: head.target,
            });
    } catch (e) {
      const why = errorText(e);
      setHud((h) => ({ ...h, lastRejection: why }));
      // A lapsed session refuses every action, which reads as a game that
      // simply stopped responding. Renew and carry on with the same run.
      if (why.includes("SessionExpired") || why.includes("BadSession")) {
        void renewSession();
      }
    }
    window.clearTimeout(ackTimerRef.current);
    ackTimerRef.current = window.setTimeout(checkOutboxHead, ackWindowMs());
  }

  function checkOutboxHead() {
    const head = outboxRef.current[0];
    if (!head) return;
    if (lastAuthSeqRef.current > head.seq) {
      // Accepted. Move on to whatever the player queued behind it.
      outboxRef.current.shift();
      rejectedRunRef.current = 0;
      void pumpOutbox();
      return;
    }
    if (head.tries < ACTION_TRIES) {
      // Lost or refused for a reason that may not hold a slot later (the
      // one-action-per-slot rule, a dropped packet). Same sequence, so the
      // chain can apply it at most once however many copies arrive.
      if (head.sig) boot.client.markTx(head.sig, "failed", "lost — resending");
      void pumpOutbox();
      return;
    }
    // Out of tries: the chain genuinely will not take this. Everything
    // predicted behind it was predicated on it, so the whole queue goes.
    if (head.sig) boot.client.markTx(head.sig, "failed", "refused by the world");
    outboxRef.current = [];
    reconcileNowRef.current();
    rejectedRunRef.current += 1;
    if (rejectedRunRef.current >= 3) {
      rejectedRunRef.current = 0;
      // Not a forced claim: if another window has taken the run, this one
      // learns that instead of wrestling for the key.
      void renewSession();
    }
  }

  /**
   * Re-authorise the session key on our own run (score is untouched).
   *
   * `claim` forces the takeover — used when this window is deliberately
   * starting play. Otherwise a window that has been displaced by a newer
   * one stands down rather than grabbing the key back, which would just
   * start the two of them trading it.
   */
  async function renewSession(claim = false) {
    try {
      const result = await boot.client.ensureSession({
        day: route.day,
        mode: route.mode,
        sessionAuthority: boot.session.publicKey,
        ownedRotation: claim ? undefined : ownedRotationRef.current,
      });
      if (result.displaced) {
        displacedRef.current = true;
        setDisplaced(true);
        sessionEndedRef.current = true;
        return;
      }
      displacedRef.current = false;
      setDisplaced(false);
      sessionEndedRef.current = false;
      if (result.rotation) ownedRotationRef.current = result.rotation;
      if (result.rotated) {
        setHud((h) => ({ ...h, lastRejection: null }));
        reconcileNowRef.current();
      }
    } catch (e) {
      setHud((h) => ({ ...h, lastRejection: `session: ${errorText(e)}` }));
    }
  }

  /**
   * Hand gameplay authority back to the wallet.
   *
   * The session key lives in browser storage and keeps working until it
   * expires, so every way of stopping play — leaving, dying, walking away —
   * otherwise leaves a usable credential behind. `renewSession` mints a
   * fresh one the moment the player acts again.
   */
  async function endSession(reason: string) {
    // Never revoke a session another window is now holding.
    if (sessionEndedRef.current || displacedRef.current) return;
    sessionEndedRef.current = true;
    try {
      await boot.client.endSession({ day: route.day, mode: route.mode });
    } catch {
      // Best effort: the session still lapses on its own, and any action
      // taken with it is refused once the wallet rotates a new one in.
    }
    void reason;
  }

  // Sessions are time-limited and a run outlives them; top ours up long
  // before it lapses rather than discovering it on a refused move.
  useEffect(() => {
    // Opening the game claims the run: any session a previous window left
    // behind stops working the moment this one takes over.
    void renewSession(true);
    const t = setInterval(() => void renewSession(), 5 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.day, route.mode]);

  // Idle players are not playing. Give the key back after a quiet spell and
  // take it again on the next input.
  useEffect(() => {
    const check = setInterval(() => {
      const idleFor = performance.now() - lastInputAtRef.current;
      if (idleFor > IDLE_SESSION_MS && !sessionEndedRef.current) {
        void endSession("idle");
        setHud((h) => ({ ...h, lastRejection: "session paused — press to resume" }));
      }
    }, 15_000);
    return () => clearInterval(check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.day, route.mode]);

  // Leaving the game hands the key back too. The unload path is best-effort
  // by nature; the idle timer is the reliable backstop behind it.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void endSession("hidden");
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void endSession("unmount");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.day, route.mode]);

  // Input: fire-and-forget with local prediction. The session key signs and
  // pays (zero-fee ER); authority corrections arrive on the subscription.
  useEffect(() => {
    let lastMoveAt = 0;
    const detach = attachInput(
      (action) => {
        lastInputAtRef.current = performance.now();
        const mine = liveRun.current;
        if (!mine || mine.state !== "active") return;
        if (displacedRef.current) {
          setHud((h) => ({
            ...h,
            lastRejection: "this run is open in another window",
          }));
          return;
        }
        // Coming back from an idle pause: take the key again first. The
        // action that woke us is spent on the handshake, and the next one
        // plays normally.
        if (sessionEndedRef.current) {
          setHud((h) => ({ ...h, lastRejection: "resuming session…" }));
          void renewSession();
          return;
        }
        if (action.kind === "move") {
          const now = performance.now();
          if (now - lastMoveAt < 60) return; // debounce bursts
          lastMoveAt = now;
          const dx =
            action.direction === Direction.Left
              ? -1
              : action.direction === Direction.Right
                ? 1
                : 0;
          const dy =
            action.direction === Direction.Forward
              ? 1
              : action.direction === Direction.Backward
                ? -1
                : 0;
          const [nx, ny] = [mine.x + dx, mine.y + dy];
          if (nx < 0 || nx > 63 || ny < 0) {
            sceneRef.current?.bumpLocal(dx, dy);
            return;
          }
          // Only static blockers refuse entry. Traffic, trains and unsupported
          // water are enterable and lethal, so authority records the death.
          const destLane = sceneRef.current?.laneAt(ny);
          if (destLane) {
            // Hazards move on whole authoritative seconds; asking on the
            // render clock would disagree with the program about what is
            // where.
            const tMs = tickOf(sceneRef.current!.worldTimeMs());
            if (evaluateTile(destLane, nx, tMs) === "blocked") {
              sceneRef.current?.bumpLocal(dx, dy);
              setHud((h) =>
                h.lastRejection === "blocked" ? h : { ...h, lastRejection: "blocked" },
              );
              return;
            }
          }
          // Prediction knows remote occupancy: don't send a doomed move.
          for (const r of occupiedRef.current.values()) {
            if (r.x === nx && r.y === ny) {
              sceneRef.current?.bumpLocal(dx, dy);
              setHud((h) => ({ ...h, lastRejection: "tile occupied" }));
              return;
            }
          }
          // Optimistic: advance the local mirror + visual immediately.
          liveRun.current = {
            ...mine,
            x: nx,
            y: ny,
            seq: mine.seq + 1,
            facing: action.direction,
          };
          sceneRef.current?.setLocal(nx, ny, action.direction);
          haptic(10);
          setHud((h) =>
            h.lastRejection == null && h.x === nx && h.y === ny
              ? h
              : { ...h, lastRejection: null, x: nx, y: ny },
          );
          enqueueAction({
            kind: "move",
            seq: mine.seq,
            attempt: mine.attempt,
            x: mine.x,
            y: mine.y,
            direction: action.direction,
            tries: 0,
          });
        } else if (action.kind === "kick") {
          const now = performance.now();
          const coolLeft = 5000 - (now - lastKickAtRef.current);
          if (coolLeft > 0) {
            setHud((h) => ({
              ...h,
              lastRejection: `kick cooldown ${(coolLeft / 1000).toFixed(1)}s`,
            }));
            return;
          }
          // Target: the adjacent tile in facing direction, from the live map.
          const dx =
            mine.facing === Direction.Left ? -1 : mine.facing === Direction.Right ? 1 : 0;
          const dy =
            mine.facing === Direction.Forward
              ? 1
              : mine.facing === Direction.Backward
                ? -1
                : 0;
          const [tx, ty] = [mine.x + dx, mine.y + dy];
          let targetWallet: string | null = null;
          for (const [w, r] of occupiedRef.current) {
            if (r.x === tx && r.y === ty && r.state === "active") {
              targetWallet = w;
              break;
            }
          }
          lastKickAtRef.current = now;
          liveRun.current = { ...mine, seq: mine.seq + 1 };
          sceneRef.current?.kickLocal(mine.facing);
          haptic(20);
          setHud((h) => ({ ...h, lastRejection: null }));
          enqueueAction({
            kind: "kick",
            seq: mine.seq,
            attempt: mine.attempt,
            x: mine.x,
            y: mine.y,
            facing: mine.facing as Direction,
            target: targetWallet
              ? { wallet: new PublicKey(targetWallet), x: tx, y: ty }
              : undefined,
            tries: 0,
          });
        }
      },
      { surface: canvasRef.current ?? undefined },
    );
    return detach;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.day, route.mode]);

  /** Casual restart: a fresh attempt on the same delegated run account. */
  async function playAgain() {
    setRespawning(true);
    try {
      const { attemptNonce } = await boot.client.joinCasual({
        day: route.day,
        sessionAuthority: boot.session.publicKey,
        sessionExpiry: Math.floor(Date.now() / 1000) + 8 * 3600,
      });
      await boot.client.spawn({
        day: route.day,
        attemptNonce,
        receiptNonce: 0,
        session: boot.session,
        mode: WorldMode.Casual,
      });
      setEndedScore(null);
      reconcileNowRef.current();
    } catch (e) {
      setHud((h) => ({ ...h, lastRejection: errorText(e) }));
    } finally {
      setRespawning(false);
    }
  }

  async function revive() {
    setReviving(true);
    try {
      const config = await boot.client.getConfig();
      const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
      const payerToken = getAssociatedTokenAddressSync(
        new PublicKey(config.usdcMint),
        boot.wallet.publicKey,
      );
      const review = await boot.client.reviewRevive({
        day: route.day,
        payerToken,
        usdcMint: new PublicKey(config.usdcMint),
      });
      await boot.client.submitReviewed(review);
      await boot.client.completeRevive({
        day: route.day,
        receiptNonce: review.receiptNonce,
        session: boot.session,
      });
      boot.client
        .reconcileReceipt({
          day: route.day,
          wallet: boot.wallet.publicKey,
          kind: ReceiptKind.Revival,
          receiptNonce: review.receiptNonce,
        })
        .catch(() => {});
      setDeath(null);
    } catch (e) {
      setHud((h) => ({ ...h, lastRejection: `${e}`.slice(0, 120) }));
    } finally {
      setReviving(false);
    }
  }

  // Where the run placed. Asked only once the run is over: mid-run it would
  // be a distraction, and the standings are one gPA over the whole world.
  useEffect(() => {
    if (endedScore == null && death == null) {
      setRank(null);
      return;
    }
    let live = true;
    boot.client
      .leaderboard(world)
      .then((board) => {
        if (!live) return;
        const me = boot.wallet.publicKey.toBase58();
        const place = board.findIndex((r) => r.wallet.toBase58() === me);
        if (place >= 0) setRank({ place: place + 1, of: board.length });
      })
      .catch(() => {
        /* the card is worth showing without a rank on it */
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endedScore, death]);

  // The revival deadline is authoritative and untouched; only the countdown
  // the player watches is presentation, so tick it once a second while the
  // death card is up instead of freezing at the moment the card opened.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!death) return;
    setNowSec(Math.floor(Date.now() / 1000));
    const tick = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(tick);
  }, [death]);

  const deadlineLeft = death ? Math.max(0, death.deadline - nowSec) : 0;

  return (
    <div className="game">
      <canvas ref={canvasRef} className="world-canvas" />
      <div className="hud score">
        {/* key retriggers the pop on every score change */}
        <span className="score-value" key={hud.score}>
          {hud.score}
        </span>
        <span className="score-best">BEST {hud.record}</span>
      </div>
      {hud.lastRejection && (
        <div className="hud top-left">
          <div className="rejection" key={hud.lastRejection}>
            {hud.lastRejection}
          </div>
        </div>
      )}
      <div className="hud top-right">
        <IconButton icon="gear" label="settings" onClick={() => setSettingsOpen(true)} />
        <IconButton icon="close" label="exit" onClick={onExit} />
      </div>

      {/* Live world status: who is here, and how far away the rollup is. */}
      {settings.showStatus && (
        <div className="hud live-strip">
          <span className="live-chip" title="players alive in this world">
            <Icon name="users" size={13} />
            {hud.players}
          </span>
          <span
            className={`live-chip live-chip--${pingTone(hud.pingMs)}`}
            title="round-trip to the ephemeral rollup"
          >
            <Icon name="signal" size={13} />
            {hud.pingMs == null ? "offline" : `${hud.pingMs} ms`}
          </span>
        </div>
      )}

      {displaced && (
        <Modal title="Playing elsewhere" ariaLabel="Playing elsewhere">
          <p>
            This run was opened in another window or device, which now holds the controls.
            Only one can play a run at a time.
          </p>
          <div className="row">
            <Button
              variant="info"
              disabled={respawning}
              onClick={() => {
                void renewSession(true);
              }}
            >
              Play here instead
            </Button>
            <Button variant="ghost" onClick={onExit}>
              Exit
            </Button>
          </div>
        </Modal>
      )}

      {endedScore != null && !death && (
        <Modal ariaLabel="Run over">
          <div className="death-card">
            {endedScore.score >= hud.record && endedScore.score > 0 && <Confetti />}
            <h2>{deathHeadline(endedScore.cause)}</h2>
            <div className="final-label">You reached</div>
            <div className="final-score">
              row <CountUp value={endedScore.score} durationMs={650} />
            </div>
            {endedScore.score >= hud.record && endedScore.score > 0 && (
              <div className="final-label final-label--gold">
                New personal course record
              </div>
            )}
            {rank && (
              <button className="final-rank" onClick={() => setBoardOpen(true)}>
                <Icon name="trophy" size={14} />
                {rank.place === 1
                  ? "1st in today's world"
                  : `#${rank.place} of ${rank.of} today`}
                <span className="final-rank__more">see standings</span>
              </button>
            )}
            <div className="row">
              <Button variant="play" disabled={respawning} onClick={playAgain}>
                {respawning ? "Starting…" : "TAP TO RETRY"}
              </Button>
              <Button variant="ghost" onClick={onExit}>
                Exit
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {settingsOpen && (
        <SettingsSheet boot={boot} onClose={() => setSettingsOpen(false)} />
      )}

      {boardOpen && (
        <LeaderboardSheet
          boot={boot}
          day={route.day}
          initialMode={route.mode}
          onClose={() => setBoardOpen(false)}
        />
      )}

      {death && (
        <Modal ariaLabel="You went down — revive or end the attempt">
          <div className="death-card">
            {hud.score >= hud.record && hud.score > 0 && <Confetti />}
            <h2>{deathHeadline(deathCauseRef.current)}</h2>
            <div className="final-label">Score retained</div>
            <div className="final-score">
              row <CountUp value={hud.score} durationMs={650} />
            </div>
            {death.price != null ? (
              <>
                <p>
                  Revive for{" "}
                  <span className="death-price">
                    {(Number(death.price) / 1e6).toFixed(2)} USDC
                  </span>{" "}
                  —{" "}
                  <span className="death-deadline">
                    <Icon name="timer" size={14} style={{ verticalAlign: "-2px" }} />{" "}
                    {deadlineLeft}s
                  </span>{" "}
                  left.
                  <br />
                  <small className="ds-dim">Later revivals double in price.</small>
                </p>
                <div className="row">
                  <Button
                    variant="danger"
                    icon="heart"
                    busy={reviving}
                    disabled={deadlineLeft === 0}
                    onClick={revive}
                  >
                    {reviving
                      ? "Reviving…"
                      : `Continue (${(Number(death.price) / 1e6).toFixed(0)} USDC)`}
                  </Button>
                  <Button variant="ghost" onClick={onExit}>
                    End attempt
                  </Button>
                </div>
              </>
            ) : (
              <p>Revival price exceeds representable limits — the attempt ends.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
