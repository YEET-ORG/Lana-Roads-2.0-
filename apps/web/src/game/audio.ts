/**
 * Chiptune-ish SFX synthesized with WebAudio — no audio assets to license.
 * Pitch is randomized ±10% so repeats never sound identical (Vlambeer rule).
 * The context is created lazily inside a user-gesture call stack, so
 * autoplay policies never block it; every call is safe to fire-and-forget.
 */

let ctx: AudioContext | null = null;

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

export const sfx = {
  hop() {
    blip({ type: "square", freq: 460, slide: 1.9, dur: 0.07, vol: 0.06 });
  },
  land() {
    blip({ type: "triangle", freq: 200, slide: 0.7, dur: 0.05, vol: 0.05 });
  },
  bump() {
    blip({ type: "square", freq: 130, slide: 0.8, dur: 0.06, vol: 0.07 });
  },
  kick() {
    blip({ type: "triangle", freq: 220, slide: 2.6, dur: 0.12, vol: 0.1 });
  },
  death() {
    blip({ type: "sawtooth", freq: 220, slide: 0.35, dur: 0.3, vol: 0.12 });
    blip({ type: "square", freq: 90, slide: 0.5, dur: 0.25, vol: 0.1 });
  },
  splash() {
    blip({ type: "sine", freq: 340, slide: 0.3, dur: 0.28, vol: 0.09 });
    blip({ type: "triangle", freq: 700, slide: 0.4, dur: 0.12, vol: 0.05 });
  },
  /** Rising two-note chime for score milestones. */
  milestone() {
    blip({ type: "square", freq: 660, slide: 1.02, dur: 0.09, vol: 0.08 });
    setTimeout(
      () => blip({ type: "square", freq: 880, slide: 1.4, dur: 0.14, vol: 0.08 }),
      70,
    );
  },
};
