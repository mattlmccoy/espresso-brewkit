// Watching a shot again.
//
// A pour is thirty seconds long and you spend most of it doing something with
// your hands — seating the cup, watching the spouts, deciding whether to stop.
// The screen is showing the one view of the shot that only exists while it is
// happening, and it is the view you are least able to look at. Afterwards there
// is a chart, which is the whole shot at once and answers different questions:
// a chart tells you the late slope sagged, and a replay tells you it sagged
// eleven seconds in, right after the flow crossed two.
//
// So this plays the recording back. Same numbers, same dial, same curve drawing
// itself — at real speed, faster, or dragged by hand to the second you want.
//
// WHY THE CLOCK IS HERE AND NOT IN THE PANEL. A transport is a small pile of
// state that is easy to get subtly wrong — a pause that keeps accumulating, a
// scrub that jumps when you let go, a speed change that teleports. Written
// beside the drawing code it would be untestable without a browser and a
// stopwatch. Here it is a function of elapsed time and can be driven by a fake
// clock, which is how the tests drive it.

import { decodeCurve } from './schema.js';
import { flowSeries } from './diagnose.js';

/** Where saved replays live. Not on the shot record — see `save`. */
const KEY = 'brewkit.replays.v1';

/**
 * The curve, with its flow worked out once.
 *
 * Flow is not stored anywhere: the laptop, the phone and the chart all derive
 * it from the weight curve, and a replay that derived it a fourth way would
 * disagree with the chart it is drawing on top of. Same `flowSeries`, same
 * window, one answer.
 */
export function prepare(curve, win = 0.8) {
  const pts = (Array.isArray(curve) ? curve : decodeCurve(curve))
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .sort((a, b) => a[0] - b[0]);
  const fs = pts.length > 4 ? flowSeries(pts, win) : [];
  return {
    pts,
    flow: pts.map(([t], i) => [t, Number.isFinite(fs[i]) ? Math.max(0, fs[i]) : 0]),
    duration: pts.length ? pts.at(-1)[0] : 0,
  };
}

/** Linear interpolation on a [t, v] series, flat outside its ends. */
function interp(series, t) {
  if (!series.length) return NaN;
  if (t <= series[0][0]) return series[0][1];
  if (t >= series.at(-1)[0]) return series.at(-1)[1];
  // A binary search rather than a scan: seeking is a drag handler, so this runs
  // on every pointer move over a curve that can be a thousand points long.
  let lo = 0, hi = series.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] <= t) lo = mid; else hi = mid;
  }
  const [t0, v0] = series[lo], [t1, v1] = series[hi];
  const span = t1 - t0;
  return span > 1e-9 ? v0 + ((t - t0) / span) * (v1 - v0) : v1;
}

/** The shot at one instant: what the scale would have read at `t`. */
export function sample(prepared, t) {
  const w = interp(prepared.pts, t);
  return {
    t: Math.max(0, Math.min(t, prepared.duration)),
    w: Number.isFinite(w) ? w : 0,
    flow: Number.isFinite(interp(prepared.flow, t)) ? interp(prepared.flow, t) : 0,
  };
}

/** The curve up to `t`, which is what makes it draw itself rather than appear. */
export function upTo(prepared, t) {
  const out = prepared.pts.filter((p) => p[0] <= t);
  // The partial point at the head, so the trace ends under the playhead instead
  // of at the last stored sample up to a quarter second behind it.
  if (out.length && t < prepared.duration) {
    const s = sample(prepared, t);
    if (s.t > out.at(-1)[0] + 1e-6) out.push([s.t, s.w]);
  }
  return out;
}

export const SPEEDS = [0.5, 1, 2, 4];

/**
 * A transport over a prepared curve.
 *
 * `tick` is called with the sample at the current time, plus `playing` and the
 * position, whenever the position changes — playing, scrubbing or stepping.
 * The frame source is injectable so the tests can run it on a clock they
 * control rather than on the wall.
 */
export class Replay {
  constructor(curve, { speed = 1, onTick = null,
                       now = () => performance.now(),
                       raf = (fn) => requestAnimationFrame(fn),
                       cancel = (h) => cancelAnimationFrame(h) } = {}) {
    this.data = prepare(curve);
    this.speed = SPEEDS.includes(speed) ? speed : 1;
    this.onTick = onTick;
    this._now = now;
    this._raf = raf;
    this._cancel = cancel;
    this.t = 0;
    this.playing = false;
    this._handle = null;
    this._last = 0;
  }

