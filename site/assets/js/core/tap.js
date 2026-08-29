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
    this._still = [];     // recent samples, for spotting a new resting level
    return this;
  }

  /**
   * Snap the baseline whenever the platter is demonstrably still somewhere new.
   *
   * Without this the baseline only creeps, and creeping is too slow after a
   * real event: lift a 70 g cup off and the baseline is still somewhere near 10
   * a second and a half later, so the first tap after it returns to a level the
   * baseline does not recognise and is thrown away. Which is precisely the
   * moment someone reaches over to undo.
   *
   * A tap can never trigger this, because a tap is not still — it is up and
   * back inside 300 ms, and this wants a third of a second of quiet.
   */
  _resettle(at, w) {
    this._still.push([at, w]);
    while (this._still.length && at - this._still[0][0] > 0.35) this._still.shift();
    if (this._still.length < 3) return false;
    const vals = this._still.map((r) => r[1]);
    const quiet = Math.max(...vals) - Math.min(...vals) < this.opt.returnBand;
    if (!quiet || Math.abs(w - this.baseline) <= this.opt.returnBand) return false;
    this.baseline = w;
    return true;
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
      // Not pressed. The baseline creeps, to follow a scale warming up without
      // chasing a real pour — and snaps outright once the platter has been
      // demonstrably still at a new level, which is what a cup landing or
      // coming off actually looks like.
      if (!this._resettle(at, w)) this.baseline += (w - this.baseline) * 0.12;
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
 * What each gesture means, and — more importantly — where it means nothing.
 *
 * THE RULE: a gesture is never bound while the scale is measuring something.
 *
 * This is a correctness constraint, not a preference. A tap is a sixty-gram
 * excursion, and sixty grams arriving in one frame is not noise to a flow
 * estimator: driven through the real filter, a two-tap gesture during a shot
 * takes the reported flow rate from 1.51 g/s to 167 g/s. That would trip the
 * predictive stop, corrupt the stored curve, and poison every model downstream
 * that reads it. The gesture would have destroyed the measurement it was part
 * of.
 *
 * So the vocabulary lives in the gaps: choosing what to make, correcting a
 * mistake, and starting again. Which turns out to be exactly where gestures
 * were needed anyway, because those are the things the scale cannot work out
 * for itself. Capturing a dose and stopping a shot are automated already —
 * binding a gesture to them spent the vocabulary on nothing.
 *
 * `live` says which phases accept gestures at all. Everything else in a step
 * is measuring, and is left alone.
 */
export const BINDINGS = {
  setup: { live: null, double: 'begin', triple: null, hold: 'method' },
  // Only while looking for a vessel: during a fill there is a weight being
  // taken, and a tap would land in the middle of it.
  dose:  { live: ['vessel'], double: 'undo', triple: 'tare', hold: 'method' },
  grind: { live: ['vessel'], double: 'undo', triple: 'tare', hold: 'method' },
  milk:  { live: ['vessel'], double: 'undo', triple: 'tare', hold: 'method' },
  // Nothing at all. The cup is on the platter and the curve is being recorded.
  brew:  { live: [], double: null, triple: null, hold: null },
  rate:  { live: null, double: 'next-shot', triple: 'discard', hold: 'method' },
};

/** Human-readable, for the hint line and for the help panel. */
export const ACTION_LABEL = {
  begin: 'start with this coffee',
  undo: 'take back the last weight',
  tare: 'tare',
  'next-shot': 'start the next shot',
  discard: 'throw this shot away',
  method: 'change brew method',
};

/**
 * The action for a gesture here, or null.
 *
 * @param phase the session's phase; when the step restricts gestures to certain
 *              phases and this is not one of them, nothing fires.
 */
export function actionFor(step, gesture, phase = null) {
  const b = BINDINGS[step];
  if (!b) return null;
  if (Array.isArray(b.live) && !b.live.includes(phase)) return null;
  return b[gesture] ?? null;
}

/** The one-line reminder of what the platter will do right now. */
export function gestureHint(step, phase = null) {
  const b = BINDINGS[step];
  if (!b) return '';
  if (Array.isArray(b.live) && !b.live.includes(phase)) {
    return b.live.length === 0
      ? 'Taps are off while the shot is pouring — one would land in the curve.'
      : 'Taps are off while a weight is being taken.';
  }
  const parts = [];
  if (b.double) parts.push(`double-tap to ${ACTION_LABEL[b.double]}`);
  if (b.triple) parts.push(`triple-tap to ${ACTION_LABEL[b.triple]}`);
  if (b.hold) parts.push(`double-tap then hold to ${ACTION_LABEL[b.hold]}`);
  return parts.length ? `${parts.join(', ')}.` : '';
}
