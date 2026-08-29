// What the log says about the habit, rather than about any one shot.
//
// A shot log is a diary whether or not it was kept as one. Once there are a few
// hundred rows the interesting questions stop being "how was that shot" and
// become "when do I actually drink coffee, and how much" — which the same rows
// answer for free, and which nothing else in brewkit was looking at.
//
// Everything here is pure and works off local dates. That matters: a shot at
// 07:30 belongs to the morning it was pulled, and UTC would file half a year of
// them under the previous day for anyone west of Greenwich.

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  + `-${String(d.getDate()).padStart(2, '0')}`;

/** A shot's local timestamp, or null when the row predates having one. */
export function shotDate(s) {
  const raw = s?.timestamp ?? s?.at ?? null;
  if (!raw) return null;
  // Stored as 'YYYY-MM-DD HH:MM:SS' with no zone, which Date parses as local in
  // every browser that matters — but only with the 'T'. Without it, Safari
  // returns Invalid Date and Chrome guesses.
  const d = new Date(String(raw).trim().replace(' ', 'T'));
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Shots and grams per local day.
 * @returns {Map<string, {shots:number, grams:number, rated:number, ratingSum:number}>}
 */
export function byDay(shots = []) {
  const out = new Map();
  for (const s of shots) {
    const d = shotDate(s);
    if (!d) continue;
    const k = dayKey(d);
    const row = out.get(k) ?? { shots: 0, grams: 0, rated: 0, ratingSum: 0 };
    row.shots += 1;
    const dose = Number(s.dose_g);
    if (Number.isFinite(dose) && dose > 0) row.grams += dose;
    const rating = Number(s.rating);
    if (Number.isFinite(rating) && rating > 0) { row.rated += 1; row.ratingSum += rating; }
    out.set(k, row);
  }
  return out;
}

/**
 * A calendar grid, newest week last, in the shape a heatmap wants: columns are
 * weeks, rows are weekdays starting Monday.
 */
export function calendar(shots = [], { weeks = 26, today = new Date() } = {}) {
  const day = byDay(shots);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // Wind back to the Monday of this week, then back `weeks - 1` more weeks.
  const dow = (end.getDay() + 6) % 7;               // 0 = Monday
  const start = new Date(end);
  start.setDate(end.getDate() - dow - (weeks - 1) * 7);

  const cols = [];
  let peak = 0;
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start);
      cur.setDate(start.getDate() + w * 7 + d);
      const k = dayKey(cur);
      const row = day.get(k) ?? null;
      const n = row?.shots ?? 0;
      if (n > peak) peak = n;
      col.push({
        key: k, date: cur, shots: n, grams: row?.grams ?? 0,
        rating: row?.rated ? row.ratingSum / row.rated : null,
        future: cur > end,
      });
    }
    cols.push(col);
  }
  // Where each month starts, as a column index, so a label row can be drawn
  // over the grid. Without them a heatmap is a texture rather than a calendar.
  const months = [];
  for (let w = 0; w < cols.length; w++) {
    const first = cols[w][0].date;
    const prev = w ? cols[w - 1][0].date : null;
    if (!prev || first.getMonth() !== prev.getMonth()) {
      months.push({ col: w, month: first.getMonth(), year: first.getFullYear() });
    }
  }
  return { cols, peak, start, end, months };
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Consecutive days with at least one shot, ending today or yesterday. */
export function streak(shots = [], today = new Date()) {
  const day = byDay(shots);
  const cur = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // A streak that ends yesterday is still a streak at 9 a.m.; one that ended
  // the day before is over.
  if (!day.has(dayKey(cur))) cur.setDate(cur.getDate() - 1);
  let n = 0;
  while (day.has(dayKey(cur))) { n += 1; cur.setDate(cur.getDate() - 1); }
  return n;
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
                         'Saturday', 'Sunday'];

/** Which weekday and which hour you actually pull coffee on. */
export function rhythm(shots = []) {
  const days = new Array(7).fill(0);
  const hours = new Array(24).fill(0);
  let dated = 0;
  for (const s of shots) {
    const d = shotDate(s);
    if (!d) continue;
    dated += 1;
    days[(d.getDay() + 6) % 7] += 1;
    hours[d.getHours()] += 1;
  }
  const pick = (arr) => arr.reduce((best, v, i) => (v > arr[best] ? i : best), 0);
  return {
    dated,
    days,
    hours,
    busiestDay: dated ? WEEKDAYS[pick(days)] : null,
    busiestHour: dated ? pick(hours) : null,
  };
}

/** The headline numbers, over a window ending today. */
export function summary(shots = [], { days = 30, today = new Date() } = {}) {
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  from.setDate(from.getDate() - (days - 1));
  let n = 0, grams = 0, rated = 0, ratingSum = 0;
  const seen = new Set();
  for (const s of shots) {
    const d = shotDate(s);
    if (!d || d < from) continue;
    n += 1;
    seen.add(dayKey(d));
    const dose = Number(s.dose_g);
    if (Number.isFinite(dose) && dose > 0) grams += dose;
    const r = Number(s.rating);
    if (Number.isFinite(r) && r > 0) { rated += 1; ratingSum += r; }
  }
  return {
    days, shots: n, grams: +grams.toFixed(1), activeDays: seen.size,
    perActiveDay: seen.size ? +(n / seen.size).toFixed(2) : 0,
    rating: rated ? +(ratingSum / rated).toFixed(2) : null,
  };
}
