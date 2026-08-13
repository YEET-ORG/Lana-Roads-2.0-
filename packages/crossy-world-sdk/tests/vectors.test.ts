/**
 * Golden vectors shared with the Rust kernel tests
 * (programs/crossy-world/src/kernel). Any drift between these and the
 * program is a release blocker.
 */
import assert from "node:assert/strict";
import {
  cutoffPassed,
  dayEnd,
  dayStart,
  marketSplit,
  revivePrice,
  settlementSplit,
  utcDayFromUnix,
} from "../src/time.js";
import { sectorBit, sectorOf } from "../src/pda.js";
import {
  LANE_ROAD,
  Lane,
  VehicleClass,
  laneObjectCovers,
  laneVehicleClass,
  laneVehicles,
  objectIndex,
  vehicleVariant,
  worldTimeMs,
} from "../src/hazards.js";

describe("shared golden vectors", () => {
  it("utc day boundaries match kernel::time", () => {
    assert.equal(utcDayFromUnix(0), 0n);
    assert.equal(utcDayFromUnix(86_399), 0n);
    assert.equal(utcDayFromUnix(86_400), 1n);
    assert.equal(utcDayFromUnix(-1), null);
    assert.equal(utcDayFromUnix(1_786_924_800), 20_682n); // 2026-08-13T00:00Z
  });

  it("cutoff is hard and exclusive", () => {
    const day = 20_682n;
    assert.equal(dayEnd(day) - dayStart(day), 86_400n);
    assert.equal(cutoffPassed(day, dayEnd(day) - 1n), false);
    assert.equal(cutoffPassed(day, dayEnd(day)), true);
  });

  it("revival prices double with u64 overflow rejection", () => {
    assert.equal(revivePrice(0), 10_000_000n);
    assert.equal(revivePrice(1), 20_000_000n);
    assert.equal(revivePrice(2), 40_000_000n);
    assert.equal(revivePrice(3), 80_000_000n);
    assert.equal(revivePrice(10), 10_240_000_000n);
    assert.equal(revivePrice(40), 10_995_116_277_760_000_000n);
    assert.equal(revivePrice(41), null);
    assert.equal(revivePrice(64), null);
  });

  it("settlement split conserves the pool with rounding to the winner", () => {
    for (const pool of [0n, 1n, 9n, 10n, 999n, 1_000_000n, 123_456_789n]) {
      const [winner, team] = settlementSplit(pool);
      assert.equal(winner + team, pool);
      assert.equal(team, pool / 10n);
    }
  });

  it("market split conserves the price", () => {
    for (const price of [1n, 10n, 55n, 5_000_000n, 20_000_000n]) {
      const [seller, team] = marketSplit(price);
      assert.equal(seller + team, price);
    }
  });

  it("sector mapping matches kernel::grid", () => {
    assert.deepEqual(sectorOf(0, 0), [0, 0]);
    assert.deepEqual(sectorOf(7, 7), [0, 0]);
    assert.deepEqual(sectorOf(8, 7), [1, 0]);
    assert.deepEqual(sectorOf(63, 8), [7, 1]);
    assert.equal(sectorBit(0, 0), 0);
    assert.equal(sectorBit(7, 0), 7);
    assert.equal(sectorBit(0, 1), 8);
    assert.equal(sectorBit(7, 7), 63);
    assert.equal(sectorBit(9, 9), 9);
  });

  // -------------------------------------------------------------------------
  // hazard geometry + canonical vehicle identity
  // -------------------------------------------------------------------------

  // Emitted by `cargo test -p crossy-world --lib -- --nocapture
  // golden_vectors_for_the_sdk`. Any drift here means a client would draw or
  // predict something the program disagrees with.
  const roadLane: Lane = {
    kind: LANE_ROAD,
    dirPositive: 1,
    footprint: 2,
    gapTiles: 7,
    speedMtps: 1_500,
    phaseMt: 400,
    warningMs: 0,
    periodMs: 0,
    blockerMask: 0n,
    sinking: 0,
  };

  it("object coverage matches kernel::hazard", () => {
    const expected: Record<number, number[]> = {
      0: [0, 1, 7, 8, 14, 15],
      1000: [1, 2, 8, 9, 15, 16],
      2000: [3, 4, 10, 11, 17, 18],
      5000: [0, 1, 7, 8, 14, 15],
      60000: [0, 6, 7, 13, 14],
    };
    for (const [t, tiles] of Object.entries(expected)) {
      const covered = [...Array(20).keys()].filter((x) =>
        laneObjectCovers(roadLane, x, Number(t)),
      );
      assert.deepEqual(covered, tiles, `coverage at t=${t}`);
    }
  });

  it("object indices match kernel::hazard and identify the same car", () => {
    const expected: Record<number, number[]> = {
      0: [0, 0, 1, 1, 2, 2],
      1000: [0, 0, 1, 1, 2, 2],
      2000: [0, 0, 1, 1, 2, 2],
      // A full cycle has passed: the same tiles are covered, but by the
      // *next* set of cars.
      5000: [-1, -1, 0, 0, 1, 1],
      60000: [-13, -12, -12, -11, -11],
    };
    for (const [t, indices] of Object.entries(expected)) {
      const got = [...Array(20).keys()]
        .map((x) => objectIndex(roadLane, x, Number(t)))
        .filter((i): i is number => i !== null);
      assert.deepEqual(got, indices, `indices at t=${t}`);
    }
  });

  it("vehicle variants match kernel::vehicle", () => {
    const seed = new Uint8Array(32).fill(7);
    const variants = [];
    for (let i = -4; i < 8; i++) {
      variants.push(vehicleVariant(seed, 9, i, VehicleClass.Compact));
    }
    assert.deepEqual(variants, [0, 2, 0, 1, 2, 1, 1, 2, 1, 0, 0, 2]);
  });

  it("class comes from footprint, and every car resolves to one asset", () => {
    assert.equal(laneVehicleClass(roadLane), VehicleClass.Pickup); // footprint 2
    assert.equal(laneVehicleClass({ ...roadLane, footprint: 1 }), VehicleClass.Compact);
    assert.equal(laneVehicleClass({ ...roadLane, footprint: 4 }), VehicleClass.Bus);

    // Same lane, same tick, asked twice: identical assets in identical places.
    const a = laneVehicles(roadLane, 9, new Uint8Array(32).fill(7), 3_000);
    const b = laneVehicles(roadLane, 9, new Uint8Array(32).fill(7), 3_000);
    assert.deepEqual(a, b);
    assert.ok(a.length > 0);
    for (const v of a) assert.ok(v.assetId.startsWith("vehicle."));
  });

  it("world time is quantised to the authoritative second", () => {
    // The program derives time from Clock::unix_timestamp, so a client that
    // predicts on a finer grid disagrees with it.
    assert.equal(worldTimeMs(1_000, 1_000), 0);
    assert.equal(worldTimeMs(1_000, 1_000.9), 0);
    assert.equal(worldTimeMs(1_000, 1_001), 1_000);
    assert.equal(worldTimeMs(1_000, 900), 0);
  });
});
