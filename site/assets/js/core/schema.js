// The canonical shot record. One row per shot, one table for all shots.
//
// The legacy layout wrote one CSV file per shot — 15 files for 15 shots, with
// the column headers repeated in every one. That makes the data unusable in a
// spreadsheet and awkward everywhere else. This is a single table.

export const FIELDS = [
  // identity
  { key: 'shot_id',       label: 'Shot ID',        type: 'text', group: 'meta' },
  { key: 'timestamp',     label: 'Timestamp',      type: 'datetime', group: 'meta' },

  // what went in
  { key: 'bag_id',        label: 'Bag',            type: 'text', group: 'coffee' },
  { key: 'roaster',       label: 'Roaster',        type: 'text', group: 'coffee' },
  { key: 'bean_name',     label: 'Coffee',         type: 'text', group: 'coffee' },
  { key: 'roast_date',    label: 'Roast date',     type: 'date', group: 'coffee' },
  { key: 'days_off_roast', label: 'Days off roast', unit: 'd', type: 'number', group: 'coffee' },
  { key: 'days_frozen',   label: 'Days frozen',     unit: 'd', type: 'number', group: 'coffee' },
  { key: 'roast_level',   label: 'Roast level',     type: 'text', group: 'coffee' },
  { key: 'process',       label: 'Process',        type: 'text', group: 'coffee' },

  // prep
  { key: 'grinder_id',    label: 'Grinder',        type: 'text', group: 'prep' },
  { key: 'grinder_name',  label: 'Grinder name',   type: 'text', group: 'prep' },
  { key: 'grind_setting', label: 'Grind setting',  unit: '',    type: 'number', group: 'prep', step: 0.1 },
  { key: 'grind_label',   label: 'Grind label',    type: 'text', group: 'prep' },
  { key: 'dose_g',        label: 'Dose in',        unit: 'g',   type: 'number', group: 'prep', measured: true, step: 0.1 },
  { key: 'grounds_out_g', label: 'Grounds out',    unit: 'g',   type: 'number', group: 'prep', measured: true, step: 0.1 },
  { key: 'retention_g',   label: 'Retention',      unit: 'g',   type: 'number', group: 'derived' },
  { key: 'basket',        label: 'Basket',         type: 'text', group: 'prep' },

  // machine
  { key: 'machine_id',    label: 'Machine',        type: 'text', group: 'machine' },
  { key: 'machine_name',  label: 'Machine name',   type: 'text', group: 'machine' },
  { key: 'temp_c',        label: 'Water temp',     unit: '°C',  type: 'number', group: 'machine', step: 0.5 },
  { key: 'pressure_bar',  label: 'Pressure',       unit: 'bar', type: 'number', group: 'machine', step: 0.1 },
  { key: 'preinfusion_s', label: 'Pre-infusion',   unit: 's',   type: 'number', group: 'machine', step: 0.5 },

  // what came out
  { key: 'yield_g',       label: 'Yield out',      unit: 'g',   type: 'number', group: 'result', measured: true, step: 0.1 },
  // WHAT YOU AIMED AT, which is not what came out and was not recorded at all.
  // The log kept the yield and the achieved ratio, so nothing afterwards could
  // say whether a 41 g shot was a 41 g intention or a 36 g one that ran away —
  // and a replay drawing its target line at the achieved yield draws a shot
  // that hit its target by definition, which is the one thing a target line
  // must never do.
  { key: 'target_g',      label: 'Target yield',   unit: 'g',   type: 'number', group: 'result', step: 0.1 },
  { key: 'ratio',         label: 'Ratio',          unit: ':1',  type: 'number', group: 'derived' },
  { key: 'time_s',        label: 'Shot time',      unit: 's',   type: 'number', group: 'result', measured: true, step: 0.1 },
  { key: 't_first_drip_s', label: 'First drip',    unit: 's',   type: 'number', group: 'result' },
  { key: 'flow_gs',       label: 'Avg flow',       unit: 'g/s', type: 'number', group: 'derived' },
  { key: 'peak_flow_gs',  label: 'Peak flow',      unit: 'g/s', type: 'number', group: 'result' },
  { key: 'steady_flow_gs', label: 'Steady flow',   unit: 'g/s', type: 'number', group: 'result' },
  { key: 'flow_slope_late', label: 'Late slope',   unit: 'g/s²', type: 'number', group: 'result' },
  // The biggest half-second jump in flow, as a fraction of the flow already
  // running. A channel is a step rather than a slope, so this is the field that
  // carries the signal the late slope was wrongly asked to carry.
  { key: 'flow_step', label: 'Biggest flow step', type: 'number', group: 'result' },

  // refractometry
  { key: 'brix',          label: 'Brix',           unit: '°Bx', type: 'number', group: 'result', measured: true, step: 0.01 },
  { key: 'tds_pct',       label: 'TDS',            unit: '%',   type: 'number', group: 'derived' },
  { key: 'ey_pct',        label: 'Extraction yield', unit: '%', type: 'number', group: 'derived' },

  // taste
  { key: 'rating',        label: 'Rating',         unit: '/10', type: 'number', group: 'taste', step: 1 },
  { key: 'tags',          label: 'Tags',           type: 'text', group: 'taste' },

  // how it was made, beyond the numbers
  { key: 'method',        label: 'Brew method',    type: 'text', group: 'meta' },
  { key: 'milk_g',        label: 'Milk',           unit: 'g',   type: 'number', group: 'result', step: 1 },
  // Seconds between the grind finishing and the pump starting. Ground coffee
  // degasses and cools from the moment it leaves the burrs, so two otherwise
  // identical shots pulled thirty seconds and five minutes after grinding are
  // not the same shot. Nothing else logs this because nothing else knows both
  // timestamps; this app captures the grounds and starts the clock itself.
  { key: 'puck_prep_s',   label: 'Grind to brew',  unit: 's',   type: 'number', group: 'result' },
  // Which of the three drinks this turned out to be, read off the ratio after
  // the fact. Stored as well as derived because a ratio is a number you have to
  // interpret every time you read it, and because the bands may be tuned later
  // — what you actually pulled should not change retroactively when they are.
  { key: 'style',         label: 'Style',                       type: 'text', group: 'result' },

  // provenance
  { key: 'curve',         label: 'Flow curve',     type: 'text', group: 'meta' },
  { key: 'defaulted',     label: 'Assumed fields', type: 'text', group: 'meta' },
  { key: 'notes',         label: 'Notes',          type: 'text', group: 'meta' },
];

