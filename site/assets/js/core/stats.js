// Descriptive statistics, regression, and outlier detection.
// No dependencies. All functions ignore null/NaN unless noted.

export const clean = (a) => a.filter((v) => typeof v === 'number' && Number.isFinite(v));

export const sum = (a) => a.reduce((s, v) => s + v, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : NaN);

export function variance(a, sample = true) {
  const n = a.length;
  if (n < (sample ? 2 : 1)) return NaN;
  const m = mean(a);
  return sum(a.map((v) => (v - m) ** 2)) / (sample ? n - 1 : n);
}
export const sd = (a, sample = true) => Math.sqrt(variance(a, sample));

/** Linear-interpolated quantile (matches numpy/pandas default). */
export function quantile(a, q) {
  const s = [...a].sort((x, y) => x - y);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = (a) => quantile(a, 0.5);

/** Median absolute deviation, scaled to be a consistent estimator of sigma. */
export function mad(a, scaled = true) {
  const m = median(a);
  const d = median(a.map((v) => Math.abs(v - m)));
  return scaled ? d * 1.4826 : d;
}

export function describe(a) {
  const x = clean(a);
  return {
    n: x.length,
    mean: mean(x),
    sd: sd(x),
    min: x.length ? Math.min(...x) : NaN,
    q1: quantile(x, 0.25),
    median: median(x),
    q3: quantile(x, 0.75),
    max: x.length ? Math.max(...x) : NaN,
    cv: (sd(x) / mean(x)) * 100,
  };
}

// Two-sided 95% critical values, df 1..30. Beyond df=30 the normal
// approximation is within ~1%, which is well inside what this data supports.
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
  2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
export const tCrit95 = (df) => (df < 1 ? NaN : df <= 30 ? T95[df - 1] : 1.96);

/**
 * Ordinary least squares, y = intercept + slope*x.
 * Returns fit quality and the standard errors needed for honest intervals.
 */
export function linreg(xs, ys) {
  const pts = xs.map((x, i) => [x, ys[i]])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = pts.length;
  if (n < 3) return { n, ok: false, reason: 'need at least 3 paired points' };

  const x = pts.map((p) => p[0]);
  const y = pts.map((p) => p[1]);
  const mx = mean(x);
  const my = mean(y);
  const sxx = sum(x.map((v) => (v - mx) ** 2));
  if (sxx === 0) return { n, ok: false, reason: 'x has no variation' };

  const sxy = sum(pts.map(([xi, yi]) => (xi - mx) * (yi - my)));
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const predict = (v) => intercept + slope * v;

  const resid = pts.map(([xi, yi]) => yi - predict(xi));
  const ssRes = sum(resid.map((r) => r ** 2));
  const ssTot = sum(y.map((v) => (v - my) ** 2));
  const df = n - 2;
  const mse = ssRes / df;

  const seSlope = Math.sqrt(mse / sxx);
  const t = tCrit95(df);

  return {
    ok: true, n, df, slope, intercept, predict, resid,
    r2: ssTot === 0 ? NaN : 1 - ssRes / ssTot,
    rmse: Math.sqrt(ssRes / n),
    se: Math.sqrt(mse),
    seSlope,
    seIntercept: Math.sqrt(mse * (1 / n + mx ** 2 / sxx)),
    slopeCI: [slope - t * seSlope, slope + t * seSlope],
    // t-stat on the slope: is there evidence of any relationship at all?
    tStat: slope / seSlope,
    significant: Math.abs(slope / seSlope) > t,
    // Standard error of the mean response at x, for the confidence band.
    seMean: (v) => Math.sqrt(mse * (1 / n + (v - mx) ** 2 / sxx)),
    tCrit: t,
  };
}

/** Solve a small linear system by Gauss-Jordan with partial pivoting. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null; // singular
    [M[c], M[p]] = [M[p], M[c]];
    const pivot = M[c][c];
    for (let j = c; j <= n; j++) M[c][j] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row) => row[n]);
}

/** Multiple linear regression on two predictors: y = b0 + b1*x1 + b2*x2. */
export function mlr2(x1s, x2s, ys) {
  const pts = x1s.map((a, i) => [a, x2s[i], ys[i]])
    .filter((p) => p.every(Number.isFinite));
  const n = pts.length;
  if (n < 4) return { n, ok: false, reason: 'need at least 4 complete points' };

  // Normal equations XᵀX b = Xᵀy
  const XtX = [[n, 0, 0], [0, 0, 0], [0, 0, 0]];
  const Xty = [0, 0, 0];
  for (const [a, b, y] of pts) {
    XtX[0][1] += a; XtX[0][2] += b;
    XtX[1][1] += a * a; XtX[1][2] += a * b;
    XtX[2][2] += b * b;
    Xty[0] += y; Xty[1] += a * y; Xty[2] += b * y;
  }
  XtX[1][0] = XtX[0][1]; XtX[2][0] = XtX[0][2]; XtX[2][1] = XtX[1][2];

  const beta = solve(XtX, Xty);
  if (!beta) return { n, ok: false, reason: 'predictors are collinear' };

  const [b0, b1, b2] = beta;
  const predict = (a, b) => b0 + b1 * a + b2 * b;
  const y = pts.map((p) => p[2]);
  const my = mean(y);
  const ssRes = sum(pts.map(([a, b, yi]) => (yi - predict(a, b)) ** 2));
  const ssTot = sum(y.map((v) => (v - my) ** 2));
  const df = n - 3;
  const r2 = ssTot === 0 ? NaN : 1 - ssRes / ssTot;

  return {
    ok: true, n, df, b0, b1, b2, predict,
    r2,
    // Adjusted R² matters here: adding a second predictor can only raise raw R².
    r2adj: 1 - (1 - r2) * ((n - 1) / df),
    rmse: Math.sqrt(ssRes / n),
  };
}

export function pearson(xs, ys) {
  const pts = xs.map((x, i) => [x, ys[i]]).filter((p) => p.every(Number.isFinite));
  if (pts.length < 3) return NaN;
  const x = pts.map((p) => p[0]);
  const y = pts.map((p) => p[1]);
  const mx = mean(x);
  const my = mean(y);
  const num = sum(pts.map(([a, b]) => (a - mx) * (b - my)));
  const den = Math.sqrt(sum(x.map((v) => (v - mx) ** 2)) * sum(y.map((v) => (v - my) ** 2)));
  return den === 0 ? NaN : num / den;
}

/**
 * Outlier detection by three methods.
 *
 * The modified z-score is included because the plain z-score is computed from a
 * mean and SD that the outlier itself inflates — at n=15 a single extreme point
 * can pull the threshold out past itself and hide. MAD-based scoring does not
 * have that failure mode, so where the two disagree, prefer the modified score.
 */
export function outliers(values, { iqrK = 1.5, zThresh = 2.5, modZThresh = 3.5 } = {}) {
  const idx = values.map((v, i) => i).filter((i) => Number.isFinite(values[i]));
  const x = idx.map((i) => values[i]);
  if (x.length < 4) return { ok: false, reason: 'need at least 4 values' };

  const q1 = quantile(x, 0.25);
  const q3 = quantile(x, 0.75);
  const iqr = q3 - q1;
  const lower = q1 - iqrK * iqr;
  const upper = q3 + iqrK * iqr;

  const m = mean(x);
  const s = sd(x);
  const med = median(x);
  const md = mad(x);

  const rows = idx.map((i, k) => {
    const v = x[k];
    const z = s === 0 ? 0 : (v - m) / s;
    const mz = md === 0 ? 0 : (v - med) / md;
    return {
      index: i, value: v, z, modZ: mz,
      byIqr: v < lower || v > upper,
      byZ: Math.abs(z) > zThresh,
      byModZ: Math.abs(mz) > modZThresh,
    };
  });

  return {
    ok: true, rows,
    stats: { q1, q3, iqr, lower, upper, mean: m, sd: s, median: med, mad: md },
    counts: {
      iqr: rows.filter((r) => r.byIqr).length,
      z: rows.filter((r) => r.byZ).length,
      modZ: rows.filter((r) => r.byModZ).length,
    },
  };
}
