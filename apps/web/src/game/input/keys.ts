/**
 * Keyboard input: WASD/arrows for movement, Space for Kick. At most one
 * buffered intent; key repeat never queues spam. Focused text inputs
 * suspend gameplay shortcuts.
 */
import { Direction } from "@crossy-world/sdk";

export type GameAction = { kind: "move"; direction: Direction } | { kind: "kick" };

export function attachInput(onAction: (a: GameAction) => void): () => void {
  const down = new Set<string>();
  const handler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    if (down.has(e.code)) return; // no key-repeat spam
    down.add(e.code);
    switch (e.code) {
      case "KeyW":
      case "ArrowUp":
        onAction({ kind: "move", direction: Direction.Forward });
        break;
      case "KeyS":
      case "ArrowDown":
        onAction({ kind: "move", direction: Direction.Backward });
        break;
      case "KeyA":
      case "ArrowLeft":
        onAction({ kind: "move", direction: Direction.Left });
        break;
      case "KeyD":
      case "ArrowRight":
        onAction({ kind: "move", direction: Direction.Right });
        break;
      case "Space":
        e.preventDefault();
        onAction({ kind: "kick" });
        break;
    }
  };
  const up = (e: KeyboardEvent) => down.delete(e.code);
  window.addEventListener("keydown", handler);
  window.addEventListener("keyup", up);
  return () => {
    window.removeEventListener("keydown", handler);
    window.removeEventListener("keyup", up);
  };
}
