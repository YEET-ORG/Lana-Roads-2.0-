import { useEffect, useState } from "react";
import { bootstrap, Bootstrapped, ensureFunded } from "../lib/client";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Home } from "../features/home/Home";
import { GameScreen } from "../features/game/GameScreen";
import { WorldMode } from "@crossy-world/sdk";

export type Route =
  | { name: "home" }
  | {
      name: "play";
      mode: WorldMode;
      day: bigint;
      attemptNonce: number;
      receiptNonce: number;
    };

export function App() {
  const [boot, setBoot] = useState<Bootstrapped | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [balance, setBalance] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    bootstrap()
      .then(async (b) => {
        await ensureFunded(b);
        if (live) setBoot(b);
      })
      .catch((e) => live && setError(`${e}`));
    return () => {
      live = false;
    };
  }, []);

  // Burner balance poll: the header shows funding state so testers know to
  // top the burner up when faucets are rate-limited.
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

  if (error) return <div className="shell error">Failed to connect: {error}</div>;
  if (!boot) return <div className="shell">Connecting…</div>;

  return (
    <div className="shell">
      <header>
        <h1 onClick={() => setRoute({ name: "home" })}>🐔 Crossy World</h1>
        <span
          className="wallet"
          title="click to copy the burner address"
          onClick={() => {
            navigator.clipboard?.writeText(boot.wallet.publicKey.toBase58());
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "copied!" : `${boot.wallet.publicKey.toBase58().slice(0, 8)}…`}
          {balance != null && ` · ${balance.toFixed(3)} SOL`}
        </span>
      </header>
      {balance != null && balance < 0.01 && (
        <div className="banner">
          Burner wallet needs devnet SOL to play (~0.02). Click the address above to
          copy it, then fund it from{" "}
          <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">
            faucet.solana.com
          </a>{" "}
          or any devnet wallet: <code>{boot.wallet.publicKey.toBase58()}</code>
        </div>
      )}
      {route.name === "home" && <Home boot={boot} onPlay={(r) => setRoute(r)} />}
      {route.name === "play" && (
        <GameScreen boot={boot} route={route} onExit={() => setRoute({ name: "home" })} />
      )}
    </div>
  );
}
