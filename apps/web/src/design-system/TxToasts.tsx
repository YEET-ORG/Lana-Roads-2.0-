/**
 * Transaction toasts, bottom-right.
 *
 * Every signature this client produces passes through here. The hard part is
 * volume, not display: a player hops several times a second and each hop is
 * its own rollup transaction. Three modes cover the range of taste —
 *
 *   stack   up to five receipts, newest at the bottom (default)
 *   single  one rolling line that the newest action replaces
 *   off     nothing at all
 *
 * — and in every mode, upkeep the player never asked for (the hazard crank)
 * stays hidden, while a failure is always promoted out of the quiet lane,
 * because a refused move is the one thing they must be told about.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { CrossyClient, TxActivity } from "@crossy-world/sdk";
import { Icon } from "./icons";
import { ER_RPC, CLUSTER } from "../lib/client";
import { useSettings } from "../lib/settings";

/** How long a resolved toast stays up, by how much it matters. */
const LINGER_MS = { failed: 9_000, quiet: 2_400, normal: 4_500 };
/** A stack this deep still reads at a glance; deeper is a log, not a HUD. */
const MAX_STACK = 5;
/** The single slot every quiet gameplay transaction shares. */
const QUIET_SLOT = -1;

interface Toast extends TxActivity {
  /** Slot key: quiet transactions all share one, so they replace in place. */
  slot: number;
  /** Bumped on every update so the entry can re-play its pulse. */
  beat: number;
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
    [/TooFast/, "one hop per rollup slot"],
    [/BadActionSequence/, "out of order — resending"],
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
  const { toasts: mode, reduceMotion } = useSettings();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, number>());
  const beat = useRef(0);

  useEffect(() => {
    if (!client || mode === "off") {
      setToasts([]);
      return;
    }
    const pending = timers.current;
    const drop = (slot: number) =>
      setToasts((list) => list.filter((t) => t.slot !== slot));

    const schedule = (slot: number, ms: number) => {
      window.clearTimeout(pending.get(slot));
      pending.set(
        slot,
        window.setTimeout(() => drop(slot), ms),
      );
    };

    const off = client.onTx((a) => {
      // Upkeep the player never asked for stays out of sight entirely,
      // failures included — a refused hazard crank means someone else got
      // there first, which is the system working.
      if (a.background) return;
      // In single mode everything shares one slot, so the strip never grows.
      const collapse = mode === "single" || (a.quiet && a.status !== "failed");
      const slot = collapse ? QUIET_SLOT : a.id;
      const toast: Toast = { ...a, slot, beat: ++beat.current };
      setToasts((list) => {
        const without = list.filter((t) => t.slot !== slot);
        return [...without, toast].slice(mode === "single" ? -1 : -MAX_STACK);
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

    return () => {
      off();
      for (const id of pending.values()) window.clearTimeout(id);
      pending.clear();
    };
  }, [client, mode]);

  if (mode === "off" || !toasts.length) return null;

  return (
    <div
      className={`tx-toasts${reduceMotion ? " tx-toasts--still" : ""}`}
      aria-live="polite"
    >
      {toasts.map((t, i) => {
        const url = explorerUrl(t);
        // Older entries sit further back — a touch smaller and dimmer — so
        // the newest receipt is always the one the eye lands on.
        const depth = toasts.length - 1 - i;
        return (
          <div
            // Keyed by SLOT, not id: the quiet lane is one element that
            // updates in place, so a fast player does not restage the
            // entrance animation on every hop.
            key={t.slot}
            className={`tx-toast tx-toast--${t.status}`}
            style={{ "--depth": depth } as CSSProperties}
          >
            {/* Keyed by beat so the badge re-pops whenever the state moves. */}
            <span className="tx-toast__icon" key={t.beat}>
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
