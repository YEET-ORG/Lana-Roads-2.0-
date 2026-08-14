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
import {
  Button,
  Icon,
  IconButton,
  Notice,
  Sheet,
  StatGrid,
} from "../../design-system";
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
        {warn && (
          <div className="notice-float">
            <Notice>{warn}</Notice>
          </div>
        )}

        <div className="home-spacer" />

        <div
          className="agent-hero"
          onPointerDown={onSwipeStart}
          onPointerUp={onSwipeEnd}
          onPointerCancel={() => {
            swipeRef.current = null;
          }}
        >
          <IconButton
            icon="chevron-left"
            label="previous agent"
            variant="sun"
            size="lg"
            onClick={() => cycleAgent(-1)}
          />
          <div className="agent-nameplate">
            <span className="agent-name" key={agentIdx}>
              {agentName(agentIdx)}
            </span>
            <span className="agent-sub">
              <Icon name="paw" size={11} style={{ verticalAlign: "-1px" }} /> swipe or tap
              to switch
            </span>
          </div>
          <IconButton
            icon="chevron-right"
            label="next agent"
            variant="sun"
            size="lg"
            onClick={() => cycleAgent(1)}
          />
        </div>

        <div className="home-cta">
          <Button
            variant="play"
            size="giant"
            icon="play"
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
          </Button>
          <button
            className="home-ticket"
            onClick={() => {
              sfx.click();
              setPaidOpen(true);
            }}
          >
            <span className="home-ticket__label">
              <Icon name="ticket" size={22} />
              <span>
                DAILY POT · PAID
                <small>
                  {info && info.status !== "offline"
                    ? `pool ${(Number(info.pool) / 1e6).toFixed(2)} USDC${
                        countdown ? ` · ${countdown} left` : ""
                      }`
                    : "daily prize competition"}
                </small>
              </span>
            </span>
            <b className="home-ticket__price">1 USDC</b>
          </button>
          <Button variant="link" icon="target" onClick={() => onPlay({ name: "demo" })}>
            Practice offline
          </Button>
        </div>
      </div>

      {paidOpen && (
        <Sheet
          tone="gold"
          title="Daily competition"
          ariaLabel="Daily competition"
          onClose={() => setPaidOpen(false)}
        >
          {info ? (
            <StatGrid
              items={[
                {
                  label: "pool",
                  value: `${(Number(info.pool) / 1e6).toFixed(2)} USDC`,
                  tone: "gold",
                  icon: "vault",
                },
                { label: "record", value: `row ${info.recordScore}`, icon: "flag" },
                { label: "live", value: info.activePlayers, icon: "users" },
                { label: "cutoff", value: countdown || "…", icon: "timer" },
              ]}
            />
          ) : (
            <Notice tone="info">
              Today's competition isn't reachable right now — practice mode is still
              open.
            </Notice>
          )}
          <div className="paid-sheet-copy">
            <p>
              Entry <b>1 USDC</b> · winner takes <b>90%</b> · revival 10 → 20 → 40 USDC,
              doubling, 60s window.
            </p>
            <p className="disclosure">
              Stronger classes come from rarer agents — intentionally pay-to-win.
            </p>
          </div>
          <div className="row">
            <Button
              variant="primary"
              icon="coin"
              disabled={entering || !paidOpenable}
              onClick={() => {
                sfx.confirm();
                setEntering(true);
                setPaidOpen(false);
              }}
            >
              {paidOpenable
                ? "Enter for 1 USDC"
                : `Unavailable${info ? ` — day is ${info.status}` : ""}`}
            </Button>
            <Button variant="ghost" onClick={() => setPaidOpen(false)}>
              Back
            </Button>
          </div>
        </Sheet>
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
