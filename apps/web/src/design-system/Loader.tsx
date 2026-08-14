/** Loader — hopping block + label for async stages (never a bare spinner). */
export function Loader({ label }: { label: string }) {
  return (
    <span className="ds-loader" role="status">
      <span className="ds-loader__cube" aria-hidden />
      {label}
    </span>
  );
}
