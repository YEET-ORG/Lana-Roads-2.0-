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
import { WorldScene } from "../../game/renderer/scene";
import { preloadAssets } from "../../game/renderer/assets";
import { attachInput } from "../../game/input/keys";
import { evaluateTile } from "../../game/simulation/hazards";
import { CountUp } from "../../ui/CountUp";
import { Confetti } from "../../ui/Confetti";
import { agentModelIdFor } from "../../lib/agent";
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
  });
  const [death, setDeath] = useState<DeathInfo | null>(null);
  const [reviving, setReviving] = useState(false);
  /** Casual runs end outright on death; the player just goes again. */
  const [endedScore, setEndedScore] = useState<number | null>(null);
  const [respawning, setRespawning] = useState(false);
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

    const applyRun = (run: any, force = false) => {
      const wallet = run.wallet.toBase58();
      const state = Object.keys(run.state)[0] ?? "?";
      if (wallet === me) {
        lastOwnPushRef.current = performance.now();
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
        if (state === "deadAwaitingRevive" || state === "ended") scene?.killLocal();
        else if (state === "active") scene?.reviveLocal();
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
          const score = liveRun.current!.score;
          window.clearTimeout(deathTimerRef.current);
          deathTimerRef.current = window.setTimeout(
            () => live && setEndedScore(score),
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
          scene!.setLane(chunk.rowStart + i, {
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
          });
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
      if (worldAcc) {
        // Anchor the hazard clock to the world's own timeline. Re-running
        // this on every sweep must converge, not creep forward.
        scene?.setWorldElapsed(Date.now() - Number(worldAcc.startTs.toString()) * 1000);
        hudRecordRef.current = worldAcc.recordScore;
        setHud((h) =>
          h.record === worldAcc.recordScore ? h : { ...h, record: worldAcc.recordScore },
        );
        await loadChunks(worldAcc.revealedRows);
      }
      if (run) applyRun(run, true);
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

    // Ping meter: ER RPC round-trip every 3s.
    const pingTimer = setInterval(async () => {
      const t0 = performance.now();
      await boot.client.erConnection.getSlot("processed").catch(() => null);
      if (live) setHud((h) => ({ ...h, pingMs: Math.round(performance.now() - t0) }));
    }, 3000);

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

  // Input: fire-and-forget with local prediction. The session key signs and
  // pays (zero-fee ER); authority corrections arrive on the subscription.
  useEffect(() => {
    let lastMoveAt = 0;
    const detach = attachInput(
      (action) => {
        const mine = liveRun.current;
        if (!mine || mine.state !== "active") return;
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
            const tMs = sceneRef.current!.worldTimeMs();
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
          const sent = {
            x: mine.x,
            y: mine.y,
            attemptNonce: mine.attempt,
            actionSeq: mine.seq,
          };
          // Optimistic: advance the local mirror + visual immediately.
          liveRun.current = {
            ...mine,
            x: nx,
            y: ny,
            seq: mine.seq + 1,
            facing: action.direction,
          };
          sceneRef.current?.setLocal(nx, ny, action.direction);
          if (navigator.vibrate) navigator.vibrate(10);
          setHud((h) =>
            h.lastRejection == null && h.x === nx && h.y === ny
              ? h
              : { ...h, lastRejection: null, x: nx, y: ny },
          );
          boot.client
            .sendMove({
              day: route.day,
              mode: route.mode,
              direction: action.direction,
              session: boot.session,
              ...sent,
            })
            .catch((e) => {
              setHud((h) => ({ ...h, lastRejection: errorText(e) }));
            })
            .finally(() => {});
          // Silence reconciler: a REJECTED move produces no push (no state
          // change on-chain), which would strand the optimistic mirror. If no
          // authoritative push has arrived since this send, refetch now
          // instead of waiting for the 5s sweep.
          const sentAt = performance.now();
          setTimeout(() => {
            if (lastOwnPushRef.current < sentAt) reconcileNowRef.current();
          }, 1300);
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
          const sent = { attemptNonce: mine.attempt, actionSeq: mine.seq };
          liveRun.current = { ...mine, seq: mine.seq + 1 };
          sceneRef.current?.kickLocal(mine.facing);
          if (navigator.vibrate) navigator.vibrate(20);
          setHud((h) => ({ ...h, lastRejection: null }));
          boot.client
            .sendKick({
              day: route.day,
              mode: route.mode,
              session: boot.session,
              ...sent,
              facing: mine.facing as Direction,
              target: targetWallet
                ? { wallet: new PublicKey(targetWallet), x: tx, y: ty }
                : undefined,
            })
            .catch((e) => setHud((h) => ({ ...h, lastRejection: errorText(e) })));
          const sentAt = performance.now();
          setTimeout(() => {
            if (lastOwnPushRef.current < sentAt) reconcileNowRef.current();
          }, 1300);
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

  const deadlineLeft = death
    ? Math.max(0, death.deadline - Math.floor(Date.now() / 1000))
    : 0;

  return (
    <div className="game">
      <canvas ref={canvasRef} className="world-canvas" />
      <div className="hud score">
        {/* key retriggers the pop on every score change */}
        <span className="score-value" key={hud.score}>
          {hud.score}
        </span>
      </div>
      <div className="hud top-left">
        <div>
          best <b>row {hud.record}</b>
        </div>
        <div className="dim">
          ({hud.x}, {hud.y}) · {hud.state}
          {hud.pending && " · sending…"}
        </div>
        {hud.lastRejection && (
          <div className="rejection" key={hud.lastRejection}>
            {hud.lastRejection}
          </div>
        )}
      </div>
      <div className="hud top-right">
        {hud.pingMs != null && (
          <span
            className={
              hud.pingMs < 150 ? "ping good" : hud.pingMs < 400 ? "ping mid" : "ping bad"
            }
          >
            {hud.pingMs}ms
          </span>
        )}
        <span className={route.mode === WorldMode.Paid ? "badge paid" : "badge casual"}>
          {route.mode === WorldMode.Paid ? "PAID · 1 USDC" : "CASUAL · FREE"}
        </span>
        <button className="ghost" onClick={onExit}>
          Exit
        </button>
      </div>
      <div className="hud bottom-left">WASD / arrows or swipe to hop · Space to kick</div>

      {endedScore != null && !death && (
        <div className="modal-backdrop">
          <div className="modal card death">
            {endedScore >= hud.record && endedScore > 0 && <Confetti />}
            <h2>Squished!</h2>
            <div className="final-label">You reached</div>
            <div className="final-score">
              row <CountUp value={endedScore} durationMs={650} />
            </div>
            {endedScore >= hud.record && endedScore > 0 && (
              <div className="final-label" style={{ color: "var(--sun-400)" }}>
                New personal course record
              </div>
            )}
            <div className="row">
              <button className="play" disabled={respawning} onClick={playAgain}>
                {respawning ? "Starting…" : "Play again"}
              </button>
              <button className="ghost" onClick={onExit}>
                Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {death && (
        <div className="modal-backdrop">
          <div className="modal card death">
            <h2>You died</h2>
            <div className="final-label">Score retained</div>
            <div className="final-score">
              row <CountUp value={hud.score} durationMs={650} />
            </div>
            {death.price != null ? (
              <>
                <p style={{ textAlign: "center" }}>
                  Revive for{" "}
                  <span className="price">
                    {(Number(death.price) / 1e6).toFixed(2)} USDC
                  </span>{" "}
                  — <span className="deadline">{deadlineLeft}s</span> left.
                  <br />
                  <small className="dim">Later revivals double in price.</small>
                </p>
                <div className="row">
                  <button
                    className="danger"
                    disabled={reviving || deadlineLeft === 0}
                    onClick={revive}
                  >
                    {reviving
                      ? "Reviving…"
                      : `Continue (${(Number(death.price) / 1e6).toFixed(0)} USDC)`}
                  </button>
                  <button className="ghost" onClick={onExit}>
                    End attempt
                  </button>
                </div>
              </>
            ) : (
              <p>Revival price exceeds representable limits — the attempt ends.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
