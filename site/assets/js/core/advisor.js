// What to dial next.
//
// Two questions, two different models, because they are not the same question:
//
//   1. "What grind gets me the shot time I am aiming for?"  — physics. Flow
//      through a packed bed is Darcy's law; permeability goes as the square of
//      particle size, and a grinder dial is roughly linear in burr gap, so
//      log(flow) comes out near-linear in dial setting. Fit it and invert it.
//
//   2. "What grind tastes best?"  — not physics. Nobody has a model of your
//      palate, so this is a search: fit a Gaussian process to the ratings you
//      have given and pick the setting with the best expected improvement.
//
// Question 1 has an answer after three shots. Question 2 needs closer to ten,
// and this module says which of the two it is answering and how much to trust
// the answer, rather than emitting a number and letting you assume it is solid.

import { snapSetting } from './kit.js';

const F = (v) => (typeof v === 'number' ? v
  : v === '' || v === null || v === undefined ? NaN : Number(v));

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/** OLS of y on a design matrix whose columns are given as arrays. Adds the intercept. */
function ols(cols, y) {
  const n = y.length;
  const k = cols.length + 1;
  const X = [];
  for (let i = 0; i < n; i++) X.push([1, ...cols.map((c) => c[i])]);
  // Normal equations. k is 2 or 3 here, so an explicit solve is fine.
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < k; r++) {
      b[r] += X[i][r] * y[i];
      for (let c = 0; c < k; c++) A[r][c] += X[i][r] * X[i][c];
    }
  }
  const inv = invert(A);
  if (!inv) return null;
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * b[j], 0));
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const pred = X[i].reduce((s, v, j) => s + v * beta[j], 0);
    ss += (y[i] - pred) ** 2;
  }
  const df = n - k;
  const s2 = df > 0 ? ss / df : NaN;
  const se = inv.map((row, j) => Math.sqrt(Math.max(0, s2 * row[j])));
  return { beta, se, s2, sigma: Math.sqrt(s2), n, df };
}

function invert(M) {
  const k = M.length;
  const A = M.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-10) return null;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c];
    for (let j = 0; j < 2 * k; j++) A[c][j] /= d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c];
      if (!f) continue;
      for (let j = 0; j < 2 * k; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row) => row.slice(k));
}

/** Rows usable for the resistance model: a grind setting and a flow rate. */
export function resistanceRows(shots, { grinderId = null, bagId = null } = {}) {
  return shots.filter((s) => {
    if (grinderId && s.grinder_id !== grinderId) return false;
    if (bagId && s.bag_id !== bagId) return false;
    const g = F(s.grind_setting);
    const q = F(s.steady_flow_gs);
    const qAvg = F(s.flow_gs);
    return Number.isFinite(g) && (q > 0.05 || qAvg > 0.05);
  }).map((s) => ({
    grind: F(s.grind_setting),
    // Steady flow is the right variable — it is the bed's resistance. Average
    // flow is yield/time, which is contaminated by pre-infusion and the drip
    // tail, so it is only a fallback for rows logged before the curve existed.
    logQ: Math.log(F(s.steady_flow_gs) > 0.05 ? F(s.steady_flow_gs) : F(s.flow_gs)),
    days: Number.isFinite(F(s.days_off_roast)) ? F(s.days_off_roast) : null,
    // Ground straight from the freezer. Kept on the row rather than filtered
    // out here, so the scatter can still show the shot while the fit ignores it.
    fromFrozen: !!s.from_frozen,
    bag_id: s.bag_id ?? '',
    rating: F(s.rating),
    shot_id: s.shot_id,
  }));
}

/**
 * How much slower a first-shot-from-frozen actually runs, for this person.
 *
 * The direction is settled — colder beans fracture into a smaller mean particle
 * size and a narrower distribution, which is a finer grind at an unchanged dial
 * (Uman et al., 2016). The magnitude is not, and it should not be: it depends
 * on the burr, on how cold the freezer is, and on how long the portion sat out
 * before it was ground. So it is measured against the same fit the shot was
 * excluded from, rather than asserted, and until there are enough of them the
 * honest answer is the direction alone.
 */
