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

  const peakIdx = inWindow(0, dur);
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

  // WHAT A CHANNEL ACTUALLY LOOKS LIKE: a step, not a slope.
  // Preferential flow is a positive-feedback instability — a small defect takes
  // a disproportionate share of the water and erodes itself wider — so it
  // arrives as a discontinuity. Normal evolution is smooth and monotonic.
  // Measured as the largest jump between consecutive half-second marks relative
  // to the flow already running, past the opening ramp, where the ramp itself
  // is a legitimate step and would otherwise be the largest one every time.
  let flow_step = NaN;
  let flow_step_at = null;
  {
    // AN EDGE DETECTOR, with a gap in the middle.
    // Two things defeat the obvious version. The flow series is smoothed over
    // ±0.6 s, so a genuine step is spread over more than a second and a window
    // that straddles it reads the average rather than the jump. And the onset
    // of a choked shot — nothing for fourteen seconds, then a trickle — is
    // itself the largest change in the curve, so anchoring anywhere near the
    // ramp finds the ramp every time.
    // So: compare settled flow before a moment against settled flow after it,
    // leaving a gap between the two windows wide enough for the smoothing to
    // pass through, and only look once flow has been established long enough
    // for the "before" window to sit entirely past the ramp.
    const PAD = 0.8;   // half the gap, which the transition lives in
    const SPAN = 1.2;  // how much settled flow to average on each side
    const at = (a, b) => {
      const v = [];
      for (let i = 0; i <= end; i++) if (t[i] >= a && t[i] <= b && Number.isFinite(flow[i])) v.push(flow[i]);
      return v.length ? median(v) : NaN;
    };
    // The baseline has to be SETTLED, and that is what excludes the opening
    // ramp — without needing to know where the ramp ends, which turns out to be
    // circular. Anchoring to a fraction of the steady rate fails because a step
    // raises the steady rate, which pushes the search window past the very step
    // it is looking for; both large steps scored exactly 0 that way. A step is
    // a jump away from a level, so requiring the level first is the definition
    // rather than a workaround.
    const settled = (a, b) => {
      const ts = [], fs = [];
      for (let i = 0; i <= end; i++) {
        if (t[i] >= a && t[i] <= b && Number.isFinite(flow[i])) { ts.push(t[i]); fs.push(flow[i]); }
      }
      if (ts.length < 4) return false;
      const g = slope(ts, fs);
      return Number.isFinite(g) && Math.abs(g) < 0.15;
    };
    const iUp = flow.findIndex((v, k) => k <= end && Number.isFinite(v) && v >= 0.25);
    const from = (iUp >= 0 ? t[iUp] : 0) + PAD + SPAN + 0.4;
    for (let i = 0; i <= end; i++) {
      const tau = t[i];
      if (tau < from || tau > dur - PAD - 0.4) continue;
      const lo = tau - PAD - SPAN, hi = tau - PAD;
      const before = at(lo, hi);
      const after = at(tau + PAD, tau + PAD + SPAN);
      if (!(before > 0.25) || !Number.isFinite(after) || !settled(lo, hi)) continue;
      const rise = (after - before) / before;
      if (Number.isFinite(rise) && (!Number.isFinite(flow_step) || rise > flow_step)) {
        flow_step = rise;
        flow_step_at = +tau.toFixed(2);
      }
    }
  }

  return {
    t_first_drip_s,
    flow_step: Number.isFinite(flow_step) ? +flow_step.toFixed(3) : null,
    flow_step_at,
    peak_flow_gs: Number.isFinite(peak_flow_gs) ? +peak_flow_gs.toFixed(3) : null,
    steady_flow_gs: Number.isFinite(steady_flow_gs) ? +steady_flow_gs.toFixed(3) : null,
    flow_slope_late: Number.isFinite(flow_slope_late) ? +flow_slope_late.toFixed(4) : null,
    duration_s: +dur.toFixed(2),
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
  // 0.20 sits in a measured gap rather than being a round number. Across
  // synthetic curves with known shapes, the steepest ordinary rise scored
  // 0.099 and the smallest deliberate step 0.267; a flat shot scored -0.011
  // and a choked one 0.001. Anything between those two is a coin toss, so the
  // threshold goes in the middle of the gap and not at the edge of it.
  if (Number.isFinite(step) && step > 0.20) {
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
  } else if (Number.isFinite(late) && late < -0.09 && Number.isFinite(steady) && steady > 0.2) {
    out.push({
      code: 'migration', severity: 'low', title: 'Flow fell away steadily',
      detail: `Flow dropped ${Math.abs(late).toFixed(3)} g/s² late. Some sag is normal; this much `
        + 'usually means fines migrating down and blocking the basket as the shot runs.',
      action: 'A coarser grind or a lower dose both reduce it. If the taste is good, it is not a problem.',
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
  if (tags.includes('sour') && Number.isFinite(step) && step > 0.20) {
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
