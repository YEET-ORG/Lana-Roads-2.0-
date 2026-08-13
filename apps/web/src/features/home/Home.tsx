/**
 * Home / mode selection: UTC countdown to the hard cutoff, live prize pool
 * from durable accounting, current champion, and the two entry paths. Paid
 * and casual are visually distinct and cannot be confused.
 */
import { useEffect, useState } from "react";
import { dayEnd, WorldMode } from "@crossy-world/sdk";
import { Bootstrapped } from "../../lib/client";
import { EntryFlow } from "../entry/EntryFlow";
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

export function Home({
  boot,
  onPlay,
}: {
  boot: Bootstrapped;
  onPlay: (r: Route) => void;
}) {
  const [info, setInfo] = useState<DayInfo | null>(null);
  const [regionPings, setRegionPings] = useState<Record<string, number> | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [countdown, setCountdown] = useState("");
  const [entering, setEntering] = useState(false);

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
      } catch (e) {
        if (live) setWarn(`${e}`);
      }
    })();
    return () => {
      live = false;
    };
  }, [boot]);

  // Warm-connection ping to every MagicBlock ER region, measured FROM THE
  // BROWSER — a world lives on one region's validator, so pin it wherever
  // the players actually are.
  useEffect(() => {
    let live = true;
    (async () => {
      const regions = ["as", "eu", "us"];
      const out: Record<string, number> = {};
      await Promise.all(
        regions.map(async (r) => {
          const url = `https://devnet-${r}.magicblock.app`;
          const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot" });
          const ping = async () => {
            const t0 = performance.now();
            await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
            });
            return performance.now() - t0;
          };
          try {
            await ping(); // warm the connection
            out[r] = Math.round(await ping());
          } catch {
            out[r] = -1;
          }
        }),
      );
      if (live) setRegionPings(out);
    })();
    return () => {
      live = false;
    };
  }, []);

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

  if (!info) return <div className="card">Loading day…</div>;

  return (
    <div className="home">
      {warn && <div className="banner">{warn}</div>}
      <div className="card hero">
        <div className="stat">
          <label>UTC day</label>
          <b>{info.day.toString()}</b>
        </div>
        <div className="stat">
          <label>Hard cutoff in</label>
          <b>{countdown || "…"}</b>
        </div>
        <div className="stat">
          <label>Prize pool</label>
          <b>{(Number(info.pool) / 1e6).toFixed(2)} USDC</b>
          {info.rollover > 0n && (
            <small>incl. {(Number(info.rollover) / 1e6).toFixed(2)} rollover</small>
          )}
        </div>
        <div className="stat">
          <label>Record</label>
          <b>row {info.recordScore}</b>
          {info.recordHolder && <small>{info.recordHolder.slice(0, 8)}…</small>}
        </div>
        <div className="stat">
          <label>Active players</label>
          <b>{info.activePlayers}</b>
        </div>
        {regionPings && (
          <div className="stat">
            <label>ER regions (your ping)</label>
            <b className="regions">
              {Object.entries(regionPings)
                .map(([r, ms]) => `${r} ${ms < 0 ? "✕" : `${ms}ms`}`)
                .join(" · ")}
            </b>
            <small>world pinned: asia</small>
          </div>
        )}
      </div>

      <div className="modes">
        <div className="card mode paid">
          <h2>Paid competition</h2>
          <p>
            Entry <b>1 USDC</b> · winner takes <b>90%</b> of the pool, 10% to the team ·
            death offers a 60s revival at 10 → 20 → 40 USDC (doubling).
          </p>
          <p className="disclosure">
            Stronger classes are only available through rarer agents — this game
            intentionally has pay-to-win elements.
          </p>
          <button
            disabled={entering || info.status !== "open"}
            onClick={() => setEntering(true)}
          >
            {info.status === "open" ? "Enter for 1 USDC" : `Day is ${info.status}`}
          </button>
        </div>
        <div className="card mode casual">
          <h2>Casual — free</h2>
          <p>
            No entry fee, no prize pool, no revival. Every class unlocked for practice.
            Same world, separate leaderboard.
          </p>
          <button
            onClick={() =>
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
        </div>
      </div>

      {entering && (
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
