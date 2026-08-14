/**
 * Modal — centered focus dialog; Sheet — bottom sheet with handle.
 * Both: backdrop click and Escape dismiss (when dismissible), world
 * stays visible behind them, ARIA dialog semantics.
 */
import { useEffect, type ReactNode } from "react";
import { Card } from "./Card";

function useEscape(onClose: (() => void) | undefined) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export function Modal({
  title,
  onClose,
  tone,
  children,
  ariaLabel,
}: {
  title?: ReactNode;
  onClose?: () => void;
  tone?: "gold" | "aqua";
  children: ReactNode;
  ariaLabel?: string;
}) {
  useEscape(onClose);
  return (
    <div
      className="ds-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <Card tone={tone} className="ds-modal" onClick={(e) => e.stopPropagation()}>
        {title != null && <h2 className="ds-modal__title">{title}</h2>}
        {children}
      </Card>
    </div>
  );
}

export function Sheet({
  title,
  onClose,
  tone,
  children,
  ariaLabel,
}: {
  title?: ReactNode;
  onClose?: () => void;
  tone?: "gold";
  children: ReactNode;
  ariaLabel?: string;
}) {
  useEscape(onClose);
  return (
    <div
      className="ds-sheet-zone"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div
        className={`ds-sheet ${tone === "gold" ? "ds-sheet--gold" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ds-sheet__handle" />
        {title != null && <h2 className="ds-sheet__title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
