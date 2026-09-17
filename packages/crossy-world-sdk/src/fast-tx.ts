/**
 * Hot-path signing for session-signed ER transactions.
 *
 * web3.js v1's `Transaction.sign` falls back to a bundled tweetnacl, and
 * `serialize()` verifies every signature with it by default. On the gameplay
 * path that is ~3ms of pure client work per action — all of it verification
 * the rollup repeats anyway. Sign the message with `@noble/curves` instead
 * (web3.js's own curve dependency, identical signature format) and serialize
 * without the redundant client-side check.
 */
import { ed25519 } from "@noble/curves/ed25519";
import type { Keypair, Transaction } from "@solana/web3.js";

/**
 * Sign every signer with ed25519 and return the wire transaction.
 *
 * Signers may be any local keypair (the session key on the gameplay path);
 * interactive wallet signers cannot use this. Every account the message marks
 * as a signer must be covered, so a forgotten key fails here rather than on
 * the rollup.
 */
export function signHotTransaction(tx: Transaction, signers: Keypair[]): Buffer {
  const message = tx.serializeMessage();
  for (const signer of signers) {
    const signature = ed25519.sign(message, signer.secretKey.slice(0, 32));
    tx.addSignature(signer.publicKey, Buffer.from(signature));
  }
  const compiled = tx.compileMessage();
  const signerKeys = compiled.accountKeys.slice(0, compiled.header.numRequiredSignatures);
  for (const pubkey of signerKeys) {
    if (!tx.signatures.some((s) => s.publicKey.equals(pubkey) && s.signature !== null)) {
      throw new Error(`missing signature for ${pubkey.toBase58()}`);
    }
  }
  return tx.serialize({ verifySignatures: false });
}
