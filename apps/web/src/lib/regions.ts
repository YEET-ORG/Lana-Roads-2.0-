/**
 * Rollup regions.
 *
 * A world is delegated to exactly one MagicBlock validator, and that
 * validator sits in one physical place. A single global world therefore
 * charges every distant player a permanent tax — measured from this machine:
 * 101 ms to Singapore, 228 ms to the US, 284 ms to Frankfurt, against a 50 ms
 * slot time. No amount of client work removes that; only running the world
 * closer does.
 *
 * So a region is not a preference layered over one shared game. It selects
 * WHICH world you are in — your player pool, your record, and for paid days
 * your prize pot. That is the trade the split makes: everyone gets a
 * responsive world, and each world has fewer people in it.
 *
 * The ids here are the region bytes in the program's PDA seeds, so they are
 * permanent for a deployment. Never renumber them; add to the end.
 */
export interface RegionInfo {
  id: number;
  key: string;
  label: string;
  /** Where the rollup runs, for the player rather than for the code. */
  place: string;
  fqdn: string;
  validator: string;
  /**
   * Whether players may be routed here.
   *
   * A rollup can accept transactions perfectly while its websocket delivers
   * nothing — measured on devnet-eu, which answered `getSlot` but produced
   * zero notifications over five seconds against 92 from Singapore. Gameplay
   * would appear to work and multiplayer would silently fall back to the 5 s
   * poll, which is the worst of both: a region that looks open and plays
   * dead. The world stays configured on chain; this only stops the client
   * sending anyone to it.
   */
  available: boolean;
}

export const REGIONS: RegionInfo[] = [
  {
    id: 0,
    key: "as",
    label: "Asia",
    place: "Singapore",
    fqdn: "https://devnet-as.magicblock.app",
    validator: "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
    available: true,
  },
  {
    id: 1,
    key: "eu",
    label: "Europe",
    place: "Frankfurt",
    fqdn: "https://devnet-eu.magicblock.app",
    validator: "MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e",
    // Websocket delivers no notifications on devnet as of 2026-08-15.
    available: false,
  },
  {
    id: 2,
    key: "us",
    label: "Americas",
    place: "United States",
    fqdn: "https://devnet-us.magicblock.app",
    validator: "MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd",
    available: true,
  },
];

export const DEFAULT_REGION = 0;

export function regionById(id: number): RegionInfo {
  return REGIONS.find((r) => r.id === id) ?? REGIONS[0];
}

/** Regions a player may actually be sent to. */
export const OPEN_REGIONS = REGIONS.filter((r) => r.available);

const PROBE_KEY = "crossy-world:region-probe";
/**
 * How long a measurement is trusted.
 *
 * Re-probing every boot would add a round trip to each rollup before the
 * player can do anything, and network distance does not change hour to hour.
 */
const PROBE_TTL_MS = 24 * 60 * 60 * 1000;

interface ProbeResult {
  at: number;
  id: number;
  pings: Record<string, number>;
}

function readProbe(): ProbeResult | null {
  try {
    const raw = localStorage.getItem(PROBE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProbeResult;
    if (Date.now() - parsed.at > PROBE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** The last measurement, for display. Never triggers a probe. */
export function lastProbe(): ProbeResult | null {
  return readProbe();
}

async function ping(fqdn: string): Promise<number> {
  // `getHealth` is the cheapest thing a Solana RPC answers, so this measures
  // the path rather than the query.
  const started = performance.now();
  try {
    const res = await fetch(fqdn, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
    });
    await res.text();
    return performance.now() - started;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Which region this player should be in.
 *
 * Measured, not guessed from a timezone or an IP database: the thing that
 * matters is round-trip time to the rollup, and that is the one quantity we
 * can simply ask for. Two passes per region, best of two, because a single
 * cold connection measures TLS setup as much as distance.
 */
export async function detectRegion(): Promise<number> {
  const cached = readProbe();
  if (cached) return cached.id;

  const pings: Record<string, number> = {};
  await Promise.all(
    OPEN_REGIONS.map(async (region) => {
      const first = await ping(region.fqdn);
      const second = await ping(region.fqdn);
      pings[region.key] = Math.min(first, second);
    }),
  );
  let best = OPEN_REGIONS[0];
  for (const region of OPEN_REGIONS) {
    if (pings[region.key] < pings[best.key]) best = region;
  }
  // Every region unreachable (offline, or a blocked network) must not be
  // recorded as a preference — it would pin the player somewhere arbitrary
  // for a day.
  if (!Number.isFinite(pings[best.key])) return DEFAULT_REGION;
  try {
    localStorage.setItem(
      PROBE_KEY,
      JSON.stringify({ at: Date.now(), id: best.id, pings } satisfies ProbeResult),
    );
  } catch {
    /* private mode: measure again next boot */
  }
  return best.id;
}

/** Forget the measurement so the next boot re-probes. */
export function clearRegionProbe(): void {
  try {
    localStorage.removeItem(PROBE_KEY);
  } catch {
    /* nothing to clear */
  }
}
