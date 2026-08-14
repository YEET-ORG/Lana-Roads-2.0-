/** Steps — bounded transaction/workflow progress track. */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="ds-steps" role="list" aria-label="progress">
      {steps.map((label, i) => (
        <span
          key={label}
          role="listitem"
          aria-current={i === current ? "step" : undefined}
          className={`ds-step ${i < current ? "ds-step--done" : ""} ${
            i === current ? "ds-step--active" : ""
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}
