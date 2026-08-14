/**
 * Transaction toasts, bottom-right.
 *
 * Every signature this client produces passes through here. The hard part is
 * volume, not display: a player hops several times a second and each hop is
 * its own rollup transaction, so gameplay is marked `quiet` by the SDK and
 * collapses into ONE rolling slot — the newest action replaces the last.
 * Anything rare and consequential (joining, paying, reviving, taking the
 * session) gets a slot of its own, and any failure is promoted out of the
 * quiet lane, because a refused move is the one thing a player must see.
 */
import { useEffect, useRef, useState } from "react";
import type { CrossyClient, TxActivity } from "@crossy-world/sdk";
import { Icon } from "./icons";
import { ER_RPC, CLUSTER } from "../lib/client";

/** How long a resolved toast stays up, by how much it matters. */
const LINGER_MS = { failed: 11_000, quiet: 2_600, normal: 5_000 };
/** Never stack more than this; older ones fall off the top. */
const MAX_VISIBLE = 4;
/** The single slot every quiet gameplay transaction shares. */
const QUIET_SLOT = -1;

interface Toast extends TxActivity {
  /** Slot key: quiet transactions all share one, so they replace in place. */
  slot: number;
}

function explorerUrl(t: Toast): string | null {
  if (!t.signature) return null;
  const base = `https://explorer.solana.com/tx/${t.signature}`;
  if (t.plane === "base")
    return CLUSTER === "devnet" ? `${base}?cluster=devnet` : `${base}?cluster=custom`;
  // The rollup is not a cluster the explorer knows; point it at the ER's RPC.
  return `${base}?cluster=custom&customUrl=${encodeURIComponent(ER_RPC)}`;
}

function shortSig(sig: string): string {
  return `${sig.slice(0, 4)}…${sig.slice(-4)}`;
}

/**
 * Say what went wrong in the player's terms.
 *
 * The chain's own wording is precise and useless at the moment it matters:
 * "Attempt to debit an account but found no record of a prior credit" is how
 * Solana says the wallet is empty. Anything unrecognised passes through
 * unchanged rather than being flattened into a shrug.
 */
function friendlyError(raw: string): string {
  const known: [RegExp, string][] = [
    [/no record of a prior credit|insufficient (lamports|funds)/i, "not enough SOL"],
    [/SessionExpired|BadSession/i, "session expired — reauthorising"],
    [/Blocked/, "something is in the way"],
    [/TileOccupied|Occupied/, "another player is standing there"],
    [/FrontierClosed/, "the map hasn't been built that far yet"],
    [/CutoffPassed|DayNotStarted/, "today's competition is closed"],
    [/blockhash not found|Blockhash/i, "network hiccup — retrying"],
    [/429|Too Many Requests/, "the RPC is rate-limiting us"],
  ];
  for (const [re, text] of known) if (re.test(raw)) return text;
  return raw;
}

export function TxToasts({ client }: { client: CrossyClient | null }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, number>());

  useEffect(() => {
    if (!client) return;
    const drop = (slot: number) =>
      setToasts((list) => list.filter((t) => t.slot !== slot));

    const schedule = (slot: number, ms: number) => {
      window.clearTimeout(timers.current.get(slot));
      timers.current.set(
        slot,
        window.setTimeout(() => drop(slot), ms),
      );
    };

    const off = client.onTx((a) => {
      // Upkeep the player never asked for stays out of sight entirely,
      // failures included — a refused hazard crank means someone else got
      // there first, which is the system working.
      if (a.background) return;
      // A failure is never quiet otherwise: it gets its own slot and stays
      // long enough to read, even from the gameplay firehose.
      const slot = a.quiet && a.status !== "failed" ? QUIET_SLOT : a.id;
      const toast: Toast = { ...a, slot };
      setToasts((list) => {
        const without = list.filter((t) => t.slot !== slot);
        return [...without, toast].slice(-MAX_VISIBLE);
      });
      if (a.status === "pending") {
        // Nothing resolves instantly, but a send that never comes back must
        // not pin a spinner to the screen forever.
        schedule(slot, 30_000);
        return;
      }
      schedule(
        slot,
        a.status === "failed"
          ? LINGER_MS.failed
          : a.quiet
            ? LINGER_MS.quiet
            : LINGER_MS.normal,
      );
    });

    const pending = timers.current;
    return () => {
      off();
      for (const id of pending.values()) window.clearTimeout(id);
      pending.clear();
    };
  }, [client]);

  if (!toasts.length) return null;

  return (
    <div className="tx-toasts" aria-live="polite">
      {toasts.map((t) => {
        const url = explorerUrl(t);
        return (
          // Keyed by SLOT, not id: the quiet lane is one element that
          // updates in place, so a fast player does not restage the
          // entrance animation on every hop.
          <div key={t.slot} className={`tx-toast tx-toast--${t.status}`}>
            <span className="tx-toast__icon">
              {t.status === "pending" ? (
                <span className="tx-spinner" />
              ) : t.status === "failed" ? (
                <Icon name="alert" size={14} />
              ) : (
                <Icon name="check" size={14} />
              )}
            </span>
            <span className="tx-toast__body">
              <span className="tx-toast__label">
                {t.label}
                <span className="tx-toast__plane">{t.plane === "er" ? "ER" : "L1"}</span>
              </span>
              <span className="tx-toast__detail">
                {t.status === "pending"
                  ? "processing…"
                  : t.status === "failed"
                    ? friendlyError(t.error ?? "failed")
                    : t.signature
                      ? // `sent` is honest: the rollup took the bytes. Only base
                        // transactions here have actually been confirmed.
                        `${t.status === "confirmed" ? "confirmed" : "sent"} · ${shortSig(t.signature)}`
                      : t.status}
              </span>
            </span>
            {url && (
              <a
                className="tx-toast__link"
                href={url}
                target="_blank"
                rel="noreferrer"
                title="open in explorer"
              >
                <Icon name="external" size={13} />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
