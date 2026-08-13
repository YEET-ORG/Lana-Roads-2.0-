/**
 * Home / mode selection, world-first: the live game world fills the screen
 * behind floating UI (Crossy grammar). Stats ride in compact chips; the two
 * entry paths sit in a bottom dock; the agent carousel swaps your animal
 * live in the world. Paid and casual stay visually distinct.
 */
import { useEffect, useRef, useState } from "react";
import { dayEnd, WorldMode } from "@crossy-world/sdk";
import { Bootstrapped } from "../../lib/client";
import { agentModelIdFor, getAgentChoice, setAgentChoice } from "../../lib/agent";
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
  boot: Bootstrapped;
  onPlay: (r: Route) => void;
}) {
  const [info, setInfo] = useState<DayInfo | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [countdown, setCountdown] = useState("");
  const [entering, setEntering] = useState(false);
  const wallet = boot.wallet.publicKey.toBase58();
  const [agentIdx, setAgentIdx] = useState(
    () => getAgentChoice() ?? agentIndexFromModelId(agentModelIdFor(wallet)),
  );
  const menuSceneRef = useRef<WorldScene | null>(null);

  useEffect(() => {
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

  return (
    <div className="world-home">
      <MenuBackdrop
        modelId={agentId(agentIdx)}
        onScene={(s) => (menuSceneRef.current = s)}
      />
      <div className="home-overlay">
        {warn && <div className="banner floating">{warn}</div>}

        <div className="chips">
          {info ? (
            <>
              <span className="chip">
                <label>day</label> {info.day.toString()}
              </span>
              <span className="chip">
                <label>cutoff</label> {countdown || "…"}
              </span>
              <span className="chip gold">
                <label>pool</label> {(Number(info.pool) / 1e6).toFixed(2)} USDC
              </span>
              <span className="chip">
                <label>record</label> row {info.recordScore}
              </span>
              <span className="chip">
                <label>live</label> {info.activePlayers}
              </span>
            </>
          ) : (
            <span className="chip">loading day…</span>
          )}
        </div>

        <div className="agent-pick">
          <button
            className="arrow"
            aria-label="previous agent"
            onClick={() => cycleAgent(-1)}
          >
            &lsaquo;
          </button>
          <span className="agent-label">
            <label>your agent</label>
            {String(agentIdx).padStart(2, "0")}
          </span>
          <button className="arrow" aria-label="next agent" onClick={() => cycleAgent(1)}>
            &rsaquo;
          </button>
        </div>

        <div className="dock">
          <div className="dock-card paid">
            <h2>Daily competition</h2>
            <p>
              Entry <b>1 USDC</b> · winner takes <b>90%</b> · revival 10 → 20 → 40 USDC,
              doubling, 60s window.
            </p>
            <p className="disclosure">
              Stronger classes come from rarer agents — intentionally pay-to-win.
            </p>
            <button
              className="primary"
              disabled={entering || !info || info.status !== "open"}
              onClick={() => setEntering(true)}
            >
              {!info
                ? "Loading…"
                : info.status === "open"
                  ? "Enter for 1 USDC"
                  : `Day is ${info.status}`}
            </button>
          </div>
          <div className="dock-card casual">
            <h2>Casual — free</h2>
            <p>
              No fee, no prize, no revival. Every class unlocked. Same world, separate
              leaderboard.
            </p>
            <div className="row">
              <button
                className="play"
                disabled={!info}
                onClick={() =>
                  info &&
                  onPlay({
                    name: "play",
                    mode: WorldMode.Casual,
                    day: info.day,
                    attemptNonce: 0, // resolved by the game screen
                    receiptNonce: 0,
                  })
                }
              >
                Play free
              </button>
              <button className="ghost" onClick={() => onPlay({ name: "demo" })}>
                Practice offline
              </button>
            </div>
          </div>
        </div>
      </div>

      {entering && info && (
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