export const byKey = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

/**
 * WHAT A PERSON MAY CORRECT AFTER THE FACT.
 *
 * A shot was write-once, which is wrong about how the log is actually kept: you
 * change the grind, pull the shot, and remember at the second sip that the dial
 * moved and the record says otherwise. That shot is then quietly lying to every
 * regression that reads it, and the only remedy was to delete it and lose the
 * curve.
 *
 * The list is everything a person observed or typed, and nothing the app
 * measured or worked out. The derived numbers — ratio, extraction yield, TDS —
 * are deliberately absent because they are recomputed from these on save; the
 * curve scalars are absent because the curve is the evidence and editing a
 * reading of it would be editing the evidence. The curve itself is never
 * touched, so a corrected shot still replays exactly as it was pulled.
 */
export const EDITABLE = [
  'grind_setting', 'grind_label', 'dose_g', 'grounds_out_g', 'basket',
  'temp_c', 'pressure_bar', 'preinfusion_s',
  'yield_g', 'target_g', 'time_s', 'milk_g', 'brix',
  'rating', 'tags', 'notes',
];
export const NUMERIC = FIELDS.filter((f) => f.type === 'number').map((f) => f.key);
export const COLUMNS = FIELDS.map((f) => f.key);

/** Fields that make sense as a regression predictor. */
export const PREDICTORS = ['grind_setting', 'temp_c', 'pressure_bar', 'time_s', 'dose_g', 'ratio',
  'flow_gs', 'days_off_roast', 'steady_flow_gs', 'peak_flow_gs', 't_first_drip_s', 'preinfusion_s',
  'puck_prep_s'];
