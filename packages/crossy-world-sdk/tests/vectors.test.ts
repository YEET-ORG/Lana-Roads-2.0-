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
});
