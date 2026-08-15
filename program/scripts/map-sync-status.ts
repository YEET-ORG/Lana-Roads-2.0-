/**
 * Read-only live map synchronization probe.
 *
 * Confirms that the router-selected ER owns the live world while immutable
 * chunks remain readable from base. It intentionally sends no transaction.
 *
 *   pnpm --dir program status:map-sync
 *   MODE=0 DAY=20680 pnpm --dir program status:map-sync
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import {
  CrossyClient,
  pda,
  WorldMode,
} from "../../packages/crossy-world-sdk/src/index.js";

const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
const ROUTER_RPC = process.env.ROUTER_RPC ?? "https://devnet-router.magicblock.app/";
const FALLBACK_ER = process.env.ER_RPC ?? "https://devnet-as.magicblock.app";
const REPEATS = Number(process.env.REPEATS ?? 1);

async function main() {
  const day = BigInt(process.env.DAY ?? Math.floor(Date.now() / 1000 / 86400));
  const mode = Number(process.env.MODE ?? WorldMode.Casual) as WorldMode;
  const world = pda.world(mode, day);
  const chunk0 = pda.chunk(day, 0);
  const base = new Connection(BASE_RPC, "confirmed");

  const response = await fetch(ROUTER_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getDelegationStatus",
      params: [world.toBase58()],
    }),
  });
  const body = (await response.json()) as {
    result?: { isDelegated: boolean; fqdn?: string; delegationRecord?: unknown };
    error?: { message?: string };
  };
  if (body.error) throw new Error(body.error.message ?? "router request failed");
  const erRpc = body.result?.fqdn?.replace(/\/$/, "") ?? FALLBACK_ER;
  const er = new Connection(erRpc, "processed");
  const probe = Keypair.generate();
  const client = new CrossyClient({
    connection: base,
    erConnection: er,
    routerUrl: ROUTER_RPC,
    wallet: new anchor.Wallet(probe),
  });
  await client.resolveErForWorld(world);
  const header = await client.getWorld(mode, day);
  const chunkCount = Math.ceil(header.revealedRows / 16);
  const snapshots: Array<{ attempt: number; missing: number[] }> = [];
  for (let attempt = 1; attempt <= REPEATS; attempt++) {
    const chunks = await client.getChunks(day, 0, chunkCount);
    snapshots.push({
      attempt,
      missing: chunks
        .map((chunk, index) => (chunk == null ? index : -1))
        .filter((index) => index >= 0),
    });
  }
  const [baseWorld, erWorld, baseChunk, erChunk] = await Promise.all([
    base.getAccountInfo(world),
    er.getAccountInfo(world),
    base.getAccountInfo(chunk0),
    er.getAccountInfo(chunk0),
  ]);

  console.log(
    JSON.stringify(
      {
        day: day.toString(),
        mode,
        world: world.toBase58(),
        router: body.result,
        erRpc,
        revealedRows: header.revealedRows,
        chunkCount,
        snapshots,
        present: {
          worldOnBase: baseWorld != null,
          worldOnEr: erWorld != null,
          chunk0OnBase: baseChunk != null,
          chunk0OnEr: erChunk != null,
        },
      },
      null,
      2,
    ),
  );
  await client.close();
  if (snapshots.some(({ missing }) => missing.length > 0)) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
