// Syncing shots between a computer and a phone, with no server.
//
// The site is a static page on GitHub Pages, so there is nowhere to run a
// backend and nowhere to keep a secret. Google Drive's appDataFolder fits that
// exactly: a hidden per-app folder inside the user's own Drive, invisible in
// their file list, readable only by this application. The data stays in their
// account, nothing is hosted, and the OAuth client id is public by design —
// it is secured by an origin allowlist rather than by secrecy.
//
// TWO HALVES, DELIBERATELY SEPARATED. Merging is pure and is tested hard. The
// network half is a thin wrapper that CI cannot exercise without a real Google
// account, so it is kept as small as it can be and the transport is injectable,
// which is what lets the merge be tested against a fake one.

const CFG_KEY = 'brewkit.sync.v1';
const FILE_NAME = 'brewkit.json';
// drive.appdata is the narrowest Drive scope there is: a hidden folder this app
// creates, and nothing else in the user's Drive. `openid email profile` is added
// only so the page can show who is signed in — an account chooser that then
// tells you nothing about which account you chose is a worse experience than no
// chooser at all. Both appear on the consent screen, which is the point.
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const IDENTITY_SCOPES = 'openid email profile';
export const SCOPE = `${IDENTITY_SCOPES} ${DRIVE_SCOPE}`;

export const SCOPE_EXPLAINED = [
  { scope: 'drive.appdata', label: 'A private folder in your Drive',
    detail: 'Created by this app, invisible in your file list, and unreadable by anything else. '
      + 'It cannot see the rest of your Drive.' },
  { scope: 'profile', label: 'Your name and picture',
    detail: 'Shown on this page so you can tell which account you are syncing to. Never sent '
      + 'anywhere.' },
  { scope: 'email', label: 'Your email address',
    detail: 'Shown alongside your name for the same reason.' },
];

/** Every store that travels, and the key each record is identified by. */
export const STORES = [
  { key: 'brewkit.shots.v1', id: 'shot_id', type: 'shot' },
  { key: 'brewkit.bags.v1', id: 'id', type: 'bag' },
  { key: 'brewkit.grinders.v1', id: 'id', type: 'grinder' },
  { key: 'brewkit.machines.v1', id: 'id', type: 'machine' },
  { key: 'brewkit.consumables.v1', id: 'id', type: 'consumable' },
  { key: 'brewkit.adjustments.v1', id: 'id', type: 'adjustment' },
];

const TOMB_KEY = 'brewkit.tombstones.v1';

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) ?? fallback) : fallback;
  } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const config = () => ({
  clientId: '', lastSync: null, account: null, ...readJSON(CFG_KEY, {}),
});
export function saveConfig(patch) {
  const next = { ...config(), ...patch };
  writeJSON(CFG_KEY, next);
  return next;
}

/* ------------------------------------------------------------- tombstones */
// Without these, deleting a shot on the laptop and syncing would simply pull it
// back from the phone: a union can only ever add. A tombstone is the record
// that a deletion happened, which is information a union cannot invent.

export const tombstones = () => readJSON(TOMB_KEY, []);

export function tombstone(type, id) {
  if (!id) return;
  const list = tombstones();
  if (list.some((t) => t.type === type && t.id === id)) return;
  list.push({ type, id, at: new Date().toISOString() });
  writeJSON(TOMB_KEY, list);
}

/* ------------------------------------------------------------------ merge */

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
 * Deletions travel as tombstones from both sides and are applied last, so a
 * record deleted anywhere stays deleted everywhere.
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

/** The whole local dataset, as it would be written to Drive. */
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

/** Merge a remote snapshot into local storage. Returns what changed. */
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

/* -------------------------------------------------------------- transport */

/**
 * The Drive half. Small on purpose: everything above this line is testable
 * without a network, and everything below needs a real Google account, so the
 * less that lives here the less is taken on trust.
 */
export class DriveClient {
  /**
   * @param gis  the Google Identity Services oauth2 namespace. Injectable so the
   *             sign-in flow can be driven end to end by the suite — the whole
   *             point of keeping this half thin is that it is otherwise
   *             untestable without a real Google account.
   */
  constructor({ clientId, fetchImpl = null, gis = null } = {}) {
    this.clientId = clientId;
    this.token = null;
    this.account = null;
    this.fetch = fetchImpl ?? ((...a) => fetch(...a));
    this._gis = gis;
  }

