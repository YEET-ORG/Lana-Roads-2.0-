/**
 * Gameplay input: WASD/arrows + Space (kick) on desktop; tap/swipe on the
 * gameplay surface for touch. Focused text inputs suspend gameplay shortcuts.
 *
 * Holding a direction repeats it (`settings.holdToRun`). The browser's own
 * auto-repeat is still suppressed — it is jittery, starts after ~500 ms, and
 * fires at whatever rate the OS is set to. This drives its own timer instead,
 * paced to the hop so the rig flows rather than stepping.
 *
 * Repeating does not weaken authority: every repeat is an ordinary sequenced
 * action through the same outbox, subject to the same prediction checks, and
 * REPEAT_MS is an order of magnitude slower than the program's one-accepted-
 * move-per-slot rule. A repeat that authority refuses rolls back like any
 * other.
 *
 * Touch recognition per docs/FRONTEND.md §14: min travel 24 CSS px, axis
 * dominance 1.35:1, max window 420 ms; tap = forward hop.
 */
import { Direction } from "@crossy-world/sdk";
import { getSettings } from "../../lib/settings";

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

/**
 * Long enough that a deliberate single tap never double-fires, short enough
 * that a held key feels like it took effect immediately.
 */
const HOLD_DELAY_MS = 190;
/**
 * Fallback repeat interval when the caller does not supply one.
 *
 * The caller SHOULD supply one: generating input faster than the chain
 * accepts does not make the player move faster, it just fills a queue that
 * has to be dropped, and the drop is what shows up as "too fast" while a
 * direction is merely being held. The repeat should run at the same rate the
 * outbox drains, whatever that currently is.
 */
const REPEAT_MS = 135;

export interface InputHooks {
  /** Gameplay surface for touch gestures (gestures outside it are ignored). */
  surface?: HTMLElement;
  /**
   * How often a held direction should repeat, in ms.
   *
   * Read fresh on every repeat rather than captured once, because the send
   * pacing it mirrors adapts to the connection while the player is holding.
   */
  repeatMs?: () => number;
}

export function attachInput(
  onAction: (a: GameAction) => void,
  hooks: InputHooks = {},
): () => void {
  const down = new Set<string>();
  /** Direction keys in press order; the newest one held is the one that runs. */
  const heldDirections: string[] = [];
  let repeatTimer = 0;

  const stopRepeat = () => {
    if (repeatTimer) {
      window.clearTimeout(repeatTimer);
      repeatTimer = 0;
    }
  };

  const activeDirection = (): Direction | null => {
    for (let i = heldDirections.length - 1; i >= 0; i--) {
      const dir = KEY_DIRECTIONS[heldDirections[i]];
      if (dir != null) return dir;
    }
    return null;
  };

  const scheduleRepeat = (delay: number) => {
    stopRepeat();
    if (!getSettings().holdToRun) return;
    repeatTimer = window.setTimeout(() => {
      repeatTimer = 0;
      const dir = activeDirection();
      if (dir == null) return;
      onAction({ kind: "move", direction: dir });
      scheduleRepeat(Math.max(60, hooks.repeatMs?.() ?? REPEAT_MS));
    }, delay);
  };

  const handler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    // The browser's own auto-repeat is ignored; the timer below owns pacing.
    if (down.has(e.code) || e.repeat) return;
    down.add(e.code);
    const dir = KEY_DIRECTIONS[e.code];
    if (dir != null) {
      heldDirections.push(e.code);
      onAction({ kind: "move", direction: dir });
      // Changing direction mid-run restarts the delay, so a quick correction
      // is one hop rather than the start of a run the other way.
      scheduleRepeat(HOLD_DELAY_MS);
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      onAction({ kind: "kick" });
    }
  };
  const up = (e: KeyboardEvent) => {
    down.delete(e.code);
    const at = heldDirections.indexOf(e.code);
    if (at !== -1) heldDirections.splice(at, 1);
    // Releasing one of two held keys hands the run to the other, without the
    // initial delay — the player never stopped holding a direction.
    if (activeDirection() == null) stopRepeat();
  };
  /**
   * A key held while the tab loses focus never delivers its keyup, and the
   * repeat would keep walking the player into traffic they cannot see.
   */
  const release = () => {
    down.clear();
    heldDirections.length = 0;
    stopRepeat();
  };
  const onVisibility = () => {
    if (document.hidden) release();
  };
  window.addEventListener("keydown", handler);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", onVisibility);

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
    stopRepeat();
    window.removeEventListener("keydown", handler);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", release);
    document.removeEventListener("visibilitychange", onVisibility);
    if (surface) {
      surface.removeEventListener("pointerdown", pointerDown);
      surface.removeEventListener("pointerup", pointerUp);
      surface.removeEventListener("pointercancel", pointerCancel);
    }
  };
}
