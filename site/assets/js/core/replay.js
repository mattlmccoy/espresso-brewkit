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
import { flowSeries, stepAt as stepOf } from './diagnose.js';

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
  // When the first coffee actually arrived, which the brewing screen draws as a
  // marker. Read off the curve rather than stored, because it is already in it:
  // the first sample that is meaningfully above zero.
  const first = pts.find((p) => p[1] >= 0.3);
  const flow = pts.map(([t], i) => [t, Number.isFinite(fs[i]) ? Math.max(0, fs[i]) : 0]);
  return {
    pts,
    flow,
    duration: pts.length ? pts.at(-1)[0] : 0,
    firstDrip: first ? first[0] : null,
    stoppedAt: stopOf(flow),
  };
}

/**
 * When the pump stopped — the start of the drip tail.
 *
 * A curve does not end when the shot does. The pump cuts and the puck keeps
 * delivering, so the last few seconds are a decay to nothing, and anything
 * reading flow over that stretch sees a shot slowing to a halt. That is how the
 * coach came to say "0.36 g/s — close to choking" over the tail of a shot that
 * had been stopped on purpose: it was reading the drip as the pour.
 *
 * The stop is the last moment flow was still meaningfully running, measured
 * against this shot's own plateau rather than an absolute — a ristretto that
 * only ever reaches 1.2 g/s must not read as permanently stopped.
 */
function stopOf(flow) {
  const vals = flow.map((p) => p[1]).filter((v) => v > 0.05).sort((a, b) => a - b);
  if (!vals.length) return Infinity;
  const mid = vals[Math.floor(vals.length / 2)];
  const floor = Math.max(0.25, mid * 0.4);
  for (let i = flow.length - 1; i >= 0; i--) if (flow[i][1] >= floor) return flow[i][0];
  return Infinity;
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

  /** The shot so far, which is what makes the curve draw itself. */
  trace() { return upTo(this.data, this.t); }

  /**
   * The shot at this instant, in the shape the brew machine emits.
   *
   * THIS IS THE WHOLE POINT OF THE FILE. A replay panel built beside the
   * brewing screen is a second rendering of a shot, and two renderings of one
   * thing disagree eventually — a different dial, a different reading of the
   * bands, a stop weight worked out twice. Emitting the brew machine's own
   * snapshot instead means the replay is drawn by the brewing UI itself, and
   * cannot disagree with it about anything, because it is not a second opinion.
   *
   * `states` is passed in rather than imported: this module has no business
   * knowing the machine's vocabulary, and the caller already does.
   */
  snapshot({ extracting = 'extracting', complete = 'complete', label = () => '' } = {}) {
    const s = sample(this.data, this.t);
    const done = this.t >= this.duration - 1e-6;
    const state = done ? complete : extracting;
    const played = this.data.flow.filter((p) => p[0] <= this.t);
    return {
      state,
      label: label(state),
      net: s.w,
      elapsed: s.t,
      running: !done,
      flow: s.flow,
      trend: stepAt(this.data.pts, this.t),
      peakFlow: played.reduce((a, p) => Math.max(a, p[1]), 0),
      firstDrip: this.data.firstDrip,
    };
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

/* ------------------------------------------------- what he said, and when */
//
// WATCHING IT BACK MEANS WATCHING WHAT HE SAW.
//
// Pip speaks a handful of times during a pour and each line disappears after a
// few seconds, which is exactly when your hands are busy — so the lines you most
// want are the ones you are least likely to have read. A replay that showed the
// numbers again but not the reading of them would be replaying the half you
// could already reconstruct from the chart.
//
// COMPUTED, NOT RECORDED. Nothing is stored: `coach.live` is a pure function of
// what the shot was doing, and everything it needs — elapsed, weight, flow, the
// step — comes off the curve. So the timeline is derived the same way the chart
// and the dial are, and it works on shots pulled long before any of this
// existed. Recording his lines would also have meant they could drift out of
// step with the coach that produced them, which is the bug this avoids by
// construction.
//
// The `said` set is what makes it a timeline rather than a repeat: the coach
// says nothing twice in a shot, so walking the curve forward once and keeping
// the set is exactly the sequence that happened live.

/**
 * How long after a step you can know it was one.
 *
 * The detector compares a window either side of the moment in question, so the
 * later half has to have happened. A live shot therefore learns about a channel
 * about four seconds after it opens, and there is no way around that which does
 * not amount to guessing: until flow settles again, a jump and the start of a
 * steep climb are the same picture.
 */
const STEP_LAG = 3.8;

/**
 * The step in the flow as it would have been known at `t`.
 *
 * Delegates to the one detector in the app, deliberately: this used to be its
 * own implementation comparing the last second against a second two before it,
 * which is a measure of how much flow rose rather than how suddenly, and it
 * called every healthy shot a channel. The windows here never reach past `t`,
 * so a replay learns things in the order the shot did.
 */
function stepAt(pts, t) {
  return stepOf(pts, t - STEP_LAG);
}

/**
 * Everything he said during this shot, with the second he said it.
 *
 * @param prepared  a prepared curve
 * @param live      coach.live, injected so this module stays free of the coach
 * @param o         target and the machine's drip lag, as the coach wants them
 * @returns [{ at, until, text, mood, id }]
 */
export function saidDuring(prepared, live, { target = NaN, hz = 4 } = {}) {
  const said = new Set();
  const out = [];
  const step = 1 / hz;
  for (let t = step; t <= prepared.duration + 1e-6; t += step) {
    const s = sample(prepared, t);
    const line = live({
      // NOT `true` for the whole curve. Live, `running` is EXTRACTING only —
      // the page never asks the coach to read the drip tail. Replaying it as
      // permanently running handed him the decay after the stop and he read it
      // as a shot choking, which is the opposite of what it is.
      running: s.t <= prepared.stoppedAt,
      elapsed: s.t, net: s.w, flow: s.flow,
      trend: stepAt(prepared.pts, s.t), target,
    }, said);
    if (line) {
      out.push({ at: +s.t.toFixed(2), until: +(s.t + (line.ms ?? 7000) / 1000).toFixed(2),
                 text: line.text, mood: line.mood, id: line.id });
    }
  }
  return out;
}

/** Which line, if any, was on screen at `t`. */
export function sayingAt(timeline, t) {
  // The last one that had started and had not yet timed out. Last rather than
  // first because a second line lands on top of the one still showing, which is
  // what happens live.
  let hit = null;
  for (const line of timeline) {
    if (line.at <= t && t < line.until) hit = line;
  }
  return hit;
}
