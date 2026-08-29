// Moving a shot log between devices, and keeping it safe on one.
//
// This used to sync through Google Drive. It no longer does. The site is a
// static page on github.io, and github.io is on the Public Suffix List, so
// Google will not accept it as an authorised domain — which means the consent
// screen can never leave "Testing", which means every user has to be added to
// a 100-person tester list by hand before they can sign in. An account system
// that admits a hundred people by invitation is not an account system; it is a
// gate that turns the first run of the app into a support request.
//
// So the transport is a file. You export a snapshot, you carry it however you
// like, you import it on the other device. The merge underneath is unchanged
// and is still the interesting part: importing unions the two logs rather than
// overwriting one with the other, which is what makes carrying a file between
// two machines safe rather than a race you can lose.

const CFG_KEY = 'brewkit.backup.v1';
const TOMB_KEY = 'brewkit.tombstones.v1';

/** Every store that travels, and the key each record is identified by. */
export const STORES = [
  { key: 'brewkit.shots.v1', id: 'shot_id', type: 'shot' },
  { key: 'brewkit.bags.v1', id: 'id', type: 'bag' },
  { key: 'brewkit.grinders.v1', id: 'id', type: 'grinder' },
  { key: 'brewkit.machines.v1', id: 'id', type: 'machine' },
  { key: 'brewkit.consumables.v1', id: 'id', type: 'consumable' },
  { key: 'brewkit.adjustments.v1', id: 'id', type: 'adjustment' },
];

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) ?? fallback) : fallback;
  } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const config = () => ({ lastBackup: null, ...readJSON(CFG_KEY, {}) });
export function saveConfig(patch) {
  const next = { ...config(), ...patch };
  writeJSON(CFG_KEY, next);
  return next;
}

/* --------------------------------------------------------------- durability */

/**
 * Ask the browser to stop treating this log as disposable.
 *
 * localStorage survives a restart, but it is evictable: browsers are free to
 * clear it under storage pressure, and Safari discards script-written storage
 * for a site left untouched for seven days. A shot log built over months is
 * exactly the thing that should not vanish because the machine filled up, and
 * with no cloud copy behind it there is nothing to restore from. `persist()`
 * asks for the exempt bucket instead. Chrome grants it silently to a site with
 * any engagement signal; Safari has no such API and simply says no, which is
 * why the answer is reported rather than assumed.
 *
 * @returns {Promise<{supported: boolean, persisted: boolean, usage: number|null,
 *                    quota: number|null}>}
 */
export async function persist() {
  const out = { supported: false, persisted: false, usage: null, quota: null };
  const s = typeof navigator === 'undefined' ? null : navigator.storage;
  if (!s?.persist) return out;
  out.supported = true;
  try {
    out.persisted = (await s.persisted?.()) || (await s.persist());
  } catch { /* a denied or unimplemented request is an answer, not a failure */ }
  try {
    const est = await s.estimate?.();
    if (est) { out.usage = est.usage ?? null; out.quota = est.quota ?? null; }
  } catch { /* estimates are a nicety */ }
  return out;
}

/* --------------------------------------------------------------- tombstones */
// Without these, deleting a shot here and importing yesterday's file would
// simply pull it back: a union can only ever add. A tombstone is the record
// that a deletion happened, which is information a union cannot invent.

export const tombstones = () => readJSON(TOMB_KEY, []);

export function tombstone(type, id) {
  if (!id) return;
  const list = tombstones();
  if (list.some((t) => t.type === type && t.id === id)) return;
  list.push({ type, id, at: new Date().toISOString() });
  writeJSON(TOMB_KEY, list);
}

/* -------------------------------------------------------------------- merge */

const stamp = (r) => {
  const v = r?.updated_at ?? r?.timestamp ?? r?.at ?? r?.added_at ?? null;
  const t = v ? Date.parse(String(v).includes('T') ? v : String(v).replace(' ', 'T')) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * Merge two snapshots of one store.
 *
 * Records are unioned by id, because a shot log is append-mostly and losing a
 * shot because two devices were both used is unacceptable. When both sides hold
 * the same id, the one edited later wins; with no usable timestamp on either,
 * local wins, since that is the device someone is actually looking at.
 *
 * Deletions travel as tombstones in the file and are applied last, so a record
 * deleted on either device stays deleted after the merge.
 */
export function mergeStore(localRows, remoteRows, idKey, type, deaths = []) {
  const dead = new Set(deaths.filter((t) => t.type === type).map((t) => String(t.id)));
  const out = new Map();
  for (const r of remoteRows ?? []) {
    const id = String(r?.[idKey] ?? '');
    if (id) out.set(id, r);
  }
  for (const r of localRows ?? []) {
    const id = String(r?.[idKey] ?? '');
    if (!id) continue;
    const other = out.get(id);
    if (!other) { out.set(id, r); continue; }
    out.set(id, stamp(r) >= stamp(other) ? r : other);
  }
  for (const id of dead) out.delete(id);
  return [...out.values()];
}

/** The whole local dataset, as it would be written to a backup file. */
export function snapshot() {
  const data = {};
  for (const s of STORES) data[s.key] = readJSON(s.key, []);
  return {
    format: 1,
    written_at: new Date().toISOString(),
    tombstones: tombstones(),
    data,
  };
}

/** Merge a snapshot into local storage. Returns what changed. */
export function apply(remote) {
  if (!remote || remote.format !== 1) {
    return { ok: false, error: 'That backup is not in a format this version understands.' };
  }
  const deaths = [...tombstones(), ...(remote.tombstones ?? [])];
  const summary = {};
  for (const s of STORES) {
    const before = readJSON(s.key, []);
    const merged = mergeStore(before, remote.data?.[s.key] ?? [], s.id, s.type, deaths);
    writeJSON(s.key, merged);
    summary[s.type] = { before: before.length, after: merged.length,
                        added: merged.length - before.length };
  }
  writeJSON(TOMB_KEY, dedupeTombstones(deaths));
  return { ok: true, summary };
}

function dedupeTombstones(list) {
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const k = `${t.type}:${t.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/* --------------------------------------------------------------------- file */

/** Dated, so a folder of these sorts itself and you can tell which is newest. */
export function filename(at = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `brewkit-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}.json`;
}

/** How much is in a snapshot, for a sentence that says so before importing it. */
export function describe(snap) {
  const counts = {};
  for (const s of STORES) counts[s.type] = (snap?.data?.[s.key] ?? []).length;
  return { counts, written_at: snap?.written_at ?? null,
           shots: counts.shot ?? 0, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/**
 * Parse a backup file. Throws with a sentence worth showing rather than a
 * SyntaxError, because the likeliest cause is the wrong file being picked.
 */
export function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); }
  catch { throw new Error('That file is not a Brewkit backup — it is not even JSON.'); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('That file is not a Brewkit backup.');
  }
  if (obj.format !== 1) {
    throw new Error(obj.format
      ? `That backup is format ${obj.format}; this version reads format 1.`
      : 'That file is not a Brewkit backup — it has no format marker.');
  }
  if (!obj.data || typeof obj.data !== 'object') {
    throw new Error('That backup has no data in it.');
  }
  return obj;
}
