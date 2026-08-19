import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Tracked IDL used by both the browser SDK and clean production workers. */
export const DEFAULT_CROSSY_WORLD_IDL = resolve(
  __dirname,
  "../../packages/crossy-world-sdk/src/generated/crossy_world.json",
);

export function loadCrossyWorldIdl(expectedProgramId: string): any {
  const path = process.env.CROSSY_WORLD_IDL ?? DEFAULT_CROSSY_WORLD_IDL;
  const idl = JSON.parse(readFileSync(path, "utf8"));
  if (idl.address !== expectedProgramId) {
    throw new Error(
      `IDL program ${idl.address} does not match expected ${expectedProgramId}`,
    );
  }
  return idl;
}

/**
 * Read-only JSON-RPC methods, which may be retried safely.
 *
 * `sendTransaction` is deliberately absent: a request that times out may
 * still have been delivered, and resending it would submit the transaction
 * twice. Every write in this repo is `init`-guarded, so the duplicate would
 * fail with "already in use" and abort a setup that had in fact succeeded.
 */
const RETRYABLE_RPC = /^(get|is|minimumLedgerSlot|simulateTransaction)/;

/**
 * A `fetch` for `web3.Connection` that survives a throttled public RPC.
 *
 * `https://api.devnet.solana.com` regularly closes the socket mid-request or
 * stops answering headers altogether. Undici surfaces that as a thrown
 * `TypeError: fetch failed`, which aborts whatever the script was doing —
 * so a day-open would die halfway through, having created some accounts and
 * delegated none, and the next attempt started from a half-built day.
 *
 * Reads are retried with backoff; writes are passed straight through.
 */
export function retryingFetch(opts: { tries?: number; timeoutMs?: number } = {}) {
  const tries = opts.tries ?? 5;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  return async (input: any, init?: any): Promise<any> => {
    let method = "";
    try {
      method = JSON.parse(String(init?.body ?? "{}"))?.method ?? "";
    } catch {
      /* batch or non-JSON body: treated as a write, i.e. never retried */
    }
    const retryable = RETRYABLE_RPC.test(method);
    let lastError: unknown;
    for (let attempt = 0; attempt < (retryable ? tries : 1); attempt++) {
      // Each attempt gets its own deadline: without one, a stalled request
      // waits on undici's default and the retry never happens in time.
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      try {
        const res = await fetch(input, { ...init, signal: abort.signal });
        // 429 is the common one; a 5xx from the load balancer behaves the same.
        if (retryable && (res.status === 429 || res.status >= 500)) {
          lastError = new Error(`RPC ${method} returned ${res.status}`);
        } else {
          return res;
        }
      } catch (e) {
        lastError = e;
      } finally {
        clearTimeout(timer);
      }
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
    throw lastError;
  };
}
