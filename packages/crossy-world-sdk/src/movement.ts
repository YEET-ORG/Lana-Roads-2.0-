import { Direction } from "./constants.js";

export const MAX_MOVE_BATCH = 8;
export const MAX_PENDING_ACTIONS = 8;

export interface QueuedMove {
  kind: string;
  x: number;
  y: number;
  seq: number;
  attempt: number;
  direction?: Direction;
  blocked?: boolean;
  sent?: boolean;
}

export function moveDestination(x: number, y: number, direction: Direction) {
  switch (direction) {
    case Direction.Forward:
      return { x, y: y + 1 };
    case Direction.Backward:
      return { x, y: y - 1 };
    case Direction.Left:
      return { x: x - 1, y };
    case Direction.Right:
      return { x: x + 1, y };
    default:
      throw new Error("invalid direction");
  }
}

/** Contiguous unsent moves inside one sector. Never reorder around combat,
 * retries, a predicted blocker, or a sector/chunk boundary. */
export function selectMoveBatch<T extends QueuedMove>(queue: readonly T[]): T[] {
  const first = queue[0];
  if (!first || first.kind !== "move" || first.sent) return [];
  const result: T[] = [];
  let x = first.x;
  let y = first.y;
  for (const move of queue) {
    if (
      result.length === MAX_MOVE_BATCH ||
      move.kind !== "move" ||
      move.sent ||
      move.attempt !== first.attempt ||
      move.seq !== first.seq + result.length ||
      move.x !== x ||
      move.y !== y ||
      move.direction == null
    )
      break;
    const next = moveDestination(x, y, move.direction);
    if (
      next.x < 0 ||
      next.x >= 64 ||
      next.y < 0 ||
      Math.floor(next.x / 8) !== Math.floor(first.x / 8) ||
      Math.floor(next.y / 8) !== Math.floor(first.y / 8)
    )
      break;
    result.push(move);
    if (move.blocked) break;
    ({ x, y } = next);
  }
  return result;
}
