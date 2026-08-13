/**
 * Offline practice mode: the full world runtime with locally synthesized
 * lanes and client-side collision — no cluster, no signatures. Exists to
 * tune game feel (and let players warm up); scoring here is cosmetic and
 * never touches authoritative state.
 */
import { useEffect, useRef, useState } from "react";
import { WorldScene } from "../../game/renderer/scene";
import { preloadAssets } from "../../game/renderer/assets";
import { attachInput } from "../../game/input/keys";
import {
  demoBlockedReason,
  demoEvaluateTile,
  demoIsTraversable,
  demoSeed,
  makeLane,
} from "../../game/simulation/demoLanes";
import { Direction } from "@crossy-world/sdk";
import { CountUp } from "../../ui/CountUp";
import { Confetti } from "../../ui/Confetti";
import { agentModelIdFor } from "../../lib/agent";
import { deathHeadline, type DeathCause } from "../../game/renderer/scene";

export function DemoScreen({ onExit }: { onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const posRef = useRef({ x: 32, y: 0 });
  const deadRef = useRef(false);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() =>
    Number(localStorage.getItem("crossy-world:demo-best") ?? 0),
  );
  const [dead, setDead] = useState<{ score: number; cause: DeathCause } | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const scoreRef = useRef(0);
  const revealedRef = useRef(0);

  // Restart shares the reset path with first mount.
  const [runNonce, setRunNonce] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let live = true;
    let scene: WorldScene | null = null;
    deadRef.current = false;
    posRef.current = { x: 32, y: 0 };
    scoreRef.current = 0;
    revealedRef.current = 0;
    setScore(0);
    setDead(null);
    setRejection(null);

    const reveal = (upTo: number) => {
      if (!scene) return;
      for (let r = revealedRef.current; r <= upTo; r++)
        scene.setLane(r, makeLane(r, 7 + runNonce), demoSeed(7 + runNonce));
      revealedRef.current = Math.max(revealedRef.current, upTo + 1);
    };

    void preloadAssets().then(() => {
      if (!live) return;
      scene = new WorldScene(canvas, {
        wallet: `demo-${runNonce}`,
        modelId: agentModelIdFor("demo"),
      });
      sceneRef.current = scene;
      scene.resize();
      reveal(28);
      scene.setLocal(32, 0);
    });

    const onResize = () => sceneRef.current?.resize();
    window.addEventListener("resize", onResize);

    // Client-side hazard sweep (the demo's "program"): standing on a lethal
    // tile kills; riding a log drifts the player with it.
    const sweep = setInterval(() => {
      const s = scene;
      if (!s || deadRef.current) return;
      const { x, y } = posRef.current;
      const lane = s.laneAt(y);
      if (!lane) return;
      const t = s.worldTimeMs();
      const state = demoEvaluateTile(lane, Math.round(x), t);
      if (state === "lethal") {
        deadRef.current = true;
        s.killLocal();
        const final = scoreRef.current;
        const cause = s.lastDeathCause;
        setTimeout(() => {
          setDead({ score: final, cause });
          setBest((b) => {
            const nb = Math.max(b, final);
            localStorage.setItem("crossy-world:demo-best", String(nb));
            return nb;
          });
        }, 450);
      }
    }, 120);

    const detach = attachInput(
      (action) => {
        const s = scene;
        if (!s || deadRef.current) return;
        if (action.kind !== "move") {
          s.kickLocal(0);
          return;
        }
        const { x, y } = posRef.current;
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
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx > 63 || ny < 0) {
          s.bumpLocal(dx, dy);
          return;
        }
        reveal(ny + 26);
        const destLane = s.laneAt(ny);
        if (destLane) {
          const t = s.worldTimeMs();
          if (!demoIsTraversable(destLane, nx, t)) {
            s.bumpLocal(dx, dy);
            const why = demoBlockedReason(destLane, nx, t);
            setRejection(why);
            return;
          }
        }
        posRef.current = { x: nx, y: ny };
        setRejection(null);
        s.setLocal(nx, ny, action.direction);
        if (navigator.vibrate) navigator.vibrate(10);
        if (ny > scoreRef.current) {
          if (Math.floor(ny / 10) > Math.floor(scoreRef.current / 10)) s.celebrate();
          scoreRef.current = ny;
          setScore(ny);
        }
      },
      { surface: canvas },
    );

    return () => {
      live = false;
      clearInterval(sweep);
      detach();
      window.removeEventListener("resize", onResize);
      scene?.destroy();
      scene = null;
      sceneRef.current = null;
    };
  }, [runNonce]);

  return (
    <div className="game">
      <canvas ref={canvasRef} className="world-canvas" />
      <div className="hud score">
        <span className="score-value" key={score}>
          {score}
        </span>
        <span className="score-best">BEST {best}</span>
      </div>
      {rejection && (
        <div className="hud top-left">
          <div className="rejection" key={rejection}>
            {rejection}
          </div>
        </div>
      )}
      <div className="hud top-right">
        <button className="icon-btn" onClick={onExit} aria-label="exit">
          ×
        </button>
      </div>
      {score === 0 && dead == null && (
        <div className="hud hop-hint">Tap or press W to hop</div>
      )}

      {dead != null && (
        <div className="modal-backdrop">
          <div className="modal card death">
            {dead.score >= best && dead.score > 0 && <Confetti />}
            <h2>{deathHeadline(dead.cause)}</h2>
            <div className="final-label">You reached</div>
            <div className="final-score">
              row <CountUp value={dead.score} durationMs={650} />
            </div>
            {dead.score >= best && dead.score > 0 && (
              <div className="final-label" style={{ color: "var(--sun-400)" }}>
                New practice best
              </div>
            )}
            <div className="row">
              <button className="play" onClick={() => setRunNonce((n) => n + 1)}>
                TAP TO RETRY
              </button>
              <button className="ghost" onClick={onExit}>
                Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
