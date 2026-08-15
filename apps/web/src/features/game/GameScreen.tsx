/**
 * The game route: Three.js scene + HUD + death/revival overlay.
 *
 * State ownership: React owns overlays/HUD; the WorldScene owns frame-level
 * rendering. Prediction covers exactly one tile and never touches
 * authoritative score display; rejections snap back to canonical state.
 */
import { useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  Direction,
  loadContiguousChunks,
  pda,
  ReceiptKind,
  revivePrice,
  MS_PER_SLOT,
  worldTimeMs as slotTimeMs,
  WorldMode,
} from "@crossy-world/sdk";
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
import { agentId } from "../../game/renderer/assets";
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
  /** No gameplay listener may attach until the router has selected one ER. */
  const [erReady, setErReady] = useState(!boot.client.routerUrl);
  const settings = useSettings();
  const world = pda.world(boot.client.region, route.mode, route.day);

  // Resolve the authoritative ER before subscribing, reading a run, or
  // sending an action. This used to race the live-state effect: that effect
  // subscribed to the old connection, then resolution replaced the
  // connection underneath it and the map kept listening to the wrong server.
  useEffect(() => {
    let live = true;
    if (!boot.client.routerUrl) {
      setErReady(true);
      return () => {
        live = false;
      };
    }
    setErReady(false);
    setHud((h) => ({ ...h, state: "resolving ER…" }));
    boot.client
      .resolveErForWorld(world)
      .then((status) => {
        if (!live) return;
        if (!status.isDelegated || !status.fqdn)
          throw new Error("world is not delegated to a live rollup");
        console.log("world ER (router-resolved):", status.fqdn);
        setErReady(true);
      })
      .catch((e) => {
        if (live) setHud((h) => ({ ...h, state: `error: ${errorText(e)}` }));
      });
    return () => {
      live = false;
    };
  }, [boot.client, world.toBase58()]);

  // Casual: solsocket-style join — ONE base tx (profile + starter + run +
  // lock + delegate run/best to the pinned ER validator), wait for the ER
  // clone, then spawn ON the ER with the session key.
  useEffect(() => {
    let live = true;
    (async () => {
      if (!erReady || route.mode !== WorldMode.Casual) return;
      try {
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
  }, [erReady, route.day, route.mode]);

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
    if (!erReady) return;
    const canvas = canvasRef.current!;
    let scene: WorldScene | null = null;
    let live = true;
    let loadedChunks = 0;
    let wantedChunks = 0;
    let chunkLoadRunning = false;
    let chunkRetryMs = 150;
    let chunkRetryTimer = 0;
    let stopChunkWait: (() => void) | null = null;
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
      void pumpChunks();
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
     * Who everyone is: name and chosen agent, from their on-chain identity.
     *
     * Cached across the run because it almost never changes and every
     * remote push would otherwise want it. Refreshed with the roster.
     */
    const identities = new Map<string, { name: string; agent: number }>();
    const runStateSequences = new Map<string, bigint>();
    /**
     * Wallets whose identity is already being fetched.
     *
     * Runs push about five times a second each, so without this a newly
     * visible player would queue one identity read per push until the first
     * one answered.
     */
    const identityInFlight = new Set<string>();
    /** When the realtime feed last spoke about each wallet. */
    const lastFeedAt = new Map<string, number>();

    /**
     * Learn who a player is the moment they appear, not on the next sweep.
     *
     * Identity used to be read only by the 5 s roster sweep, so a player who
     * arrived between sweeps was drawn from `hashWallet` — a different animal
     * than the one they picked — and then silently swapped once the sweep
     * caught up. That is the "wrong character" everyone sees.
     */
    const learnIdentity = (wallet: string) => {
      if (identities.has(wallet) || identityInFlight.has(wallet)) return;
      identityInFlight.add(wallet);
      void boot.client
        .getIdentities([new PublicKey(wallet)])
        .then((found) => {
          identityInFlight.delete(wallet);
          const id = found.get(wallet);
          if (!id || !live) return;
          identities.set(wallet, { name: id.name, agent: id.agent });
          drawRemotes();
        })
        .catch(() => identityInFlight.delete(wallet));
    };
    const drawRemotes = () =>
      scene?.setRemotes(
        [...remotes.entries()].map(([w, r]) => ({
          wallet: w,
          x: r.x,
          y: r.y,
          agent: identities.get(w)?.agent,
          name: identities.get(w)?.name,
        })),
      );

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
      const stateSequence = BigInt(run.stateSeq?.toString() ?? run.actionSeq.toString());
      const previousStateSequence = runStateSequences.get(wallet);
      if (
        !force &&
        previousStateSequence != null &&
        stateSequence < previousStateSequence
      ) {
        return;
      }
      runStateSequences.set(wallet, stateSequence);
      const state = Object.keys(run.state)[0] ?? "?";
      // A subscription does not replay existing world-header state. During a
      // cold reload the run read can succeed while the independent header
      // read is temporarily unavailable, which previously rendered exactly
      // one thing: this player. A valid run proves every chunk through its
      // current row is revealed, so it safely seeds the minimum map range.
      loadChunks(run.y + 1);
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
          scene?.setLocal(run.x, run.y, run.facing);
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
        lastFeedAt.set(wallet, Date.now());
        if (state === "active") {
          remotes.set(wallet, {
            x: run.x,
            y: run.y,
            state,
            hazardNonce: run.hazardNonce,
          });
          learnIdentity(wallet);
        } else remotes.delete(wallet);
        drawRemotes();
      }
      syncPresence();
    };

    const clearChunkWait = () => {
      stopChunkWait?.();
      stopChunkWait = null;
      window.clearTimeout(chunkRetryTimer);
      chunkRetryTimer = 0;
    };

    // Retry is only a reconnect/propagation safety net. The normal path is
    // the ER world-header push followed immediately by a confirmed base read;
    // if that RPC is lagging, its base websocket wakes this exact chunk.
    const waitForChunk = (index: number) => {
      clearChunkWait();
      stopChunkWait = boot.client.subscribeChunk(route.day, index, () => {
        clearChunkWait();
        void pumpChunks();
      });
      chunkRetryTimer = window.setTimeout(() => {
        clearChunkWait();
        void pumpChunks();
      }, chunkRetryMs);
      chunkRetryMs = Math.min(2_000, chunkRetryMs * 2);
    };

    // Drain the map in strict chunk order. A temporary hole must never move
    // `loadedChunks` forward, otherwise those sixteen rows stay wrong until
    // the player reloads the entire game.
    const pumpChunks = async () => {
      if (!live || !scene || chunkLoadRunning || loadedChunks >= wantedChunks) return;
      chunkLoadRunning = true;
      const throughIndex = wantedChunks;
      try {
        const snapshotStart = loadedChunks;
        const snapshot = await boot.client
          .getChunks(route.day, snapshotStart, throughIndex - snapshotStart)
          .catch(() => [] as Array<any | null>);
        loadedChunks = await loadContiguousChunks({
          fromIndex: loadedChunks,
          throughIndex,
          fetchChunk: async (index) => snapshot[index - snapshotStart] ?? null,
          applyChunk: (chunk: any) => {
            if (!live || !scene) return;
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
                // Every client resolves the same model from committed bytes.
                Uint8Array.from(chunk.randomnessHash as number[]),
              );
            });
          },
        });
      } finally {
        chunkLoadRunning = false;
      }
      if (!live) return;
      if (loadedChunks < throughIndex) waitForChunk(loadedChunks);
      else if (loadedChunks < wantedChunks) void pumpChunks();
      else {
        clearChunkWait();
        chunkRetryMs = 150;
      }
    };

    // Chunk/lane loading repeats immediately whenever the frontier grows.
    const loadChunks = (revealedRows: number) => {
      wantedChunks = Math.max(wantedChunks, Math.ceil(revealedRows / 16));
      void pumpChunks();
    };

    // The realtime feed: every run/sector of this world + the world header.
    // Measured at ~200 ms end to end on the rollup, so this — not the sweep
    // below — is what makes other players move.
    let dropFeed: (() => void) | null = null;
    const openFeed = () => {
      dropFeed?.();
      dropFeed = boot.client.subscribeWorldRealtime({
        world,
        onRun: (run) => live && applyRun(run),
        onWorld: (w) => {
          if (!live) return;
          hudRecordRef.current = w.recordScore;
          setHud((h) =>
            h.record === w.recordScore ? h : { ...h, record: w.recordScore },
          );
          loadChunks(w.revealedRows);
        },
      });
    };
    openFeed();
    const unsubscribe = () => dropFeed?.();

    /**
     * Consecutive sweeps that found state the feed should have delivered.
     *
     * A silently dead websocket is indistinguishable from a quiet world by
     * timeout alone — nobody moving is not a fault. But a sweep that reads a
     * run STRICTLY ahead of anything the feed reported is proof a change was
     * missed. Two in a row and the socket is rebuilt, which is the difference
     * between multiplayer degrading to 5 s polling for the rest of the
     * session and recovering on its own.
     */
    let feedMisses = 0;

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
        // Did the feed miss anything? Only counts other players: our own run
        // is written by us, so it is ahead of the feed by design.
        let missed = false;
        const present = new Set<string>();
        for (const r of roster) {
          if (r.state !== "active") continue;
          const w = r.wallet.toBase58();
          if (w === me) continue;
          present.add(w);
          const seen = runStateSequences.get(w);
          if (seen != null && r.stateSeq > seen) missed = true;
          // The sweep is a SNAPSHOT and the feed is a stream, so a roster
          // read can easily be older than the last push — this is a poll of
          // the same rollup the notifications came from. Applying it blindly
          // dragged every other player back to where they were a moment ago
          // and then let the next push snap them forward: a visible hitch on
          // everyone else's character, every five seconds, for the whole
          // session. Membership comes from the roster; position only when it
          // is genuinely newer than what the feed already showed.
          if (seen != null && r.stateSeq < seen) continue;
          remotes.set(w, {
            x: r.x,
            y: r.y,
            state: r.state,
            hazardNonce: r.hazardNonce,
          });
          runStateSequences.set(w, r.stateSeq);
        }
        // Anyone the roster no longer lists has died or left — unless the
        // feed has heard from them since this snapshot could have been taken,
        // which means they joined into the gap and the snapshot is simply
        // older than they are. Dropping those would make a new player flicker
        // out and back on the next push.
        const staleAfter = Date.now() - 3000;
        for (const w of [...remotes.keys()]) {
          if (present.has(w)) continue;
          if ((lastFeedAt.get(w) ?? 0) > staleAfter) continue;
          remotes.delete(w);
          lastFeedAt.delete(w);
        }
        feedMisses = missed ? feedMisses + 1 : 0;
        if (feedMisses >= 2) {
          feedMisses = 0;
          console.warn("realtime feed missed changes twice; resubscribing");
          openFeed();
        }
        // Names and agents for EVERYONE present, not just wallets we have
        // never seen. A player can change agent or name mid-session, and
        // caching only-on-first-sight meant that change never reached anyone
        // else — they kept drawing whatever that wallet was when it arrived.
        // It is one getMultipleAccounts for the whole roster either way.
        const here = [...remotes.keys()];
        if (here.length) {
          const found = await boot.client
            .getIdentities(here.map((w) => new PublicKey(w)))
            .catch(() => null);
          if (found) {
            for (const [w, id] of found) identities.set(w, id);
            // Someone who cleared their identity should stop being drawn
            // under the old one.
            for (const w of here) if (!found.has(w)) identities.delete(w);
          }
        }
        drawRemotes();
        syncPresence();
      }
      if (worldAcc) {
        hudRecordRef.current = worldAcc.recordScore;
        setHud((h) =>
          h.record === worldAcc.recordScore ? h : { ...h, record: worldAcc.recordScore },
        );
        loadChunks(worldAcc.revealedRows);
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

    // Your own name and agent, so the world agrees with the menu.
    void boot.client
      .getIdentity()
      .then((id) => {
        if (!id) return;
        sceneRef.current?.setLocalName(id.name);
        sceneRef.current?.setLocalModel(agentId(id.agent));
      })
      .catch(() => {});

    // World time IS the rollup's slot — the program reads `Clock::slot`, so
    // this is the only clock that agrees with it. Following it is a servo,
    // not a fetch:
    //
    //   - world time advances 50ms per SLOT, and slots arrive every ~53ms,
    //     so the local rate has to be measured rather than assumed, or the
    //     animation runs ~7% fast and lurches backwards on every correction;
    //   - the correction itself is eased in, so being slightly out costs a
    //     few milliseconds a frame instead of a visible jump.
    let lastSlot = 0;
    let lastSlotAt = 0;
    let msPerSlot = 53; // measured on devnet; converges to the truth
    const acceptSlot = (slot: number) => {
      // The initial HTTP seed races the websocket. Never let an older seed
      // or delayed notification rewind every moving obstacle on the map.
      if (slot <= lastSlot) return;
      const at = performance.now();
      if (lastSlot && slot > lastSlot) {
        const observed = (at - lastSlotAt) / (slot - lastSlot);
        // Ignore obvious outliers (a delayed batch of notifications).
        if (observed > 20 && observed < 200) msPerSlot += (observed - msPerSlot) * 0.1;
      }
      lastSlot = slot;
      lastSlotAt = at;

      const scene = sceneRef.current;
      if (!scene) return;
      const rate = MS_PER_SLOT / msPerSlot;
      const target = slotTimeMs(slot);
      const error = target - scene.worldTimeMs();
      // A big gap means we just connected, or the tab was asleep: take the
      // chain's word for it. Normal updates only move a target; WorldScene
      // eases the phase error every frame instead of stepping all obstacles
      // whenever a websocket notification arrives.
      scene.setWorldClock(target, rate, Math.abs(error) > 300);
    };
    const stopSlots = boot.client.subscribeSlot(acceptSlot);
    // The subscription only speaks on the NEXT slot, so seed it once.
    void boot.client.erConnection
      .getSlot("processed")
      .then(acceptSlot)
      .catch(() => {});

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
      clearChunkWait();
      window.clearTimeout(deathTimerRef.current);
      stopPrewarm?.();
      stopSlots();
      unsubscribe();
      window.removeEventListener("resize", onResize);
      scene?.destroy();
      scene = null;
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [erReady, route.day, route.mode]);

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
   * The queue therefore preserves ORDER, but it does not wait for a round
   * trip between sends. It used to: each action was sent, then nothing else
   * went out until the chain pushed back an accepted sequence, which is one
   * action per ~200ms at best and per `ackWindowMs` at worst. The player's own
   * screen hopped at input rate because prediction is local, so this was
   * invisible to them — and everyone ELSE saw their hops arrive at the
   * acknowledgement rate, falling further behind the longer a direction was
   * held. "My hop is slow on my friend's screen" is exactly that gap.
   *
   * Sending one slot apart is enough. The program's two rules are an exact
   * `action_seq` and at most one accepted action per rollup slot; consecutive
   * sends from one client are already in sequence, so the only requirement is
   * that they do not land inside the same 50ms slot.
   *
   * A lost action is RESENT WITH THE SAME SEQUENCE, which is idempotent by
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
        sent?: boolean;
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
        sent?: boolean;
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
  /** Pacing timer: when the next queued action may go out. */
  const sendTimerRef = useRef(0);
  /** When the last action actually went out, for the one-slot floor. */
  const lastSendAtRef = useRef(0);

  /**
   * How closely two actions may be sent, MEASURED against devnet rather than
   * derived from the slot time.
   *
   * The tempting number is one rollup slot (50ms), because that is the rule
   * the program states. It is wrong. `action_seq` must match EXACTLY at
   * execution, so each action has to observe the previous one already
   * applied — dispatched is not enough. Sending faster than the rollup can
   * execute means every action after the first reads a sequence that has not
   * advanced and is refused, the local prediction rolls back, and the player
   * rubber-bands while everyone else watches them stutter.
   *
   * scripts/realtime-check.ts PIPELINE=1, oscillating inside the hazard-free
   * spawn zone so nothing dies and terrain cannot skew it, 10 actions per run:
   *
   *     60ms  ->  1/10 accepted
   *     90ms  ->  4/10
   *    120ms  -> 10/10, 10/10
   *
   * 120ms it is. Roughly eight actions a second is what this rollup takes.
   */
  const MIN_SEND_GAP_MS = 120;
  /**
   * How far prediction may run ahead of the chain.
   *
   * Input faster than the chain accepts cannot all land, so queueing it
   * without limit only buys a longer rollback later. Two outstanding keeps
   * the screen honest.
   */
  const MAX_PENDING_ACTIONS = 2;

  function enqueueAction(action: Outbound) {
    outboxRef.current.push(action);
    pumpOutbox();
  }

  /**
   * Send the next queued action, paced by the CLOCK rather than by the
   * network.
   *
   * Holding the queue while awaiting the send made the real cadence a round
   * trip plus the slot gap — about 137ms to the Singapore rollup, slower than
   * a player holding a direction. Input then outran the outbox, the queue
   * grew, and the drift landed entirely on other people's screens: the faster
   * you moved, the further behind you appeared. Prediction hid it locally.
   *
   * Sends may overlap in flight. Ordering does not depend on them arriving
   * one at a time — it depends on `action_seq`, which the program checks
   * exactly, and on two accepted actions never sharing a rollup slot, which
   * the gap below guarantees. A send that loses its race is retried with the
   * same sequence and is idempotent by construction.
   */
  function pumpOutbox() {
    const next = outboxRef.current.find((a) => !a.sent);
    if (!next) return;
    const since = performance.now() - lastSendAtRef.current;
    if (since < MIN_SEND_GAP_MS) {
      window.clearTimeout(sendTimerRef.current);
      sendTimerRef.current = window.setTimeout(pumpOutbox, MIN_SEND_GAP_MS - since);
      return;
    }
    lastSendAtRef.current = performance.now();
    next.sent = true;
    next.tries += 1;

    const common = { day: route.day, mode: route.mode, session: boot.session };
    const sending =
      next.kind === "move"
        ? boot.client.sendMove({
            ...common,
            direction: next.direction,
            x: next.x,
            y: next.y,
            attemptNonce: next.attempt,
            actionSeq: next.seq,
          })
        : boot.client.sendKick({
            ...common,
            attemptNonce: next.attempt,
            actionSeq: next.seq,
            facing: next.facing,
            target: next.target,
          });
    // Deliberately not awaited: the signature and any failure are recorded
    // when they arrive, and neither gates the next action.
    void sending
      .then((sig) => {
        next.sig = sig;
      })
      .catch((e) => {
        const why = errorText(e);
        setHud((h) => ({ ...h, lastRejection: why }));
        // A lapsed session refuses every action, which reads as a game that
        // simply stopped responding. Renew and carry on with the same run.
        if (why.includes("SessionExpired") || why.includes("BadSession")) {
          void renewSession();
        }
      });

    // The ack timer governs the HEAD only: it is the retry and rollback
    // clock, never the pacing clock.
    window.clearTimeout(ackTimerRef.current);
    ackTimerRef.current = window.setTimeout(checkOutboxHead, ackWindowMs());
    if (outboxRef.current.some((a) => !a.sent)) {
      window.clearTimeout(sendTimerRef.current);
      sendTimerRef.current = window.setTimeout(pumpOutbox, MIN_SEND_GAP_MS);
    }
  }

  function checkOutboxHead() {
    const head = outboxRef.current[0];
    if (!head) return;
    if (lastAuthSeqRef.current > head.seq) {
      // Accepted — and possibly several behind it, since sends are pipelined
      // and one push can carry the chain past a whole burst. Drop every entry
      // the chain has moved past, not just the first.
      while (
        outboxRef.current.length &&
        lastAuthSeqRef.current > outboxRef.current[0].seq
      )
        outboxRef.current.shift();
      rejectedRunRef.current = 0;
      if (outboxRef.current.length) {
        window.clearTimeout(ackTimerRef.current);
        ackTimerRef.current = window.setTimeout(checkOutboxHead, ackWindowMs());
      }
      pumpOutbox();
      return;
    }
    if (head.tries < ACTION_TRIES) {
      // Resend this exact sequence. Everything queued behind it was numbered
      // on top of it, so it has to land before they can.
      head.sent = false;
      // Lost or refused for a reason that may not hold a slot later (the
      // one-action-per-slot rule, a dropped packet). Same sequence, so the
      // chain can apply it at most once however many copies arrive.
      if (head.sig) boot.client.markTx(head.sig, "failed", "lost — resending");
      pumpOutbox();
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
          const turnIntoBlockedTile = (reason: string) => {
            // A blocked move is still a valid turn-in-place action. Predict
            // the facing immediately so kick direction feels responsive,
            // then persist the same action through authority.
            sceneRef.current?.setFacing(action.direction);
            sceneRef.current?.bumpLocal(dx, dy);
            liveRun.current = {
              ...mine,
              seq: mine.seq + 1,
              facing: action.direction,
            };
            setHud((h) =>
              h.lastRejection === reason ? h : { ...h, lastRejection: reason },
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
          };
          // Only static blockers refuse entry. Traffic, trains and unsupported
          // water are enterable and lethal, so authority records the death.
          const destLane = sceneRef.current?.laneAt(ny);
          if (destLane) {
            // Hazards move on whole authoritative seconds; asking on the
            // render clock would disagree with the program about what is
            // where.
            const tMs = tickOf(sceneRef.current!.worldTimeMs());
            if (evaluateTile(destLane, nx, tMs) === "blocked") {
              turnIntoBlockedTile("blocked");
              return;
            }
          }
          // Prediction knows remote occupancy: don't send a doomed move.
          for (const r of occupiedRef.current.values()) {
            if (r.x === nx && r.y === ny) {
              turnIntoBlockedTile("tile occupied");
              return;
            }
          }
          // Do not predict past what the chain can accept. At roughly eight
          // actions a second, input beyond that cannot land, and predicting
          // it only buys a bigger rollback — which is the rubber-band other
          // players see as lag.
          if (outboxRef.current.length >= MAX_PENDING_ACTIONS) {
            setHud((h) =>
              h.lastRejection === "too fast" ? h : { ...h, lastRejection: "too fast" },
            );
            return;
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
