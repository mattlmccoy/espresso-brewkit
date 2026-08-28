// Uncertainty propagation for extraction yield, following the GUM
// (Guide to the Expression of Uncertainty in Measurement) law of propagation.
//
//   EY% = k · B · (m_bev / m_dry)
//
// where k is the Brix->TDS factor, B the Brix reading, and m the two masses.
//
// The combined standard uncertainty is the root-sum-square of each input's
// standard uncertainty scaled by its sensitivity coefficient (the partial
// derivative of EY with respect to that input).
//
// NOTE ON THE FACTOR k
// --------------------
// The original Python implementation treated k = 0.85 as an exact constant and
// propagated only the Brix and mass uncertainties. That understates the result,
// usually badly: k is an empirical correction that varies with roast level and
// instrument, and its relative uncertainty is typically larger than that of a
// Brix reading. Including it is the single most important change here, and the
// budget below exists to make its dominance visible rather than assumed.
// Set uFactor = 0 to reproduce the legacy numbers exactly.

export const DEFAULTS = {
  uMass: 0.01,      // g,     scale resolution / repeatability
  uBrix: 0.5,       // Brix,  refractometer repeatability
  uFactor: 0.02,    // -,     uncertainty in the Brix->TDS factor itself
  coverage: 2,      // k=2 ≈ 95% for an approximately normal distribution
};

/**
 * @returns per-term sensitivity coefficients, contributions, combined and
 *          expanded uncertainty, and each term's share of the total variance.
 */
export function propagate({ brix, factor, doseG, yieldG }, opts = {}) {
  const { uMass, uBrix, uFactor, coverage } = { ...DEFAULTS, ...opts };

  const tds = factor * brix;
  const ey = tds * (yieldG / doseG);

  // Sensitivity coefficients: ∂EY/∂x for each input x.
  const c = {
    factor: brix * (yieldG / doseG),
    brix: factor * (yieldG / doseG),
    yieldG: tds / doseG,
    doseG: -(tds * yieldG) / doseG ** 2,
  };

  const u = { factor: uFactor, brix: uBrix, yieldG: uMass, doseG: uMass };

  // Each term's contribution to the standard uncertainty, |c_i| · u_i.
  const contrib = Object.fromEntries(
    Object.keys(c).map((key) => [key, Math.abs(c[key]) * u[key]]),
  );

  const variance = Object.values(contrib).reduce((s, v) => s + v ** 2, 0);
  const combined = Math.sqrt(variance);

  // Share of total variance — this is what identifies the term worth improving.
  // Shares are of variance, not of standard uncertainty, because variances add.
  const budget = Object.entries(contrib)
    .map(([key, v]) => ({
      key,
      sensitivity: c[key],
      u: u[key],
      contribution: v,
      share: variance === 0 ? 0 : (v ** 2 / variance) * 100,
    }))
    .sort((a, b) => b.share - a.share);

  return {
    tds, ey,
    combined,
    expanded: combined * coverage,
    coverage,
    relative: (combined / ey) * 100,
    budget,
    inputs: { brix, factor, doseG, yieldG, uMass, uBrix, uFactor },
  };
}

const LABELS = {
  factor: 'Brix→TDS factor',
  brix: 'Brix reading',
  yieldG: 'Beverage mass',
  doseG: 'Dry dose mass',
};
export const termLabel = (key) => LABELS[key] ?? key;

/** Plain-language reading of where the error is actually coming from. */
export function interpret(result) {
  const top = result.budget[0];
  if (!top || !Number.isFinite(top.share)) return '';
  const pct = top.share.toFixed(0);
  if (top.key === 'factor') {
    return `The Brix→TDS factor accounts for ${pct}% of the variance. A better scale or a `
      + `steadier refractometer hand will not measurably improve this number — only pinning `
      + `down the factor for your roast will.`;
  }
  if (top.key === 'brix') {
    return `The refractometer reading accounts for ${pct}% of the variance. Averaging repeated `
      + `readings on the same sample is the cheapest improvement available: n readings cut this `
      + `term by √n.`;
  }
  return `${termLabel(top.key)} accounts for ${pct}% of the variance. Improving scale resolution `
    + `or technique on this measurement is where the gain is.`;
}
