// The settings that had nowhere to live.
//
// Most of this app's configuration was already persisted somewhere — the theme,
// the sound cues, the tap threshold each own a key and a button. What was not
// persisted anywhere was the set of numbers that decide how the session behaves:
// how heavy a thing has to be before it counts as a dose, how long a reading has
// to sit still before it is taken, how long the Bluetooth chooser scans for.
//
// Those were constructor options on `SessionMachine` with sensible defaults and
// no caller ever passing them, which is a particular kind of not-configurable:
// the seam exists, the wire was never run. That mattered because the capture
// rules misfired in a real kitchen and the only remedy on offer was to edit the
// source. The thresholds are guesses; the person holding the scale is the one
// who can correct them.
//
// One key, one shape, one place to reset from. Everything is a number or a
// boolean, and every one of them is documented where it is declared, because a
// settings page that lists `liftFor: 0.25` without saying what it does is a
// list of traps.

const KEY = 'brewkit.prefs.v1';
const listeners = new Set();

/**
 * Every preference this module owns, with the value it has when untouched.
 *
 * These are the current hardcoded defaults, moved rather than changed: turning
 * on the settings page must not silently alter anybody's behaviour.
 */
export const DEFAULTS = Object.freeze({
  // ---- how a reading becomes a measurement ----
  // Anything lighter than this is not a dose, it is a fingertip or a draught.
  minMass: 1,
  // Anything heavier is a portafilter, a jug, or the bag — not a dose.
  maxMass: 45,
  // How still, for how long, before a reading counts as settled.
  settleFor: 0.6,
  // How long a settled reading on target is held before it is taken by itself.
  holdFor: 5,
  // A drop of at least this much means something was lifted off.
  dropG: 3,
  // ...and it has to stay off for this long, so a knock is not a lift.
  liftFor: 0.25,
  // How close to the target still counts as on target: whichever of a fraction
  // of the target and a flat floor in grams is larger.
  nearFrac: 0.12,
  nearMin: 1.5,

  // ---- what a shot aims at before you change it ----
  // Null means "use the method's own default", which is the behaviour anyone
  // who never opens this page already has.
  defaultDose: null,
  defaultRatio: null,

  // ---- finding a scale ----
  // Scan the long list of service UUIDs, which finds scales that advertise
  // nothing useful, at the cost of a longer chooser.
  wideScan: true,
  // One extra service UUID to offer the chooser, for a scale nothing else finds.
  extraUuid: '',

  // ---- refractometry ----
  // Brix to TDS. Governs the extraction yield derived for every stored shot,
  // and was previously readable by the store and writable by nothing.
  brixFactor: 0.85,

  // ---- the character ----
  // On by default, because a coach that has to be found is a coach nobody
  // meets. Off is one click and it stays off — the whole design of the thing
  // rests on it never being in the way, and a dismissal that does not stick is
  // how an assistant becomes an adversary.
  coach: true,
});

/** Which keys are numbers, so a form field cannot store the string "18". */
const NUMERIC = new Set(['minMass', 'maxMass', 'settleFor', 'holdFor', 'dropG', 'liftFor',
  'nearFrac', 'nearMin', 'defaultDose', 'defaultRatio', 'brixFactor']);

/**
 * What each one is for, in the words the settings page shows.
 *
 * Here rather than in the page because the number and its explanation are one
 * thing: a threshold whose meaning lives in another file is a threshold that
 * will eventually be described wrongly.
 */
export const ABOUT = Object.freeze({
  minMass: ['Lightest real dose', 'g',
    'Below this, a reading is a fingertip or a draught rather than coffee.'],
  maxMass: ['Heaviest real dose', 'g',
    'Above this it is a portafilter, a jug or the bag — not a dose.'],
  settleFor: ['Settle for', 's',
    'How long the reading has to stop moving before it counts as settled.'],
  holdFor: ['Hold before capture', 's',
    'How long a settled reading on target is held before the app takes it '
    + 'without being asked.'],
  dropG: ['Counts as a lift', 'g',
    'A fall of at least this much reads as something being taken off the platter.'],
  liftFor: ['Lift has to last', 's',
    'And it has to stay off this long, so a knock is not a lift.'],
  nearFrac: ['On target, as a fraction', '',
    'How close to the target still counts as on target — 0.12 is twelve per cent.'],
  nearMin: ['On target, at least', 'g',
    'The floor under that fraction, so a small target still has a workable window.'],
  defaultDose: ['Default dose', 'g',
    'What a new shot starts at. Empty means the brew method decides.'],
  defaultRatio: ['Default ratio', ':1',
    'What a new shot aims for. Empty means the brew method decides.'],
  coach: ['Pip, the shot coach', '',
    'The bean in the corner. Reads the curve while it pours and the whole shot '
    + 'afterwards, and says nothing at all unless it has something you cannot '
    + 'already see on the screen.'],
  brixFactor: ['Brix to TDS factor', '',
    'The refractometer conversion behind every extraction yield in the log. '
    + 'Changing it changes what past shots are said to have extracted.'],
});

function safeParse(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

/** Everything, with defaults filled in for whatever has never been set. */
export const prefs = () => ({ ...DEFAULTS, ...safeParse(safeGet(KEY), {}) });

/** Only what has actually been changed, which is what a reset has to undo. */
export const changed = () => {
  const stored = safeParse(safeGet(KEY), {});
  return Object.fromEntries(
    Object.entries(stored).filter(([k, v]) => k in DEFAULTS && v !== DEFAULTS[k]));
};

/**
 * Write some of them.
 *
 * A value equal to the default is removed rather than stored, so "has this been
 * changed" stays answerable and a later change to a default reaches anyone who
 * never disagreed with the old one.
 */
export function set(patch) {
  const next = { ...safeParse(safeGet(KEY), {}) };
  for (const [k, raw] of Object.entries(patch)) {
    if (!(k in DEFAULTS)) continue;
    let v = raw;
    if (NUMERIC.has(k)) {
      v = raw === '' || raw === null || raw === undefined ? null : Number(raw);
      if (v !== null && !Number.isFinite(v)) continue;
    }
    if (v === DEFAULTS[k]) delete next[k];
    else next[k] = v;
  }
  safeSet(KEY, JSON.stringify(next));
  emit();
  return prefs();
}

/** Put some, or all, back to the default. */
export function reset(keys = null) {
  if (!keys) { try { localStorage.removeItem(KEY); } catch { /* ignore */ } emit(); return prefs(); }
  const next = { ...safeParse(safeGet(KEY), {}) };
  for (const k of keys) delete next[k];
  safeSet(KEY, JSON.stringify(next));
  emit();
  return prefs();
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(prefs()); }

/**
 * The subset `SessionMachine` takes, named the way its constructor names them.
 *
 * A separate function so the page that builds a session does not have to know
 * which of these preferences are its business — and so adding one here is the
 * only edit needed to make it reach the session.
 */
export function sessionOptions() {
  const p = prefs();
  return {
    minMass: p.minMass, maxMass: p.maxMass, dropG: p.dropG, liftFor: p.liftFor,
    settleFor: p.settleFor, holdFor: p.holdFor,
    nearFrac: p.nearFrac, nearMin: p.nearMin,
  };
}
