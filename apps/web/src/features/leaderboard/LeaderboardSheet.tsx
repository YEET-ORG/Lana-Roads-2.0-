/**
 * The day's standings, and — once the day has settled — its result.
 *
 * One screen rather than two, because they are the same list at different
 * points in its life: while the world is live it updates under you and says
 * who is still out there; after the cutoff the same rows are final and the
 * top of the sheet becomes the payout.
 *
 * Every number here comes from an account the program keeps. Ranking is the
 * program's own: best row first, and on a tie whoever reached it in the
 * earlier slot. This client does not get an opinion.
 */
import { useCallback, useEffect, useState } from "react";
import type { LeaderboardEntry } from "@crossy-world/sdk";
import { pda, WorldMode } from "@crossy-world/sdk";
import { Button, Icon, Loader, Notice, Pill, Sheet } from "../../design-system";
import type { Bootstrapped } from "../../lib/client";
import { agentIndexForWallet, agentName } from "../../lib/agent";
import { sfx } from "../../game/audio";

/** How often a live board refetches. Slow enough to be polite to the RPC. */
const REFRESH_MS = 8000;
const TOP_N = 25;

interface DayResult {
  status: string;
  pool: bigint;
  winner: string | null;
  /** The score the prize was actually paid on. */
  settledScore: number;
  winnerAmount: bigint;
  teamAmount: bigint;
  rolloverOut: bigint;
}

