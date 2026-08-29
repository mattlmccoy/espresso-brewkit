// What is running out.
//
// A bag of coffee is the obvious one, and shots alone do not account for it:
// beans get spilled, purged through the grinder to clear the last coffee, used
// for a pour-over, or thrown away when a bag goes stale. A log that only
// subtracts logged doses will always say you have more left than you do, and
// the error only grows.
//
// So the bag's balance is a ledger, not a subtraction. Shots deduct
// automatically; anything else you write down. The same machinery covers the
// other things that deplete on an espresso setup — burrs by kilos ground, a
// water filter by shots pulled, a descale by days elapsed — because they differ
// only in what they count.

const ADJ_KEY = 'brewkit.adjustments.v1';
const CONS_KEY = 'brewkit.consumables.v1';

import { tombstone } from './backup.js';

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

const F = (v) => (typeof v === 'number' ? v
  : v === '' || v === null || v === undefined ? NaN : Number(v));

/** Why coffee leaves a bag other than by being pulled as a shot. */
export const REASONS = [
  { id: 'purge', label: 'Grinder purge', hint: 'Clearing the last coffee out of the burrs.' },
  { id: 'spill', label: 'Spilled', hint: 'It happens.' },
  { id: 'other-brew', label: 'Other brew method', hint: 'Filter, moka, cupping — anything not logged as a shot.' },
  { id: 'gift', label: 'Gave some away', hint: '' },
  { id: 'discard', label: 'Threw away', hint: 'Stale, or a bag you gave up on.' },
  { id: 'correction', label: 'Correction', hint: 'Reconciling against what the bag actually weighs.' },
];

/* -------------------------------------------------------------- adjustments */

export const adjustments = () => readJSON(ADJ_KEY, []);

/**
 * @param amount  grams removed. Positive removes; negative puts some back,
 *                which is what a correction upward looks like.
 */
export function addAdjustment({ target_type = 'bag', target_id, amount, reason = 'other-brew', note = '' }) {
  const list = adjustments();
  const rec = {
    id: nextId(list, 'adj'),
    target_type, target_id,
    amount: +Number(amount).toFixed(2),
    reason, note,
    at: new Date().toISOString(),
  };
  list.push(rec);
  writeJSON(ADJ_KEY, list);
  emit();
  return rec;
}

export function removeAdjustment(id) {
  tombstone('adjustment', id);
  writeJSON(ADJ_KEY, adjustments().filter((a) => a.id !== id));
  emit();
}

export const adjustmentsFor = (targetId) =>
  adjustments().filter((a) => a.target_id === targetId);

const adjustedTotal = (targetId) =>
  adjustmentsFor(targetId).reduce((t, a) => t + (F(a.amount) || 0), 0);

/* ---------------------------------------------------------------- bag state */

/**
 * Everything worth showing about a bag's balance.
 *
 * `shotsLeft` is deliberately an estimate from your own recent doses rather than
 * from a nominal 18 g: if you pull triples the nominal figure is wrong by a
 * third, and a wrong number here is worse than no number.
 */
export function bagStatus(bag, shots) {
  const capacity = F(bag?.weight_g);
  const mine = shots.filter((s) => s.bag_id === bag?.id);
  const byShots = mine.reduce((t, s) => t + (F(s.dose_g) || 0), 0);
  const manual = adjustedTotal(bag?.id);
  const used = +(byShots + manual).toFixed(2);

  const doses = mine.map((s) => F(s.dose_g)).filter((v) => v > 0);
  const typical = doses.length
    ? doses.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, doses.length) : NaN;

  if (!Number.isFinite(capacity) || capacity <= 0) {
    return { known: false, used, byShots, manual, shots: mine.length, typical };
  }
  // Exact, and allowed to go negative: over-drawing a bag is real information —
  // usually that the bag weight was wrong — and clamping here would leave the
  // log quietly disagreeing with the tin. `left` and `over` are what displays
  // print, because "−3912.8 g left" is not a sentence.
  const remaining = +(capacity - used).toFixed(2);
  const over = remaining < 0 ? +(-remaining).toFixed(2) : 0;
  const shotsLeft = Number.isFinite(typical) && typical > 0
    ? Math.floor(Math.max(0, remaining) / typical) : null;
  return {
    known: true, capacity, used, byShots, manual, remaining, over,
    left: Math.max(0, remaining),
    shots: mine.length, typical, shotsLeft,
    pct: Math.max(0, Math.min(1, remaining / capacity)),
    // "Low" is measured in shots rather than grams, because 40 g left means
    // something different on a 15 g dose than on a 22 g one.
    low: shotsLeft !== null ? shotsLeft <= 3 : remaining < 40,
    empty: remaining <= 0.05,
  };
}

