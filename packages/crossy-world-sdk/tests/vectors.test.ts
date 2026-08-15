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
  VEHICLE_ASSET_IDS,
  VEHICLE_VARIANT_COUNT,
  VehicleClass,
  MS_PER_SLOT,
  laneObjectCovers,
  laneObjects,
  laneVehicleClass,
  laneVehicles,
  objectIndex,
  tickOf,
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
    assert.deepEqual(sectorOf(63, 1_000_000), [7, 125_000]);
    assert.equal(sectorBit(0, 0), 0);
    assert.equal(sectorBit(7, 0), 7);
    assert.equal(sectorBit(0, 1), 8);
    assert.equal(sectorBit(7, 7), 63);
    assert.equal(sectorBit(9, 9), 9);
    assert.equal(sectorBit(63, 1_000_000), 7);
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

  it("every class has exactly as many ids as variants", () => {
    // A count the asset table cannot satisfy would resolve cars to models
    // that do not exist.
    for (const [cls, count] of Object.entries(VEHICLE_VARIANT_COUNT)) {
      assert.equal(
        VEHICLE_ASSET_IDS[Number(cls) as VehicleClass].length,
        count,
        `class ${cls}`,
      );
    }
  });

  it("vehicle variants match kernel::vehicle", () => {
    const seed = new Uint8Array(32).fill(7);
    const variants = [];
    for (let i = -4; i < 8; i++) {
      variants.push(vehicleVariant(seed, 9, i, VehicleClass.Compact));
    }
    assert.deepEqual(variants, [3, 3, 2, 3, 2, 2, 2, 1, 0, 1, 0, 1]);
  });

  it("class comes from footprint, and every car resolves to one asset", () => {
    assert.equal(laneVehicleClass(roadLane), VehicleClass.Pickup); // footprint 2
    // Every id the roster can return must be a model that actually ships.
    for (const ids of Object.values(VEHICLE_ASSET_IDS)) {
      assert.ok(ids.length > 0);
    }
    assert.equal(laneVehicleClass({ ...roadLane, footprint: 1 }), VehicleClass.Compact);
    assert.equal(laneVehicleClass({ ...roadLane, footprint: 4 }), VehicleClass.Bus);

    // Same lane, same tick, asked twice: identical assets in identical places.
    const a = laneVehicles(roadLane, 9, new Uint8Array(32).fill(7), 3_000);
    const b = laneVehicles(roadLane, 9, new Uint8Array(32).fill(7), 3_000);
    assert.deepEqual(a, b);
    assert.ok(a.length > 0);
    for (const v of a) assert.ok(v.assetId.startsWith("vehicle."));
  });

  it("every lethal tile belongs to a listed object", () => {
    // The renderer draws what `laneObjects` enumerates; the program kills
    // on what `laneObjectCovers` says. If the enumeration misses an object,
    // that car is invisible and still lethal — which is exactly what a
    // left-running lane used to do, listing two or three cars out of
    // twenty. Sweep every lane shape rather than trusting one.
    for (const footprint of [1, 2, 3, 4]) {
      for (const gapTiles of [3, 4, 6, 8, 12]) {
        for (const dirPositive of [0, 1]) {
          for (const speedMtps of [1200, 2000, 3000, 4000]) {
            for (const phaseMt of [0, 250, 700]) {
              const lane = {
                kind: 1,
                dirPositive,
                footprint,
                gapTiles,
                speedMtps,
                phaseMt,
                warningMs: 0,
                periodMs: 0,
                blockerMask: 0n,
                sinking: 0,
              };
              for (let tick = 0; tick < 24; tick++) {
                const t = tick * 1000;
                const objects = laneObjects(lane, t);
                for (let x = 0; x < 64; x++) {
                  const listed = objects.some((o) => x >= o.x && x < o.x + footprint);
                  assert.equal(
                    listed,
                    laneObjectCovers(lane, x, t),
                    `fp=${footprint} gap=${gapTiles} dir=${dirPositive} ` +
                      `spd=${speedMtps} phase=${phaseMt} t=${t} x=${x}`,
                  );
                }
              }
            }
          }
        }
      }
    }
  });

  it("the render grid is the program's own step", () => {
    // A renderer quantising to anything coarser than the program's step
    // throws away motion the chain has: it glides toward a stale position
    // and lurches when its own coarse tick rolls. This is the assertion
    // that was missing when the clock moved to slots and the grid did not.
    assert.equal(tickOf(0), 0);
    assert.equal(tickOf(MS_PER_SLOT - 1), 0);
    assert.equal(tickOf(MS_PER_SLOT), MS_PER_SLOT);
    assert.equal(tickOf(MS_PER_SLOT * 3 + 7), MS_PER_SLOT * 3);
    // And the interpolation spans exactly one step: at the far end of a
    // step the drawn position has reached the authoritative tile.
    const seed = new Uint8Array(32).fill(5);
    const t = MS_PER_SLOT * 400;
    for (const v of laneVehicles(roadLane, 4, seed, t + MS_PER_SLOT - 0.001)) {
      assert.ok(Math.abs(v.renderX - v.x) < 0.02, `car ${v.index} never arrived`);
    }
  });

  it("smooth car positions never draw ahead of the program", () => {
    // Smoothing may glide a car between tiles for the eye, but the drawn
    // position must never LEAD the authoritative one. A car drawn past its
    // tile leaves a gap behind it that the program still calls lethal, and
    // a player who hops into that gap dies with nothing on screen to
    // explain it. Lagging is the safe direction: the car is shown arriving
    // at a tile the program already considers occupied.
    const seed = new Uint8Array(32).fill(3);
    // Steps, not seconds: the grid is one rollup slot.
    for (let step = 1; step < 40; step++) {
      const t = step * MS_PER_SLOT;
      const here = laneVehicles(roadLane, 4, seed, t);
      const prev = laneVehicles(roadLane, 4, seed, t - MS_PER_SLOT);
      for (let f = 0; f <= 10; f++) {
        for (const v of laneVehicles(roadLane, 4, seed, t + (f * MS_PER_SLOT) / 10)) {
          const before = prev.find((p) => p.index === v.index);
          if (!before) continue;
          const lo = Math.min(before.x, v.x);
          const hi = Math.max(before.x, v.x);
          assert.ok(
            v.renderX >= lo - 1e-9 && v.renderX <= hi + 1e-9,
            `car ${v.index} strayed outside [${lo}, ${hi}] at frac ${f / 10}`,
          );
          // Never past the authoritative tile, in whichever direction the
          // lane runs.
          if (roadLane.dirPositive === 1) {
            assert.ok(v.renderX <= v.x + 1e-9, `car ${v.index} led its tile`);
          } else {
            assert.ok(v.renderX >= v.x - 1e-9, `car ${v.index} led its tile`);
          }
        }
      }
      // And it does arrive: at the end of the tick the drawn position is
      // the authoritative one.
      for (const v of laneVehicles(roadLane, 4, seed, t + MS_PER_SLOT - 0.001)) {
        const target = here.find((h) => h.index === v.index);
        if (target) assert.ok(Math.abs(v.renderX - target.x) < 0.01);
      }
    }
  });

  it("world time comes from the rollup slot", () => {
    // The program derives time from Clock::slot, so a client predicting on
    // any other grid disagrees with it.
    // Slot-derived, so the grid is 50ms rather than a whole second: this
    // is the number that lets traffic move a tile at a time.
    assert.equal(worldTimeMs(0), 0);
    assert.equal(worldTimeMs(1), 50);
    assert.equal(worldTimeMs(20), 1_000);
    assert.equal(worldTimeMs(534_438_269), 26_721_913_450);
    // Big enough to matter, small enough that the tile maths stays exact
    // in a double.
    assert.ok(worldTimeMs(534_438_269) * 4_000 < Number.MAX_SAFE_INTEGER);
  });
});
