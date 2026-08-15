/**
 * Load only the contiguous prefix of a revealed map.
 *
 * A newly published base-layer chunk can take a moment to reach the RPC a
 * browser is reading. Skipping that temporary hole and continuing would make
 * the missing rows permanent for the life of the scene. Stop at the first
 * absent chunk instead; the realtime account listener or retry can resume
 * from the exact same index.
 */
export async function loadContiguousChunks<T>(params: {
  fromIndex: number;
  throughIndex: number;
  fetchChunk: (index: number) => Promise<T | null>;
  applyChunk: (chunk: T, index: number) => void | Promise<void>;
}): Promise<number> {
  let next = params.fromIndex;
  while (next < params.throughIndex) {
    const chunk = await params.fetchChunk(next);
    if (chunk == null) break;
    await params.applyChunk(chunk, next);
    next += 1;
  }
  return next;
}