/* -------------------------------------------------------------- consumables */

/** Things other than coffee that run out. They differ only in what they count. */
export const CONSUMABLE_KINDS = [
  { id: 'shots', label: 'Shots pulled', unit: 'shots',
    hint: 'Water filters and backflush intervals are usually rated this way.' },
  { id: 'grams', label: 'Coffee ground', unit: 'g',
    hint: 'Burr life is quoted in kilograms through the grinder.' },
  { id: 'days', label: 'Days elapsed', unit: 'd',
    hint: 'Descaling intervals, and anything on a calendar.' },
];

export const consumables = () => readJSON(CONS_KEY, []);

export function saveConsumable(patch) {
  const list = consumables();
  const i = list.findIndex((c) => c.id === patch.id);
  const rec = {
    name: '', kind: 'shots', capacity: 100, notes: '',
    installed_at: new Date().toISOString().slice(0, 10),
    ...(i >= 0 ? list[i] : {}),
    ...patch,
    updated_at: new Date().toISOString(),
    id: patch.id || list[i]?.id || nextId(list, 'cons'),
  };
  if (i >= 0) list[i] = rec; else list.push(rec);
  writeJSON(CONS_KEY, list);
  emit();
  return rec;
}

export function removeConsumable(id) {
  tombstone('consumable', id);
  writeJSON(CONS_KEY, consumables().filter((c) => c.id !== id));
  emit();
}

/** Reset the counter — a new filter, fresh burrs, a descale just done. */
export function resetConsumable(id) {
  return saveConsumable({ id, installed_at: new Date().toISOString().slice(0, 10) });
}

const shotTime = (s) => {
  const raw = String(s.timestamp ?? '').trim();
  const t = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
};

export function consumableStatus(c, shots, now = new Date()) {
  const kind = CONSUMABLE_KINDS.find((k) => k.id === c.kind) ?? CONSUMABLE_KINDS[0];
  const since = Date.parse(`${String(c.installed_at ?? '').slice(0, 10)}T00:00:00Z`);
  const after = shots.filter((s) => {
    const t = shotTime(s);
    return !Number.isFinite(since) || t === null ? true : t >= since;
  });

  let used;
  if (c.kind === 'shots') used = after.length;
  else if (c.kind === 'grams') used = +after.reduce((t, s) => t + (F(s.dose_g) || 0), 0).toFixed(1);
  else used = Number.isFinite(since) ? Math.max(0, Math.round((now.getTime() - since) / 86400000)) : 0;

  used = +(used + adjustedTotal(c.id)).toFixed(2);
  const capacity = F(c.capacity);
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return { known: false, used, unit: kind.unit, kindLabel: kind.label };
  }
  const remaining = +(capacity - used).toFixed(2);
  return {
    known: true, capacity, used, remaining, unit: kind.unit, kindLabel: kind.label,
    pct: Math.max(0, Math.min(1, remaining / capacity)),
    low: remaining <= capacity * 0.1 || remaining <= 0,
    empty: remaining <= 0,
  };
}

/**
 * One list of everything with a remaining figure, worst first — what the
 * dashboard shows, so the thing about to run out is the thing you see.
 */
export function supplyBoard(bags, shots, now = new Date()) {
  const rows = [];
  for (const b of bags) {
    if (b.archived) continue;
    const st = bagStatus(b, shots);
    if (!st.known) continue;
    rows.push({
      id: b.id, kind: 'bag', name: b.bean_name || b.id,
      remaining: st.remaining, unit: 'g', pct: st.pct, low: st.low, empty: st.empty,
      // `left`, never `remaining`: an over-drawn bag has a negative one, and
      // "−3912.8 g left" is not something to put on a dashboard.
      detail: st.empty ? 'used up'
        : st.shotsLeft === null ? `${st.left} g left`
          : `${st.left} g · about ${st.shotsLeft} more shot${st.shotsLeft === 1 ? '' : 's'}`,
    });
  }
  for (const c of consumables()) {
    const st = consumableStatus(c, shots, now);
    if (!st.known) continue;
    rows.push({
      id: c.id, kind: 'consumable', name: c.name || c.id,
      remaining: st.remaining, unit: st.unit, pct: st.pct, low: st.low, empty: st.empty,
      detail: st.empty ? `used up, of ${st.capacity} ${st.unit}`
        : `${Math.max(0, st.remaining)} ${st.unit} left of ${st.capacity}`,
    });
  }
  return rows.sort((a, b) => a.pct - b.pct);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if ([ADJ_KEY, CONS_KEY].includes(e.key)) emit();
  });
}
