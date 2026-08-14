/**
 * Settings: everything a player can change about how the game behaves,
 * in one sheet reachable from the menu and from inside a run.
 *
 * The world does not pause behind it — this is a live multiplayer game and
 * a settings screen is not a shield, so the sheet says so rather than
 * pretending otherwise.
 */
import { useEffect, useState } from "react";
import type { ErRoute } from "@crossy-world/sdk";
import { Button, Notice, Sheet } from "../../design-system";
import type { Bootstrapped } from "../../lib/client";
import {
  resetSettings,
  setSetting,
  useSettings,
  type Settings,
  type ToastMode,
} from "../../lib/settings";
import { sfx } from "../../game/audio";

/** One row: a label, an explanation, and a set of mutually exclusive picks. */
function Choice<T extends string | number | boolean>({
  label,
  hint,
  value,
  options,
  onPick,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string }[];
  onPick: (v: T) => void;
}) {
  return (
    <div className="setting">
      <div className="setting__text">
        <span className="setting__label">{label}</span>
        {hint && <span className="setting__hint">{hint}</span>}
      </div>
      <div className="setting__choices" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            className={`setting__choice${o.value === value ? " is-on" : ""}`}
            aria-pressed={o.value === value}
            onClick={() => {
              sfx.click();
              onPick(o.value);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "https://devnet-as.magicblock.app/" -> "as" */
function hostTag(fqdn: string): string {
  const host = fqdn.replace(/^https?:\/\//, "").split(/[./]/)[0] ?? fqdn;
  return host.replace(/^devnet-/, "");
}

const ON_OFF = [
  { value: true, label: "On" },
  { value: false, label: "Off" },
];

export function SettingsSheet({
  boot,
  onClose,
}: {
  boot: Bootstrapped | null;
  onClose: () => void;
}) {
  const s = useSettings();
  const [routes, setRoutes] = useState<ErRoute[] | null>(null);
  const [regionChanged, setRegionChanged] = useState(false);

  // The rollup directory is live: which regions exist is the router's
  // answer, not a list baked into this build.
  useEffect(() => {
    if (!boot?.client.routerUrl) return;
    let live = true;
    boot.client
      .getRoutes()
      .then((r) => live && setRoutes(r))
      .catch(() => live && setRoutes([]));
    return () => {
      live = false;
    };
  }, [boot]);

  const set =
    <K extends keyof Settings>(k: K) =>
    (v: Settings[K]) =>
      setSetting(k, v);

  return (
    <Sheet title="Settings" ariaLabel="Settings" onClose={onClose}>
      <Notice tone="info">The world keeps running while this is open.</Notice>

      <h3 className="setting-group">Transactions</h3>
      <Choice<ToastMode>
        label="Receipts"
        hint="Every move is a real transaction. Choose how much of that you want to see."
        value={s.toasts}
        options={[
          { value: "stack", label: "Stack" },
          { value: "single", label: "One line" },
          { value: "off", label: "Off" },
        ]}
        onPick={set("toasts")}
      />
      <Choice
        label="Live status"
        hint="Players online and rollup latency, bottom-left."
        value={s.showStatus}
        options={ON_OFF}
        onPick={set("showStatus")}
      />

      <h3 className="setting-group">Sound &amp; feel</h3>
      <Choice
        label="Sound effects"
        value={s.sound}
        options={ON_OFF}
        onPick={(v) => {
          set("sound")(v);
          if (v) sfx.confirm();
        }}
      />
      <Choice
        label="Ambience"
        hint="The river and traffic bed."
        value={s.ambience}
        options={ON_OFF}
        onPick={set("ambience")}
      />
      <Choice
        label="Volume"
        value={s.volume}
        options={[
          { value: 0.35, label: "Low" },
          { value: 0.8, label: "Normal" },
          { value: 1, label: "Loud" },
        ]}
        onPick={(v) => {
          set("volume")(v);
          sfx.hop();
        }}
      />
      <Choice
        label="Vibration"
        hint="Hop, kick and death feedback on phones."
        value={s.haptics}
        options={ON_OFF}
        onPick={set("haptics")}
      />
      <Choice
        label="Reduced motion"
        hint="Trims non-essential animation."
        value={s.reduceMotion}
        options={ON_OFF}
        onPick={set("reduceMotion")}
      />

      <h3 className="setting-group">Connection</h3>
      <div className="setting">
        <div className="setting__text">
          <span className="setting__label">Rollup region</span>
          <span className="setting__hint">
            Every move is answered by an ephemeral rollup. The nearest one is the fastest
            — but a world lives on exactly one, so pinning the wrong region means playing
            alone.
          </span>
        </div>
        <div className="setting__choices setting__choices--wrap">
          {[
            { value: "auto", label: "Auto" },
            // Two rollups can share a country, so the country code alone is
            // an ambiguous label. The host name is what distinguishes them.
            ...(routes ?? []).map((r) => ({
              value: r.fqdn,
              label: `${r.countryCode} · ${hostTag(r.fqdn)}`,
            })),
          ].map((o) => (
            <button
              key={o.value}
              className={`setting__choice${o.value === s.region ? " is-on" : ""}`}
              aria-pressed={o.value === s.region}
              onClick={() => {
                sfx.click();
                setSetting("region", o.value);
                setRegionChanged(true);
              }}
            >
              {o.label}
            </button>
          ))}
          {routes == null && <span className="setting__hint">loading regions…</span>}
        </div>
      </div>
      {regionChanged && (
        <Notice tone="warn">
          The region applies on reload — the client holds one connection for the whole
          session.
          <div className="row">
            <Button variant="info" onClick={() => window.location.reload()}>
              Reload now
            </Button>
          </div>
        </Notice>
      )}

      <div className="row">
        <Button variant="ghost" onClick={() => resetSettings()}>
          Reset to defaults
        </Button>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Sheet>
  );
}
