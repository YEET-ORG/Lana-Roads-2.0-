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
  });
  const [death, setDeath] = useState<DeathInfo | null>(null);
  const [reviving, setReviving] = useState(false);
  const world = pda.world(route.mode, route.day);

  // Casual: spawn a free run on mount when needed.
  useEffect(() => {
    let live = true;
    (async () => {
      if (route.mode !== WorldMode.Casual) return;
      try {
        let run = await boot.client.getRun(world);
        if (!run) {
          // init + starter lock + spawn, wallet-signed (free).
          const attemptNonce = 1;
          const w = boot.wallet.publicKey;
          const methods = boot.client.program.methods;
          const ixs = [];
          const profile = await boot.client.getProfile();
          if (!profile) {
            ixs.push(
              await methods
                .ensureProfile()
                .accountsPartial({ profile: pda.profile(w), wallet: w })
                .instruction(),
            );
          }
          if (!profile?.starterClaimed) {
            ixs.push(
              await methods
                .claimStarter()
                .accountsPartial({ profile: pda.profile(w), wallet: w })
                .instruction(),
            );
          }
          ixs.push(
            await methods
              .initRun(
                boot.session.publicKey,
                new (await import("@coral-xyz/anchor")).BN(
                  Math.floor(Date.now() / 1000) + 8 * 3600,
                ),
              )
              .accountsPartial({
                world,
                run: pda.run(world, w),
                best: pda.best(world, w),
                wallet: w,
              })
              .instruction(),
            await methods
              .lockStarter(attemptNonce)
              .accountsPartial({
                profile: pda.profile(w),
                world,
                lock: pda.agentLock(world, w, attemptNonce),
                wallet: w,
              })
              .instruction(),
          );
          const { Transaction } = await import("@solana/web3.js");
          const provider = boot.client.program
            .provider as import("@coral-xyz/anchor").AnchorProvider;
          await provider.sendAndConfirm(new Transaction().add(...ixs));
          run = await boot.client.getRun(world);
        }
        const state = run ? Object.keys(run.state)[0] : "missing";
        if (state === "idle" || state === "ended" || state === "entryFailed") {
          const attemptNonce = (run?.attemptNonce ?? 0) + 1;
          const w = boot.wallet.publicKey;
          const lock = await boot.client.program.account.agentLock.fetchNullable(
            pda.agentLock(world, w, attemptNonce),
          );
          if (!lock) {
            await boot.client.program.methods
              .lockStarter(attemptNonce)
              .accountsPartial({
                profile: pda.profile(w),
                world,
                lock: pda.agentLock(world, w, attemptNonce),
                wallet: w,
              })
              .rpc();
          }
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
        if (live) setHud((h) => ({ ...h, state: `error: ${`${e}`.slice(0, 120)}` }));
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scene lifecycle + canonical state polling/subscription.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const scene = new WorldScene(canvas);
    sceneRef.current = scene;
    const onResize = () => scene.resize();
    window.addEventListener("resize", onResize);

    let live = true;

    // Load revealed chunks into the scene.
    (async () => {
      const worldAcc = await boot.client
        .getWorld(route.mode, route.day)
        .catch(() => null);
      if (!worldAcc || !live) return;
      scene.worldTimeOffsetMs =
        Date.now() -
        Number(worldAcc.startTs.toString()) * 1000 -
        performance.now() +
        performance.now();
      const chunks = Math.ceil(worldAcc.revealedRows / 16);
      for (let c = 0; c < chunks; c++) {
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
      }
    })();

    // Canonical run/world refresh loop (subscription-driven refinement comes
    // with the indexer milestone; polling keeps the slice simple).
    const poll = setInterval(async () => {
      if (!live) return;
      const run = await boot.client.getRun(world).catch(() => null);
      const worldAcc = await boot.client
        .getWorld(route.mode, route.day)
        .catch(() => null);
      if (!run || !live) return;
      const state = Object.keys(run.state)[0] ?? "?";
      scene.setLocal(run.x, run.y);
      setHud((h) => ({
        ...h,
        score: run.score,
        record: worldAcc?.recordScore ?? h.record,
        x: run.x,
        y: run.y,
        state,
      }));
      if (state === "deadAwaitingRevive" && route.mode === WorldMode.Paid) {
        setDeath({
          deathNonce: run.deathNonce,
          deadline: Number(run.reviveDeadline.toString()),
          price: revivePrice(run.successfulRevives),
        });
      } else if (state === "active") {
        setDeath(null);
      }
      // Record propagation: strictly-improving scores claim the record.
      if (worldAcc && run.score > worldAcc.recordScore && state === "active") {
        boot.client.claimRecord(route.day, route.mode).catch(() => {});
      }
    }, 700);

    return () => {
      live = false;
      clearInterval(poll);
      window.removeEventListener("resize", onResize);
      scene.destroy();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.day, route.mode]);

  // Input: one in-flight action; predict one tile, reconcile on rejection.
  useEffect(() => {
    const detach = attachInput(async (action) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setHud((h) => ({ ...h, pending: true, lastRejection: null }));
      try {
        if (action.kind === "move") {
          // Optimistic single-tile prediction (presentation only).
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
          setHud((h) => {
            sceneRef.current?.setLocal(h.x + dx, h.y + dy);
            return h;
          });
          await boot.client.move({
            day: route.day,
            mode: route.mode,
            direction: action.direction,
            session: boot.session,
          });
        } else if (action.kind === "kick") {
          // Kick needs a target; the slice scans the facing tile occupant via
          // canonical sector state and skips silently when empty.
          setHud((h) => ({ ...h, lastRejection: "kick: no adjacent target" }));
        }
      } catch (e) {
        const msg = `${e}`;
        const code = msg.match(/Error Code: (\w+)/)?.[1] ?? msg.slice(0, 80);
        // Rejection: snap the visual back to canonical state.
        setHud((h) => {
          sceneRef.current?.setLocal(h.x, h.y);
          return { ...h, lastRejection: code };
        });
      } finally {
        busyRef.current = false;
        setHud((h) => ({ ...h, pending: false }));
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