  get duration() { return this.data.duration; }
  get ended() { return this.t >= this.duration - 1e-6; }
  /** Whether there is anything to watch. Two points is a dot, not a shot. */
  get playable() { return this.data.pts.length > 1 && this.duration > 0.5; }

  play() {
    if (this.playing || !this.playable) return;
    // Pressing play at the end starts it over, rather than doing nothing and
    // looking broken.
    if (this.ended) this.t = 0;
    this.playing = true;
    this._last = this._now();
    this._handle = this._raf(this._step);
    this._emit();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    if (this._handle != null) this._cancel(this._handle);
    this._handle = null;
    this._emit();
  }

  toggle() { return this.playing ? this.pause() : this.play(); }

  /** Move the playhead. Playing or paused, without changing which it is. */
  seek(t) {
    this.t = Math.max(0, Math.min(Number(t) || 0, this.duration));
    // The elapsed clock restarts from here, or the next frame would advance by
    // however long the drag took.
    this._last = this._now();
    this._emit();
  }

  setSpeed(x) {
    if (!SPEEDS.includes(x)) return;
    // Anchored at the current time: without resetting the mark, changing speed
    // mid-play applies the new rate to the time since the last frame as well.
    this._last = this._now();
    this.speed = x;
    this._emit();
  }

  /** Give up the frame loop. Called when the panel goes away. */
  destroy() {
    this.pause();
    this.onTick = null;
  }

  _step = () => {
    if (!this.playing) return;
    const now = this._now();
    this.t = Math.min(this.duration, this.t + ((now - this._last) / 1000) * this.speed);
    this._last = now;
    if (this.t >= this.duration - 1e-6) {
      // Stops at the end rather than looping. A shot that restarted on its own
      // would be a shot you cannot look at the end of.
      this.t = this.duration;
      this.playing = false;
      this._handle = null;
      this._emit();
      return;
    }
    this._emit();
    this._handle = this._raf(this._step);
  };

  _emit() {
    this.onTick?.({
      ...sample(this.data, this.t),
      playing: this.playing,
      speed: this.speed,
      duration: this.duration,
      trace: upTo(this.data, this.t),
    });
  }
}

/* ------------------------------------------------------------------ storage */
//
// WHY REPLAYS ARE NOT A COLUMN ON THE SHOT.
//
// The obvious place is a field on the record, and it is the wrong one twice
// over. `FIELDS` is also the CSV schema, so a replay column would put a
// multi-kilobyte blob in a cell of every export, in a file whose whole purpose
// is being opened by something else. And a shot record is the small, always-
// present description of what happened; a replay is large and optional, which
// is exactly the shape that should be addressed separately and deleted on its
// own.
//
// So they live in their own map, keyed by shot id.

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') ?? {}; } catch { return {}; }
}

function writeAll(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); return true; } catch { return false; }
}

/**
 * Keep this shot's pour.
 *
 * Stored at the rate it was recorded rather than the 4 Hz the shot record
 * carries. The saved curve is there to be plotted and to survive a CSV; this
 * one is there to be watched, and a scrub across a 4 Hz curve steps in quarter
 * seconds — visible, and exactly the wrong thing to notice while you are trying
 * to see when the flow turned over.
 *
 * Returns false if it would not fit. localStorage is a few megabytes and a
 * recorded pour is on the order of ten kilobytes, so this is the hundredth
 * replay rather than the second — but the caller has to be able to say so
 * instead of believing it worked.
 */
export function save(shotId, curve) {
  if (!shotId) return false;
  const pts = (Array.isArray(curve) ? curve : decodeCurve(curve))
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 2) return false;
  const map = readAll();
  map[shotId] = pts.map(([t, w]) => `${t.toFixed(2)}:${w.toFixed(2)}`).join('|');
  return writeAll(map);
}

/** This shot's pour, or null. */
export function load(shotId) {
  const raw = readAll()[shotId];
  return raw ? decodeCurve(raw) : null;
}

export function has(shotId) { return !!readAll()[shotId]; }

export function drop(shotId) {
  const map = readAll();
  if (!(shotId in map)) return false;
  delete map[shotId];
  return writeAll(map);
}

/** Which shots have one, so a list can mark them without loading every curve. */
export function saved() { return Object.keys(readAll()); }

/** Roughly what they are costing, for the line in Settings that says so. */
export function bytes() {
  try { return (localStorage.getItem(KEY) || '').length; } catch { return 0; }
}
