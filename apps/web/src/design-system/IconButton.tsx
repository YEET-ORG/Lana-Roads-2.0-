/**
 * IconButton — round icon-only button for HUD corners and carousels.
 * Always requires an aria-label since it has no text.
 */
import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./icons";

export function IconButton({
  icon,
  label,
  variant = "overlay",
  size,
  className = "",
  ...rest
}: {
  icon: IconName;
  label: string;
  variant?: "overlay" | "sun";
  size?: "lg";
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = [
    "ds-iconbtn",
    variant === "sun" ? "ds-iconbtn--sun" : "",
    size === "lg" ? "ds-iconbtn--lg" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size === "lg" ? 26 : 22} />
    </button>
  );
}
