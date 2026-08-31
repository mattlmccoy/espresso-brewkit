// Flow-curve diagnosis.
//
// A shot time and a final weight tell you almost nothing about *why* a shot went
// the way it did. The curve does: when the first drop appeared, how fast flow
// peaked, whether it held steady, and — the useful one — which way it drifted
// late. Those four numbers separate "too coarse" from "channelled", which look
// identical if all you record is 22 seconds and 36 grams.
//
// The thresholds below are conventions read off a lot of espresso curves, not
// constants of nature. They are here to flag a shot worth thinking about.

/** OLS slope of y on x. Returns NaN for fewer than two distinct x. */
function slope(xs, ys) {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx; sxy += dx * (ys[i] - my); sxx += dx * dx; }
  return sxx > 1e-12 ? sxy / sxx : NaN;
}

const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Flow at each sample, by local linear regression over a ±`win` second window.
 *
 * Differencing consecutive samples would be simpler and useless — it amplifies
 * exactly the noise the Kalman filter just removed. A local fit is a derivative
 * estimator with a controlled bandwidth instead.
 */
export function flowSeries(curve, win = 0.6) {
  const t = curve.map((p) => p[0]);
  const w = curve.map((p) => p[1]);
  const out = new Array(t.length).fill(NaN);
  let lo = 0, hi = 0;
  for (let i = 0; i < t.length; i++) {
    while (t[lo] < t[i] - win) lo++;
    while (hi < t.length && t[hi] <= t[i] + win) hi++;
    out[i] = slope(t.slice(lo, hi), w.slice(lo, hi));
  }
  return out;
}

/* ------------------------------------------------------- the step detector */

/**
 * How big a step has to be before the app says anything about it.
 *
 * Measured rather than chosen. Across the synthetic curves the suite keeps and
 * four real shots, the largest reading an ordinary shot produced was 0.154 and
 * the smallest deliberate channel 0.281, so the line goes in the middle of the
 * gap rather than at either edge of it. Exported because the live banner, the
 * coach and the post-shot read all have to agree: a shot called a channel while
 * it pours and cleared when it is over is worse than either answer alone.
 */
export const STEP_FLAG = 0.20;

/**
 * Which version of the curve reading a record was made with.
 *
 * The scalars below are computed once, when a shot is saved, and stored on the
 * record — so correcting the mathematics does not reach a single shot already
 * in the log. Three of the four shots in the first real dataset had no
 * `flow_step` at all because the field postdated them; the fourth carried one
 * from a superseded detector. Stamping the version is what lets a reader tell
 * "measured and found nothing" apart from "never measured", which are the same
 * absent field otherwise.
 */
export const METRICS_V = 4;

/**
 * How fast flow may climb before the climb itself is worth remarking on.
 *
 * A channel is a step, and the step detector is the confident signal. But a bed
 * can also fail gradually — widening rather than opening all at once — and that
 * leaves a climb too steep for erosion without ever being a discontinuity.
 *
 * Measured, like everything else here. Across four real healthy shots the
 * steepest sustained four-second climb was 0.304 g/s², and a deliberately
 * pathological smooth ramp (1 to 4 g/s in five seconds) scores 0.621. The line
 * goes at 0.50 — above every healthy reading by a margin of two thirds, and
 * still well under the pathological one.
 *
 * This is weaker evidence than a step and says so when it speaks. Four shots
 * from one machine is a thin basis for a universal number, which is exactly why
 * the threshold sits far above the observed ceiling rather than just past it:
 * the cost of missing a gradual failure is a shot you taste anyway, and the
 * cost of a false alarm is the app crying channel at healthy coffee, which is
 * the failure this whole reading is being rebuilt to avoid.
 */
export const CLIMB_FLAG = 0.50;

/**
 * The curve-shape fields, and only those.
 *
 * Refreshing a record must not touch what the shot actually produced. The dose,
 * the yield and the taste are the user's, some of them typed by hand, and a
 * recomputation that quietly overwrote a yield with a number re-derived from a
 * downsampled curve would be destroying data to fix a reading.
 */