  async gis() {
    if (this._gis) return this._gis;
    await DriveClient.loadGis();
    return window.google.accounts.oauth2;
  }

  /** Google Identity Services, loaded lazily so the page costs nothing without it. */
  static async loadGis() {
    if (window.google?.accounts?.oauth2) return;
    await new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'https://accounts.google.com/gsi/client';
      el.async = true;
      el.onload = resolve;
      el.onerror = () => reject(new Error(
        'Could not load Google Sign-In. Check the network, and any content blocker.'));
      document.head.appendChild(el);
    });
  }

  /**
   * The real Google flow: account chooser, then a consent screen naming each
   * permission, then a token. `prompt: ''` lets Google skip the chooser when
   * there is only one signed-in account and consent is already given, which is
   * what makes a return visit one click rather than three.
   */
  async signIn({ prompt = '' } = {}) {
    if (!this.clientId) throw new Error('No Google OAuth client ID has been set.');
    const oauth2 = await this.gis();
    const token = await new Promise((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPE,
        prompt,
        callback: (r) => {
          if (r.error) { reject(new Error(r.error_description || r.error)); return; }
          this.token = r.access_token;
          resolve(r.access_token);
        },
        error_callback: (e) => reject(new Error(
          e?.type === 'popup_closed' ? 'Sign-in window was closed.'
            : e?.message ?? 'Sign-in was dismissed.')),
      });
      client.requestAccessToken();
    });
    await this.loadAccount();
    return token;
  }

  /** Who is signed in, so the page can say so rather than just claiming success. */
  async loadAccount() {
    try {
      const res = await this.fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) throw new Error(String(res.status));
      const me = await res.json();
      this.account = {
        name: me.name ?? me.given_name ?? null,
        email: me.email ?? null,
        picture: me.picture ?? null,
      };
      saveConfig({ account: this.account });
      return this.account;
    } catch {
      // Identity is a nicety; failing to fetch it must not fail the sync.
      this.account = null;
      return null;
    }
  }

  /** Sign out properly: hand the token back rather than just forgetting it. */
  async signOut({ revoke = true } = {}) {
    const token = this.token;
    this.token = null;
    this.account = null;
    saveConfig({ account: null });
    if (!revoke || !token) return;
    try {
      const oauth2 = await this.gis();
      oauth2.revoke?.(token);
    } catch { /* the token expires on its own soon enough */ }
  }

  async api(path, opts = {}) {
    const res = await this.fetch(`https://www.googleapis.com/${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${this.token}`, ...(opts.headers ?? {}) },
    });
    if (!res.ok) {
      throw new Error(`Drive returned ${res.status} ${res.statusText}. `
        + (res.status === 401 ? 'The sign-in may have expired; try again.' : ''));
    }
    return res;
  }

  /** The single file this app keeps, or null the first time. */
  async findFile() {
    const res = await this.api(
      `drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime)&pageSize=10`);
    const { files } = await res.json();
    return (files ?? []).find((f) => f.name === FILE_NAME) ?? null;
  }

  async read() {
    const file = await this.findFile();
    if (!file) return null;
    const res = await this.api(`drive/v3/files/${file.id}?alt=media`);
    return res.json();
  }

  async write(payload) {
    const file = await this.findFile();
    const meta = file ? {} : { name: FILE_NAME, parents: ['appDataFolder'] };
    const body = new FormData();
    body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    body.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    await this.api(
      `upload/drive/v3/files${file ? '/' + file.id : ''}?uploadType=multipart`,
      { method: file ? 'PATCH' : 'POST', body });
  }
}

/**
 * Pull, merge, push. Doing all three every time is what makes two devices agree
 * rather than the last one to sync overwriting the other.
 */
export async function syncNow(client) {
  const remote = await client.read();
  let summary = null;
  if (remote) {
    const applied = apply(remote);
    if (!applied.ok) return applied;
    summary = applied.summary;
  }
  await client.write(snapshot());
  saveConfig({ lastSync: new Date().toISOString() });
  return { ok: true, summary, firstTime: !remote };
}
