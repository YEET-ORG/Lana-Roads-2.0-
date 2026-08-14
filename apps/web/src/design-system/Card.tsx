import type { HTMLAttributes, ReactNode } from "react";

/** ArcadeCard — solid navy panel; tone adds paid(gold)/info(aqua) edges. */
export function Card({
  tone,
  className = "",
  children,
  ...rest
}: {
  tone?: "gold" | "aqua";
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const cls = ["ds-card", tone ? `ds-card--${tone}` : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