export const SHAPE_FIELDS = ['flow_step', 'flow_step_at', 'flow_climb', 'flow_climb_at',
  'peak_flow_gs', 'curve_yield_g'];

/**
 * Bring one record's curve reading up to date, from the curve it stored.
 *
 * `decode` is passed in rather than imported so this module keeps its one job
 * and does not gain an opinion about storage formats.
 *
 * A record with no curve cannot be re-read, and its stale shape fields are
 * cleared rather than kept: a wrong measurement presented as a measurement is
 * worse than an honest gap, and these are exactly the fields that drive the
 * channel finding.
 */
export function refreshMetrics(shot, decode) {
  if (!shot || shot.metrics_v === METRICS_V) return shot;
  const curve = shot.curve ? decode(shot.curve) : null;
  if (!Array.isArray(curve) || curve.length < 8) {
    const blanked = {};
    for (const k of SHAPE_FIELDS) if (shot[k] != null) blanked[k] = null;
    if (!Object.keys(blanked).length) return { ...shot, metrics_v: METRICS_V };
    return { ...shot, ...blanked, metrics_v: METRICS_V };
  }
  const m = curveMetrics(curve);
  const next = { ...shot, metrics_v: METRICS_V };
  for (const k of SHAPE_FIELDS) next[k] = m[k] ?? null;
  return next;
}

/**
 * WHERE THE FLOW SETTLES AFTER THE OPENING TRANSIENT.
 *
 * The first drops land on the scale pan with some force, and the reading spikes
 * and decays — real curves open at 3.7 g/s and fall to 0.9 within two seconds.
 * Nothing in that decay is a flow rate, so nothing in it is a baseline either,
 * and a detector that anchors there measures the artefact.
 *
 * Returns the first moment the flow holds roughly level, or NaN if it never
 * does.
 */
function settlesAt(t, flow, end, level = 0.30) {
  const grad = (a, b) => {
    const ts = [], fs = [];
    for (let i = 0; i <= end; i++) {
      if (t[i] >= a && t[i] <= b && Number.isFinite(flow[i])) { ts.push(t[i]); fs.push(flow[i]); }
    }
    return ts.length < 4 ? NaN : slope(ts, fs);
  };
  for (let i = 0; i <= end; i++) {
    if (!(flow[i] > 0.25)) continue;
    const g = grad(t[i], t[i] + 1.2);
    if (Number.isFinite(g) && Math.abs(g) < level) return t[i];
  }
  return NaN;
}

/**
 * The flow series and the settling point for a curve, computed once.
 *
 * Both are O(n · window) with an allocation per sample, and the live page asks
 * for a step on every animation frame while the replay asks on every frame of
 * playback — so deriving them per call turned a reading into sixty scans a
 * second over a curve that can be a thousand points long.
 *
 * One entry is the whole cache, keyed on the array itself and its length: a
 * replay reads the same finished curve over and over, and a live shot appends
 * to one array, so a single slot hits on everything except the sample that just
 * arrived. Keyed on length as well as identity because the live curve is the
 * same array each time and a stale flow series for it would be a wrong answer
 * rather than a slow one.
 */
let memoCurve = null, memoLen = -1, memoOut = null;

function derive(curve) {
  if (curve === memoCurve && curve.length === memoLen) return memoOut;
  const t = curve.map((p) => p[0]);
  const flow = flowSeries(curve);
  const end = t.length - 1;
  memoCurve = curve;
  memoLen = curve.length;
  memoOut = { t, flow, end, t0: settlesAt(t, flow, end) };
  return memoOut;
}

