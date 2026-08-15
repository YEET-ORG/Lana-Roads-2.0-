import { strict as assert } from "node:assert";
import { loadContiguousChunks } from "../src/map-sync.js";

describe("loadContiguousChunks", () => {
  it("stops at a propagation hole and resumes without skipping rows", async () => {
    const available = new Map<number, string>([
      [0, "chunk-0"],
      [2, "chunk-2"],
    ]);
    const applied: number[] = [];

    let next = await loadContiguousChunks({
      fromIndex: 0,
      throughIndex: 3,
      fetchChunk: async (index) => available.get(index) ?? null,
      applyChunk: async (_chunk, index) => applied.push(index),
    });

    assert.equal(next, 1);
    assert.deepEqual(applied, [0]);

    available.set(1, "chunk-1");
    next = await loadContiguousChunks({
      fromIndex: next,
      throughIndex: 3,
      fetchChunk: async (index) => available.get(index) ?? null,
      applyChunk: async (_chunk, index) => applied.push(index),
    });

    assert.equal(next, 3);
    assert.deepEqual(applied, [0, 1, 2]);
  });

  it("does not request chunks beyond the revealed frontier", async () => {
    const requested: number[] = [];
    const next = await loadContiguousChunks({
      fromIndex: 2,
      throughIndex: 4,
      fetchChunk: async (index) => {
        requested.push(index);
        return { index };
      },
      applyChunk: () => {},
    });

    assert.equal(next, 4);
    assert.deepEqual(requested, [2, 3]);
  });
});
