/**
 * Home / mode selection, world-first: the live game world fills the screen
 * behind a Crossy-style overlay. The selected agent is the hero; Play is
 * the only giant CTA. Paid details live on a ticket sheet.
 */
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { dayEnd, WorldMode } from "@crossy-world/sdk";
import { Bootstrapped } from "../../lib/client";
import {
  agentModelIdFor,
  agentName,
  getAgentChoice,
  setAgentChoice,
} from "../../lib/agent";
import { agentId, AGENT_COUNT } from "../../game/renderer/assets";
import { sfx } from "../../game/audio";
import { WorldScene } from "../../game/renderer/scene";
import { EntryFlow } from "../entry/EntryFlow";
import { MenuBackdrop } from "./MenuBackdrop";
import type { Route } from "../../app/App";

interface DayInfo {
  day: bigint;
  pool: bigint;
  rollover: bigint;
  recordScore: number;
  recordHolder: string;
  activePlayers: number;
  status: string;
}

function agentIndexFromModelId(id: string): number {
  return Number(id.slice(-2));
}

export function Home({
  boot,
  onPlay,
}: {
  boot: Bootstrapped | null;
  onPlay: (r: Route) => void;
}) {
  const [info, setInfo] = useState<DayInfo | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [countdown, setCountdown] = useState("");
  const [entering, setEntering] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const wallet = boot?.wallet.publicKey.toBase58() ?? "offline";
  const [agentIdx, setAgentIdx] = useState(
    () => getAgentChoice() ?? agentIndexFromModelId(agentModelIdFor(wallet)),
  );
  const menuSceneRef = useRef<WorldScene | null>(null);
  const swipeRef = useRef<{ x: number; t: number } | null>(null);

  useEffect(() => {
    if (!boot) {
      setWarn("Cluster offline — practice is still open.");
      setInfo({
        day: 0n,
        pool: 0n,
        rollover: 0n,
        recordScore: 0,
        recordHolder: "",
        activePlayers: 0,
        status: "offline",
      });
      return;
    }
    let live = true;
    (async () => {
      try {
        const day = await boot.client.getCurrentDay();
        const daily = await boot.client.getDaily(day).catch(() => null);
        const world = await boot.client.getWorld(WorldMode.Paid, day).catch(() => null);
        if (!live) return;
        if (!daily || !world) {
          setWarn(
            `Today's competition (day ${day}) is not prepared on this cluster yet.`,
          );
          setInfo({
            day,
            pool: 0n,
            rollover: 0n,
            recordScore: 0,
            recordHolder: "",
            activePlayers: 0,
            status: "unprepared",
          });
          return;
        }
        setInfo({
          day,
          pool: BigInt(daily.activePool.toString()),
          rollover: BigInt(daily.rolloverIn.toString()),
          recordScore: world.recordScore,
          recordHolder: world.recordHolder.toBase58(),
          activePlayers: world.activePlayers,
          status: Object.keys(daily.status)[0] ?? "?",
        });
      } catch {
        if (live)
          setWarn("Can't reach the cluster — the daily competition is unavailable.");
      }
    })();
    return () => {
      live = false;
    };
  }, [boot]);

  useEffect(() => {
    if (!info) return;
    const id = setInterval(() => {
      const left = Number(dayEnd(info.day)) * 1000 - Date.now();
      if (left <= 0) return setCountdown("cutoff reached");
      const h = Math.floor(left / 3_600_000);
      const m = Math.floor((left % 3_600_000) / 60_000);
      const s = Math.floor((left % 60_000) / 1000);
      setCountdown(`${h}h ${m}m ${s}s`);
    }, 1000);
    return () => clearInterval(id);
  }, [info]);

  function cycleAgent(delta: number) {
    const next = (((agentIdx + delta) % AGENT_COUNT) + AGENT_COUNT) % AGENT_COUNT;
    setAgentIdx(next);
    setAgentChoice(next);
    menuSceneRef.current?.setLocalModel(agentId(next));
    sfx.hop();
  }

  function onSwipeStart(e: PointerEvent) {
    swipeRef.current = { x: e.clientX, t: performance.now() };
  }
  function onSwipeEnd(e: PointerEvent) {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) < 40) return;
    cycleAgent(dx < 0 ? 1 : -1);
  }

  const paidOpenable = info?.status === "open";

  return (
    <div className="world-home">
      <MenuBackdrop
        modelId={agentId(agentIdx)}
        onScene={(s) => (menuSceneRef.current = s)}
      />
      <div className="home-overlay">
        {warn && <div className="banner floating">{warn}</div>}

        <div className="home-spacer" />

        <div
          className="agent-hero"
          onPointerDown={onSwipeStart}
          onPointerUp={onSwipeEnd}
          onPointerCancel={() => {
            swipeRef.current = null;
          }}
        >
          <button
            className="arrow round"
            aria-label="previous agent"
            onClick={() => cycleAgent(-1)}
          >
            ‹
          </button>
          <div className="agent-nameplate">
            <span className="agent-name" key={agentIdx}>
              {agentName(agentIdx)}
            </span>
            <span className="agent-sub">swipe or tap to switch</span>
          </div>
          <button
            className="arrow round"
            aria-label="next agent"
            onClick={() => cycleAgent(1)}
          >
            ›
          </button>
        </div>

        <div className="home-cta">
          <button
            className="play giant"
            onClick={() => {
              if (
                !boot ||
                !info ||
                info.status === "offline" ||
                info.status === "unprepared"
              ) {
                onPlay({ name: "demo" });
                return;
              }
              info &&
                onPlay({
                  name: "play",
                  mode: WorldMode.Casual,
                  day: info.day,
                  attemptNonce: 0,
                  receiptNonce: 0,
                });
            }}
          >
            PLAY
          </button>
          <button
            className="ticket"
            onClick={() => {
              sfx.click();
              setPaidOpen(true);
            }}
          >
            <span>DAILY POT</span>
            <b>1 USDC</b>
          </button>
          <button className="text-link" onClick={() => onPlay({ name: "demo" })}>
            Practice offline
          </button>
        </div>
      </div>

      {paidOpen && info && (
        <div className="sheet-backdrop" onClick={() => setPaidOpen(false)}>
          <div
            className="sheet paid-sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Daily competition"
          >
            <div className="sheet-handle" />
            <h2>Daily competition</h2>
            <div className="sheet-stats">
              <span>
                <label>pool</label>
                {(Number(info.pool) / 1e6).toFixed(2)} USDC
              </span>
              <span>
                <label>record</label>
                row {info.recordScore}
              </span>
              <span>
                <label>live</label>
                {info.activePlayers}
              </span>
              <span>
                <label>cutoff</label>
                {countdown || "…"}
              </span>
            </div>
            <p>
              Entry <b>1 USDC</b> · winner takes <b>90%</b> · revival 10 → 20 → 40 USDC,
              doubling, 60s window.
            </p>
            <p className="disclosure">
              Stronger classes come from rarer agents — intentionally pay-to-win.
            </p>
            <div className="row">
              <button
                className="primary"
                disabled={entering || !paidOpenable}
                onClick={() => {
                  sfx.confirm();
                  setEntering(true);
                  setPaidOpen(false);
                }}
              >
                {paidOpenable ? "Enter for 1 USDC" : `Day is ${info.status}`}
              </button>
              <button className="ghost" onClick={() => setPaidOpen(false)}>
                Back
              </button>
            </div>
          </div>
        </div>
      )}

      {entering && info && boot && (
        <EntryFlow
          boot={boot}
          day={info.day}
          onCancel={() => setEntering(false)}
          onActive={(attemptNonce, receiptNonce) =>
            onPlay({
              name: "play",
              mode: WorldMode.Paid,
              day: info.day,
              attemptNonce,
              receiptNonce,
            })
          }
        />
      )}
    </div>
  );
}
