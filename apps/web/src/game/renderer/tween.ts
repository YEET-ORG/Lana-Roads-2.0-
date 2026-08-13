/**
 * Minimal frame-driven tween helpers for the world runtime. No library: the
 * scene owns the rAF loop, so tweens are plain time functions evaluated with
 * the loop's clock (delta-time correct on any refresh rate).
 */

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
export const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
/** Half-sine arc: 0 → 1 → 0 over t ∈ [0, 1]. */
export const arc = (t: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, t)));

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * Framerate-independent exponential smoothing factor: the equivalent of
 * `lerp(a, b, k)` per 60 Hz frame, corrected for the actual dt.
 * `smoothing` is the fraction of remaining distance covered per 16.67 ms.
 */
export function smoothFactor(smoothing: number, dtMs: number): number {
  return 1 - Math.pow(1 - smoothing, dtMs / 16.667);
}

/** Cheap deterministic noise (used by camera shake — smooth, not white). */
export function noise1d(t: number, seed = 0): number {
  const s =
    Math.sin(t * 2.1 + seed * 17.13) * 0.55 +
    Math.sin(t * 4.7 + seed * 31.7) * 0.3 +
    Math.sin(t * 9.3 + seed * 5.9) * 0.15;
  return s;
}