/** Fields that make sense as a regression response. */
export const RESPONSES = ['ey_pct', 'tds_pct', 'time_s', 'flow_gs', 'ratio', 'yield_g',
  'steady_flow_gs', 't_first_drip_s', 'rating', 'retention_g'];

/**
 * A label with its unit, in a form that survives being shouted.
 *
 * Every label on this site is uppercased by CSS, and "(g)" uppercased is "(G)"
 * — gauss. "(s)" is "(S)", siemens. Both are real units and neither is the one
 * meant, so the two that collide are spelled out and the rest, which read the
 * same either way, keep the parenthesis they had.
 *
 * Here rather than in the pages, because there were two places composing this
 * string and they have to agree.
 */
export function withUnit(text, unit) {
  if (!unit) return text;
  const spelled = { g: 'grams', s: 'seconds' }[unit];
  return spelled ? `${text}, ${spelled}` : `${text} (${unit})`;
}

export function label(key) {
  const f = byKey[key];
  if (!f) return key;
  return withUnit(f.label, f.unit);
}

// Legacy header -> canonical key. The "<X> Used" booleans marked whether a
// default was substituted for a real measurement; they collapse into the single
// `defaulted` column rather than being dropped, because "this value was assumed"
// is information you want when a point turns up as an outlier later.
export const LEGACY_MAP = {
  'Timestamp': 'timestamp',
  'Temperature (°C)': 'temp_c',
  'Pressure (bar)': 'pressure_bar',
  'Grind Size': 'grind_label',
  'Extraction Time (s)': 'time_s',
  'Dry Coffee Mass (g)': 'dose_g',
  'Beverage Mass (g)': 'yield_g',
  'Brix': 'brix',
  'Extraction Yield (%)': 'ey_pct',
};

export const LEGACY_DEFAULT_FLAGS = {
  'Temperature Used': 'temp_c',
  'Pressure Used': 'pressure_bar',
  'Grind Size Used': 'grind_setting',
  'Extraction Time Used': 'time_s',
};

/** Legacy grind labels were mapped to a nominal particle size in microns. */
export const GRIND_MICRONS = { fine: 200, medium: 400, coarse: 600 };

/** Taste tags, kept short so they are one tap after a shot rather than an essay. */
export const TASTE_TAGS = ['sour', 'bitter', 'balanced', 'sweet', 'harsh', 'thin', 'syrupy',
  'fruity', 'ashy', 'hollow', 'channelled'];

/**
 * The flow curve is stored downsampled, as `t:w|t:w|…`. A 30 s shot at the
 * 40 Hz stream rate is 1200 points and roughly 12 kB per row, which makes a CSV
 * unopenable; 4 Hz keeps the shape, the late-shot slope and a plottable curve
 * in about a tenth of that. The scalars that diagnosis depends on are computed
 * before downsampling, so nothing rests on the reduced version.
 */
export const CURVE_HZ = 4;

export function encodeCurve(points, hz = CURVE_HZ) {
  if (!points?.length) return '';
  const step = 1 / hz;
  const out = [];
  let next = points[0][0];
  for (const [t, w] of points) {
    if (t + 1e-9 < next) continue;
    out.push(`${t.toFixed(2)}:${w.toFixed(2)}`);
    next = t + step;
  }
  const last = points.at(-1);
  if (out.length && !out.at(-1).startsWith(last[0].toFixed(2))) {
    out.push(`${last[0].toFixed(2)}:${last[1].toFixed(2)}`);
  }
  return out.join('|');
}

export function decodeCurve(str) {
  if (!str) return [];
  return String(str).split('|').map((p) => p.split(':').map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite));
}
