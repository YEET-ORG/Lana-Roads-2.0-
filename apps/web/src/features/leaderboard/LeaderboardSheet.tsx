/**
 * Casual standings for the selected day.
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

function shortWallet(w: string): string {
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

function nameFor(wallet: string): string {
  return agentName(agentIndexForWallet(wallet));
}

export function LeaderboardSheet({
  boot,
  day: today,
  onClose,
}: {
  boot: Bootstrapped;
  day: bigint;
  onClose: () => void;
}) {
  const mode = WorldMode.Casual;
  const [day, setDay] = useState<bigint>(today);
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [record, setRecord] = useState<{ score: number; holder: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const me = boot.wallet.publicKey.toBase58();

  const load = useCallback(async () => {
    const world = pda.world(boot.client.region, mode, day);
    try {
      const [board, header] = await Promise.all([
        boot.client.leaderboard(world),
        boot.client.getWorldAnywhere(mode, day),
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
    } catch (e) {
      setError(`${e}`.slice(0, 120));
    }
  }, [boot, day]);

  useEffect(() => {
    setRows(null);
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // A run account left "active" when the cutoff passed is not someone
  // playing — it is a day that ended around them.
  const isToday = day === today;
  const myRow = rows?.findIndex((r) => r.wallet.toBase58() === me) ?? -1;

  return (
    <Sheet title="Standings" ariaLabel="Casual standings" onClose={onClose}>
      <div className="lb-modes" role="group" aria-label="Casual standings">
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
      </div>

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
                {r.live && isToday && (
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
