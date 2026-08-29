// The old dataset, and why it does not belong in your log.
//
// Fifteen shots from the Python era, pulled on different equipment: a different
// machine, a grinder whose dial ran 200–600 rather than 0–50, and no flow
// curves at all, because nothing was streaming a scale yet. What they do have
// is refractometry — Brix on every row — which almost no shot pulled since
// does, because a refractometer is a bench instrument and this app is used at
// a machine.
//
// That combination is exactly wrong for the daily tools and exactly right for
// the Lab. Loaded into the shot log they poison the things that assume one
// setup: the grind model fits a dial that does not exist on your grinder, the
// habit calendar shows mornings from 2025, the supply page counts beans against
// bags that were never entered. Kept as their own dataset they are what makes
// regression, outlier detection and uncertainty propagation demonstrable at
// all.
//
// So they are never imported. The Lab fetches them, holds them in memory, and
// says where they came from.

import { read } from './csv.js';

const URL = './data/shots.csv';
let cached = null;

/** Everything about a row that says it is not yours. */
export const isReferenceRow = (r) => String(r?.shot_id ?? '').startsWith('legacy-');

/**
 * The reference set, fetched once per page.
 *
 * Returns an empty list rather than throwing when it is missing: the file is
 * staged into the site at build time, and a Lab with no reference data is a Lab
 * with fewer rows, not a broken page.
 */
export async function load(fetchImpl = null) {
  if (cached) return cached;
  const f = fetchImpl ?? ((...a) => fetch(...a));
  try {
    const res = await f(URL);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const { records } = read(await res.text());
    cached = records;
  } catch {
    cached = [];
  }
  return cached;
}

/** For tests, and for anything that wants a second fetch. */
export function forget() { cached = null; }

export const DESCRIPTION = 'Fifteen shots from this project’s Python era, on a different '
  + 'machine and a grinder dialled 200–600. No flow curves, but Brix on every row, which is '
  + 'why the analysis tools can demonstrate anything at all before you have pulled fifty shots '
  + 'with a refractometer to hand.';

/**
 * Which rows a Lab tool should work on.
 *
 * `mine` is the honest default everywhere it is usable. The reference set is
 * offered because for most people it is the only data with Brix in it, and an
 * uncertainty tool with nothing to propagate teaches nobody anything.
 */
export function pick(source, mine, reference) {
  if (source === 'reference') return reference;
  if (source === 'both') return [...mine, ...reference];
  return mine;
}

/** How many of your own rows are actually the reference set, wrongly imported. */
export function strays(shots) {
  return (shots ?? []).filter(isReferenceRow);
}
