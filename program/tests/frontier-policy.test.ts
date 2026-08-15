import assert from "node:assert/strict";
import test from "node:test";
import {
  CHUNK_LOOKAHEAD_CHUNKS,
  CHUNK_REQUEST_MARGIN,
  CHUNK_ROWS,
  chunksNeededForLookahead,
} from "../scripts/frontier-policy";
import { DEFAULT_CROSSY_WORLD_IDL, loadCrossyWorldIdl } from "../scripts/runtime-config";

test("a fresh world fills ten chunks beyond the spawn chunk", () => {
  assert.equal(CHUNK_LOOKAHEAD_CHUNKS, 10);
  assert.equal(CHUNK_REQUEST_MARGIN, 160);
  assert.equal(chunksNeededForLookahead(0, CHUNK_ROWS), 10);
  assert.equal(chunksNeededForLookahead(0, CHUNK_ROWS * 11), 0);
});

test("crossing a chunk boundary opens exactly one new lookahead chunk", () => {
  const fullBuffer = CHUNK_ROWS * 11;
  assert.equal(chunksNeededForLookahead(15, fullBuffer), 0);
  assert.equal(chunksNeededForLookahead(16, fullBuffer), 1);
});

test("catch-up work is bounded per keeper pass", () => {
  assert.equal(chunksNeededForLookahead(400, CHUNK_ROWS), 10);
  assert.equal(chunksNeededForLookahead(400, CHUNK_ROWS, 3), 3);
});

test("invalid frontier snapshots fail closed", () => {
  assert.throws(() => chunksNeededForLookahead(-1, CHUNK_ROWS));
  assert.throws(() => chunksNeededForLookahead(0, CHUNK_ROWS + 1));
});

test("production keeper IDL is tracked and matches the program", () => {
  assert.match(DEFAULT_CROSSY_WORLD_IDL, /packages[\\/]crossy-world-sdk/);
  const idl = loadCrossyWorldIdl("GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX");
  assert.equal(idl.metadata.name, "crossy_world");
});
