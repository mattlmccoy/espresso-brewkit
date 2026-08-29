// Sound and vibration, for the moments you are not looking at the screen.
//
// The whole point of the phone viewer is that the laptop is somewhere else and
// you are standing at the machine with your hands full. A number changing on a
// screen you are not looking at is not feedback. A short tone when the dose
// lands in its window, and a countdown as the cup approaches your yield, is.
//
// WHY SYNTHESISED. Three short tones would be three audio files to host, cache
// and get wrong on a phone that has never had them. WebAudio makes them from
// nothing, in about twenty lines, with no network and no assets — and lets the
// pitch carry meaning rather than the timbre: rising for "that is your dose",
// falling for "stop", a soft tick for counting down.
//
// WHY IT WAITS FOR A GESTURE. Browsers refuse to start audio until the user has
// interacted with the page, and iOS is the strictest about it. Rather than fail
// silently on the device this matters most on, the context is created on the
// first real interaction and a page that has not had one says so.

let ctx = null;
let armed = false;

/** Must be called from a user gesture; safe to call repeatedly. */
export function arm() {
  if (armed) return true;
  try {
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctor) return false;
    ctx = ctx ?? new Ctor();
    ctx.resume?.();
    armed = ctx.state === 'running';
    return armed;
  } catch {
    return false;
  }
}

export const isArmed = () => armed;

/**
 * One tone. Short, quiet, and shaped: a raw gate on an oscillator clicks at
 * both ends, which sounds like a fault rather than a cue.
 */
export function tone(freq, { ms = 120, gain = 0.16, type = 'sine' } = {}) {
  if (!armed || !ctx) return false;
  try {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
    return true;
  } catch {
    return false;
  }
}

export function buzz(pattern) {
  try { return navigator.vibrate?.(pattern) ?? false; } catch { return false; }
}

/** Pitch carries the meaning, so the cues stay distinguishable across a room. */
export const CUES = {
  // The session's own beats. These are confirmations rather than alarms: they
  // say "that registered" at moments when you are looking at a portafilter
  // rather than at a screen, which is most of them.
  tared:    () => { tone(420, { ms: 55, gain: 0.09 }); buzz(18); },
  captured: () => { tone(560, { ms: 70 }); setTimeout(() => tone(760, { ms: 110 }), 72); buzz(30); },
  stepped:  () => { tone(500, { ms: 60, gain: 0.1 }); setTimeout(() => tone(620, { ms: 90, gain: 0.1 }), 62); },
  undone:   () => { tone(620, { ms: 70 }); setTimeout(() => tone(430, { ms: 110 }), 72); buzz(30); },
  // Your dose landed in its window: a rising pair, the sound of arriving.
  target: () => { tone(660, { ms: 90 }); setTimeout(() => tone(880, { ms: 140 }), 95); buzz(40); },
  // Counting down to the yield: a soft tick, once a second, no vibration.
  tick: () => tone(520, { ms: 55, gain: 0.1 }),
  // Cut it now: a falling pair, and a longer buzz.
  stop: () => { tone(880, { ms: 90 }); setTimeout(() => tone(520, { ms: 170 }), 95); buzz([50, 40, 90]); },
  // Something is wrong with the shot while it is still running.
  warn: () => { tone(320, { ms: 220, type: 'square', gain: 0.09 }); buzz([30, 60, 30]); },
};

/**
 * Fires each cue once per occasion rather than once per frame.
 *
 * A cue that repeats ten times a second is not a cue, it is an alarm — and the
 * conditions here are all sampled from a 10 Hz stream. The gate resets when the
 * condition clears, so the next dose gets its own tone.
 */
export class CueGate {
  constructor({ enabled = true } = {}) {
    this.enabled = enabled;
    this.state = new Map();
  }

  /** @returns true when this is a fresh edge and the cue actually fired. */
  edge(name, condition, fire) {
    const was = this.state.get(name) ?? false;
    this.state.set(name, condition);
    if (!condition || was || !this.enabled) return false;
    fire?.();
    return true;
  }

  /** For the countdown, which repeats deliberately but only once a second. */
  every(name, seconds, fire) {
    const last = this.state.get(`t:${name}`) ?? -Infinity;
    if (seconds === null || !Number.isFinite(seconds)) return false;
    const step = Math.ceil(seconds);
    if (step === last || !this.enabled) return false;
    this.state.set(`t:${name}`, step);
    fire?.();
    return true;
  }

  reset() { this.state.clear(); }
}
