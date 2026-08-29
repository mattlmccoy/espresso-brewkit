// How this shot differs from your best one on the same coffee.
//
// Every scale with an app will draw you a reference curve behind the live one.
// Two curves on one chart is a picture, not an answer: you still have to look
// at it, decide where they part company, and remember what that means. This
// does the looking — where they diverge, by how much, and in which direction —
// and it can only exist because the ratings live in the same rows as the
// curves. A scale that stores curves and a notebook that stores ratings cannot
// be joined after the fact.
//
// "Best" is deliberately your own best on this coffee rather than an ideal
// curve. There is no ideal curve. There is the one you liked.

import { decodeCurve } from './schema.js';

/**
 * Resample a curve onto a fixed grid so two of them can be subtracted.
 *
 * Shots differ in length, and the interesting comparison is not "what did each
 * weigh at 12 s" but "what did each look like a third of the way through" —
 * a 32 s shot and a 26 s shot are the same shape stretched. So the grid is
 * fractional time, and the weights are normalised by the final yield. What
 * survives that is the shape: when flow arrived, whether it held, how it fell
 * away. Which is the thing worth comparing.
 */
export function normalise(curve, n = 40) {
  const pts = Array.isArray(curve) ? curve : decodeCurve(curve);
  if (!Array.isArray(pts) || pts.length < 4) return null;
  const tEnd = pts[pts.length - 1][0];
  const wEnd = pts[pts.length - 1][1];
  if (!(tEnd > 0) || !(wEnd > 0)) return null;
  const out = [];
  let i = 0;
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * tEnd;
    while (i < pts.length - 2 && pts[i + 1][0] < t) i++;
    const [t0, w0] = pts[i];
    const [t1, w1] = pts[Math.min(i + 1, pts.length - 1)];
    const span = t1 - t0;
    const w = span > 1e-9 ? w0 + ((w1 - w0) * (t - t0)) / span : w0;
    out.push(w / wEnd);
  }
  return { shape: out, tEnd, wEnd };
}

/**
 * Similarity, 0 to 1, from the mean absolute difference between two shapes.
 *
 * Not a correlation: two curves that both rise monotonically correlate at
 * nearly 1 however differently they rise, which would call every espresso ever
 * pulled a match. Mean absolute deviation on normalised weight says what it
 * means — "on average these are N% of the yield apart".
 */
export function similarity(a, b) {
  if (!a || !b || a.shape.length !== b.shape.length) return null;
  let sum = 0;
  for (let i = 0; i < a.shape.length; i++) sum += Math.abs(a.shape[i] - b.shape[i]);
  const mad = sum / a.shape.length;
  // 0.15 mean deviation is about as different as two shots of the same coffee
  // get; anything past that is already "not the same shot".
  return { mad: +mad.toFixed(4), score: +Math.max(0, 1 - mad / 0.15).toFixed(3) };
}

/**
 * Where the two shots part company, and what that means in words.
 *
 * The largest gap is the interesting one, and its sign is the whole message: at
 * that point you were either ahead of the reference — flowing faster, extracting
 * looser — or behind it.
 */
export function divergence(mine, ref) {
  if (!mine || !ref) return null;
  let at = 0, worst = 0;
  for (let i = 1; i < mine.shape.length; i++) {
    const d = mine.shape[i] - ref.shape[i];
    if (Math.abs(d) > Math.abs(worst)) { worst = d; at = i; }
  }
  const frac = at / (mine.shape.length - 1);
  return {
    frac: +frac.toFixed(3),
    atSeconds: +(frac * mine.tEnd).toFixed(1),
    delta: +worst.toFixed(3),
    ahead: worst > 0,
  };
}

/** The best-rated shot on a coffee that actually has a curve to compare with. */
export function bestOn(shots, { bagId = null, exclude = null, minRating = 6 } = {}) {
  const rated = (shots ?? []).filter((r) => {
    if (exclude && r.shot_id === exclude) return false;
    if (bagId && r.bag_id !== bagId) return false;
    const rating = Number(r.rating);
    if (!Number.isFinite(rating) || rating < minRating) return false;
    return decodeCurve(r.curve).length > 4;
  });
  if (!rated.length) return null;
  // Highest rating; ties go to the most recent, because a grinder drifts and
  // the newer one is the one you could actually reproduce today.
  return rated.sort((a, b) => (Number(b.rating) - Number(a.rating))
    || String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')))[0];
}

/**
 * The whole comparison, as a sentence someone can act on.
 *
 * Returns null rather than a hedge when there is nothing to say: a comparison
 * against one mediocre shot is worse than no comparison, because it looks like
 * a standard.
 */
export function compareToBest(shot, shots, { bagId = null } = {}) {
  const ref = bestOn(shots, { bagId: bagId ?? shot?.bag_id ?? null, exclude: shot?.shot_id });
  if (!ref) return null;
  const mine = normalise(shot?.curve);
  const theirs = normalise(ref.curve);
  if (!mine || !theirs) return null;
  const sim = similarity(mine, theirs);
  const div = divergence(mine, theirs);
  if (!sim || !div) return null;

  const pct = Math.round(sim.score * 100);
  const when = div.atSeconds;
  const gap = Math.abs(Math.round(div.delta * 100));
  const close = sim.score >= 0.8;

  let detail;
  if (close) {
    detail = `This one tracks it closely the whole way — never more than ${gap}% of the yield `
      + 'apart. Whatever you changed, it did not change the shape.';
  } else if (div.ahead) {
    detail = `They part company around ${when} s, where this one was ${gap}% of the yield ahead: `
      + 'it was running faster than the shot you liked, so more of the cup arrived early.';
  } else {
    detail = `They part company around ${when} s, where this one was ${gap}% of the yield behind: `
      + 'it was running slower than the shot you liked and had to make it up later.';
  }

  return {
    ref,
    refRating: Number(ref.rating),
    score: sim.score,
    percent: pct,
    close,
    divergence: div,
    title: `${pct}% like your ${ref.rating}/10 shot`,
    detail,
    // Same yield in a different shape is the case worth naming: the numbers
    // matched and the drink did not.
    sameNumbers: Math.abs(mine.wEnd - theirs.wEnd) < 1.5 && Math.abs(mine.tEnd - theirs.tEnd) < 2,
  };
}
