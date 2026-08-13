/**
 * Keyboard input: WASD/arrows for movement, Space for Kick. At most one
 * buffered intent; key repeat never queues spam. Focused text inputs
 * suspend gameplay shortcuts.
 */
import { Direction } from "@crossy-world/sdk";

export type GameAction = { kind: "move"; direction: Direction } | { kind: "kick" };

const KEY_DIRECTIONS: Record<string, Direction> = {
  KeyW: Direction.Forward,
  ArrowUp: Direction.Forward,
  KeyS: Direction.Backward,
  ArrowDown: Direction.Backward,
  KeyA: Direction.Left,
  ArrowLeft: Direction.Left,
  KeyD: Direction.Right,
  ArrowRight: Direction.Right,
};

/** Hold-to-run repeat cadence (the program allows one move per ~50ms slot). */
const HOLD_REPEAT_MS = 120;

export function attachInput(onAction: (a: GameAction) => void): () => void {
  const down = new Set<string>();
  let held: Direction | null = null;
  const repeat = setInterval(() => {
    if (held != null) onAction({ kind: "move", direction: held });
  }, HOLD_REPEAT_MS);

  const handler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    if (down.has(e.code)) return; // browser key-repeat is replaced by ours
    down.add(e.code);
    const dir = KEY_DIRECTIONS[e.code];
    if (dir != null) {
      held = dir;
      onAction({ kind: "move", direction: dir });
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      onAction({ kind: "kick" });
    }
  };
  const up = (e: KeyboardEvent) => {
    down.delete(e.code);
    if (held != null && KEY_DIRECTIONS[e.code] === held) {
      // Fall back to another still-held direction key, if any.
      held = null;
      for (const code of down) {
        const d = KEY_DIRECTIONS[code];
        if (d != null) {
          held = d;
          break;
        }
      }
    }
  };
  window.addEventListener("keydown", handler);
  window.addEventListener("keyup", up);
  return () => {
    clearInterval(repeat);
    window.removeEventListener("keydown", handler);
    window.removeEventListener("keyup", up);
  };
}
