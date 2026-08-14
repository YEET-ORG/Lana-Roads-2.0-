import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** Notice — durable inline banner (funding, warnings, cluster state). */
export function Notice({
  tone = "warn",
  icon,
  children,
}: {
  tone?: "warn" | "error" | "info";
  icon?: IconName;
  children: ReactNode;
}) {
  const defaultIcon = tone === "info" ? "signal" : "alert";
  return (
    <div className={`ds-notice ds-notice--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span className="ds-notice__icon">
        <Icon name={icon ?? defaultIcon} size={18} />
      </span>
      <span>{children}</span>
    </div>
  );
}
