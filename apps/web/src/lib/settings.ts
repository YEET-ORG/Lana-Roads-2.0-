/**
 * Player settings: one small store, persisted, readable outside React.
 *
 * The renderer, the audio engine and the input layer all need these and
 * none of them are React components, so the source of truth is a plain
 * object with a subscription rather than a context. `useSettings` is a thin
 * hook over the same store.
 */
import { useSyncExternalStore } from "react";

export type ToastMode = "stack" | "single" | "off";

export interface Settings {
  /** How transaction receipts are shown: a stack, one rolling line, or none. */
  toasts: ToastMode;
  /** Gameplay sound effects. */
  sound: boolean;
  /** Ambient world loop (river, traffic). */
  ambience: boolean;
  /** 0..1, applied to everything the audio engine plays. */
  volume: number;
  /** Controller/phone vibration on hop, kick and death. */
  haptics: boolean;
  /** The live player count and rollup latency chips. */
  showStatus: boolean;
  /**
   * Which rollup REGION to play in: "auto" measures round-trip time to each
   * and picks the nearest; otherwise a region id from lib/regions.
   *
   * This is not a transport preference. Each region runs its own world, so it
   * decides which players you meet and which prize pot you play for. Changing
   * it rebuilds the client, so it applies on the next boot.
   */
  region: string;
  /** Trim non-essential animation for motion sensitivity and weak GPUs. */
  reduceMotion: boolean;
  /**
   * Hold a direction to keep hopping.
   *
   * Each repeat is an ordinary sequenced action through the same outbox, and
   * the repeat interval is far slower than the program's one-move-per-slot
   * limit, so this changes how it feels and nothing about what authority
   * accepts. Off restores strict one-press-one-hop.
   */
  holdToRun: boolean;
  /**
   * Draw the tiles traffic legally occupies right now.
   *
   * Cars are smoothed between the program's whole-second steps, so the
   * body on screen is not exactly the span that collides. This shows the
   * span that does.
   */
  hazardMarks: boolean;
}

const KEY = "crossy-world:settings";

export const DEFAULT_SETTINGS: Settings = {
  toasts: "stack",
  sound: true,
  ambience: true,
  volume: 0.8,
  haptics: true,
  showStatus: true,
  region: "auto",
  reduceMotion: false,
  holdToRun: true,
  hazardMarks: true,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    // Merge over defaults so a setting added later is never `undefined`
    // for a player who saved before it existed.
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

/** Read the settings outside React (renderer, audio, input). */
export function getSettings(): Settings {
  return current;
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  if (current[key] === value) return;
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode: the session still works, it just will not be remembered.
  }
  for (const l of listeners) l();
}

export function resetSettings() {
  current = { ...DEFAULT_SETTINGS };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings, () => DEFAULT_SETTINGS);
}

/** Vibrate only if the player wants it and the device can. */
export function haptic(pattern: number | number[]) {
  if (!current.haptics) return;
  navigator.vibrate?.(pattern);
}
