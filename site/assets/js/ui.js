// Shared chrome: theme toggle, current-page nav marking, and the backup nudge.

import { config as backupConfig, persist } from './core/backup.js';
import { flowBar } from './core/method.js';
import * as prefs from './core/prefs.js';

const THEME_KEY = 'brewkit.theme';

/**
 * Six palettes, cycled in order.
 *
 * Light and dark also track the system preference until you choose one. The
 * other three never do, because nothing about `prefers-color-scheme` asks for
 * green phosphor, a lit instrument, or frosted glass — and the last two are
 * not palettes at all but different ways of rendering the same page.
 */
export const THEMES = ['light', 'dark', 'terminal', 'glass'];
const LABEL = { light: 'Light', dark: 'Dark', terminal: 'Terminal', glass: 'Glass' };

/* ------------------------------------------------------------------- view mode */
// SIMPLE OR FULL, and why it is a mode rather than a switch on one panel.
//
// This began as a button that hid four things on the Live page while a shot ran,
// which is a declutter, not a view. What it should be is the same choice a
// camera offers between auto and manual: not "show me less of this screen" but
// "how much apparatus do you want between you and the result" — and that answer
// does not change when you navigate to another page.
//
// So it lives in the nav, on every page, and it is one class on <body> that any
// page can hang rules off. Nothing is measured, derived or stored differently in
// either: the difference is entirely what is on screen.

export const MODES = ['simple', 'full'];

/** Which view is on, defaulting to full for anyone who has never chosen. */
export function currentMode() {
  const m = prefs.prefs().mode;
  return MODES.includes(m) ? m : 'full';
}

/** Put it on <body>, which is what every page's rules key off. */
export function applyMode(mode = currentMode()) {
  const m = MODES.includes(mode) ? mode : 'full';
  // Module scripts are deferred so body is normally there; a page that calls
  // this from <head> would otherwise fail silently and look like the mode not
  // working rather than like an ordering mistake.
  if (!document.body) {
    addEventListener('DOMContentLoaded', () => applyMode(m), { once: true });
    return m;
  }
  document.body.classList.toggle('simple', m === 'simple');
  document.body.classList.toggle('full', m === 'full');
  document.dispatchEvent(new CustomEvent('brewkit:mode', { detail: m }));
  return m;
}

export function setMode(mode) {
  prefs.set({ mode: MODES.includes(mode) ? mode : 'full' });
  return applyMode(mode);
}

/**
 * The control, in the nav beside the theme button.
 *
 * Named for where it takes you rather than where you are, exactly like the
 * theme button beside it — a button labelled with the state you are already in
 * is a button you have to think about.
 */
export function mountMode() {
  const nav = document.querySelector('.nav');
  if (!nav || nav.querySelector('[data-mode-toggle]')) return;
  const btn = el('button', { class: 'theme-btn', type: 'button', 'data-mode-toggle': '' });
  const paint = () => {
    const next = currentMode() === 'simple' ? 'full' : 'simple';
    btn.textContent = next === 'simple' ? 'Simple' : 'Full';
    btn.setAttribute('aria-label', `Switch to the ${next} view`);
    btn.title = next === 'simple'
      ? 'Show the shot and the few numbers you act on'
      : 'Show everything the app can derive';
  };
  btn.addEventListener('click', () => { setMode(currentMode() === 'simple' ? 'full' : 'simple'); });
  document.addEventListener('brewkit:mode', paint);
  prefs.subscribe?.(paint);
  nav.insertBefore(btn, nav.querySelector('[data-theme-toggle]'));
  paint();
}

/** What is on screen right now, whether or not it was chosen. */
export function currentTheme() {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (THEMES.includes(explicit)) return explicit;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Whether a theme was picked here, as opposed to inherited or defaulted. */
export function themeChosen() {
  try { return THEMES.includes(localStorage.getItem(THEME_KEY)); } catch { return false; }
}

/**
 * Wear a theme without claiming it was chosen.
 *
 * The viewer follows the laptop it is watching — one glance at two screens
 * beside each other should not be one light and one dark. But following is not
 * choosing: if somebody picks a theme on the phone, that is a decision about
 * the phone and the laptop stops overriding it.
 */
export function applyTheme(name, { remember = false } = {}) {
  if (!THEMES.includes(name)) return false;
  document.documentElement.setAttribute('data-theme', name);
  if (remember) { try { localStorage.setItem(THEME_KEY, name); } catch { /* ignore */ } }
  document.dispatchEvent(new CustomEvent('brewkit:theme', { detail: { theme: name } }));
  return true;
}

export function initTheme() {
  // The class first, and on every page that boots at all — the phone viewer
  // calls this directly rather than going through boot(), and it wants the mode
  // as much as any other screen.
  applyMode();
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
    applyTheme(nextTheme(), { remember: true });
    paint();
  });
  // Repaint when something else changes the theme — the viewer adopts the
  // laptop's, and a button still offering to switch to the theme you are
  // already wearing is a button that has stopped telling the truth.
  document.addEventListener('brewkit:theme', paint);
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
    // `false` means leave it off, not set it to the string "false". For a
    // boolean attribute those are opposites: disabled="false" is disabled, and
    // a button nobody can press looks exactly like a button that does nothing.
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
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
  mountMode();
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
