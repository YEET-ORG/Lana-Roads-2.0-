/**
 * Session key management. Scope is (program, cluster, wallet) — never one
 * origin-global key. Session keys sign gameplay only; they can never move
 * USDC or NFTs, and losing one is recovered by wallet-signed rotation.
 */
import { Keypair, PublicKey } from "@solana/web3.js";

export interface SessionScope {
  program: string;
  cluster: string;
  wallet: string;
}

export interface SessionStore {
  load(scope: SessionScope): Promise<Keypair | null>;
  save(scope: SessionScope, key: Keypair): Promise<void>;
  remove(scope: SessionScope): Promise<void>;
}

const scopeKey = (s: SessionScope) =>
  `crossy-world:session:${s.program}:${s.cluster}:${s.wallet}`;

/** Browser localStorage store; corruption and unavailability fail safe. */
export class BrowserSessionStore implements SessionStore {
  async load(scope: SessionScope): Promise<Keypair | null> {
    try {
      const raw = globalThis.localStorage?.getItem(scopeKey(scope));
      if (!raw) return null;
      const bytes = Uint8Array.from(JSON.parse(raw));
      if (bytes.length !== 64) return null;
      return Keypair.fromSecretKey(bytes);
    } catch {
      return null;
    }
  }
  async save(scope: SessionScope, key: Keypair): Promise<void> {
    try {
      globalThis.localStorage?.setItem(
        scopeKey(scope),
        JSON.stringify(Array.from(key.secretKey)),
      );
    } catch {
      // Storage unavailable: session stays in memory for this page load.
    }
  }
  async remove(scope: SessionScope): Promise<void> {
    try {
      globalThis.localStorage?.removeItem(scopeKey(scope));
    } catch {
      /* ignore */
    }
  }
}

/** Explicit in-memory store for Node/test callers. */
export class MemorySessionStore implements SessionStore {
  private map = new Map<string, Uint8Array>();
  async load(scope: SessionScope): Promise<Keypair | null> {
    const bytes = this.map.get(scopeKey(scope));
    return bytes ? Keypair.fromSecretKey(bytes) : null;
  }
  async save(scope: SessionScope, key: Keypair): Promise<void> {
    this.map.set(scopeKey(scope), key.secretKey);
  }
  async remove(scope: SessionScope): Promise<void> {
    this.map.delete(scopeKey(scope));
  }
}

/** Load-or-create a session key for the scope. */
export async function loadOrCreateSession(
  store: SessionStore,
  scope: SessionScope,
): Promise<Keypair> {
  const existing = await store.load(scope);
  if (existing) return existing;
  const fresh = Keypair.generate();
  await store.save(scope, fresh);
  return fresh;
}

export function sessionMatches(session: Keypair, authority: PublicKey): boolean {
  return session.publicKey.equals(authority);
}
