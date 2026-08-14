/**
 * Chiptune-ish SFX synthesized with WebAudio — no audio assets to license.
 * Pitch is randomized ±10% so repeats never sound identical (Vlambeer rule).
 * The context is created lazily inside a user-gesture call stack, so
 * autoplay policies never block it; every call is safe to fire-and-forget.
 */

import { getSettings } from "../lib/settings";

let ctx: AudioContext | null = null;

/**
 * Player volume, applied at the point every sound is made.
 *
 * Muting has to happen HERE rather than at each call site: the scene, the
 * HUD and the input layer all make noise, and a switch any one of them can
 * forget is a switch that does not work.
 */
function gainScale(kind: "sfx" | "ambience"): number {
  const s = getSettings();
  if (kind === "sfx" && !s.sound) return 0;
  if (kind === "ambience" && !s.ambience) return 0;
  return Math.max(0, Math.min(1, s.volume));
}

function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface Blip {
  type: OscillatorType;
  freq: number;
  /** Multiplier the pitch slides to across the note (1 = flat). */
  slide?: number;
  dur: number;
  vol: number;
}

function blip({ type, freq, slide = 1, dur, vol }: Blip) {
  const scale = gainScale("sfx");
  if (scale <= 0) return;
  vol *= scale;
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime;
  const osc = a.createOscillator();
  const gain = a.createGain();
  const f = freq * (0.9 + Math.random() * 0.2);
  osc.type = type;
  osc.frequency.setValueAtTime(f, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseBurst(dur: number, vol: number, hp = 400, lp = 2400) {
  const scale = gainScale("sfx");
  if (scale <= 0) return;
  vol *= scale;
  const a = ac();
  if (!a) return;
  const n = a.sampleRate * dur;
  const buf = a.createBuffer(1, n, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = (hp + lp) / 2;
  filter.Q.value = 0.7;
  const gain = a.createGain();
  const t0 = a.currentTime;
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(gain).connect(a.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

let riverNodes: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let riverWanted = false;

function startRiver(a: AudioContext) {
  const n = a.sampleRate * 2;
  const buf = a.createBuffer(1, n, a.sampleRate);
  const data = buf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < n; i++) {
    b = b * 0.97 + (Math.random() * 2 - 1) * 0.03;
    data[i] = b + Math.sin(i * 0.012) * 0.04;
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filter = a.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 780;
  const gain = a.createGain();
  gain.gain.value = 0.0001;
  src.connect(filter).connect(gain).connect(a.destination);
  src.start();
  gain.gain.exponentialRampToValueAtTime(
    Math.max(0.0002, 0.028 * gainScale("ambience")),
    a.currentTime + 0.4,
  );
  riverNodes = { src, gain };
}

export const sfx = {
  hop() {
    blip({ type: "square", freq: 460, slide: 1.9, dur: 0.07, vol: 0.06 });
  },
  land() {
    blip({ type: "triangle", freq: 200, slide: 0.7, dur: 0.05, vol: 0.05 });
  },
  landGrass() {
    blip({ type: "triangle", freq: 210, slide: 0.72, dur: 0.045, vol: 0.045 });
  },
  landRoad() {
    blip({ type: "square", freq: 170, slide: 0.6, dur: 0.04, vol: 0.05 });
  },
  landRail() {
    blip({ type: "square", freq: 620, slide: 1.4, dur: 0.04, vol: 0.035 });
    blip({ type: "triangle", freq: 280, slide: 0.5, dur: 0.05, vol: 0.03 });
  },
  plip() {
    blip({ type: "sine", freq: 520, slide: 0.45, dur: 0.09, vol: 0.055 });
    blip({ type: "triangle", freq: 880, slide: 0.5, dur: 0.06, vol: 0.03 });
    noiseBurst(0.07, 0.035, 600, 2200);
  },
  bump() {
    blip({ type: "square", freq: 130, slide: 0.8, dur: 0.06, vol: 0.07 });
  },
  kick() {
    blip({ type: "triangle", freq: 220, slide: 2.6, dur: 0.12, vol: 0.1 });
  },
  click() {
    blip({ type: "square", freq: 520, slide: 1.15, dur: 0.04, vol: 0.04 });
  },
  confirm() {
    blip({ type: "square", freq: 440, slide: 1.5, dur: 0.07, vol: 0.06 });
    setTimeout(
      () => blip({ type: "square", freq: 660, slide: 1.05, dur: 0.08, vol: 0.05 }),
      50,
    );
  },
  death() {
    blip({ type: "sawtooth", freq: 220, slide: 0.35, dur: 0.3, vol: 0.12 });
    blip({ type: "square", freq: 90, slide: 0.5, dur: 0.25, vol: 0.1 });
  },
  splash() {
    blip({ type: "sine", freq: 340, slide: 0.3, dur: 0.28, vol: 0.09 });
    blip({ type: "triangle", freq: 700, slide: 0.4, dur: 0.12, vol: 0.05 });
    noiseBurst(0.18, 0.06, 400, 1800);
  },
  whoosh() {
    noiseBurst(0.16, 0.045, 200, 900);
    blip({ type: "sine", freq: 140, slide: 0.55, dur: 0.14, vol: 0.03 });
  },
  horn() {
    blip({ type: "sawtooth", freq: 196, slide: 0.98, dur: 0.28, vol: 0.07 });
    blip({ type: "square", freq: 247, slide: 1.01, dur: 0.32, vol: 0.05 });
  },
  bell() {
    blip({ type: "triangle", freq: 880, slide: 0.97, dur: 0.16, vol: 0.07 });
    setTimeout(
      () => blip({ type: "triangle", freq: 660, slide: 0.97, dur: 0.14, vol: 0.055 }),
      140,
    );
  },
  /** Rising two-note chime for score milestones. */
  milestone() {
    blip({ type: "square", freq: 660, slide: 1.02, dur: 0.09, vol: 0.08 });
    setTimeout(
      () => blip({ type: "square", freq: 880, slide: 1.4, dur: 0.14, vol: 0.08 }),
      70,
    );
  },
  fanfare() {
    blip({ type: "square", freq: 523, slide: 1.02, dur: 0.1, vol: 0.07 });
    setTimeout(
      () => blip({ type: "square", freq: 659, slide: 1.02, dur: 0.1, vol: 0.07 }),
      80,
    );
    setTimeout(
      () => blip({ type: "square", freq: 784, slide: 1.2, dur: 0.18, vol: 0.08 }),
      160,
    );
  },
  /** Soft looping river bed. Safe to call every frame with a bool. */
  river(on: boolean) {
    // An ambience the player switched off is never "wanted", or it would
    // start itself again the next time the loop restarts.
    on = on && gainScale("ambience") > 0;
    riverWanted = on;
    const a = ac();
    if (!a) return;
    if (on && !riverNodes) startRiver(a);
    if (!on && riverNodes) {
      const nodes = riverNodes;
      riverNodes = null;
      nodes.gain.gain.cancelScheduledValues(a.currentTime);
      nodes.gain.gain.setValueAtTime(
        Math.max(0.0001, nodes.gain.gain.value),
        a.currentTime,
      );
      nodes.gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.35);
      setTimeout(() => {
        try {
          nodes.src.stop();
        } catch {
          /* already stopped */
        }
        if (riverWanted && !riverNodes) {
          const again = ac();
          if (again) startRiver(again);
        }
      }, 380);
    }
  },
};
