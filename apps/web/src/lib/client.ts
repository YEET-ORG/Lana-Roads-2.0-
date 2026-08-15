/**
 * Client bootstrap: burner wallet (vertical slice; wallet-standard adapter
 * lands with the full product shell), scoped session key, CrossyClient.
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { getSettings } from "./settings";
import { DEFAULT_REGION, detectRegion, regionById } from "./regions";
import {
  BrowserSessionStore,
  CROSSY_WORLD_PROGRAM_ID,
  CrossyClient,
  loadOrCreateSession,
} from "@crossy-world/sdk";

export const BASE_RPC = import.meta.env.VITE_RPC ?? "http://localhost:8899";
const BASE_WS = import.meta.env.VITE_WS ?? "ws://localhost:8900";
export const ER_RPC = import.meta.env.VITE_ER_RPC ?? BASE_RPC;
const ER_WS = import.meta.env.VITE_ER_WS ?? BASE_WS;
export const CLUSTER = import.meta.env.VITE_CLUSTER ?? "local";
const ROUTER =
  import.meta.env.VITE_ROUTER ??
  (CLUSTER === "devnet" ? "https://devnet-router.magicblock.app" : undefined);
/** ER validator identity (pins delegation). Defaults to MagicBlock devnet-as. */
const VALIDATOR = import.meta.env.VITE_VALIDATOR
  ? new PublicKey(import.meta.env.VITE_VALIDATOR)
  : CLUSTER === "devnet"
    ? new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57")
    : undefined;

/**
 * Browser-safe keypair wallet: anchor's `Wallet` (NodeWallet) is not
 * exported in the browser bundle, so the provider gets this thin adapter.
 */
export class KeypairWallet {
  constructor(readonly payer: Keypair) {}
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if ("partialSign" in tx) tx.partialSign(this.payer);
    else tx.sign([this.payer]);
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    for (const tx of txs) await this.signTransaction(tx);
    return txs;
  }
}

export interface Bootstrapped {
  client: CrossyClient;
  wallet: Keypair;
  session: Keypair;
  cluster: string;
  /** The rollup region this session is playing in. */
  region: number;
}

/** Build the game client around the resolved identity keypair (burner or
 * wallet-derived — see lib/identity.ts). */
export async function bootstrap(wallet: Keypair): Promise<Bootstrapped> {
  const connection = new Connection(BASE_RPC, {
    wsEndpoint: BASE_WS,
    commitment: "confirmed",
  });
  // Which region — and therefore which world, pot and player pool. "auto"
  // measures the round trip to each rollup and takes the nearest; anything
  // else is the player pinning a region on purpose, which is allowed and
  // means playing with the people there rather than the people near them.
  const setting = getSettings().region;
  const regionId =
    setting === "auto"
      ? await detectRegion().catch(() => DEFAULT_REGION)
      : (Number(setting) ?? DEFAULT_REGION);
  const region = regionById(Number.isFinite(regionId) ? regionId : DEFAULT_REGION);
  // On devnet the region's own rollup is authoritative for its world. A local
  // cluster has one node and no directory, so the build's endpoint stands.
  const erUrl = CLUSTER === "devnet" ? region.fqdn : ER_RPC;
  const erConnection = new Connection(erUrl, {
    wsEndpoint: CLUSTER === "devnet" ? erUrl.replace(/^http/, "ws") : ER_WS,
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
    // The world for this region is delegated to this region's validator, so
    // pin it rather than letting the router resolve to whichever rollup
    // happens to answer.
    validator:
      CLUSTER === "devnet" ? new PublicKey(region.validator) : VALIDATOR,
    routerUrl: ROUTER,
    region: region.id,
    wallet: new KeypairWallet(wallet),
  });
  return { client, wallet, session, cluster: CLUSTER, region: region.id };
}

export async function ensureFunded(b: Bootstrapped): Promise<void> {
  try {
    const balance = await b.client.connection.getBalance(b.wallet.publicKey);
    if (balance < 0.05 * LAMPORTS_PER_SOL && CLUSTER !== "mainnet") {
      const sig = await b.client.connection.requestAirdrop(
        b.wallet.publicKey,
        LAMPORTS_PER_SOL,
      );
      await b.client.connection.confirmTransaction(sig, "confirmed");
    }
  } catch {
    // RPC or faucet unavailable: never fatal — the UI surfaces balance
    // state, and offline practice stays reachable regardless.
  }
}
