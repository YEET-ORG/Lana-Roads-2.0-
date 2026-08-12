/**
 * Client bootstrap: burner wallet (vertical slice; wallet-standard adapter
 * lands with the full product shell), scoped session key, CrossyClient.
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  BrowserSessionStore,
  CROSSY_WORLD_PROGRAM_ID,
  CrossyClient,
  loadOrCreateSession,
} from "@crossy-world/sdk";

const BASE_RPC = import.meta.env.VITE_RPC ?? "http://localhost:8899";
const BASE_WS = import.meta.env.VITE_WS ?? "ws://localhost:8900";
const ER_RPC = import.meta.env.VITE_ER_RPC ?? BASE_RPC;
const ER_WS = import.meta.env.VITE_ER_WS ?? BASE_WS;
const CLUSTER = import.meta.env.VITE_CLUSTER ?? "local";

export function loadBurnerWallet(): Keypair {
  const key = "crossy-world:wallet";
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)));
    } catch {
      /* rotate below */
    }
  }
  const kp = Keypair.generate();
  localStorage.setItem(key, JSON.stringify([...kp.secretKey]));
  return kp;
}

export interface Bootstrapped {
  client: CrossyClient;
  wallet: Keypair;
  session: Keypair;
  cluster: string;
}

export async function bootstrap(): Promise<Bootstrapped> {
  const wallet = loadBurnerWallet();
  const connection = new Connection(BASE_RPC, {
    wsEndpoint: BASE_WS,
    commitment: "confirmed",
  });
  const erConnection = new Connection(ER_RPC, {
    wsEndpoint: ER_WS,
    commitment: "processed",
  });
  const session = await loadOrCreateSession(new BrowserSessionStore(), {
    program: CROSSY_WORLD_PROGRAM_ID.toBase58(),
    cluster: CLUSTER,
    wallet: wallet.publicKey.toBase58(),
  });
  const client = new CrossyClient({
    connection,
    erConnection,
    wallet: new anchor.Wallet(wallet),
  });
  return { client, wallet, session, cluster: CLUSTER };
}

export async function ensureFunded(b: Bootstrapped): Promise<void> {
  const balance = await b.client.connection.getBalance(b.wallet.publicKey);
  if (balance < 0.05 * LAMPORTS_PER_SOL && CLUSTER !== "mainnet") {
    try {
      const sig = await b.client.connection.requestAirdrop(
        b.wallet.publicKey,
        LAMPORTS_PER_SOL,
      );
      await b.client.connection.confirmTransaction(sig, "confirmed");
    } catch {
      // Faucet unavailable: the UI surfaces the balance instead.
    }
  }
}
