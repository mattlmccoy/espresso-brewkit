// Shot storage. localStorage-backed, synchronous, with change notification.
//
// Deliberately not IndexedDB: the whole dataset is a few hundred kilobytes at
// the scale this project will ever reach, and a synchronous store removes an
// entire category of race conditions from the UI code.

import { read, serialize } from './csv.js';
import { tombstone } from './backup.js';
import { deriveShot, DEFAULT_BRIX_FACTOR } from './coffee.js';

const KEY = 'brewkit.shots.v1';
const SETTINGS_KEY = 'brewkit.settings.v1';
const listeners = new Set();

function safeParse(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
// localStorage throws in private mode and when the origin blocks site data.
function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

export const getSettings = () => ({
  brixFactor: DEFAULT_BRIX_FACTOR,
  ...safeParse(safeGet(SETTINGS_KEY), {}),
});

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  safeSet(SETTINGS_KEY, JSON.stringify(next));
  emit();
  return next;
}

export const all = () => safeParse(safeGet(KEY), []);

export function write(records) {
  const ok = safeSet(KEY, JSON.stringify(records));
  emit();
  return ok;
}

function nextId(records) {
  const n = records.reduce((max, r) => {
    const m = /^shot-(\d+)$/.exec(r.shot_id ?? '');
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `shot-${String(n + 1).padStart(3, '0')}`;
}

export function add(shot) {
  const records = all();
  const { brixFactor } = getSettings();
  const derived = deriveShot({
    ...shot,
    shot_id: shot.shot_id || nextId(records),
    timestamp: shot.timestamp || new Date().toISOString().replace('T', ' ').slice(0, 19),
  }, brixFactor);
  records.push(derived);
  write(records);
  return derived;
}

export function update(shotId, patch) {
  const { brixFactor } = getSettings();
  write(all().map((r) => (r.shot_id === shotId ? deriveShot({ ...r, ...patch }, brixFactor) : r)));
}

// A deletion has to be recorded, not just performed: syncing unions two
// devices' rows, and a union can only ever add. Without a tombstone, deleting a
// shot here and syncing would pull it straight back from the phone.
export const remove = (shotId) => { tombstone('shot', shotId); return write(all().filter((r) => r.shot_id !== shotId)); };
export const clear = () => { for (const r of all()) tombstone('shot', r.shot_id); return write([]); };

/** Import CSV text. Returns a summary; does not silently drop conflicts. */
export function importCsv(text, { replace = false } = {}) {
  const { records, legacy } = read(text);
  const { brixFactor } = getSettings();
  const incoming = records.map((r) => deriveShot(r, brixFactor));

  if (replace) {
    write(incoming);
    return { added: incoming.length, skipped: 0, legacy, total: incoming.length };
  }

  const existing = all();
  const seen = new Set(existing.map((r) => r.shot_id));
  let skipped = 0;
  const merged = [...existing];
  for (const r of incoming) {
    if (seen.has(r.shot_id)) { skipped++; continue; }
    seen.add(r.shot_id);
    merged.push(r);
  }
  write(merged);
  return { added: merged.length - existing.length, skipped, legacy, total: merged.length };
}

export const exportCsv = () => serialize(all());

/** Pull a column as numbers, preserving row alignment (nulls kept as NaN). */
export const column = (records, key) =>
  records.map((r) => {
    const v = r[key];
    return typeof v === 'number' ? v : Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : NaN;
  });

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn());

// Keep tools open in two tabs in sync.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === SETTINGS_KEY) emit();
  });
}
