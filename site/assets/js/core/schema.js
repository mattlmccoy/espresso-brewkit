// The canonical shot record. One row per shot, one table for all shots.
//
// The legacy layout wrote one CSV file per shot — 15 files for 15 shots, with
// the column headers repeated in every one. That makes the data unusable in a
// spreadsheet and awkward everywhere else. This is a single table.

export const FIELDS = [
  { key: 'shot_id',       label: 'Shot ID',       type: 'text', group: 'meta' },
  { key: 'timestamp',     label: 'Timestamp',     type: 'datetime', group: 'meta' },
  { key: 'dose_g',        label: 'Dose in',       unit: 'g',   type: 'number', group: 'input', measured: true, step: 0.1 },
  { key: 'yield_g',       label: 'Yield out',     unit: 'g',   type: 'number', group: 'input', measured: true, step: 0.1 },
  { key: 'ratio',         label: 'Ratio',         unit: ':1',  type: 'number', group: 'derived' },
  { key: 'grind_setting', label: 'Grind setting', unit: '',    type: 'number', group: 'input', step: 0.1 },
  { key: 'grind_label',   label: 'Grind label',   type: 'text', group: 'input' },
  { key: 'temp_c',        label: 'Water temp',    unit: '°C',  type: 'number', group: 'input', step: 0.5 },
  { key: 'pressure_bar',  label: 'Pressure',      unit: 'bar', type: 'number', group: 'input', step: 0.1 },
  { key: 'time_s',        label: 'Shot time',     unit: 's',   type: 'number', group: 'input', measured: true, step: 0.1 },
  { key: 'brix',          label: 'Brix',          unit: '°Bx', type: 'number', group: 'input', measured: true, step: 0.01 },
  { key: 'tds_pct',       label: 'TDS',           unit: '%',   type: 'number', group: 'derived' },
  { key: 'ey_pct',        label: 'Extraction yield', unit: '%', type: 'number', group: 'derived' },
  { key: 'flow_gs',       label: 'Avg flow',      unit: 'g/s', type: 'number', group: 'derived' },
  { key: 'defaulted',     label: 'Assumed fields', type: 'text', group: 'meta' },
  { key: 'notes',         label: 'Notes',         type: 'text', group: 'meta' },
];

export const byKey = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
export const NUMERIC = FIELDS.filter((f) => f.type === 'number').map((f) => f.key);
export const COLUMNS = FIELDS.map((f) => f.key);

/** Fields that make sense as a regression predictor. */
export const PREDICTORS = ['grind_setting', 'temp_c', 'pressure_bar', 'time_s', 'dose_g', 'ratio', 'flow_gs'];
/** Fields that make sense as a regression response. */
export const RESPONSES = ['ey_pct', 'tds_pct', 'time_s', 'flow_gs', 'ratio', 'yield_g'];

export function label(key) {
  const f = byKey[key];
  if (!f) return key;
  return f.unit ? `${f.label} (${f.unit})` : f.label;
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
