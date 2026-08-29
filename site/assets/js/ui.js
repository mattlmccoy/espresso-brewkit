// Shared chrome: theme toggle, current-page nav marking, and the backup nudge.

import { config as backupConfig, persist } from './core/backup.js';
import { flowBar } from './core/method.js';

const THEME_KEY = 'brewkit.theme';

/**
 * Three palettes, cycled in order. Light and dark also track the system
 * preference until you choose one; terminal never does, because nothing about
 * `prefers-color-scheme` asks for green phosphor.
 */
export const THEMES = ['light', 'dark', 'terminal'];
const LABEL = { light: 'Light', dark: 'Dark', terminal: 'Terminal' };

/** What is on screen right now, whether or not it was chosen. */
function currentTheme() {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (THEMES.includes(explicit)) return explicit;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* blocked storage */ }
  if (THEMES.includes(saved)) document.documentElement.setAttribute('data-theme', saved);
  const btn = document.querySelector('[data-theme-toggle]');
  if (!btn) return;
  // The button is named for where it takes you, not for where you are.
  const nextTheme = () => THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
  const paint = () => {
    const next = nextTheme();
    btn.textContent = LABEL[next];
    btn.setAttribute('aria-label', `Switch to the ${LABEL[next].toLowerCase()} theme`);
  };
  btn.addEventListener('click', () => {
    const next = nextTheme();
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    paint();
  });
  paint();
}

export function markNav() {
  const here = location.pathname.split('/').pop() || 'index.html';
  for (const a of document.querySelectorAll('.nav a')) {
    if ((a.getAttribute('href') || '').split('/').pop() === here) {
      a.setAttribute('aria-current', 'page');
    }
  }
}

/** Number formatting that never prints "NaN" at a user. */
export const fmt = (v, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : '—');
export const fmtInt = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—');

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

/**
 * How overdue a backup is, on every page rather than only on Backup.
 *
 * There is no cloud copy behind this log any more, so the only thing standing
 * between a cleared browser and months of shots is a file someone remembered
 * to export. A nav link that quietly turns amber once the newest shot is newer
 * than the newest backup is the cheapest possible reminder, and it costs a
 * single localStorage read.
 */
export function backupState(now = Date.now()) {
  let last = null;
  try { last = backupConfig().lastBackup ?? null; } catch { return { due: false, never: false }; }
  let newest = 0;
  try {
    const rows = JSON.parse(localStorage.getItem('brewkit.shots.v1') ?? '[]');
    for (const r of rows) {
      const v = r?.timestamp ?? r?.added_at ?? null;
      const t = v ? Date.parse(String(v).includes('T') ? v : String(v).replace(' ', 'T')) : NaN;
      if (Number.isFinite(t) && t > newest) newest = t;
    }
  } catch { /* blocked or unparseable storage is not a reason to nag */ }
  if (!newest) return { due: false, never: !last, newest: 0, last };
  const lastAt = last ? Date.parse(last) : 0;
  return { due: newest > lastAt, never: !last, newest, last,
           days: Math.floor((now - newest) / 86400000) };
}

export function paintBackup(root = document) {
  const slot = root.querySelector('[data-backup]');
  if (!slot) return null;
  const st = backupState();
  slot.classList.toggle('due', !!st.due);
  slot.title = st.due
    ? 'You have shots that are not in any backup file yet'
    : 'Export or restore your log as a file';
  return st;
}

/** The link itself, so no page has to remember to put it in its own markup. */
function mountBackup() {
  const nav = document.querySelector('.nav');
  if (!nav || nav.querySelector('[data-backup]')) return;
  const link = el('a', { class: 'backup-link', href: './backup.html', 'data-backup': '' },
    'Backup', el('span', { class: 'dot', 'aria-hidden': 'true' }));
  nav.insertBefore(link, nav.querySelector('[data-theme-toggle]'));
  paintBackup();
  addEventListener('storage', (e) => {
    if (!e.key || e.key === 'brewkit.backup.v1' || e.key === 'brewkit.shots.v1') paintBackup();
  });
}

export function boot() {
  initTheme();
  mountBackup();
  markNav();
  // Ask once, in the background: a granted persistent bucket is the difference
  // between a log that survives a full disk and one that quietly does not.
  persist().catch(() => {});
}


/**
 * Paint a flow bar. Shared, because the laptop and the phone must not disagree
 * about what "too fast" looks like — the whole point of the phone is that it is
 * the one you are actually looking at.
 *
 * @param root an element containing .qbar > .band + .now, and optionally .qv
 */
export function paintFlow(root, flow, method = 'espresso') {
  if (!root) return null;
  const bar = root.querySelector('.qbar') ?? root;
  const p = flowBar(method, flow);
  const now = bar.querySelector('.now');
  const band = bar.querySelector('.band');
  const val = root.querySelector('.qv');
  if (!p) {
    bar.className = 'qbar';
    if (now) now.style.width = '0%';
    if (val) val.textContent = '—';
    return null;
  }
  bar.className = `qbar is-${p.state}`;
  if (now) now.style.width = `${(p.frac * 100).toFixed(1)}%`;
  if (band) {
    band.style.left = `${(p.lo * 100).toFixed(1)}%`;
    band.style.width = `${((p.hi - p.lo) * 100).toFixed(1)}%`;
  }
  if (val) val.textContent = `${flow.toFixed(2)} g/s`;
  return p;
}


/* ---------------------------------------------------- the Lab's data source */

const SOURCE_KEY = 'brewkit.labsource.v1';
export const labSource = () => {
  try { return localStorage.getItem(SOURCE_KEY) || 'mine'; } catch { return 'mine'; }
};

/**
 * Let a Lab page choose what it is analysing.
 *
 * The reference set is fifteen shots from this project's Python era, on
 * different equipment. That makes it wrong for the daily tools — it would skew
 * a grind model fitted to a dial it never used — and right for these three,
 * because it carries Brix on every row and almost nothing pulled since does.
 * A refractometer is a bench instrument; this app is used at a machine.
 *
 * Defaults to the reference set only while you have nothing of your own, so a
 * new Lab demonstrates something rather than three empty charts.
 */
export function mountLabSource(root, { mine, reference, onChange }) {
  if (!root) return labSource();
  let value = labSource();
  if (value === 'mine' && !mine.length && reference.length) value = 'reference';
  const options = [
    ['mine', `Your shots (${mine.length})`],
    ['reference', `Reference set (${reference.length})`],
    ['both', `Both (${mine.length + reference.length})`],
  ];
  root.replaceChildren(...options.map(([id, text]) => el('button', {
    type: 'button', 'data-source': id, 'aria-pressed': String(id === value),
    onclick: () => {
      value = id;
      try { localStorage.setItem(SOURCE_KEY, id); } catch { /* ignore */ }
      for (const b of root.children) b.setAttribute('aria-pressed', String(b.dataset.source === id));
      onChange?.(id);
    },
  }, text)));
  return value;
}
