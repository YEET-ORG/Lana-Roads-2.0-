/**
 * First-run identity chooser: Guest (burner keypair, instant play) or a
 * Solana wallet via wallet-standard adapters. Connecting a wallet derives
 * the game key from a signature, so the identity is portable and tied to
 * the user's wallet while gameplay stays popup-free.
 */
import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import {
  createBurnerIdentity,
  DERIVATION_MESSAGE,
  deriveIdentityFromSignature,
  Identity,
} from "../../lib/identity";

export function IdentityGate({ onReady }: { onReady: (identity: Identity) => void }) {
  const {
    wallets,
    select,
    connect,
    disconnect,
    signMessage,
    publicKey,
    wallet,
    connected,
  } = useWallet();
  const [stage, setStage] = useState<"choose" | "wallets" | "connecting" | "signing">(
    "choose",
  );
  const [error, setError] = useState<string | null>(null);

  const detected = useMemo(
    () =>
      wallets.filter(
        (w) =>
          w.readyState === WalletReadyState.Installed ||
          w.readyState === WalletReadyState.Loadable,
      ),
    [wallets],
  );

  async function deriveFromConnected() {
    setStage("signing");
    setError(null);
    try {
      if (!publicKey) throw new Error("wallet not connected");
      if (!signMessage) {
        throw new Error(
          `${wallet?.adapter.name ?? "This wallet"} cannot sign messages — use Guest mode instead`,
        );
      }
      const signature = await signMessage(new TextEncoder().encode(DERIVATION_MESSAGE));
      const identity = await deriveIdentityFromSignature(publicKey.toBase58(), signature);
      onReady(identity);
    } catch (e) {
      setError(`${(e as Error).message ?? e}`.slice(0, 160));
      setStage("wallets");
    }
  }

  async function pickWallet(name: string) {
    setStage("connecting");
    setError(null);
    try {
      // select() is async under the hood; connect once the adapter flips.
      select(name as never);
      // The adapter connects on select in recent versions; if not, connect().
      for (let i = 0; i < 50 && !connected; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (connected) break;
        if (i === 5) await connect().catch(() => {});
      }
      await deriveFromConnected();
    } catch (e) {
      setError(`${(e as Error).message ?? e}`.slice(0, 160));
      setStage("wallets");
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal card">
        <h2>Who's hopping?</h2>
        {stage === "choose" && (
          <div className="identity-options">
            <button
              className="identity-option"
              onClick={() => onReady(createBurnerIdentity())}
            >
              <span className="identity-mark burner">G</span>
              <span>
                <span className="opt-title">Guest — burner wallet</span>
                <br />
                <span className="opt-sub">
                  Instant play. A local key is created on this device; you can top it up
                  or upgrade to a wallet later.
                </span>
              </span>
            </button>
            <button className="identity-option" onClick={() => setStage("wallets")}>
              <span className="identity-mark adapter">S</span>
              <span>
                <span className="opt-title">Connect Solana wallet</span>
                <br />
                <span className="opt-sub">
                  One signature derives your game key — your identity, record and agents
                  stay tied to your wallet on any device.
                </span>
              </span>
            </button>
          </div>
        )}

        {stage === "wallets" && (
          <>
            {detected.length === 0 ? (
              <p className="dim">
                No Solana wallets detected in this browser. Install Phantom, Solflare or
                Backpack — or play as Guest.
              </p>
            ) : (
              <div className="identity-options">
                {detected.map((w) => (
                  <button
                    key={w.adapter.name}
                    className="identity-option"
                    onClick={() => pickWallet(w.adapter.name)}
                  >
                    <img
                      src={w.adapter.icon}
                      alt=""
                      width={40}
                      height={40}
                      style={{ borderRadius: 10 }}
                    />
                    <span className="opt-title">{w.adapter.name}</span>
                  </button>
                ))}
              </div>
            )}
            {connected && publicKey && (
              <div className="row">
                <button className="primary" onClick={deriveFromConnected}>
                  Use {publicKey.toBase58().slice(0, 6)}… — sign to derive game key
                </button>
              </div>
            )}
            {error && <p className="error">{error}</p>}
            <div className="row">
              <button
                className="ghost"
                onClick={() => {
                  setError(null);
                  void disconnect().catch(() => {});
                  setStage("choose");
                }}
              >
                Back
              </button>
            </div>
          </>
        )}

        {stage === "connecting" && <p>Connecting wallet…</p>}
        {stage === "signing" && <p>Approve the signature request in your wallet…</p>}
      </div>
    </div>
  );
}
