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
  CHUNK_LOOKAHEAD_CHUNKS,
  CHUNK_REQUEST_MARGIN,
  CHUNK_ROWS,
} from "../src/constants.js";
import {
  LANE_RAIL,
  LANE_ROAD,
  Lane,
  VEHICLE_ASSET_IDS,
  VEHICLE_VARIANT_COUNT,
  VehicleClass,
  MS_PER_SLOT,
  evaluateTile,
  laneObjectCovers,
  laneObjects,
  laneVehicleClass,
  laneVehicles,
  objectIndex,
  railNextCoverageMs,
  railPhase,
  railTrainCovers,
  railTrainTileX,
  railTrainXMt,
  railVisualSpan,
  tickOf,
  vehicleVariant,
  worldTimeMs,
} from "../src/hazards.js";

describe("shared golden vectors", () => {
  it("keeps ten complete chunks ahead of the leader", () => {
    assert.equal(CHUNK_LOOKAHEAD_CHUNKS, 10);
    assert.equal(CHUNK_REQUEST_MARGIN, CHUNK_ROWS * 10);
  });

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

  // -------------------------------------------------------------------------
  // rails: the train is a position, not a whole-row timer
  // -------------------------------------------------------------------------

  // Emitted by `cargo test -p crossy-world --lib -- --nocapture
  // golden_rail_vectors_for_the_sdk`. A rail lane is 6 tiles long, crosses
  // at 2 tiles/s (35s), warns for 1.5s, waits 6s, and starts at phase 0.
  const railLane = (dirPositive: number): Lane => ({
    kind: LANE_RAIL,
    dirPositive,
    footprint: 6,
    gapTiles: 0,
    speedMtps: 2_000,
    phaseMt: 0,
    warningMs: 1_500,
    periodMs: 6_000,
    blockerMask: 0n,
    sinking: 0,
  });

  it("a train is only lethal where it is", () => {
    // This is the bug the whole-row rule shipped: a player crossing at one
    // end died while the train was still leaving the other end — or had not
    // even entered yet.
    const lane = railLane(1);
    assert.deepEqual(railPhase(lane, 0), "quiet");
    assert.deepEqual(railPhase(lane, 7_000), "warning");
    assert.deepEqual(railPhase(lane, 7_500), "train");
    assert.equal(evaluateTile(lane, 0, 0), "safe");
    assert.equal(evaluateTile(lane, 63, 0), "safe");
    // The phase is open but the train is still off-world: nothing dies.
    assert.equal(evaluateTile(lane, 0, 7_500), "safe");
    assert.equal(evaluateTile(lane, 63, 7_500), "safe");
    // Mid-crossing: exactly the tiles under the train.
    const mid = 7_500 + 17_500;
    for (let x = 0; x < 64; x++) {
      assert.equal(
        evaluateTile(lane, x, mid),
        x >= 29 && x < 35 ? "lethal" : "safe",
        `x=${x}`,
      );
    }
  });

  it("rail coverage and train position match kernel::hazard", () => {
    const expected: Record<number, { pos: [number, number]; covered: [number, number] }> =
      {
        0: { pos: [-6_000, 64_000], covered: [[], []] },
        7_500: { pos: [-6_000, 64_000], covered: [[], []] },
        17_500: {
          pos: [14_000, 44_000],
          covered: [
            [14, 15, 16, 17, 18, 19],
            [44, 45, 46, 47, 48, 49],
          ],
        },
        25_000: {
          pos: [29_000, 29_000],
          covered: [
            [29, 30, 31, 32, 33, 34],
            [29, 30, 31, 32, 33, 34],
          ],
        },
        42_499: { pos: [63_998, -5_998], covered: [[63], [0]] },
      };
    for (const dir of [0, 1] as const) {
      const lane = railLane(dir);
      const at = dir === 1 ? 0 : 1;
      for (const [t, want] of Object.entries(expected)) {
        assert.equal(railTrainXMt(lane, Number(t)), want.pos[at], `x_mt ${dir} ${t}`);
        assert.equal(
          railTrainTileX(lane, Number(t)),
          want.pos[at] / 1_000,
          `tile x ${dir} ${t}`,
        );
        const covered = [...Array(64).keys()].filter((x) =>
          railTrainCovers(lane, x, Number(t)),
        );
        assert.deepEqual(covered, want.covered[at], `covered ${dir} ${t}`);
      }
    }
  });

  it("the lethal span is exactly the train body", () => {
    // The collision span and the authoritative train edge must agree, or a
    // player dies beside a train with nothing under them. Sweep a full cycle.
    for (const dir of [0, 1] as const) {
      const lane = railLane(dir);
      for (let step = 0; step < 900; step++) {
        const t = step * MS_PER_SLOT;
        const edge = railTrainTileX(lane, t);
        let lethal = 0;
        for (let x = 0; x < 64; x++) {
          const inBody = x + 1 > edge + 1e-9 && x + 1e-9 < edge + lane.footprint;
          assert.equal(railTrainCovers(lane, x, t), inBody, `dir ${dir} t ${t} x ${x}`);
          if (inBody) lethal += 1;
        }
        // One train, never a whole row. A body straddling two cells can
        // overlap up to footprint + 1 tiles; nothing more.
        assert.ok(lethal <= lane.footprint + 1, `dir ${dir} t ${t}: ${lethal} lethal`);
      }
    }
  });

  it("the drawn train always covers the lethal train", () => {
    // The renderer draws `railVisualSpan`. If that span ever misses a tile
    // the program kills on, the player dies to a train that was not there
    // on their screen. Sweep render time (fractional) across many cycles.
    for (const dir of [0, 1] as const) {
      const lane = railLane(dir);
      let drawn = 0;
      for (let step = 0; step < 4_000; step++) {
        const t = step * 3.3;
        if (railPhase(lane, tickOf(t)) !== "train") continue;
        const span = railVisualSpan(lane, t);
        const lethalLeft = railTrainTileX(lane, tickOf(t));
        assert.ok(
          span.left <= lethalLeft + 1e-9,
          `dir ${dir} t ${t}: left leak ${span.left} > ${lethalLeft}`,
        );
        assert.ok(
          span.left + span.length >= lethalLeft + lane.footprint - 1e-9,
          `dir ${dir} t ${t}: right leak`,
        );
        // Over-cover stays bounded to one tick of travel.
        assert.ok(
          span.length <= lane.footprint + 1,
          `dir ${dir} t ${t}: overstretched ${span.length}`,
        );
        drawn++;
      }
      assert.ok(drawn > 1_000, `dir ${dir} never drew a train`);
    }
  });

  it("rail hazard deadlines land when the train arrives", () => {
    // A player standing on the track must be scheduled for the moment the
    // train reaches THEM — not for the phase opening, which happens while
    // the train is still off-world.
    const expected: Record<number, [number, number]> = {
      0: [7_501, 39_001],
      31: [23_001, 23_501],
      63: [39_001, 7_501],
    };
    for (const dir of [0, 1] as const) {
      const lane = railLane(dir);
      const at = dir === 1 ? 0 : 1;
      for (const [x, want] of Object.entries(expected)) {
        const d = railNextCoverageMs(lane, Number(x), 0);
        assert.equal(d, want[at], `x=${x} dir=${dir}`);
        assert.ok(railTrainCovers(lane, Number(x), d), "covers at the deadline");
        assert.ok(!railTrainCovers(lane, Number(x), d - 1), "not one ms early");
      }
      // Once the train has passed, the next deadline is the next cycle.
      const lane1 = railLane(dir);
      const cycle = 6_000 + 1_500 + 35_000;
      const passed = 7_500 + 35_000 + 100;
      assert.equal(
        railNextCoverageMs(lane1, 63, passed),
        railNextCoverageMs(lane1, 63, 0) + cycle,
      );
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
