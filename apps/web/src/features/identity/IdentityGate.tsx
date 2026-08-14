/**
 * First-run identity chooser: Guest (burner keypair, instant play) or a
 * Solana wallet via wallet-standard adapters. Connecting a wallet derives
 * the game key from a signature, so the identity is portable and tied to
 * the user's wallet while gameplay stays popup-free.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import {
  createBurnerIdentity,
  DERIVATION_MESSAGE,
  deriveIdentityFromSignature,
  Identity,
} from "../../lib/identity";
import { Button, Icon, Loader, Modal, Notice } from "../../design-system";

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
  const connectRequested = useRef(false);

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

  function pickWallet(name: string) {
    setStage("connecting");
    setError(null);
    connectRequested.current = false;
    select(name as never);
  }

  // Drive the connect → sign chain from adapter state, not a polling loop:
  // useWallet() values are only valid per-render, and with autoConnect=false
  // select() alone never opens the wallet — connect() must be requested
  // explicitly once the chosen adapter is in place.
  useEffect(() => {
    if (stage !== "connecting") return;
    if (connected && publicKey) {
      connectRequested.current = false;
      void deriveFromConnected();
      return;
    }
    if (!connectRequested.current) {
      connectRequested.current = true;
      connect().catch((e) => {
        connectRequested.current = false;
        setError(`${(e as Error)?.message ?? e}`.slice(0, 160));
        setStage("wallets");
      });
    }
  }, [stage, connected, publicKey, connect]);

  return (
    <Modal title="Who's hopping?" ariaLabel="Choose how to play">
      {stage === "choose" && (
        <>
          <div className="identity-brand">
            <span className="identity-brand__cube" aria-hidden />
            <span className="identity-brand__word">LANA ROADS</span>
          </div>
          <p className="ds-dim" style={{ marginTop: 0 }}>
            One tap and you're in the world. No crypto knowledge needed.
          </p>
          <div className="identity-options">
            <button
              className="identity-option"
              onClick={() => onReady(createBurnerIdentity())}
            >
              <span className="opt-mark opt-mark--grass">
                <Icon name="user" size={24} />
              </span>
              <span>
                <span className="opt-title">Play as Guest</span>
                <br />
                <span className="opt-sub">
                  Instant play. A local game key is created on this device — top it up
                  or upgrade to a wallet later.
                </span>
              </span>
            </button>
            <button className="identity-option" onClick={() => setStage("wallets")}>
              <span className="opt-mark opt-mark--violet">
                <Icon name="wallet" size={24} />
              </span>
              <span>
                <span className="opt-title">Connect Solana wallet</span>
                <br />
                <span className="opt-sub">
                  One signature derives your game key — identity, record and agents
                  stay tied to your wallet on any device.
                </span>
              </span>
            </button>
          </div>
          <p className="ds-dim" style={{ fontSize: 12, marginBottom: 0 }}>
            Your game key only signs moves. It can never spend USDC or touch NFTs.
          </p>
        </>
      )}

      {stage === "wallets" && (
        <>
          {detected.length === 0 ? (
            <Notice tone="info">
              No Solana wallets detected in this browser. Install Phantom, Solflare or
              Backpack — or play as Guest.
            </Notice>
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
              <Button variant="primary" onClick={deriveFromConnected}>
                Use {publicKey.toBase58().slice(0, 6)}… — sign to derive game key
              </Button>
            </div>
          )}
          {error && (
            <div style={{ marginTop: 12 }}>
              <Notice tone="error">{error}</Notice>
            </div>
          )}
          <div className="row">
            <Button
              variant="ghost"
              onClick={() => {
                setError(null);
                void disconnect().catch(() => {});
                setStage("choose");
              }}
            >
              Back
            </Button>
          </div>
        </>
      )}

      {stage === "connecting" && <Loader label="Connecting wallet…" />}
      {stage === "signing" && (
        <Loader label="Approve the signature request in your wallet…" />
      )}
    </Modal>
  );
}