/**
 * A CHANNEL CONCENTRATES ITS RISE; AN ORDINARY SHOT SPREADS IT.
 *
 * This is the one measurement in the app that was wrong in a way that mattered,
 * and it was wrong three times over — the live banner, the replay and the
 * post-shot read each had their own version, two of which compared flow now
 * against flow a couple of seconds ago and called any large relative rise a
 * step. Every healthy shot triggered it, because every healthy shot has one:
 * puck resistance falls as the bed saturates and erodes, so at constant
 * pressure flow climbs, and off a low pre-infusion baseline that climb is a
 * 70% "rise". Four real shots out of four were told they channelled.
 *
 * The fix is to stop measuring how MUCH flow rose and measure how SUDDENLY.
 * Compare the rise across a short window straddling `tau` with the rise across
 * a long one centred on the same moment. A straight ramp delivers rise in
 * proportion to the width of the window you look through, so short/long lands
 * near h/H. A discontinuity delivers nearly all of its rise inside the short
 * window, so the ratio approaches 1. That ratio is dimensionless, which is the
 * point: it does not care whether the shot is a ristretto or a lungo, and it
 * does not care what the baseline was.
 *
 * `h` is set by the smoothing — flowSeries averages over ±0.6 s, so a genuine
 * discontinuity is already smeared across more than a second and a shorter
 * window would read the smear rather than the jump.
 *
 * Returns the rise as a fraction of the flow before it, or NaN where the
 * windows do not fit or the shape is a ramp. Being NaN is the common case and
 * the correct one.
 */
export function stepAt(curve, tau, opts = {}) {
  const { h = 0.9, H = 3.2, conc = 0.62 } = opts;
  const { t, flow, t0, end } = derive(curve);
  if (!Number.isFinite(t0)) return NaN;
  const dur = t[end];
  if (tau - H - 0.6 < t0 || tau + H + 0.6 > dur) return NaN;
  // Binary search rather than a scan from zero: this runs once per sample when
  // reading a whole curve, and four times per call, so a linear window search
  // makes the whole-curve read quadratic — which is paid on every stale shot in
  // the log, on every page load.
  const at = (a, b) => {
    let lo = 0, hi = end + 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < a) lo = m + 1; else hi = m; }
    const v = [];
    for (let i = lo; i <= end && t[i] <= b; i++) if (Number.isFinite(flow[i])) v.push(flow[i]);
    return v.length ? median(v) : NaN;
  };
  const nearLo = at(tau - h - 0.6, tau - h), nearHi = at(tau + h, tau + h + 0.6);
  const farLo = at(tau - H - 0.6, tau - H), farHi = at(tau + H, tau + H + 0.6);
  if (![nearLo, nearHi, farLo, farHi].every(Number.isFinite)) return NaN;
  if (!(nearLo > 0.25)) return NaN;
  const shortRise = nearHi - nearLo, longRise = farHi - farLo;
  // A fall is not a channel, and a long window with no rise in it gives the
  // ratio no denominator worth dividing by.
  if (!(shortRise > 0) || !(longRise > 0.02)) return NaN;
  if (shortRise / longRise < conc) return NaN;
  return shortRise / nearLo;
}

/**
 * The largest step anywhere in a curve, and when it happened.
 *
 * Live and replay call `stepAt` on one moment at a time — live because it only
 * ever has the shot so far, replay so that it reproduces live exactly. This is
 * the whole-curve version, for reading a shot that is over.
 */
export function climbOf(t, flow, from, end, win = 4) {
  let best = -Infinity, at = null;
  for (let i = 0; i <= end; i++) {
    const a = t[i], b = a + win;
    if (!(a >= from) || b > t[end]) continue;
    const ts = [], fs = [];
    for (let j = i; j <= end && t[j] <= b; j++) {
      if (Number.isFinite(flow[j])) { ts.push(t[j]); fs.push(flow[j]); }
    }
    if (ts.length < 6) continue;
    const g = slope(ts, fs);
    if (Number.isFinite(g) && g > best) { best = g; at = +a.toFixed(2); }
  }
  return Number.isFinite(best) ? { climb: +best.toFixed(3), at } : { climb: null, at: null };
}

export function flowStep(curve, opts = {}) {
  if (!Array.isArray(curve) || curve.length < 8) return { step: null, at: null };
  let best = NaN, bestAt = null;
  for (const [tau] of curve) {
    const r = stepAt(curve, tau, opts);
    if (Number.isFinite(r) && (!Number.isFinite(best) || r > best)) { best = r; bestAt = +tau.toFixed(2); }
  }
  return { step: Number.isFinite(best) ? +best.toFixed(3) : null, at: bestAt };
}