function shortWallet(w: string): string {
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

function nameFor(wallet: string): string {
  return agentName(agentIndexForWallet(wallet));
}

function usdc(v: bigint): string {
  return `${(Number(v) / 1e6).toFixed(2)} USDC`;
}

export function LeaderboardSheet({
  boot,
  day: today,
  initialMode = WorldMode.Casual,
  onClose,
}: {
  boot: Bootstrapped;
  day: bigint;
  initialMode?: WorldMode;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<WorldMode>(initialMode);
  // Yesterday's result is the most-asked question of a daily competition,
  // so the board walks days rather than only ever showing this one.
  const [day, setDay] = useState<bigint>(today);
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [record, setRecord] = useState<{ score: number; holder: string } | null>(null);
  const [result, setResult] = useState<DayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const me = boot.wallet.publicKey.toBase58();

  const load = useCallback(async () => {
    const world = pda.world(mode, day);
    try {
      const [board, header, daily] = await Promise.all([
        boot.client.leaderboard(world),
        boot.client.getWorldAnywhere(mode, day),
        boot.client.getDaily(day).catch(() => null),
      ]);
      setRows(board);
      // Names, in one request for the whole board. A player who never set
      // one keeps the species-and-address label.
      const ids = await boot.client
        .getIdentities(board.slice(0, TOP_N).map((r) => r.wallet))
        .catch(() => null);
      if (ids) setNames(new Map([...ids].map(([w, id]) => [w, id.name])));
      setError(null);
      setRecord(
        header
          ? { score: header.recordScore, holder: header.recordHolder.toBase58() }
          : null,
      );
      // Only the paid world settles; casual has standings but no purse.
      const status = daily ? (Object.keys(daily.status)[0] ?? "?") : null;
      setResult(
        daily && mode === WorldMode.Paid
          ? {
              status: status ?? "?",
              pool: BigInt(daily.activePool.toString()),
              winner: daily.settledScore !== 0 ? daily.settledWinner.toBase58() : null,
              settledScore: daily.settledScore,
              winnerAmount: BigInt(daily.winnerAmount.toString()),
              teamAmount: BigInt(daily.teamAmount.toString()),
              rolloverOut: BigInt(daily.rolloverOut.toString()),
            }
          : null,
      );
    } catch (e) {
      setError(`${e}`.slice(0, 120));
    }
  }, [boot, day, mode]);

  useEffect(() => {
    setRows(null);
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const settled = result?.status === "settled";
  // A run account left "active" when the cutoff passed is not someone
  // playing — it is a day that ended around them.
  const isToday = day === today;
  const myRow = rows?.findIndex((r) => r.wallet.toBase58() === me) ?? -1;

  return (
    <Sheet
      title={settled ? "Results" : "Standings"}
      ariaLabel={settled ? "Day results" : "Day standings"}
      onClose={onClose}
      tone={settled ? "gold" : undefined}
    >
      <div className="lb-modes" role="group" aria-label="World">
        {[
          { value: WorldMode.Casual, label: "Casual" },
          { value: WorldMode.Paid, label: "Daily pot" },
        ].map((m) => (
          <button
            key={m.label}
            className={`setting__choice${m.value === mode ? " is-on" : ""}`}
            aria-pressed={m.value === mode}
            onClick={() => {
              sfx.click();
              setMode(m.value);
            }}
          >
            {m.label}
          </button>
        ))}
        <span className="lb-days">
          <button
            className="lb-day-step"
            aria-label="previous day"
            onClick={() => {
              sfx.click();
              setDay((d) => d - 1n);
            }}
          >
            <Icon name="chevron-left" size={14} />
          </button>
          <span className="lb-day">
            {day === today ? "today" : `day ${day.toString()}`}
          </span>
          <button
            className="lb-day-step"
            aria-label="next day"
            disabled={day >= today}
            onClick={() => {
              sfx.click();
              setDay((d) => (d < today ? d + 1n : d));
            }}
          >
            <Icon name="chevron-right" size={14} />
          </button>
        </span>
      </div>

      {settled && result && (
        <div className="lb-result">
          {result.winner ? (
            <>
              <div className="lb-result__label">Winner</div>
              <div className="lb-result__winner">
                <Icon name="trophy" size={18} />
                {names.get(result.winner) ??
                  (result.winner === me ? "You" : nameFor(result.winner))}
                <span className="lb-result__wallet">{shortWallet(result.winner)}</span>
              </div>
              <div className="lb-result__prize">{usdc(result.winnerAmount)}</div>
              <div className="lb-result__label">
                {/* The prize is settled on the CLAIMED record, which is not
                    always the best row anyone reached — claiming is its own
                    transaction. Saying which score won avoids a board that
                    seems to contradict the payout. */}
                won at row {result.settledScore} · team {usdc(result.teamAmount)}
              </div>
            </>
          ) : (
            <>
              <div className="lb-result__label">Nobody scored</div>
              <div className="lb-result__prize">{usdc(result.rolloverOut)}</div>
              <div className="lb-result__label">rolled into the next day</div>
            </>
          )}
        </div>
      )}

      {!settled && (
        <div className="lb-meta">
          {record && record.score > 0 ? (
            <Pill tone="info" icon="flag">
              record row {record.score} ·{" "}
              {names.get(record.holder) ??
                (record.holder === me ? "you" : nameFor(record.holder))}
            </Pill>
          ) : (
            <Pill tone="neutral" icon="flag">
              no record yet
            </Pill>
          )}
          {result && result.status !== "settled" && mode === WorldMode.Paid && (
            <Pill tone="paid" icon="vault">
              pool {usdc(result.pool)}
            </Pill>
          )}
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {rows == null ? (
        <Loader label="reading the world…" />
      ) : rows.length === 0 ? (
        <Notice tone="info">
          {day === today
            ? "Nobody has scored in this world today. First hop takes the top spot."
            : "No standings recorded for this day."}
        </Notice>
      ) : (
        <ol className="lb-list">
          {rows.slice(0, TOP_N).map((r, i) => {
            const wallet = r.wallet.toBase58();
            const mine = wallet === me;
            return (
              <li key={wallet} className={`lb-row${mine ? " is-me" : ""}`}>
                <span className={`lb-rank lb-rank--${i < 3 ? i + 1 : "n"}`}>{i + 1}</span>
                <span className="lb-who">
                  <span className="lb-name">
                    {names.get(wallet) ?? (mine ? "You" : nameFor(wallet))}
                    {mine && names.has(wallet) && <span className="lb-you">you</span>}
                  </span>
                  <span className="lb-wallet">{shortWallet(wallet)}</span>
                </span>
                {r.live && isToday && !settled && (
                  <span className="lb-live" title="still playing">
                    <span className="lb-live__dot" />
                    row {r.currentScore}
                  </span>
                )}
                <span className="lb-score">{r.bestScore}</span>
              </li>
            );
          })}
        </ol>
      )}

      {rows != null && myRow >= TOP_N && (
        <Notice tone="info">
          You are #{myRow + 1} with row {rows[myRow].bestScore}.
        </Notice>
      )}

      <div className="row">
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Sheet>
  );
}
