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
import { attachInput } from "../../game/input/keys";
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
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const scene = new WorldScene(canvas);
    sceneRef.current = scene;
    const onResize = () => scene.resize();
    window.addEventListener("resize", onResize);

    let live = true;
    const me = boot.wallet.publicKey.toBase58();
    const remotes = new Map<string, { x: number; y: number; state: string }>();

    const applyRun = (run: any) => {
      const wallet = run.wallet.toBase58();
      const state = Object.keys(run.state)[0] ?? "?";
      if (wallet === me) {
        const mine = liveRun.current;
        liveRun.current = {
          x: run.x,
          y: run.y,
          // Never regress the optimistic sequence: in-flight moves may
          // already be ahead of this push.
          seq: Math.max(run.actionSeq.toNumber(), mine?.seq ?? 0),
          attempt: run.attemptNonce,
          state,
          score: run.score,
        };
        scene.setLocal(run.x, run.y);
        setHud((h) => ({ ...h, score: run.score, x: run.x, y: run.y, state }));
        if (state === "deadAwaitingRevive" && route.mode === WorldMode.Paid) {
          setDeath({
            deathNonce: run.deathNonce,
            deadline: Number(run.reviveDeadline.toString()),
            price: revivePrice(run.successfulRevives),
          });
        } else if (state === "active") {
          setDeath(null);
        }
      } else {
        if (state === "active") remotes.set(wallet, { x: run.x, y: run.y, state });
        else remotes.delete(wallet);
        scene.setRemotes(
          [...remotes.entries()].map(([w, r]) => ({ wallet: w, x: r.x, y: r.y })),
        );
      }
    };

    // Chunk/lane loading (repeats when the frontier grows).
    let loadedChunks = 0;
    const loadChunks = async (revealedRows: number) => {
      const worldAcc = { revealedRows };
      const chunks = Math.ceil(worldAcc.revealedRows / 16);
      for (let c = loadedChunks; c < chunks; c++) {
        const chunk = await boot.client.getChunk(route.day, c).catch(() => null);
        if (!chunk || !live) continue;
        chunk.lanes.forEach((lane: any, i: number) => {
          scene.setLane(chunk.rowStart + i, {
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
        setHud((h) => ({ ...h, record: w.recordScore }));
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
        scene.worldTimeOffsetMs =
          Date.now() -
          Number(worldAcc.startTs.toString()) * 1000 -
          performance.now() +
          performance.now();
        setHud((h) => ({ ...h, record: worldAcc.recordScore }));
        await loadChunks(worldAcc.revealedRows);
      }
      if (run) applyRun(run);
    };
    void reconcile();
    const sweep = setInterval(() => void reconcile(), 5000);

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
      unsubscribe();
      window.removeEventListener("resize", onResize);
      scene.destroy();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.day, route.mode]);

  // Input: fire-and-forget with local prediction. The session key signs and
  // pays (zero-fee ER); authority corrections arrive on the subscription.
  useEffect(() => {
    let lastMoveAt = 0;
    const detach = attachInput((action) => {
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
        if (nx < 0 || nx > 63 || ny < 0) return;
        const sent = {
          x: mine.x,
          y: mine.y,
          attemptNonce: mine.attempt,
          actionSeq: mine.seq,
        };
        // Optimistic: advance the local mirror + visual immediately.
        liveRun.current = { ...mine, x: nx, y: ny, seq: mine.seq + 1 };
        sceneRef.current?.setLocal(nx, ny);
        setHud((h) => ({ ...h, pending: true, lastRejection: null, x: nx, y: ny }));
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
          .finally(() => setHud((h) => ({ ...h, pending: false })));
      } else if (action.kind === "kick") {
        setHud((h) => ({ ...h, lastRejection: "kick: aim at an adjacent player" }));
      }
    });
    return detach;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.day, route.mode]);

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
      <div className="hud top-left">
        <div>
          score <b>row {hud.score}</b>
        </div>
        <div>
          record <b>row {hud.record}</b>
        </div>
        <div className="dim">
          ({hud.x}, {hud.y}) · {hud.state}
          {hud.pending && " · sending…"}
        </div>
        {hud.lastRejection && <div className="rejection">✕ {hud.lastRejection}</div>}
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
          {route.mode === WorldMode.Paid ? "PAID" : "CASUAL — FREE"}
        </span>
        <button className="ghost" onClick={onExit}>
          Exit
        </button>
      </div>
      <div className="hud bottom-left">WASD / arrows to move · Space to kick</div>

      {death && (
        <div className="modal-backdrop">
          <div className="modal card death">
            <h2>You died</h2>
            <p>
              Score retained: <b>row {hud.score}</b>
            </p>
            {death.price != null ? (
              <>
                <p>
                  Revive for <b>{(Number(death.price) / 1e6).toFixed(2)} USDC</b> —{" "}
                  <b>{deadlineLeft}s</b> left. Later revivals double in price.
                </p>
                <div className="row">
                  <button disabled={reviving || deadlineLeft === 0} onClick={revive}>
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