/**
 * Scalars from a full-rate curve. Computed before downsampling, so nothing here
 * depends on the reduced version stored in the CSV.
 *
 * `curve` is [[t seconds from shot start, w grams net], …].
 */
export function curveMetrics(curve) {
  if (!Array.isArray(curve) || curve.length < 5) return {};
  const t = curve.map((p) => p[0]);
  const w = curve.map((p) => p[1]);
  const flow = flowSeries(curve);

  // The pump cuts before the curve ends — a couple of seconds of dripping
  // follow. Including that tail would make every shot look like flow collapsed,
  // so find where real flow stops and analyse only up to there.
  const peakAll = Math.max(...flow.filter(Number.isFinite), 0);
  const cutoff = Math.max(0.12, peakAll * 0.2);
  let end = t.length - 1;
  while (end > 3 && !(flow[end] >= cutoff)) end--;
  const dur = t[end];
  if (!(dur > 2)) return { t_first_drip_s: null };

  // When the clock starts at first flow — which is what happens hands-free,
  // because nothing tells the app the pump was pressed — the first sample is
  // already wet and "time to first drip" is not a quantity this curve contains.
  // Reporting the first sample's timestamp would put 0.08 s in the log and in
  // every regression that reads it, which is a made-up number dressed as a
  // measurement. Null is the true answer.
  const iFirst = w.findIndex((v) => v >= 0.5);
  const startedWet = iFirst === 0 && t[0] < 0.5;
  const t_first_drip_s = iFirst >= 0 && !startedWet ? +t[iFirst].toFixed(2) : null;

  const inWindow = (a, b) => {
    const idx = [];
    for (let i = 0; i <= end; i++) if (t[i] >= a && t[i] <= b && Number.isFinite(flow[i])) idx.push(i);
    return idx;
  };

  // PEAK FLOW, PAST THE FIRST DROPS.
  // Measured from t=0 this reports the impact of the opening drops on the scale
  // pan rather than anything the pump did — real shots open at 3.7 g/s and fall
  // to 0.9 within two seconds. That number then fed the "flow spiked well above
  // its steady rate" finding, which reads the artefact as the puck surface
  // breaking. Peak flow means the peak of the shot.
  const settled = settlesAt(t, flow, end);
  const peakIdx = inWindow(Number.isFinite(settled) ? settled : 0, dur);
  const peak_flow_gs = peakIdx.length ? Math.max(...peakIdx.map((i) => flow[i])) : NaN;

  // "Steady" is the middle of the shot: past the ramp, before the pump cut.
  const steadyIdx = inWindow(dur * 0.4, dur * 0.85);
  const steady_flow_gs = steadyIdx.length ? median(steadyIdx.map((i) => flow[i])) : NaN;

  // The late slope. This used to be described here as "the diagnostic one" —
  // flat-to-rising late was read as a channel opening, and the app said so at
  // high severity. That was wrong, and wrong on ordinary shots: puck resistance
  // falls as the bed saturates and erodes, so at constant pressure flow climbs
  // through almost every shot. Decent, who hold more shot data than anyone,
  // call the fall in resistance "pretty much universal".
  // It is still worth recording — a very steep climb outruns the target, and a
  // steep fall is its own signal — but it is not evidence of a channel.
  const lateIdx = inWindow(dur * 0.55, dur * 0.95);
  const flow_slope_late = lateIdx.length >= 4
    ? slope(lateIdx.map((i) => t[i]), lateIdx.map((i) => flow[i])) : NaN;

  // WHAT A CHANNEL ACTUALLY LOOKS LIKE: a step, not a slope — measured by the
  // one detector the live banner and the replay also use, so a shot cannot be
  // read one way while it runs and another way afterwards. That divergence is
  // what let this be wrong in three places at once.
  const { step: flow_step, at: flow_step_at } = flowStep(curve);

  // The other shape a failing bed makes: not a step, but a climb too steep for
  // erosion. Measured past the point the opening transient settles, because
  // every healthy shot's steepest climb is the machine coming up to pressure —
  // on all four real shots it lands between 5 and 7.5 s — and reading the
  // pressure ramp as a fault is the exact mistake being corrected here.
  const { climb: flow_climb, at: flow_climb_at } =
    climbOf(t, flow, Number.isFinite(settled) ? settled + 4 : 4, end);

  return {
    metrics_v: METRICS_V,
    t_first_drip_s,
    flow_step,
    flow_step_at,
    flow_climb,
    flow_climb_at,
    peak_flow_gs: Number.isFinite(peak_flow_gs) ? +peak_flow_gs.toFixed(3) : null,
    steady_flow_gs: Number.isFinite(steady_flow_gs) ? +steady_flow_gs.toFixed(3) : null,
    flow_slope_late: Number.isFinite(flow_slope_late) ? +flow_slope_late.toFixed(4) : null,
    duration_s: +dur.toFixed(2),
    // WHAT THE CURVE SAYS CAME OUT, kept beside what the record says came out.
    // They are the same number when nothing went wrong, and when they disagree
    // one of them is a measurement and the other is a mistake. Storing only one
    // of them left a shot in the log claiming a yield of -2.5 g while its own
    // curve ran cleanly to 40, with nothing in the app able to notice.
    curve_yield_g: +Math.max(...w.slice(0, end + 1)).toFixed(2),
    // The most the cup ever held, not the last sample. Weight into a cup only
    // goes up, so a lower final reading means the cup moved — lifted off the
    // platter, or knocked — and the last sample is then a measurement of the
    // empty scale rather than of the shot.
    yield_g: +Math.max(...w.slice(0, end + 1)).toFixed(2),
  };
}

