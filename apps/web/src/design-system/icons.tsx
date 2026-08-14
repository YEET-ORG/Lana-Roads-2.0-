/**
 * Original Voxel Arcade icons — inline SVG, blocky geometry on a 24x24
 * grid, drawn for this project (no emoji, no text glyphs, no copied
 * reference-game artwork). Fill icons use `currentColor`.
 */
import type { CSSProperties } from "react";

export type IconName =
  | "play"
  | "close"
  | "chevron-left"
  | "chevron-right"
  | "ticket"
  | "wallet"
  | "user"
  | "users"
  | "switch"
  | "copy"
  | "check"
  | "alert"
  | "timer"
  | "skull"
  | "trophy"
  | "kick"
  | "spark"
  | "exit"
  | "signal"
  | "vault"
  | "flag"
  | "lock"
  | "key"
  | "percent"
  | "heart"
  | "paw"
  | "drop"
  | "calendar"
  | "coin"
  | "target"
  | "external"
  | "gear";

const PATHS: Record<IconName, JSX.Element> = {
  play: (
    <path d="M7 4.5v15c0 .9 1 1.5 1.8 1L20 13a1.2 1.2 0 0 0 0-2L8.8 3.5c-.8-.5-1.8.1-1.8 1Z" />
  ),
  close: (
    <path
      d="M6 6l12 12M18 6L6 18"
      stroke="currentColor"
      strokeWidth={3.2}
      strokeLinecap="square"
      fill="none"
    />
  ),
  "chevron-left": (
    <path
      d="M14.5 5L8 12l6.5 7"
      stroke="currentColor"
      strokeWidth={3.4}
      strokeLinecap="square"
      strokeLinejoin="miter"
      fill="none"
    />
  ),
  "chevron-right": (
    <path
      d="M9.5 5L16 12l-6.5 7"
      stroke="currentColor"
      strokeWidth={3.4}
      strokeLinecap="square"
      strokeLinejoin="miter"
      fill="none"
    />
  ),
  ticket: (
    <path d="M3 7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3.2a2.3 2.3 0 0 0 0 3.6V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3.2a2.3 2.3 0 0 0 0-3.6V7Zm10 1.5v2h2v-2h-2Zm0 5v2h2v-2h-2Z" />
  ),
  wallet: (
    <path d="M4 6a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v1h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Zm12.5 6.5a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z" />
  ),
  user: (
    <path d="M12 3a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4Zm-7 16.5C5 16 8 14.5 12 14.5s7 1.5 7 5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-1.5Z" />
  ),
  switch: <path d="M7 4 3 8l4 4V9.5h9v-3H7V4Zm10 8 4 4-4 4v-2.5H8v-3h9V12Z" />,
  gear: (
    <path d="M10.2 2h3.6l.5 2.5 1.6.9 2.3-1.1 2.5 2.5-1.1 2.3.9 1.6 2.5.5v3.6l-2.5.5-.9 1.6 1.1 2.3-2.5 2.5-2.3-1.1-1.6.9-.5 2.5h-3.6l-.5-2.5-1.6-.9-2.3 1.1L3.3 19l1.1-2.3-.9-1.6L1 14.6v-3.6l2.5-.5.9-1.6L3.3 6.6 5.8 4.1l2.3 1.1 1.6-.9L10.2 2Zm1.8 6.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z" />
  ),
  external: (
    <path d="M13 3h8v8h-2.6V7.4l-7 7-1.8-1.8 7-7H13V3ZM4 6h6v2.4H6.4v9.2h9.2V14H18v6H4V6Z" />
  ),
  copy: (
    <path d="M8 8h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm-3 8H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1h-2V5H5v9Z" />
  ),
  check: (
    <path
      d="M4.5 12.5l5 5L19.5 7"
      stroke="currentColor"
      strokeWidth={3.4}
      strokeLinecap="square"
      strokeLinejoin="miter"
      fill="none"
    />
  ),
  alert: (
    <path d="M12 2.5 22.5 20a1 1 0 0 1-.87 1.5H2.37A1 1 0 0 1 1.5 20L12 2.5Zm-1.2 7v5h2.4v-5h-2.4Zm0 7v2.4h2.4v-2.4h-2.4Z" />
  ),
  timer: (
    <path d="M9 2h6v2.5H9V2Zm3 5a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm1.2 4v5.2l4 2.4-1.2 2-5.2-3.1V11h2.4Z" />
  ),
  skull: (
    <path d="M12 2a8 8 0 0 0-8 8c0 3 1.6 5.3 4 6.6V20a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 16 20v-3.4c2.4-1.3 4-3.6 4-6.6a8 8 0 0 0-8-8ZM8.5 12a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm7 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4ZM10 17h1.5v3H10v-3Zm2.5 0H14v3h-1.5v-3Z" />
  ),
  trophy: (
    <path d="M6 3h12a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1c0 3.2-2 5.4-4.6 6.2A6 6 0 0 1 13.5 15v2.5H17a1 1 0 0 1 1 1V21a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-2.5a1 1 0 0 1 1-1h3.5V15a6 6 0 0 1-3.9-2.8C4 11.4 2 9.2 2 6a1 1 0 0 1 1-1h2V4a1 1 0 0 1 1-1ZM5 7.2c.3 1.2 1 2.1 2 2.6V7.2H5Zm14 0h-2v2.6c1-.5 1.7-1.4 2-2.6Z" />
  ),
  kick: (
    <path d="M4 3h6a1 1 0 0 1 1 1v6.6l2.8 1.4H19a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm6 14.5h9V19a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-1.5h1Z" />
  ),
  spark: (
    <path d="M12 2l2.2 6.1L21 10l-6.8 1.9L12 18l-2.2-6.1L3 10l6.8-1.9L12 2Zm7 13 1 2.8 2.8 1-2.8 1L19 22l-1-2.2-2.8-1 2.8-1 1-2.8Z" />
  ),
  exit: (
    <path d="M10 3h9a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-9v-3h8V6h-8V3Zm-1.5 7.5H2v3h6.5V17l5-5-5-5v3.5Z" />
  ),
  signal: <path d="M4 14h3v7H4v-7Zm6-5h3v12h-3V9Zm6-6h3v18h-3V3Z" />,
  users: (
    <path d="M8.5 4a3.5 3.5 0 0 1 3.5 3.5v.8a3.5 3.5 0 0 1-7 0v-.8A3.5 3.5 0 0 1 8.5 4Zm8 1.5a3 3 0 0 1 3 3v.7a3 3 0 0 1-6 0v-.7a3 3 0 0 1 3-3ZM2 19.2C2 16.1 4.9 14.8 8.5 14.8s6.5 1.3 6.5 4.4V20a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-.8Zm15 1.8v-1.6c0-1.4-.4-2.5-1.1-3.4 2.6.3 4.6 1.3 4.6 3.4V20a1 1 0 0 1-1 1H17Z" />
  ),
  vault: (
    <path d="M4 4h16a1 1 0 0 1 1 1v2.5H3V5a1 1 0 0 1 1-1Zm-1 5.5h18V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.5Zm9 2.3a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4Zm0 1.8a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Z" />
  ),
  flag: (
    <path d="M5 2h2.5v20H5V2Zm4.5 1H20a1 1 0 0 1 .8 1.6L17.6 9l3.2 4.4A1 1 0 0 1 20 15H9.5V3Z" />
  ),
  lock: (
    <path d="M12 2a5 5 0 0 1 5 5v3h1a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 18 21H6a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 6 10h1V7a5 5 0 0 1 5-5Zm0 2.5A2.5 2.5 0 0 0 9.5 7v3h5V7A2.5 2.5 0 0 0 12 4.5Zm0 8.2a1.9 1.9 0 0 0-.9 3.6v1.2a.9.9 0 0 0 1.8 0v-1.2a1.9 1.9 0 0 0-.9-3.6Z" />
  ),
  key: (
    <path d="M14.5 2A7.5 7.5 0 0 0 7.2 12.9L2.6 17.5a1 1 0 0 0-.3.7V21a1 1 0 0 0 1 1h2.8a1 1 0 0 0 .7-.3l1-1v-2h2l1.2-1.2A7.5 7.5 0 1 0 14.5 2Zm1 4a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" />
  ),
  percent: (
    <path d="M7 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM17 13a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM18.9 3.3l2 1.4-13.8 17-2-1.4 13.8-17Z" />
  ),
  heart: (
    <path d="M12 21S3 14.8 3 8.9C3 5.6 5.5 3 8.6 3c1.4 0 2.7.6 3.4 1.5C12.7 3.6 14 3 15.4 3 18.5 3 21 5.6 21 8.9c0 5.9-9 12.1-9 12.1Z" />
  ),
  paw: (
    <path d="M8 3a2.4 2.4 0 0 1 2.4 2.4v1.4a2.4 2.4 0 0 1-4.8 0V5.4A2.4 2.4 0 0 1 8 3Zm8 0a2.4 2.4 0 0 1 2.4 2.4v1.4a2.4 2.4 0 0 1-4.8 0V5.4A2.4 2.4 0 0 1 16 3ZM4 8.5A2.4 2.4 0 0 1 6.4 11v1.4a2.4 2.4 0 0 1-4.8 0V11A2.4 2.4 0 0 1 4 8.5Zm16 0a2.4 2.4 0 0 1 2.4 2.5v1.4a2.4 2.4 0 0 1-4.8 0V11A2.4 2.4 0 0 1 20 8.5ZM12 11c3.2 0 6.5 2.6 6.5 5.9 0 2.2-1.7 4.1-4 4.1-1 0-1.7-.4-2.5-.4s-1.5.4-2.5.4c-2.3 0-4-1.9-4-4.1C5.5 13.6 8.8 11 12 11Z" />
  ),
  drop: (
    <path d="M12 2s6.5 7.4 6.5 12.3a6.5 6.5 0 0 1-13 0C5.5 9.4 12 2 12 2Zm0 16.5a3 3 0 0 1-3-3h2a1 1 0 0 0 1 1v2Z" />
  ),
  calendar: (
    <path d="M7 2h2.5v3H7V2Zm7.5 0H17v3h-2.5V2ZM4 4h16a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1.5 6.5v2h3v-2h-3Zm5 0v2h3v-2h-3Zm5 0v2h3v-2h-3Zm-10 5v2h3v-2h-3Zm5 0v2h3v-2h-3Z" />
  ),
  coin: (
    <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm-1 2.5h2V9h2.5v2H13v2h2.5v2H13v1.5h-2V15H8.5v-2H11v-2H8.5V9H11V7.5Z" />
  ),
  target: (
    <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
  ),
};

export function Icon({
  name,
  size = 20,
  style,
  title,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <svg
      className="ds-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={style}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
