import { useEffect, useMemo, useState } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WorldMode } from "@crossy-world/sdk";
import { BASE_RPC, bootstrap, Bootstrapped, ensureFunded } from "../lib/client";
import { clearIdentity, Identity, loadIdentity } from "../lib/identity";
import { preloadAssets } from "../game/renderer/assets";
import { Home } from "../features/home/Home";
import { GameScreen } from "../features/game/GameScreen";
import { IdentityGate } from "../features/identity/IdentityGate";
import { DemoScreen } from "../features/demo/DemoScreen";
import { AgentGallery } from "../features/demo/AgentGallery";
import { sfx } from "../game/audio";

export type Route =
  | { name: "home" }
  | { name: "demo" }
  | {
      name: "play";
      mode: WorldMode;
      day: bigint;
      attemptNonce: number;
      receiptNonce: number;
    };

export function App() {
  // Wallet-standard wallets self-register; no per-wallet adapter packages.
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider
      endpoint={BASE_RPC.startsWith("http") ? BASE_RPC : "http://localhost:8899"}
    >
      <WalletProvider wallets={wallets} autoConnect={false}>
        <AppInner />
      </WalletProvider>
    </ConnectionProvider>
  );
}

function AppInner() {
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity());
  const [boot, setBoot] = useState<Bootstrapped | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(() =>
    new URLSearchParams(window.location.search).has("demo")
      ? { name: "demo" }
      : { name: "home" },
  );
  const showGallery = new URLSearchParams(window.location.search).has("agents");
  const [balance, setBalance] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  // Models download while the player is still reading the menu.
  useEffect(() => {
    void preloadAssets();
  }, []);

  // Every button press ticks (game-feel: nothing is silent).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest("button")) sfx.click();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  useEffect(() => {
    if (!identity) return;
    let live = true;
    setBoot(null);
    bootstrap(identity.keypair)
      .then(async (b) => {
        await ensureFunded(b);
        if (live) setBoot(b);
      })
      .catch((e) => live && setError(`${e}`));
    return () => {
      live = false;
    };
  }, [identity]);

  // Game-key balance poll: the header shows funding state so players know
  // when to top up (faucets rate-limit on devnet).
  useEffect(() => {
    if (!boot) return;
    let live = true;
    const tick = async () => {
      const lamports = await boot.client.connection
        .getBalance(boot.wallet.publicKey)
        .catch(() => null);
      if (live && lamports != null) setBalance(lamports / LAMPORTS_PER_SOL);
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [boot]);

  if (showGallery) return <AgentGallery />;
  // Practice mode needs no cluster and no identity — always reachable.
  if (route.name === "demo")
    return <DemoScreen onExit={() => setRoute({ name: "home" })} />;
  if (!identity) return <IdentityGate onReady={setIdentity} />;
  if (!boot && !error)
    return (
      <div className="splash">
        <h1>LANA ROADS</h1>
        <div className="splash-cube" />
        <p>hopping in…</p>
      </div>
    );

  const gameAddress = boot?.wallet.publicKey.toBase58() ?? "";

  return (
    <div className={`shell ${route.name === "home" ? "shell-home" : ""}`}>
      <header>
        <h1 onClick={() => setRoute({ name: "home" })}>LANA ROADS</h1>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {identity.kind === "adapter" && (
            <span className="wallet" title="identity derived from this wallet">
              {identity.parent.slice(0, 4)}…{identity.parent.slice(-4)}
            </span>
          )}
          {gameAddress && (
            <span
              className="wallet"
              title="game key — click to copy"
              onClick={() => {
                navigator.clipboard?.writeText(gameAddress);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "copied!" : `${gameAddress.slice(0, 8)}…`}
              {balance != null && ` · ${balance.toFixed(3)} SOL`}
            </span>
          )}
          <button
            className="ghost"
            style={{ minHeight: 34, padding: "6px 12px", fontSize: 13 }}
            title="switch identity"
            onClick={() => {
              clearIdentity();
              setIdentity(null);
              setBoot(null);
              setRoute({ name: "home" });
            }}
          >
            Switch
          </button>
        </span>
      </header>
      {boot && balance != null && balance < 0.01 && (
        <div className="banner floating">
          Your game key needs devnet SOL to play (~0.02). Click the address above to copy
          it, then fund it from{" "}
          <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">
            faucet.solana.com
          </a>{" "}
          or any devnet wallet: <code>{gameAddress}</code>
        </div>
      )}
      {route.name === "home" && <Home boot={boot} onPlay={(r) => setRoute(r)} />}
      {route.name === "play" && boot && (
        <GameScreen boot={boot} route={route} onExit={() => setRoute({ name: "home" })} />
      )}
    </div>
  );
}
