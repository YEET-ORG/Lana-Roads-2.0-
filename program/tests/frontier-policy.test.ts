import assert from "node:assert/strict";
import test from "node:test";
import {
  CHUNK_LOOKAHEAD_CHUNKS,
  CHUNK_REQUEST_MARGIN,
  CHUNK_ROWS,
  chunksNeededForLookahead,
} from "../scripts/frontier-policy";
import { DEFAULT_CROSSY_WORLD_IDL, loadCrossyWorldIdl } from "../scripts/runtime-config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  // Derive the id from `declare_id!` rather than pinning a literal. The real
  // invariant is that the shipped IDL matches the compiled program; a
  // hardcoded id turns this into a check that nobody has redeployed, which
  // fails for the one reason it should stay silent about — and it did, twice.
  const lib = readFileSync(
    resolve(__dirname, "../programs/crossy-world/src/lib.rs"),
    "utf8",
  );
  const declared = lib.match(/declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\)/)?.[1];
  assert.ok(declared, "declare_id! not found in lib.rs");
  const idl = loadCrossyWorldIdl(declared);
  assert.equal(idl.metadata.name, "crossy_world");
});