import { STYLE_BANDS } from './knowledge.js';

const F = (v) => (typeof v === 'number' ? v : Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : NaN);

/**
 * Diagnose one shot. Returns findings ordered most severe first; an empty list
 * means nothing stood out, which is a real answer and is reported as one.
 */
export function diagnose(shot) {
  const out = [];
  const drip = F(shot.t_first_drip_s);
  const peak = F(shot.peak_flow_gs);
  const steady = F(shot.steady_flow_gs);
  const late = F(shot.flow_slope_late);
  const time = F(shot.time_s);
  const ratio = F(shot.ratio);
  const ey = F(shot.ey_pct);
  const tags = String(shot.tags ?? '').toLowerCase();

  // A CHANNEL IS A STEP, NOT A SLOPE.
  // What stood here tested `late > 0.05` — a gently rising late flow — and
  // called it a channel at high severity. Rising flow is what an ordinary shot
  // does: puck resistance falls as the bed saturates and erodes, so at constant
  // pressure the flow climbs. The rule fired on healthy shots and told people
  // to go and fix their distribution.
  // The real signature is a discontinuity, and even that is only suggestive
  // here: on a pressure machine a channel is a flow spike WITH a simultaneous
  // pressure dip, and a scale cannot see the second half. So this says what it
  // saw and what else it could be, rather than naming a cause it cannot
  // establish.
  const step = F(shot.flow_step);
  const stepAt = F(shot.flow_step_at);
  const climb = F(shot.flow_climb);
  const climbAt = F(shot.flow_climb_at);
  // 0.20 sits in a measured gap rather than being a round number. Across
  // synthetic curves with known shapes, the steepest ordinary rise scored
  // 0.099 and the smallest deliberate step 0.267; a flat shot scored -0.011
  // and a choked one 0.001. Anything between those two is a coin toss, so the
  // threshold goes in the middle of the gap and not at the edge of it.
  if (Number.isFinite(step) && step > STEP_FLAG) {
    out.push({
      code: 'flow_step', severity: 'medium', title: 'Flow jumped rather than climbed',
      detail: `Flow rose ${Math.round(step * 100)}% in half a second`
        + `${Number.isFinite(stepAt) ? ` around ${stepAt.toFixed(1)} s` : ''}. A bed holding `
        + 'together loses resistance smoothly, so a step is the shape a channel makes. '
        + 'Worth knowing: a scale sees weight and nothing else, and this same step would '
        + 'appear if the machine ramped or the cup was nudged.',
      action: 'If it repeats across shots at the same setting, it is the puck — stir the '
        + 'grounds deeply and tamp level. If it does not repeat, it was this one shot.',
    });
  } else if (Number.isFinite(climb) && climb > CLIMB_FLAG) {
    out.push({
      code: 'flow_climb', severity: 'low', title: 'Flow climbed faster than a bed usually erodes',
      detail: `Flow gained ${climb.toFixed(2)} g/s every second at its steepest`
        + `${Number.isFinite(climbAt) ? `, around ${climbAt.toFixed(0)} s` : ''} — against about `
        + '0.3 for an ordinary shot. Rising flow is normal and is not on its own a fault; this is '
        + 'the rate of the rise, not the rise. A bed widening gradually rather than giving way '
        + 'all at once can look like this. So can a machine with a slow pressure ramp, and a '
        + 'scale cannot tell those apart, so this is a weaker signal than a step and is offered '
        + 'as something to watch across shots rather than a diagnosis of this one.',
      action: 'If it shows up on most of your shots it is the machine, and it is not telling you '
        + 'anything. If it is unusual for you, note whether the cup is thin or drying.',
    });
  } else if (Number.isFinite(late) && late < -0.09 && Number.isFinite(steady) && steady > 0.2) {
    out.push({
      code: 'migration', severity: 'low', title: 'Flow fell away steadily',
      detail: `Flow dropped ${Math.abs(late).toFixed(3)} g/s² late. Some sag is normal; this much `
        + 'usually means fines migrating down and blocking the basket as the shot runs.',
      action: 'A coarser grind or a lower dose both reduce it. If the taste is good, it is not a problem.',
    });
  }

  // A YIELD THAT IS NOT A WEIGHT.
  // Checked before anything else because everything else is downstream of it:
  // the ratio, the extraction yield and every regression that reads this shot
  // are all computed from a number that, here, is not a measurement of coffee.
  // A scale reads negative when the cup is lifted off mid-shot and the tare
  // goes with it — the pour was fine, the record of it is not.
  const yieldG = F(shot.yield_g);
  const curveYield = F(shot.curve_yield_g);
  if (Number.isFinite(yieldG) && yieldG <= 0) {
    out.push({
      code: 'yield_impossible', severity: 'high', title: `Recorded yield of ${yieldG.toFixed(1)} g`,
      detail: 'No shot produces zero or less. A scale reads this way when the cup comes off the '
        + 'platter before the shot is filed, so the tare goes with it'
        + `${Number.isFinite(curveYield) && curveYield > 1
          ? ` — this shot's own curve runs cleanly to ${curveYield.toFixed(1)} g` : ''}. `
        + 'Everything derived from the yield is wrong until it is corrected: the ratio, the '
        + 'extraction yield, and this shot\'s contribution to every comparison.',
      action: 'Put the real yield in with Edit. The curve is intact and is not touched by it.',
    });
  } else if (Number.isFinite(yieldG) && Number.isFinite(curveYield) && curveYield > 1
    && Math.abs(yieldG - curveYield) > Math.max(3, curveYield * 0.25)) {
    out.push({
      code: 'yield_disagrees', severity: 'medium',
      title: `Recorded ${yieldG.toFixed(1)} g, curve reached ${curveYield.toFixed(1)} g`,
      detail: 'The weight written down and the weight the scale actually traced are far enough '
        + 'apart that one of them is not a measurement of this shot. A cup nudged or lifted does '
        + 'this, and so does a yield typed from memory afterwards.',
      action: 'Whichever you trust, make them agree with Edit — the log is only worth what its '
        + 'numbers are.',
    });
  }

  if (Number.isFinite(drip) && drip > 0.2) {
    if (drip > 12) {
      out.push({
        code: 'choked', severity: 'medium', title: `First drop at ${drip.toFixed(1)} s`,
        detail: 'A long pre-drip means the bed is close to choking the machine. Anything past about '
          + '12 s tends to come with harsh, drying extractions and poor shot-to-shot repeatability.',
        action: 'Go coarser, or drop the dose a few tenths.',
      });
    } else if (drip < 3 && Number.isFinite(steady) && steady > 2.2) {
      out.push({
        code: 'gusher', severity: 'medium', title: `First drop at ${drip.toFixed(1)} s`,
        detail: 'Water reached the cup almost immediately and flow was fast throughout — the bed is '
          + 'offering very little resistance.',
        action: 'Go finer. If the grind is already at the fine end, the dose is probably too low for '
          + 'the basket.',
      });
    }
  }

  if (Number.isFinite(peak) && Number.isFinite(steady) && steady > 0.15 && peak / steady > 2.2) {
    out.push({
      code: 'spiky', severity: 'low', title: 'Flow spiked well above its steady rate',
      detail: `Peak flow was ${(peak / steady).toFixed(1)}× the steady rate. A brief spike at first `
        + 'flow is normal; a large one suggests the surface of the puck broke before it settled.',
      action: 'Longer or gentler pre-infusion usually flattens it.',
    });
  }

  if (Number.isFinite(time) && Number.isFinite(ratio)) {
    if (time < 18 && ratio > 1.7) {
      out.push({ code: 'fast', severity: 'medium', title: `${time.toFixed(0)} s to 1:${ratio.toFixed(1)}`,
        detail: 'Short for that ratio. Usually under-extracted: sour, thin, salty.',
        action: 'Grind finer. One or two dial steps at a time — the response is steep.' });
    } else if (time > 40 && ratio < 2.5) {
      out.push({ code: 'slow', severity: 'medium', title: `${time.toFixed(0)} s to 1:${ratio.toFixed(1)}`,
        detail: 'Long for that ratio. Often over-extracted and drying, though a slow shot can also '
          + 'just be a very fine grind that never got there.',
        action: 'Grind coarser.' });
    }
  }

  // YIELD, AGAINST THE DRINK RATHER THAN AGAINST ONE BAND.
  // This used to flag anything under 17%. Extraction yield is the ratio times
  // the strength — arithmetic, not opinion — so a 1:1.3 ristretto CANNOT reach
  // 17% without a strength espresso does not attain. Every correctly made
  // ristretto was being told it was under-extracted.
  // The band it was measured against is inherited from 1950s drip research
  // anyway, and the SCA's own funded successor work replaced the single-box
  // model with preference spread far wider. So the comparison is to what this
  // drink structurally is, and it is offered as context rather than a verdict.
  if (Number.isFinite(ey) && Number.isFinite(ratio)) {
    const band = ratio < 1.6 ? STYLE_BANDS.ristretto
      : ratio < 2.35 ? STYLE_BANDS.espresso
        : ratio < 2.9 ? STYLE_BANDS.long : STYLE_BANDS.lungo;
    const name = ratio < 1.6 ? 'a ristretto' : ratio < 2.35 ? 'an espresso'
      : ratio < 2.9 ? 'a long shot' : 'a lungo';
    if (ey < band.ey[0] - 1.5) {
      out.push({ code: 'ey_low', severity: 'low', title: `Extraction yield ${ey.toFixed(1)}%`,
        detail: `Low even for ${name}, which usually lands ${band.ey[0]} to ${band.ey[1]}%. `
          + 'Taste it before acting — this is one number and it cannot see how evenly the '
          + 'puck extracted, which is what actually drives the cup.',
        action: 'A longer ratio raises it most cheaply. Finer raises it too, up to a point '
          + 'past which it lowers it again.' });
    } else if (ey > band.ey[1] + 2) {
      out.push({ code: 'ey_high', severity: 'low', title: `Extraction yield ${ey.toFixed(1)}%`,
        detail: `High for ${name}. Often fine — the ceiling is set by how evenly the puck `
          + 'extracts rather than by a number — but this is where dry, hollow bitterness '
          + 'turns up if it is going to.',
        action: 'Shorter ratio, or coarser, if the cup is drying.' });
    }
  }

  // The taste tags are the only ground truth here; when they contradict the
  // curve, say so rather than quietly ranking one above the other.
  if (tags.includes('sour') && Number.isFinite(step) && step > STEP_FLAG) {
    out.push({ code: 'sour_channel', severity: 'medium', title: 'Sour, and the flow stepped',
      detail: 'Sourness after a shot whose flow jumped is usually under-extraction of the bed '
        + 'the water went around, rather than of the coffee as a whole.',
      action: 'Even out the puck before changing grind. Grinding finer for the sourness will '
        + 'over-extract the parts that were already extracting fine.' });
  }

  // TWO OPPOSITE DEFECTS AT ONCE.
  // The most valuable single reading in the subject, and the one most often got
  // wrong: sour AND bitter is not a midpoint between them, so splitting the
  // difference on grind makes both halves worse. Water strips the coffee along
  // its path and barely wets the rest, and both go into the same cup.
  // Reported taste beats the curve here — this fires whether or not the flow
  // showed anything, because particle-scale unevenness leaves a perfectly
  // ordinary-looking curve.
  const has = (w) => tags.includes(w);
  const opposed = (has('sour') && (has('bitter') || has('ashy')))
    || (has('thin') && has('harsh'));
  if (opposed) {
    out.push({ code: 'uneven', severity: 'high', title: 'Two opposite faults in one cup',
      detail: 'Sour and bitter together is not halfway between them — it is both ends of the '
        + 'same puck at once: over-extracted where the water ran, under-extracted where it '
        + 'did not. A smaller grind change in either direction makes both halves worse.',
      action: 'Even out the bed rather than changing how much you extract: stir the grounds '
        + 'deeply, tamp level, and go a little coarser rather than finer. If it survives all '
        + 'that and every setting, it is the grinder making fines and boulders together '
        + 'rather than anything you did.' });
  }

  // Astringency is a mouthfeel, not a taste, and it is the one defect where the
  // reflex — grind finer — is almost always wrong. Kept separate from bitter
  // for exactly that reason.
  if (has('harsh') && !opposed) {
    out.push({ code: 'astringent', severity: 'medium', title: 'Drying, rather than bitter',
      detail: 'Roughness is large polyphenols binding the proteins in your saliva, and they '
        + 'come out through channels that reach the base of the bed. It is a different fault '
        + 'from bitterness and it takes the opposite correction.',
      action: 'Coarser, not finer. Deeper stirring and a gentler pressure ramp both help; '
        + 'so does a gram less in the basket.' });
  }

  // Ground coffee is a different material five minutes after the burrs than it
  // was at thirty seconds: it degasses, it cools, and it takes up water from
  // the air. Nothing else logs this because nothing else owns both timestamps,
  // which is exactly why a shot that looks inexplicably unlike its neighbours
  // usually has no explanation available. Here it does.
  const prep = F(shot.puck_prep_s);
  if (Number.isFinite(prep) && prep > 240) {
    out.push({ code: 'puck_stale', severity: 'medium',
      title: `${Math.round(prep / 60)} minutes between grinding and brewing`,
      detail: 'Grounds degas and cool from the moment they leave the burrs, and they pick up '
        + 'moisture from the air. A long gap makes a shot faster and flatter than the same dose '
        + 'ground fresh, so this one is not really comparable with the rest of the log.',
      action: 'Grind immediately before pulling, and treat this shot as its own thing.' });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** One-line verdict for a list of findings. */
export function verdict(findings) {
  if (!findings.length) return { label: 'Nothing stood out', tone: 'ok' };
  const worst = findings[0];
  return {
    label: worst.title,
    tone: worst.severity === 'high' ? 'warn' : worst.severity === 'medium' ? 'flag' : 'ok',
  };
}
