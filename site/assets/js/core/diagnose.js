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

  const iFirst = w.findIndex((v) => v >= 0.5);
  const t_first_drip_s = iFirst >= 0 ? +t[iFirst].toFixed(2) : null;

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

  // The late slope is the diagnostic one. Espresso flow should sag gently as the
  // puck compacts; flat-to-rising late is the signature of a channel opening.
  const lateIdx = inWindow(dur * 0.55, dur * 0.95);
  const flow_slope_late = lateIdx.length >= 4
    ? slope(lateIdx.map((i) => t[i]), lateIdx.map((i) => flow[i])) : NaN;

  return {
    t_first_drip_s,
    peak_flow_gs: Number.isFinite(peak_flow_gs) ? +peak_flow_gs.toFixed(3) : null,
    steady_flow_gs: Number.isFinite(steady_flow_gs) ? +steady_flow_gs.toFixed(3) : null,
    flow_slope_late: Number.isFinite(flow_slope_late) ? +flow_slope_late.toFixed(4) : null,
    duration_s: +dur.toFixed(2),
    yield_g: +w[end].toFixed(2),
  };
}

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

  if (Number.isFinite(late) && late > 0.05) {
    out.push({
      code: 'channeling', severity: 'high', title: 'Flow accelerated late',
      detail: `Flow rose ${late.toFixed(3)} g/s² through the back half of the shot. A puck that is `
        + 'holding together resists more as it compacts, so flow should sag, not climb. Rising flow '
        + 'means water found a path with less resistance than the bed around it.',
      action: 'Check distribution and tamp level before changing grind — a channel is a prep fault, '
        + 'and grinding finer to compensate usually makes the next one worse.',
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

  if (Number.isFinite(ey)) {
    if (ey < 17) out.push({ code: 'ey_low', severity: 'low', title: `Extraction yield ${ey.toFixed(1)}%`,
      detail: 'Below the conventional espresso band. Not automatically wrong — light roasts and short '
        + 'ratios sit low — but worth tasting critically for sourness.',
      action: 'Finer, hotter, or a longer ratio all raise it.' });
    else if (ey > 23) out.push({ code: 'ey_high', severity: 'low', title: `Extraction yield ${ey.toFixed(1)}%`,
      detail: 'Above the conventional band. Often accompanied by dry, hollow bitterness.',
      action: 'Coarser, cooler, or a shorter ratio all lower it.' });
  }

  // The taste tags are the only ground truth here; when they contradict the
  // curve, say so rather than quietly ranking one above the other.
  if (tags.includes('sour') && Number.isFinite(late) && late > 0.05) {
    out.push({ code: 'sour_channel', severity: 'medium', title: 'Sour, and the curve shows a channel',
      detail: 'Sourness after a channelled shot is usually under-extraction of the bed that water '
        + 'went around, not of the coffee as a whole.',
      action: 'Fix the channel first. Grinding finer for the sourness will over-extract the parts '
        + 'that were already extracting fine.' });
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
