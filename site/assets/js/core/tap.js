// The scale as an input device.
//
// Everything about this app happens with a portafilter in one hand and a wet
// cloth in the other, two metres from the laptop. The scale is already under
// your hands and already streaming ten times a second, which makes it the only
// control surface in the room you can reach — so it should be one.
//
// A finger tapped on the platter is unmistakable in the raw stream: a sharp
// excursion of tens of grams that returns to exactly where it started, inside a
// couple of hundred milliseconds. Nothing else a scale sees does that. A cup
// landing steps up and STAYS up. Coffee arriving climbs at a couple of grams a
// second. A drip lands and stays. The signature that matters is not the size of
// the excursion but the return: same baseline, quickly.
//
// This reads the RAW stream deliberately. The Kalman filter's whole job is to
// treat a 40 g spike lasting 150 ms as measurement noise and remove it, which
// is correct for weighing and fatal for this.

/**
 * What a gesture is worth reacting to. Tuned for a finger on a platter.
 *
 * A lone long press is NOT a gesture, and the reason is worth writing down: a
 * cup set on the scale and lifted off a second later produces exactly that
 * signal, and so does a scale-side tare, where the reading drops back to zero
 * with nothing having moved. Both happen constantly during normal use. So the
 * hold is a compound: two taps and then a press. Nothing anyone does with a
 * cup taps the platter twice first.
 */
export const DEFAULTS = {
  threshold: 12,     // g above baseline that counts as a press at all
  returnBand: 1.5,   // g, how close to the old baseline "it came back" means
  maxTapMs: 300,     // longer than this and it is not a tap
  minHoldMs: 700,    // held at least this long and it is a hold
  gapMs: 420,        // how long to wait for the next tap of a chord
  settleMs: 250,     // quiet time before the baseline is trusted again
  maxObjectMs: 1250, // above threshold longer than this: something was put down
};

/**
 * Reads a weight stream and emits gestures.
 *
 * Pure and synchronous: hand it samples, take back a gesture or null. No DOM,
 * no timers — a timer would fire on wall-clock time while the samples carry
 * scale time, and the two disagree the moment a frame is late.
 */
export class TapListener {
  constructor(opts = {}) {
    this.opt = { ...DEFAULTS, ...opts };
    this.enabled = true;
    this.reset();
  }

  reset(baseline = null) {
    this.baseline = baseline;
    this.press = null;    // { startT, peak } while above threshold
    this.taps = [];       // times of taps in the chord being assembled
    this.lastT = null;
    this.quietUntil = null;
    return this;
  }

  /** Ignore the platter for a while — used across a tare or a step change. */
  mute(seconds = 0.6, at = this.lastT) {
    if (Number.isFinite(at)) this.quietUntil = at + seconds;
    this.press = null;
    this.taps = [];
    return this;
  }

