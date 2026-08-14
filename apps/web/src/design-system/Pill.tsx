import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export type PillTone =
  | "paid"
  | "casual"
  | "info"
  | "warn"
  | "error"
  | "neutral"
  | "outline";

/** StatusPill — compact labelled state chip (mode, price, warnings). */
export function Pill({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: PillTone;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <span className={`ds-pill ds-pill--${tone}`}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}
