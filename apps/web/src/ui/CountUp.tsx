/**
 * Animated number: eases the displayed value toward `value` (never snaps —
 * fast first, ease-out, ~500 ms). Renders plain text; rAF-driven, no
 * per-frame React state churn beyond the displayed integer.
 */
import { useEffect, useRef, useState } from "react";

export function CountUp({
  value,
  durationMs = 500,
}: {
  value: number;
  durationMs?: number;
}) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(from + (value - from) * eased);
      setShown(v);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, durationMs]);

  return <>{shown}</>;
}