export function frozenEffect(rows, fit, { minN = 3 } = {}) {
  const res = rows.map((r) => r.logQ - (fit.a + fit.b * r.grind + (fit.c ?? 0) * (r.days ?? 0)));
  if (res.length < minN) {
    const need = minN - res.length;
    return { known: false, n: res.length,
      note: 'Colder beans grind finer, so the first shot off a portion runs slower than the rest '
        + 'of it. How much is a property of your grinder and your freezer rather than a constant, '
        + `so it is measured rather than assumed: ${need} more frozen first shot`
        + `${need === 1 ? '' : 's'} and this becomes a number.` };
  }
  const m = mean(res);
  const sd = Math.sqrt(res.reduce((t, v) => t + (v - m) ** 2, 0) / (res.length - 1));
  const se = sd / Math.sqrt(res.length);
  const pct = (Math.exp(m) - 1) * 100;
  return {
    known: true, n: res.length, logRatio: m, se, pct,
    // Two standard errors either side, on the ratio scale where the fit lives.
    lo: (Math.exp(m - 2 * se) - 1) * 100,
    hi: (Math.exp(m + 2 * se) - 1) * 100,
    note: `Across ${res.length} first shots from frozen, flow ran `
      + `${Math.abs(pct).toFixed(0)}% ${pct < 0 ? 'slower' : 'faster'} than the same dial setting `
      + 'gives once the portion is at room temperature.',
  };
}

/**
 * Fit log(Q) = a + b·grind + c·days, partially pooling the grind sensitivity.
 *
 * `b` is mostly a property of the grinder, not of the bag: the same dial step
 * moves burr gap by the same amount whatever is in the hopper. So it is
 * estimated across every shot on that grinder and shrunk toward, rather than
 * refit from the two or three shots a fresh bag has. `a` stays bag-specific,
 * because how much a particular coffee resists at a given setting is exactly
 * what changes between bags.
 *
 * The shrinkage weight is n/(n+κ) with κ=4 — a stand-in for the variance ratio
 * a full hierarchical fit would estimate. With this much data that ratio is
 * itself barely identified, so a fixed κ is the more honest simplification.
 */
export function fitResistance(shots, { grinderId, bagId, kappa = 4 } = {}) {
  // A shot pulled from frozen beans is not a reading of the bag's resistance.
  // Colder beans fracture into a smaller mean particle size and a narrower
  // distribution (Uman et al., Scientific Reports, 2016), so at a fixed dial
  // setting they run slower — the dial did not move, the bean did. Leaving
  // those rows in would drag the bag intercept toward a grind you never set,
  // and with only a handful of shots on a fresh bag, one of them is enough.
  const all = resistanceRows(shots, { grinderId });
  const frozen = all.filter((r) => r.fromFrozen).length;
  const pooledRows = all.filter((r) => !r.fromFrozen);
  if (pooledRows.length < 3) {
    return { ok: false, frozen,
             reason: 'needs at least 3 shots on this grinder with a grind setting and a flow rate'
               + (frozen ? `, and ${frozen} of them came straight from the freezer` : ''),
             n: pooledRows.length };
  }
  const spread = (rows) => {
    const gs = rows.map((r) => r.grind);
    return Math.max(...gs) - Math.min(...gs);
  };
  if (spread(pooledRows) < 1e-6) {
    return { ok: false, frozen,
             reason: 'every shot used the same grind setting, so nothing separates grind from noise',
             n: pooledRows.length };
  }

  const useDays = pooledRows.filter((r) => r.days !== null).length >= pooledRows.length * 0.8
    && new Set(pooledRows.map((r) => r.days)).size >= 3;
  const withDays = useDays ? pooledRows.filter((r) => r.days !== null) : pooledRows;
  const cols = useDays
    ? [withDays.map((r) => r.grind), withDays.map((r) => r.days)]
    : [withDays.map((r) => r.grind)];
  const pooled = ols(cols, withDays.map((r) => r.logQ));
  if (!pooled) {
    return { ok: false, frozen, reason: 'the grinder-wide fit is singular', n: pooledRows.length };
  }

  const bPool = pooled.beta[1];
  const c = useDays ? pooled.beta[2] : 0;

  const bagRows = bagId ? pooledRows.filter((r) => r.bag_id === bagId) : [];
  let b = bPool, lambda = 0, bBag = NaN, aRows = bagRows.length >= 2 ? bagRows : pooledRows;

  if (bagRows.length >= 3 && spread(bagRows) > 0.4) {
    const offset = bagRows.map((r) => r.logQ - c * (r.days ?? 0));
    const own = ols([bagRows.map((r) => r.grind)], offset);
    if (own && Number.isFinite(own.beta[1])) {
      bBag = own.beta[1];
      lambda = bagRows.length / (bagRows.length + kappa);
      b = lambda * bBag + (1 - lambda) * bPool;
    }
  }

  // Refit the intercept holding the shrunk slope, so predictions pass through
  // the bag's own data even though the slope was borrowed.
  const a = mean(aRows.map((r) => r.logQ - b * r.grind - c * (r.days ?? 0)));
  const resid = aRows.map((r) => r.logQ - (a + b * r.grind + c * (r.days ?? 0)));
  const sigma = aRows.length > 2 ? Math.sqrt(resid.reduce((s, v) => s + v * v, 0) / (aRows.length - 2)) : pooled.sigma;

  return {
    ok: true, a, b, c, bPool, bBag, lambda, sigma,
    seB: pooled.se[1], usesDays: useDays,
    n: pooledRows.length, nBag: bagRows.length,
    frozen, frozenEffect: frozenEffect(all.filter((r) => r.fromFrozen), { a, b, c }),
    /** Predicted steady flow, g/s, at a dial setting. */
    predictFlow: (grind, days = 0) => Math.exp(a + b * grind + c * (days ?? 0)),
  };
}

