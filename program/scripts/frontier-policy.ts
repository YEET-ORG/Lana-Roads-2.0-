/** Shared, deterministic policy for the off-chain frontier keeper. */
export const CHUNK_ROWS = 16;
export const CHUNK_LOOKAHEAD_CHUNKS = 10;
export const CHUNK_REQUEST_MARGIN = CHUNK_LOOKAHEAD_CHUNKS * CHUNK_ROWS;

/**
 * Number of sequential chunks the keeper should append in this pass.
 *
 * The inclusive comparison mirrors the on-chain request gate exactly. At
 * row zero with the spawn chunk revealed, it returns ten: chunks 1..10.
 */
export function chunksNeededForLookahead(
  leaderScore: number,
  revealedRows: number,
  maxChunks = CHUNK_LOOKAHEAD_CHUNKS,
): number {
  if (!Number.isSafeInteger(leaderScore) || leaderScore < 0)
    throw new Error("leaderScore must be a non-negative safe integer");
  if (
    !Number.isSafeInteger(revealedRows) ||
    revealedRows < CHUNK_ROWS ||
    revealedRows % CHUNK_ROWS !== 0
  )
    throw new Error("revealedRows must be a positive chunk boundary");
  if (!Number.isSafeInteger(maxChunks) || maxChunks < 0)
    throw new Error("maxChunks must be a non-negative safe integer");

  let frontier = revealedRows;
  let count = 0;
  while (count < maxChunks && leaderScore + CHUNK_REQUEST_MARGIN >= frontier) {
    frontier += CHUNK_ROWS;
    count += 1;
  }
  return count;
}
