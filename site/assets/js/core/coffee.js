// Espresso extraction math.
//
// Conventions used throughout this project:
//   tds_pct  — total dissolved solids as a PERCENTAGE (e.g. 9.1, not 0.091)
//   ey_pct   — extraction yield as a PERCENTAGE of the dry dose
//   ratio    — beverage mass / dry dose mass (the "1:2" of a 1:2 shot)
//
// The legacy CSVs stored TDS as a fraction (0.11475). The importer converts.

/** Default refractometer Brix -> TDS conversion factor. See BRIX_FACTOR_NOTE. */
export const DEFAULT_BRIX_FACTOR = 0.85;

export const BRIX_FACTOR_NOTE = `A refractometer measures refractive index and reports it as Brix, which is
calibrated for sucrose. Coffee solubles are not sucrose, so a correction factor is applied. 0.85 is the
common convention, but the true factor depends on roast level, the reference method, and the instrument —
published and community values span roughly 0.79–0.89. Treat it as a measured quantity with its own
uncertainty, not as a constant. It is usually the single largest contributor to extraction-yield error.`;

export const brixToTds = (brix, factor = DEFAULT_BRIX_FACTOR) => brix * factor;
export const tdsToBrix = (tdsPct, factor = DEFAULT_BRIX_FACTOR) => tdsPct / factor;

export const ratio = (doseG, yieldG) => yieldG / doseG;

/** Extraction yield (%) = mass of dissolved solids in the cup / dry dose. */
export const extractionYield = (tdsPct, doseG, yieldG) => tdsPct * (yieldG / doseG);

/** Mass of dissolved coffee solids actually in the cup, in grams. */
export const solidsMass = (tdsPct, yieldG) => (tdsPct / 100) * yieldG;

/** Average flow rate over the whole shot (g/s). */
export const avgFlow = (yieldG, timeS) => yieldG / timeS;

/** Brew ratio needed to reach a target yield at a known TDS. */
export const ratioForYield = (targetEyPct, tdsPct) => targetEyPct / tdsPct;

/**
 * Interpretation bands. These are conventions from the SCA brewing control
 * chart adapted to espresso, not laws of nature — plenty of excellent shots
 * sit outside them, and they exist to flag a shot worth tasting critically.
 */
export const EY_BANDS = [
  { max: 18, label: 'Under-extracted', hint: 'Often sour, thin, salty. Try finer, hotter, or a longer ratio.' },
  { max: 22, label: 'Typical range', hint: 'The conventional target band for espresso.' },
  { max: Infinity, label: 'Over-extracted', hint: 'Often bitter, drying, hollow. Try coarser, cooler, or a shorter ratio.' },
];

export function classifyYield(eyPct) {
  if (!Number.isFinite(eyPct)) return null;
  return EY_BANDS.find((b) => eyPct < b.max) ?? EY_BANDS.at(-1);
}

/** Derive every dependent field from what the user actually measured. */
export function deriveShot(s, factor = DEFAULT_BRIX_FACTOR) {
  const out = { ...s };
  if (Number.isFinite(s.brix) && !Number.isFinite(s.tds_pct)) {
    out.tds_pct = brixToTds(s.brix, factor);
  }
  if (Number.isFinite(out.dose_g) && Number.isFinite(out.yield_g)) {
    out.ratio = ratio(out.dose_g, out.yield_g);
    if (Number.isFinite(out.time_s)) out.flow_gs = avgFlow(out.yield_g, out.time_s);
    if (Number.isFinite(out.tds_pct)) {
      out.ey_pct = extractionYield(out.tds_pct, out.dose_g, out.yield_g);
      out.solids_g = solidsMass(out.tds_pct, out.yield_g);
    }
  }
  return out;
}
