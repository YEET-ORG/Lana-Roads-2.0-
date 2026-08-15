/**
 * Centralized PDA derivation. Every address the program derives has exactly
 * one client-side counterpart here — no hand-copied offsets elsewhere.
 */
import { PublicKey } from "@solana/web3.js";
import {
  CROSSY_WORLD_PROGRAM_ID,
  ReceiptKind,
  SECTOR_EDGE,
  SEEDS,
  WorldMode,
} from "./constants.js";

const le16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const le32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const le64 = (n: bigint | number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

const find = (seeds: (Buffer | Uint8Array)[], programId = CROSSY_WORLD_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(seeds as Buffer[], programId)[0];

export const pda = {
  config: () => find([SEEDS.config]),
  season: (seasonIndex: number) => find([SEEDS.season, le16(seasonIndex)]),
  banner: (seasonIndex: number, tier: number) =>
    find([SEEDS.banner, le16(seasonIndex), Buffer.from([tier])]),
  variant: (seasonIndex: number, variantId: number) =>
    find([SEEDS.variant, le16(seasonIndex), le16(variantId)]),
  rarityPool: (seasonIndex: number, rarity: number) =>
    find([SEEDS.rarityPool, le16(seasonIndex), Buffer.from([rarity])]),
  classConfig: (classId: number, version: number) =>
    find([SEEDS.class, le16(classId), le16(version)]),
  profile: (wallet: PublicKey) => find([SEEDS.player, wallet.toBuffer()]),
  identity: (wallet: PublicKey) => find([SEEDS.identity, wallet.toBuffer()]),
  pull: (wallet: PublicKey, pullNonce: number) =>
    find([SEEDS.pull, wallet.toBuffer(), le32(pullNonce)]),
  daily: (day: bigint | number) => find([SEEDS.daily, le64(day)]),
  dailyVaultAuthority: (day: bigint | number) => find([SEEDS.dailyVault, le64(day)]),
  dailyVault: (day: bigint | number) =>
    find([SEEDS.dailyVault, le64(day), Buffer.from("ata")]),
  contribution: (day: bigint | number, wallet: PublicKey) =>
    find([SEEDS.contribution, le64(day), wallet.toBuffer()]),
  receipt: (
    kind: ReceiptKind,
    day: bigint | number,
    wallet: PublicKey,
    receiptNonce: number,
  ) =>
    find([
      SEEDS.payment,
      Buffer.from([kind]),
      le64(day),
      wallet.toBuffer(),
      le32(receiptNonce),
    ]),
  agentLock: (world: PublicKey, wallet: PublicKey, attemptNonce: number) =>
    find([SEEDS.agentLock, world.toBuffer(), wallet.toBuffer(), le32(attemptNonce)]),
  assetMap: (asset: PublicKey) => find([SEEDS.assetMap, asset.toBuffer()]),
  listing: (asset: PublicKey) => find([SEEDS.listing, asset.toBuffer()]),
  world: (mode: WorldMode, day: bigint | number) =>
    find([SEEDS.world, Buffer.from([mode]), le64(day)]),
  chunk: (day: bigint | number, chunkIndex: number) =>
    find([SEEDS.chunk, le64(day), le32(chunkIndex)]),
  sector: (world: PublicKey, sectorX: number, sectorY: number) =>
    find([SEEDS.sector, world.toBuffer(), Buffer.from([sectorX]), le32(sectorY)]),
  run: (world: PublicKey, wallet: PublicKey) =>
    find([SEEDS.run, world.toBuffer(), wallet.toBuffer()]),
  best: (world: PublicKey, wallet: PublicKey) =>
    find([SEEDS.best, world.toBuffer(), wallet.toBuffer()]),
  gachaVault: () => find([SEEDS.gachaVault]),
  gachaVaultAuthority: () => find([SEEDS.gachaVaultAuthority]),
  mintAuthority: () => find([SEEDS.mintAuthority]),
  freezeAuthority: () => find([SEEDS.freezeAuthority]),
};

/** Sector coordinates covering a tile. */
export function sectorOf(x: number, y: number): [number, number] {
  return [Math.floor(x / SECTOR_EDGE), Math.floor(y / SECTOR_EDGE)];
}

/** Bit index of a tile inside its 8x8 sector bitset. */
export function sectorBit(x: number, y: number): number {
  return (y % SECTOR_EDGE) * SECTOR_EDGE + (x % SECTOR_EDGE);
}

/** The sector account covering a tile. */
export function sectorForTile(world: PublicKey, x: number, y: number): PublicKey {
  const [sx, sy] = sectorOf(x, y);
  return pda.sector(world, sx, sy);
}

/** All 16 spawn-zone sectors in canonical order (sy 0..2, sx 0..8). */
export function spawnSectors(world: PublicKey): PublicKey[] {
  const out: PublicKey[] = [];
  for (let sy = 0; sy < 2; sy++)
    for (let sx = 0; sx < 8; sx++) out.push(pda.sector(world, sx, sy));
  return out;
}
