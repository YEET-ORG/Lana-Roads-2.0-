/**
 * ArcadeButton — chunky voxel button with a hard lower edge that
 * compresses on press. Variants carry product meaning:
 * primary = paid/commit, play = free/go, info = neutral action,
 * danger = destructive/urgent, violet = special, ghost/link = quiet.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export type ButtonVariant =
  | "info"
  | "primary"
  | "play"
  | "danger"
  | "violet"
  | "ghost"
  | "link";

export function Button({
  variant = "info",
  size,
  icon,
  busy = false,
  block = false,
  children,
  className = "",
  disabled,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: "sm" | "giant";
  icon?: IconName;
  busy?: boolean;
  block?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = [
    "ds-btn",
    `ds-btn--${variant}`,
    size === "giant" ? "ds-btn--giant" : "",
    size === "sm" ? "ds-btn--sm" : "",
    block ? "ds-btn--block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} disabled={disabled || busy} {...rest}>
      {busy ? (
        <span className="ds-btn__loader" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      ) : (
        icon && <Icon name={icon} size={size === "giant" ? 26 : 18} />
      )}
      <span>{children}</span>
    </button>
  );
}
