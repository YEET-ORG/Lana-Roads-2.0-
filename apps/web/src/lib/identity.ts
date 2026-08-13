/**
 * Player identity: either a standalone burner keypair (instant guest play)
 * or a game keypair deterministically derived from a connected wallet's
 * signature — so the identity is *tied to the user's wallet* and can be
 * re-derived on any device by signing the same message, while gameplay
 * stays hot-path signed by a local key (zero popups).
 */
import { Keypair } from "@solana/web3.js";

const IDENTITY_KEY = "crossy-world:identity";
const LEGACY_BURNER_KEY = "crossy-world:wallet";

export type Identity =
  | { kind: "burner"; keypair: Keypair }
  | { kind: "adapter"; keypair: Keypair; parent: string };

interface StoredIdentity {
  kind: "burner" | "adapter";
  parent?: string;
  secret: number[];
}

/** The message a wallet signs to derive its game key. Versioned: changing
 * this string rotates every derived identity, so never edit casually. */
export const DERIVATION_MESSAGE =
  "Lana Roads identity v1\n\n" +
  "Signing this message derives your game key from your wallet. " +
  "It does not cost anything and does not authorize any transfer.";

export function loadIdentity(): Identity | null {
  const raw = localStorage.getItem(IDENTITY_KEY);
  if (raw) {
    try {
      const stored = JSON.parse(raw) as StoredIdentity;
      const keypair = Keypair.fromSecretKey(Uint8Array.from(stored.secret));
      if (stored.kind === "adapter" && stored.parent) {
        return { kind: "adapter", keypair, parent: stored.parent };
      }
      return { kind: "burner", keypair };
    } catch {
      /* fall through */
    }
  }
  // Migrate the pre-identity burner so existing testers keep their wallet.
  const legacy = localStorage.getItem(LEGACY_BURNER_KEY);
  if (legacy) {
    try {
      const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(legacy)));
      const identity: Identity = { kind: "burner", keypair };
      persistIdentity(identity);
      return identity;
    } catch {
      /* rotate below */
    }
  }
  return null;
}

export function persistIdentity(identity: Identity) {
  const stored: StoredIdentity = {
    kind: identity.kind,
    parent: identity.kind === "adapter" ? identity.parent : undefined,
    secret: [...identity.keypair.secretKey],
  };
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(stored));
}

export function clearIdentity() {
  localStorage.removeItem(IDENTITY_KEY);
}

export function createBurnerIdentity(): Identity {
  const identity: Identity = { kind: "burner", keypair: Keypair.generate() };
  persistIdentity(identity);
  return identity;
}

/**
 * Derive the game keypair from a wallet signature over the fixed derivation
 * message. Ed25519 signatures are deterministic (RFC 8032), so the same
 * wallet always yields the same game key.
 */
export async function deriveIdentityFromSignature(
  parent: string,
  signature: Uint8Array,
): Promise<Identity> {
  const digest = await crypto.subtle.digest("SHA-256", signature.slice().buffer);
  const seed = new Uint8Array(digest); // 32 bytes
  const keypair = Keypair.fromSeed(seed);
  const identity: Identity = { kind: "adapter", keypair, parent };
  persistIdentity(identity);
  return identity;
}
