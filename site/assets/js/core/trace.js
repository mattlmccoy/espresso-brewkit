// Every reading, and what the app decided about it.
//
// The capture rules in session.js are a pile of thresholds — how heavy is too
// heavy to be a dose, how still is still, how long a plateau has to last — and
// every one of them was picked by reasoning about what a scale probably does
// rather than by looking at what this scale actually does. That is how the
// polarity bug survived: the logic was defensible in prose and inverted in
// practice, and nothing in the repo could have told me.
//
// So this records the raw stream alongside the state machine's reading of it.
// One row per sample, one column per thing a rule looks at, plus a marked event
// wherever the app decided something. Exported as a CSV, it is enough to replay
// a session offline and ask why a rule fired — which is the only honest way to
// set thresholds that are currently guesses.
//
// It is a ring buffer and it is always on. At 10 Hz a row is about 90 bytes, so
// an hour is roughly 3 MB and the cap below holds a bit over an hour. Nothing
// leaves the machine unless the file is exported by hand.

export const MAX_ROWS = 40000;

/** The columns, in order. Named here so the header and the rows cannot drift. */
export const COLUMNS = [
  't_s',            // seconds since the recorder started
  'raw_g',          // straight off the scale, before anything
  'net_g',          // raw minus whatever the session thinks the tare is
  'filtered_g',     // the Kalman weight
  'flow_gs',        // and its flow
  'settled',        // the scale's own stability flag, where it has one
  'step',           // session step
  'phase',          // vessel / fill / ready
  'method',
  'target_g',       // what this step is aiming at
  'candidate_g',    // what the app would capture right now
  'hold_left_s',    // seconds until it captures on its own, or blank
  'off_target_g',   // how far out a held reading is, or blank
  'disturbed',      // a hand on the platter
  'brew_state',
  'elapsed_s',      // shot clock
  'event',          // what the app decided on this sample, if anything
];

export class Trace {
  constructor({ max = MAX_ROWS, now = () => Date.now() } = {}) {
    this.max = max;
    this.now = now;
    this.rows = [];
    this.t0 = null;
    this.started = null;
    this.meta = {};
  }

  /** Thresholds and kit in force, so a row can be read against the rules. */
  describe(meta) { this.meta = { ...this.meta, ...meta }; }

  get length() { return this.rows.length; }

  /**
   * One sample.
   *
   * `event` is the only field that is not a measurement: it carries whatever the
   * step decided, so the CSV shows the decision on the row that caused it rather
   * than leaving it to be inferred from the numbers around it.
   */
  push(row) {
    const ms = this.now();
    if (this.t0 === null) { this.t0 = ms; this.started = new Date(ms).toISOString(); }
    this.rows.push({ ...row, t_s: +((ms - this.t0) / 1000).toFixed(2) });
    // Dropping the oldest keeps the most recent hour, which is the session you
    // are actually trying to explain.
    if (this.rows.length > this.max) this.rows.splice(0, this.rows.length - this.max);
  }

  /** Mark the newest row, for a decision that happened between samples. */
  mark(event) {
    if (!this.rows.length || !event) return;
    const last = this.rows[this.rows.length - 1];
    last.event = last.event ? `${last.event}; ${event}` : event;
  }

  clear() { this.rows = []; this.t0 = null; this.started = null; }

  /**
   * The whole thing as a CSV, with the rules that were in force on top.
   *
   * The commented header is the part that makes the file readable a month
   * later: a column of weights explains nothing without the thresholds it was
   * being judged against, and those are exactly what is under discussion.
   */
  toCsv() {
    const head = Object.entries(this.meta)
      .map(([k, v]) => `# ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    const cell = (v) => {
      if (v === null || v === undefined || v === '') return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [
      `# brewkit workflow trace`,
      `# started: ${this.started ?? 'never'}`,
      `# samples: ${this.rows.length}`,
      ...head,
      COLUMNS.join(','),
      ...this.rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(',')),
    ].join('\n');
  }

  filename() {
    const stamp = (this.started ?? new Date().toISOString()).slice(0, 19).replace(/[:T]/g, '-');
    return `brewkit-trace-${stamp}.csv`;
  }
}

/**
 * Read a trace back, for replaying one offline.
 *
 * The point of writing the file is being able to run the capture rules against
 * it later, so the parser is part of the feature rather than something to be
 * improvised when the first file arrives.
 */
export function parseTrace(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const meta = {};
  let head = -1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.startsWith('#')) {
      const m = /^#\s*([^:]+):\s*(.*)$/.exec(ln);
      if (m) meta[m[1].trim()] = m[2].trim();
      continue;
    }
    if (ln.trim()) { head = i; break; }
  }
  if (head < 0) return null;
  const cols = lines[head].split(',');
  const rows = [];
  for (const ln of lines.slice(head + 1)) {
    if (!ln.trim()) continue;
    const cells = splitCsv(ln);
    const row = {};
    cols.forEach((c, i) => {
      const v = cells[i] ?? '';
      row[c] = v === '' ? null : (Number.isNaN(Number(v)) ? v : Number(v));
    });
    rows.push(row);
  }
  return { meta, columns: cols, rows };
}

function splitCsv(line) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * What a trace says about the thresholds, without anyone reading 20,000 rows.
 *
 * These are the questions the capture rules turn on: how long a real dose sits
 * still before it is finished, how far a settled reading drifts while it does,
 * and how big the excursion is when a hand goes near the platter. Every one of
 * them is a constant in session.js that was picked by reasoning rather than
 * measured.
 */
export function summarise(trace) {
  const rows = trace?.rows ?? [];
  const num = (v) => (Number.isFinite(v) ? v : null);
  const plateaus = [];
  let run = null;
  for (const r of rows) {
    const net = num(r.net_g);
    if (net === null) continue;
    if (run && Math.abs(net - run.at) <= 0.3) {
      run.until = r.t_s;
      run.n++;
      run.min = Math.min(run.min, net);
      run.max = Math.max(run.max, net);
    } else {
      if (run && run.until - run.from >= 0.5) plateaus.push(run);
      run = { at: net, from: r.t_s, until: r.t_s, n: 1, min: net, max: net, step: r.step };
    }
  }
  if (run && run.until - run.from >= 0.5) plateaus.push(run);

  const events = rows.filter((r) => r.event).map((r) => ({ t: r.t_s, event: r.event,
    net: r.net_g, step: r.step }));
  const nets = rows.map((r) => num(r.net_g)).filter((v) => v !== null);
  const peaks = rows.filter((r) => r.disturbed === true || r.disturbed === 'true');

  return {
    samples: rows.length,
    seconds: rows.length ? +(rows[rows.length - 1].t_s - rows[0].t_s).toFixed(1) : 0,
    rate: rows.length > 1
      ? +(rows.length / Math.max(0.001, rows[rows.length - 1].t_s - rows[0].t_s)).toFixed(1) : null,
    maxNet: nets.length ? Math.max(...nets) : null,
    // The longest still stretch at each step, which is what `holdFor` is really
    // being set against.
    plateaus: plateaus
      .sort((a, b) => (b.until - b.from) - (a.until - a.from))
      .slice(0, 12)
      .map((p) => ({ step: p.step, at: +p.at.toFixed(2), seconds: +(p.until - p.from).toFixed(2),
                     spread: +(p.max - p.min).toFixed(2) })),
    disturbedSamples: peaks.length,
    events,
  };
}
