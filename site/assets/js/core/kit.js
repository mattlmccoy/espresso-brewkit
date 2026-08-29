// Bags and grinders as first-class objects.
//
// A shot stores `bag_id` and `grinder_id`, not a copy of the bag. That matters
// because a bag is a thing in the world that ages: its roast date is fixed, but
// how stale it was *when you pulled a given shot* is not. Keeping the bag
// separate means days-off-roast is computed once, at the moment of the shot, and
// frozen into the row — so re-reading the log next month does not silently
// rewrite history.
//
// The denormalised copy (roaster, bean name, roast date) is written onto the row
// anyway, because the exported CSV has to stand alone. The id is the join key;
// the copy is the archive.

const BAG_KEY = 'brewkit.bags.v1';
const GRINDER_KEY = 'brewkit.grinders.v1';
const MACHINE_KEY = 'brewkit.machines.v1';
const SESSION_KEY = 'brewkit.session.v1';

import { tombstone } from './backup.js';
import { beanAge, fromFrozen } from './beans.js';

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) ?? fallback) : fallback;
  } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

function nextId(list, prefix) {
  const n = list.reduce((max, r) => {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(r.id ?? '');
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `${prefix}-${String(n + 1).padStart(3, '0')}`;
}

/* --------------------------------------------------------------------- bags */

/** @typedef {{id:string, roaster:string, bean_name:string, roast_date:string,
 *             process:string, weight_g:number|null, notes:string, archived:boolean}} Bag */

export const bags = () => readJSON(BAG_KEY, []);
export const activeBags = () => bags().filter((b) => !b.archived);
export const bag = (id) => bags().find((b) => b.id === id) ?? null;

export function saveBag(patch) {
  const list = bags();
  const i = list.findIndex((b) => b.id === patch.id);
  const rec = {
    roaster: '', bean_name: '', roast_date: '', process: '', roast_level: 'Medium',
    frozen_at: '', thawed_at: '', vacuum_sealed: false,
    weight_g: null, notes: '', archived: false,
    added_at: new Date().toISOString().slice(0, 10),
    ...(i >= 0 ? list[i] : {}),
    ...patch,
    updated_at: new Date().toISOString(),
    // Last, not first: a form for a new bag sends `id: null`, and spreading
    // that over a generated id leaves every record keyed on null.
    id: patch.id || list[i]?.id || nextId(list, 'bag'),
  };
  if (i >= 0) list[i] = rec; else list.push(rec);
  writeJSON(BAG_KEY, list);
  emit();
  return rec;
}

/**
 * Split a purchase into single-session portions, and freeze them.
 *
 * This is the shape the freezer is actually useful in. A 900 g bag frozen whole
 * gets opened once a week for two months, and every opening condenses water
 * onto beans that are well below the dew point — so the thing that was supposed
 * to preserve the coffee is instead wetting it, repeatedly. Portioned on day
 * one, the same purchase is six coffees each paused at day one, each opened
 * exactly once.
 *
 * Portions are ordinary bags, not a new kind of record. They have their own
 * weight, their own thaw date and their own shots, because that is what they
 * are: from the grinder's point of view the portion *is* the bag. What they
 * share with the parent — roaster, roast date, roast level — is copied, since
 * that is fixed at roast and cannot drift between them.
 */
export function splitBag(id, { count, grams, frozen_at = '', vacuum_sealed = true } = {}) {
  const parent = bag(id);
  const n = Math.floor(Number(count));
  const g = Number(grams);
  if (!parent) throw new Error('No such bag.');
  if (!Number.isFinite(n) || n < 2) throw new Error('Split into at least two portions.');
  if (!Number.isFinite(g) || g <= 0) throw new Error('Give each portion a weight.');
  // Splitting off more than the bag holds is a typo, not an intention, and it
  // would leave the parent with a negative weight that every later reading of
  // "grams left" would inherit.
  const held = Number(parent.weight_g);
  if (Number.isFinite(held) && n * g > held) {
    throw new Error(`${n} × ${g} g is ${(n * g).toFixed(0)} g, and this bag holds `
      + `${held.toFixed(0)} g.`);
  }

  const froze = frozen_at || new Date().toISOString().slice(0, 10);
  const portions = [];
  for (let i = 1; i <= n; i++) {
    portions.push(saveBag({
      id: null,
      roaster: parent.roaster, bean_name: parent.bean_name, roast_date: parent.roast_date,
      process: parent.process, roast_level: parent.roast_level,
      weight_g: +g.toFixed(1), notes: parent.notes,
      frozen_at: froze, thawed_at: '', vacuum_sealed: !!vacuum_sealed,
      parent_id: parent.id, portion_index: i, portion_of: n,
    }));
  }

  // What the portions took has left the parent. If that is all of it, the
  // parent is a purchase record rather than a bag you can dose from, so it
  // stops cluttering the active list.
  const left = Number.isFinite(held) ? +(held - n * g).toFixed(1) : null;
  const rest = saveBag({
    id: parent.id,
    weight_g: left === null ? null : Math.max(0, left),
    split_into: n,
    archived: left !== null && left < 15 ? true : parent.archived,
  });
  emit();
  return { portions, parent: rest, leftover: left };
}

/** The portions a purchase was split into, in order. */
export const portionsOf = (id) => bags()
  .filter((b) => b.parent_id === id)
  .sort((a, b) => (a.portion_index ?? 0) - (b.portion_index ?? 0));

export function removeBag(id) {
  tombstone('bag', id);
  writeJSON(BAG_KEY, bags().filter((b) => b.id !== id));
  emit();
}

/* ----------------------------------------------------------------- grinders */

/** Grinder dials are not standardised: some count up to coarser, some down, and
 *  the step is whatever the manufacturer engraved. Recording the range and step
 *  is what lets the advisor round a recommendation to a setting you can actually
 *  dial in, instead of telling you to grind at 4.37. */
export const grinders = () => readJSON(GRINDER_KEY, []);
export const grinder = (id) => grinders().find((g) => g.id === id) ?? null;

export function saveGrinder(patch) {
  const list = grinders();
  const i = list.findIndex((g) => g.id === patch.id);
  const rec = {
    name: '', burr: '', min: 0, max: 40, step: 1, notes: '',
    ...(i >= 0 ? list[i] : {}),
    ...patch,
    updated_at: new Date().toISOString(),
    id: patch.id || list[i]?.id || nextId(list, 'grinder'),
  };
  if (i >= 0) list[i] = rec; else list.push(rec);
  writeJSON(GRINDER_KEY, list);
  emit();
  return rec;
}

export function removeGrinder(id) {
  tombstone('grinder', id);
  writeJSON(GRINDER_KEY, grinders().filter((g) => g.id !== id));
  emit();
}

/** Snap a continuous recommendation to a dial position the grinder actually has. */
export function snapSetting(g, value) {
  if (!Number.isFinite(value)) return NaN;
  const step = Number(g?.step) > 0 ? Number(g.step) : 1;
  const lo = Number.isFinite(Number(g?.min)) ? Number(g.min) : -Infinity;
  const hi = Number.isFinite(Number(g?.max)) ? Number(g.max) : Infinity;
  const snapped = Math.round(value / step) * step;
  return Math.min(hi, Math.max(lo, +snapped.toFixed(4)));
}

/* ----------------------------------------------------------------- machines */

/**
 * How the machine makes pressure. It is not decoration: a lever's pressure is
 * whatever the spring or your arm is doing at that instant, so a single
 * `pressure_bar` on the shot means something quite different from a pump
 * machine's gauge reading, and the advisor should not pool them blindly.
 */
export const MACHINE_KINDS = [
  'Single boiler', 'Heat exchanger', 'Dual boiler',
  'Spring lever', 'Manual lever', 'Pressure profiling', 'Other',
];

export const machines = () => readJSON(MACHINE_KEY, []);
export const machine = (id) => machines().find((m) => m.id === id) ?? null;

export function saveMachine(patch) {
  const list = machines();
  const i = list.findIndex((m) => m.id === patch.id);
  const rec = {
    name: '', kind: 'Dual boiler', basket: '',
    default_temp_c: null, default_pressure_bar: null, default_preinfusion_s: null,
    notes: '',
    ...(i >= 0 ? list[i] : {}),
    ...patch,
    updated_at: new Date().toISOString(),
    id: patch.id || list[i]?.id || nextId(list, 'machine'),
  };
  if (i >= 0) list[i] = rec; else list.push(rec);
  writeJSON(MACHINE_KEY, list);
  emit();
  return rec;
}

export function removeMachine(id) {
  tombstone('machine', id);
  writeJSON(MACHINE_KEY, machines().filter((m) => m.id !== id));
  emit();
}

/* ------------------------------------------------------------------ session */
// What you were last using. Reopening the page mid-session and being asked to
// re-pick the bag, the grinder and the basket is the fastest way to make a tool
// not get used.

export const session = () => ({
  bag_id: '', grinder_id: '', grind_setting: null, basket: '', machine_id: '',
  target_dose_g: 18, target_ratio: 2, temp_c: null, pressure_bar: null,
  ...readJSON(SESSION_KEY, {}),
});

export function saveSession(patch) {
  const next = { ...session(), ...patch };
  writeJSON(SESSION_KEY, next);
  emit();
  return next;
}

/* ------------------------------------------------------------------ derived */

/** Whole days between a roast date and a shot. Null rather than 0 when unknown:
 *  "roasted today" and "I did not record the roast date" are different facts. */
export function daysOffRoast(roastDate, at = new Date()) {
  if (!roastDate) return null;
  const r = Date.parse(`${String(roastDate).slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(r)) return null;
  const t = at instanceof Date ? at.getTime() : Date.parse(at);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((t - r) / 86400000));
}

/**
 * Copy the bag and grinder onto a shot at the moment it is recorded.
 * Called by the session flow and the logger, not by the store: the store should
 * not have to know that bags exist.
 */
export function attachKit(shot, at = new Date(), { shots = [] } = {}) {
  const out = { ...shot };
  const b = out.bag_id ? bag(out.bag_id) : null;
  if (b) {
    out.roaster = out.roaster || b.roaster || '';
    out.bean_name = out.bean_name || b.bean_name || '';
    out.roast_date = out.roast_date || b.roast_date || '';
    out.process = out.process || b.process || '';
    out.roast_level = out.roast_level || b.roast_level || '';
    // The age that matters is the one the coffee actually accrued. A bag frozen
    // on day 5 and opened in June is a five-day-old coffee that was paused, not
    // a five-month-old one, and modelling it as five months would be simply
    // wrong. The calendar age stays recoverable from days_frozen.
    const age = beanAge(b, at);
    if (age.known && !Number.isFinite(out.days_off_roast)) {
      out.days_off_roast = age.effective;
      out.days_frozen = age.frozenDays;
    }
    // Only the first dose off a portion is actually frozen; the rest of it
    // spends the session on the counter. Cold beans grind finer, so that one
    // shot is not a reading of the bag's resistance and must not be filed as
    // one — see beans.fromFrozen and advisor.resistanceRows.
    if (out.from_frozen === undefined) out.from_frozen = fromFrozen(b, shots, at);
  }
  // Names are copied alongside the ids for the same reason the bag's are: the
  // exported CSV has to mean something on its own, months later, on a machine
  // that has no localStorage.
  const g = out.grinder_id ? grinder(out.grinder_id) : null;
  if (g) out.grinder_name = out.grinder_name || g.name || '';
  const m = out.machine_id ? machine(out.machine_id) : null;
  if (m) {
    out.machine_name = out.machine_name || m.name || '';
    // Machine settings are properties of the machine until a shot overrides
    // them, which is most shots on most machines.
    if (!Number.isFinite(out.temp_c) && Number.isFinite(Number(m.default_temp_c))) {
      out.temp_c = Number(m.default_temp_c);
    }
    if (!Number.isFinite(out.pressure_bar) && Number.isFinite(Number(m.default_pressure_bar))) {
      out.pressure_bar = Number(m.default_pressure_bar);
    }
    if (!Number.isFinite(out.preinfusion_s) && Number.isFinite(Number(m.default_preinfusion_s))) {
      out.preinfusion_s = Number(m.default_preinfusion_s);
    }
    if (!out.basket && m.basket) out.basket = m.basket;
  }
  if (Number.isFinite(out.dose_g) && Number.isFinite(out.grounds_out_g)) {
    out.retention_g = +(out.dose_g - out.grounds_out_g).toFixed(2);
  }
  return out;
}

/** Grams of this bag already accounted for by logged shots. */
export function bagUsage(shots, bagId) {
  const mine = shots.filter((s) => s.bag_id === bagId);
  const used = mine.reduce((t, s) => t + (Number(s.dose_g) || 0), 0);
  return { shots: mine.length, used_g: +used.toFixed(1) };
}

/** Remaining grams, or null when the bag's weight was never entered. */
export function bagRemaining(shots, b) {
  const w = Number(b?.weight_g);
  if (!Number.isFinite(w) || w <= 0) return null;
  return +(w - bagUsage(shots, b.id).used_g).toFixed(1);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if ([BAG_KEY, GRINDER_KEY, MACHINE_KEY, SESSION_KEY].includes(e.key)) emit();
  });
}
