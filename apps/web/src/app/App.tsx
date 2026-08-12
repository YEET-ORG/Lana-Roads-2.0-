import { useEffect, useState } from "react";
import { bootstrap, Bootstrapped, ensureFunded } from "../lib/client";
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

  if (error) return <div className="shell error">Failed to connect: {error}</div>;
  if (!boot) return <div className="shell">Connecting…</div>;

  return (
    <div className="shell">
      <header>
        <h1 onClick={() => setRoute({ name: "home" })}>🐔 Crossy World</h1>
        <span className="wallet">{boot.wallet.publicKey.toBase58().slice(0, 8)}…</span>
      </header>
      {route.name === "home" && <Home boot={boot} onPlay={(r) => setRoute(r)} />}
      {route.name === "play" && (
        <GameScreen boot={boot} route={route} onExit={() => setRoute({ name: "home" })} />
      )}
    </div>
  );
}
