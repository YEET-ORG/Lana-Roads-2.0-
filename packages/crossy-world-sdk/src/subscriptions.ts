/**
 * Subscription hub: one underlying websocket subscription per account per
 * connection, multiplexed to listeners. First listener creates it, removing
 * the last listener tears it down (the solsocket listener-leak pattern is
 * explicitly not carried forward). Sequence gaps are the caller's signal to
 * refetch.
 */
import { AccountInfo, Connection, PublicKey } from "@solana/web3.js";

type Listener = (info: AccountInfo<Buffer>, slot: number) => void;

interface Entry {
  subId: number;
  listeners: Set<Listener>;
}

export class SubscriptionHub {
  private entries = new Map<string, Entry>();

  constructor(private connection: Connection) {}

  /** Subscribe to account changes; returns an idempotent unsubscribe. */
  onAccount(address: PublicKey, listener: Listener): () => void {
    const key = address.toBase58();
    let entry = this.entries.get(key);
    if (!entry) {
      const listeners = new Set<Listener>();
      const subId = this.connection.onAccountChange(
        address,
        (info, ctx) => {
          for (const l of listeners) {
            try {
              l(info as AccountInfo<Buffer>, ctx.slot);
            } catch {
              // Listener exceptions are isolated.
            }
          }
        },
        { commitment: "processed" },
      );
      entry = { subId, listeners };
      this.entries.set(key, entry);
    }
    entry.listeners.add(listener);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const e = this.entries.get(key);
      if (!e) return;
      e.listeners.delete(listener);
      if (e.listeners.size === 0) {
        this.entries.delete(key);
        void this.connection.removeAccountChangeListener(e.subId);
      }
    };
  }

  /** Release every subscription (world close / wallet change). */
  async close(): Promise<void> {
    const ids = [...this.entries.values()].map((e) => e.subId);
    this.entries.clear();
    await Promise.allSettled(
      ids.map((id) => this.connection.removeAccountChangeListener(id)),
    );
  }
}