/**
 * Invert the resistance model: which setting lands the target shot time?
 *
 * Target flow is yield/time with the pre-infusion subtracted, because the model
 * describes flow once the bed is saturated, and pre-infusion time is not part
 * of that.
 */
export function recommendGrind(shots, { grinderId, bagId, grinder, targetTimeS = 28,
                                        targetDoseG = 18, targetRatio = 2, days = 0,
                                        preinfusionS = 0, currentSetting = null } = {}) {
  const fit = fitResistance(shots, { grinderId, bagId });
  if (!fit.ok) return { ok: false, ...fit };

  const flowSeconds = Math.max(4, targetTimeS - (preinfusionS || 0));
  const targetFlow = (targetDoseG * targetRatio) / flowSeconds;
  const raw = (Math.log(targetFlow) - fit.a - fit.c * (days ?? 0)) / fit.b;

  if (!Number.isFinite(raw)) {
    return { ok: false, reason: 'the fitted grind sensitivity is too small to invert', ...fit };
  }
  // Sensitivity is steep and the data are few; a recommendation ten steps away
  // is extrapolation dressed as advice.
  const setting = snapSetting(grinder, raw);
  const relSe = Math.abs(fit.seB / fit.b);
  const spanFactor = Math.abs(fit.sigma / fit.b) + Math.abs(raw * relSe);

  return {
    ok: true,
    setting,
    raw: +raw.toFixed(3),
    lo: snapSetting(grinder, raw - spanFactor),
    hi: snapSetting(grinder, raw + spanFactor),
    targetFlow: +targetFlow.toFixed(3),
    delta: Number.isFinite(F(currentSetting)) ? +(setting - F(currentSetting)).toFixed(2) : null,
    extrapolating: Number.isFinite(F(currentSetting)) && Math.abs(setting - F(currentSetting)) > 4,
    confidence: relSe < 0.2 && fit.n >= 6 ? 'good' : relSe < 0.5 ? 'rough' : 'weak',
    fit,
  };
}

/* --------------------------------------------------------- taste, as a search */

/** Matérn 5/2. Smoother than exponential, less absurdly smooth than squared
 *  exponential — the usual default when you do not believe your response is
 *  infinitely differentiable, and nobody's palate is. */
export function matern52(a, b, ell, sigmaF) {
  const s = Math.sqrt(5) * Math.abs(a - b) / ell;
  return sigmaF * sigmaF * (1 + s + (s * s) / 3) * Math.exp(-s);
}

function cholesky(A) {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 1e-12) return null;
        L[i][j] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  }
  return L;
}

function cholSolve(L, b) {
  const n = L.length;
  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

/** GP posterior at `xstar`, with hyperparameters fixed. */
export function gpPosterior(xs, ys, xstar, { ell, sigmaF, sigmaN, prior = 0 }) {
  const n = xs.length;
  const K = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => matern52(xs[i], xs[j], ell, sigmaF) + (i === j ? sigmaN * sigmaN : 0)));
  const L = cholesky(K);
  if (!L) return null;
  const alpha = cholSolve(L, ys.map((y) => y - prior));
  return xstar.map((x) => {
    const k = xs.map((xi) => matern52(x, xi, ell, sigmaF));
    const mu = prior + k.reduce((s, v, i) => s + v * alpha[i], 0);
    const v = cholSolve(L, k);
    const varr = matern52(x, x, ell, sigmaF) - k.reduce((s, kv, i) => s + kv * v[i], 0);
    return { x, mean: mu, sd: Math.sqrt(Math.max(1e-9, varr)) };
  });
}

function logMarginal(xs, ys, { ell, sigmaF, sigmaN, prior }) {
  const n = xs.length;
  const K = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => matern52(xs[i], xs[j], ell, sigmaF) + (i === j ? sigmaN * sigmaN : 0)));
  const L = cholesky(K);
  if (!L) return -Infinity;
  const d = ys.map((y) => y - prior);
  const alpha = cholSolve(L, d);
  let logdet = 0;
  for (let i = 0; i < n; i++) logdet += 2 * Math.log(L[i][i]);
  return -0.5 * d.reduce((s, v, i) => s + v * alpha[i], 0) - 0.5 * logdet - 0.5 * n * Math.log(2 * Math.PI);
}

const normPdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t
    + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

export const expectedImprovement = (mu, sd, best, xi = 0.1) => {
  if (!(sd > 1e-9)) return 0;
  const z = (mu - best - xi) / sd;
  return (mu - best - xi) * normCdf(z) + sd * normPdf(z);
};

/**
 * Where to grind next if you are chasing taste rather than a stopwatch.
 *
 * Ratings are 1–10 integers, which are ordinal — the gap from 6 to 7 is not
 * necessarily the gap from 8 to 9. Treating them as continuous with a generous
 * noise term is a real approximation, and it is the one made here: an ordinal
 * likelihood needs more data than a home log will ever have to beat it.
 */
export function suggestByTaste(shots, { grinderId, bagId, grinder, currentSetting = null,
                                        maxStep = 3 } = {}) {
  const rows = shots.filter((s) => {
    if (grinderId && s.grinder_id !== grinderId) return false;
    if (bagId && s.bag_id !== bagId) return false;
    return Number.isFinite(F(s.grind_setting)) && Number.isFinite(F(s.rating));
  }).map((s) => ({ x: F(s.grind_setting), y: F(s.rating), shot_id: s.shot_id }));

  if (rows.length < 4) {
    return { ok: false, reason: `needs at least 4 rated shots on this coffee; there are ${rows.length}`,
             n: rows.length };
  }
  const xs = rows.map((r) => r.x);
  const ys = rows.map((r) => r.y);
  const range = Math.max(...xs) - Math.min(...xs);
  if (!(range > 1e-6)) {
    return { ok: false, reason: 'every rated shot used the same grind setting', n: rows.length };
  }

  // Hyperparameters by marginal likelihood over a coarse grid. With this few
  // points a gradient optimiser would just find a sharper overfit.
  const prior = mean(ys);
  const spread = Math.max(0.5, Math.sqrt(ys.reduce((s, v) => s + (v - prior) ** 2, 0) / ys.length));
  let best = { ll: -Infinity };
  for (const ellF of [0.2, 0.35, 0.5, 0.8, 1.2]) {
    for (const sigF of [spread, spread * 1.6]) {
      for (const sigN of [0.5, 0.9, 1.4]) {
        const hp = { ell: Math.max(0.3, ellF * range), sigmaF: sigF, sigmaN: sigN, prior };
        const ll = logMarginal(xs, ys, hp);
        if (ll > best.ll) best = { ll, hp };
      }
    }
  }
  if (!best.hp) return { ok: false, reason: 'the taste model would not fit', n: rows.length };

  const step = Number(grinder?.step) > 0 ? Number(grinder.step) : 0.5;
  const lo = Number.isFinite(Number(grinder?.min)) ? Number(grinder.min) : Math.min(...xs) - 2;
  const hi = Number.isFinite(Number(grinder?.max)) ? Number(grinder.max) : Math.max(...xs) + 2;
  const grid = [];
  for (let v = lo; v <= hi + 1e-9; v += step) grid.push(+v.toFixed(4));
  if (!grid.length) return { ok: false, reason: 'the grinder has no usable dial range', n: rows.length };

  const post = gpPosterior(xs, ys, grid, best.hp);
  if (!post) return { ok: false, reason: 'the taste model would not fit', n: rows.length };

  const bestSeen = Math.max(...ys);
  const anchor = Number.isFinite(F(currentSetting)) ? F(currentSetting)
    : xs[ys.indexOf(bestSeen)];

  const scored = post.map((p) => {
    const ei = expectedImprovement(p.mean, p.sd, bestSeen);
    // Nobody dials eight steps on the strength of six shots. The penalty keeps
    // the suggestion inside the region the next shot can actually test.
    const penalty = Math.exp(-(((p.x - anchor) / (2 * maxStep)) ** 2));
    return { ...p, ei, score: ei * penalty };
  }).sort((a, b) => b.score - a.score);

  const top = scored[0];
  const peak = [...post].sort((a, b) => b.mean - a.mean)[0];

  return {
    ok: true,
    n: rows.length,
    setting: top.x,
    predicted: +top.mean.toFixed(2),
    predictedSd: +top.sd.toFixed(2),
    ei: +top.ei.toFixed(3),
    bestSeen,
    modelPeak: { setting: peak.x, rating: +peak.mean.toFixed(2) },
    exploring: top.sd > 0.8 * best.hp.sigmaF,
    curve: post.map((p) => ({ x: p.x, mean: +p.mean.toFixed(3), sd: +p.sd.toFixed(3) })),
    observations: rows,
    hp: best.hp,
    alternatives: scored.slice(1, 4).map((p) => ({ setting: p.x, predicted: +p.mean.toFixed(2) })),
  };
}