  /**
   * Feed one raw sample.
   *
   * @param {number} at seconds, monotonic, from the same clock as the frames
   * @param {number} w  raw grams, before any filtering or tare
   * @returns {{type: 'double'|'triple'|'hold', at: number, taps: number}|null}
   */
  push(at, w) {
    if (!Number.isFinite(at) || !Number.isFinite(w)) return null;
    this.lastT = at;
    if (this.baseline === null) { this.baseline = w; return null; }
    if (!this.enabled) { this.baseline = w; this.taps = []; this.press = null; return null; }
    if (this.quietUntil !== null) {
      if (at < this.quietUntil) { this.baseline = w; return null; }
      this.quietUntil = null;
    }

    const dev = w - this.baseline;
    const ms = (t) => (at - t) * 1000;

    if (this.press === null) {
      // A press starts when the platter is pushed. Only downward-resisting
      // presses count: lifting a cup off is a negative excursion, and it is
      // never a command — you are carrying something.
      if (dev > this.opt.threshold) {
        this.press = { startT: at, peak: dev };
        return null;
      }
      // Not pressed: track the baseline slowly. Slowly, because this has to
      // follow a scale warming up and drifting without chasing a real pour, and
      // because a baseline that snapped to every sample would make the return
      // test meaningless.
      this.baseline += (w - this.baseline) * 0.12;
      return this.settle(at);
    }

    // Mid-press.
    this.press.peak = Math.max(this.press.peak, dev);
    const held = ms(this.press.startT);

    if (dev > this.opt.threshold * 0.35) {
      // Still down. Long enough and it stopped being a gesture: something was
      // put on the scale, so adopt the new weight as the baseline and forget it.
      if (held > this.opt.maxObjectMs) {
        this.press = null;
        this.taps = [];
        this.baseline = w;
      }
      return null;
    }

    // Came back. Which gesture depends only on how long it was down.
    const back = Math.abs(w - this.baseline) <= this.opt.returnBand;
    this.press = null;
    if (!back) {
      // It returned to somewhere else — a cup lifted, a spill, a knock that
      // moved something. Not a gesture, and the baseline is now wrong.
      this.taps = [];
      this.baseline = w;
      return null;
    }
    if (held >= this.opt.minHoldMs) {
      // Only a hold if it was announced by a chord. On its own this is a cup
      // being lifted, or a tare, or someone leaning on the counter.
      const announced = this.taps.length >= 2;
      this.taps = [];
      return announced ? { type: 'hold', at, taps: 2 } : null;
    }
    if (held <= this.opt.maxTapMs) {
      this.taps.push(at);
      // Three is the longest chord worth having; emit it without waiting for a
      // fourth that is not coming.
      if (this.taps.length >= 3) {
        this.taps = [];
        return { type: 'triple', at, taps: 3 };
      }
    }
    return null;
  }

  /** Close out a chord once the gap has passed with nothing more arriving. */
  settle(at) {
    if (!this.taps.length) return null;
    if ((at - this.taps[this.taps.length - 1]) * 1000 < this.opt.gapMs) return null;
    const n = this.taps.length;
    this.taps = [];
    // A single tap is never a command. A scale on a counter beside a machine
    // gets knocked, and a one-tap vocabulary would fire the moment someone set
    // a spoon down. Two is the cheapest gesture nobody performs by accident.
    return n >= 2 ? { type: 'double', at, taps: n } : null;
  }
}

/* ------------------------------------------------------------------ binding */

/**
 * What each gesture means, given where the session is.
 *
 * Kept as data rather than a switch inside the page, because this table is the
 * thing that will grow: the gestures are a control surface, and the next things
 * to hang off it — switching brew method, starting a pour-over timer — are new
 * rows here rather than new code anywhere.
 *
 * `hold` is deliberately the same everywhere. A gesture that means five things
 * depending on invisible state is a gesture nobody trusts.
 */
export const BINDINGS = {
  dose:  { double: 'capture', triple: 'tare', hold: 'method' },
  grind: { double: 'capture', triple: 'tare', hold: 'method' },
  brew:  { double: 'stop',    triple: 'tare', hold: 'method' },
  rate:  { double: 'next',    triple: null,   hold: 'method' },
  setup: { double: 'next',    triple: 'tare', hold: 'method' },
};

/** Human-readable, for the hint line and for the help panel. */
export const ACTION_LABEL = {
  capture: 'take this weight and move on',
  tare: 'tare',
  stop: 'stop the shot',
  next: 'next step',
  method: 'change brew method',
};

export function actionFor(step, gesture) {
  return BINDINGS[step]?.[gesture] ?? null;
}

/** The one-line reminder of what the platter will do right now. */
export function gestureHint(step) {
  const b = BINDINGS[step];
  if (!b) return '';
  const parts = [];
  if (b.double) parts.push(`double-tap the scale to ${ACTION_LABEL[b.double]}`);
  if (b.triple) parts.push(`triple-tap to ${ACTION_LABEL[b.triple]}`);
  if (b.hold) parts.push(`double-tap then hold to ${ACTION_LABEL[b.hold]}`);
  return parts.join(', ') + '.';
}
