/**
 * One-shot voxel confetti (square motif, transform/opacity only). Rendered
 * inside a positioned parent; each square gets a deterministic column,
 * delay and palette color via CSS custom properties.
 */
const COLORS = ["#FFD23F", "#4BE08F", "#22B9E6", "#F45169", "#8E63EA", "#FFFDF5"];

export function Confetti({ count = 14 }: { count?: number }) {
  return (
    <div className="ds-confetti" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          style={
            {
              "--x": `${6 + ((i * 61) % 89)}%`,
              "--d": `${(i * 97) % 380}ms`,
              "--r": `${((i * 131) % 360) - 180}deg`,
              background: COLORS[i % COLORS.length],
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
