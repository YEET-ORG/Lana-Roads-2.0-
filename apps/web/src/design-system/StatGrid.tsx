import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** StatGrid — 2-up label/value tiles with tabular numerals and icons. */
export function StatGrid({
  items,
}: {
  items: { label: string; value: ReactNode; tone?: "gold"; icon?: IconName }[];
}) {
  return (
    <div className="ds-stats">
      {items.map((s) => (
        <span key={s.label} className={`ds-stat ${s.tone === "gold" ? "ds-stat--gold" : ""}`}>
          {s.icon && <Icon name={s.icon} size={20} />}
          <span>
            <label className="ds-stat__label">{s.label}</label>
            <span className="ds-stat__value">{s.value}</span>
          </span>
        </span>
      ))}
    </div>
  );
}
