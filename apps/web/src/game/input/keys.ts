/**
 * Gameplay input: WASD/arrows + Space (kick) on desktop; tap/swipe on the
 * gameplay surface for touch. One press or gesture = exactly one grid-step
 * intent — no hold-repeat, no charge; browser key auto-repeat is suppressed.
 * Focused text inputs suspend gameplay shortcuts.
 *
 * Touch recognition per docs/FRONTEND.md §14: min travel 24 CSS px, axis
 * dominance 1.35:1, max window 420 ms; tap = forward hop.
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

const SWIPE_MIN_PX = 24;
const SWIPE_DOMINANCE = 1.35;
const SWIPE_WINDOW_MS = 420;

export interface InputHooks {
  /** Gameplay surface for touch gestures (gestures outside it are ignored). */
  surface?: HTMLElement;
}

export function attachInput(
  onAction: (a: GameAction) => void,
  hooks: InputHooks = {},
): () => void {
  const down = new Set<string>();

  const handler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    if (down.has(e.code)) return; // one action per physical press
    down.add(e.code);
    const dir = KEY_DIRECTIONS[e.code];
    if (dir != null) {
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
  };
  window.addEventListener("keydown", handler);
  window.addEventListener("keyup", up);

  // ---- touch / pointer gestures (tap = hop, swipe = directional hop) ----
  const surface = hooks.surface;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startT = 0;

  const pointerDown = (e: PointerEvent) => {
    if (pointerId != null) return; // multi-touch never submits extra actions
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startT = performance.now();
  };

  const pointerUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    const dt = performance.now() - startT;
    if (dt > SWIPE_WINDOW_MS) return; // long press = no action
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < SWIPE_MIN_PX) {
      onAction({ kind: "move", direction: Direction.Forward }); // tap = hop
      return;
    }
    // Dominant-axis lock rejects ambiguous diagonals.
    if (ax > ay * SWIPE_DOMINANCE) {
      onAction({ kind: "move", direction: dx > 0 ? Direction.Right : Direction.Left });
    } else if (ay > ax * SWIPE_DOMINANCE) {
      onAction({
        kind: "move",
        direction: dy < 0 ? Direction.Forward : Direction.Backward,
      });
    }
  };

  const pointerCancel = (e: PointerEvent) => {
    if (e.pointerId === pointerId) pointerId = null;
  };

  if (surface) {
    surface.addEventListener("pointerdown", pointerDown);
    surface.addEventListener("pointerup", pointerUp);
    surface.addEventListener("pointercancel", pointerCancel);
    surface.style.touchAction = "none";
  }

  return () => {
    window.removeEventListener("keydown", handler);
    window.removeEventListener("keyup", up);
    if (surface) {
      surface.removeEventListener("pointerdown", pointerDown);
      surface.removeEventListener("pointerup", pointerUp);
      surface.removeEventListener("pointercancel", pointerCancel);
    }
  };
}
