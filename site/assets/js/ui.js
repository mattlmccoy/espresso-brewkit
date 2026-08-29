// Shared chrome: theme toggle, current-page nav marking, and the signed-in
// account.

import { config as syncConfig } from './core/sync.js';

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
 * Who this device syncs as, on every page rather than only on Sync.
 *
 * This works because the account outlives the token. The access token is
 * deliberately never persisted — it lasts about an hour — but the profile is,
 * so any page can say which Google account the log belongs to without holding
 * a credential or making a request. Signed out, the same control is simply the
 * way in to Sync, which the nav otherwise has no room for.
 */
export function paintAccount(root = document) {
  const slot = root.querySelector('[data-account]');
  if (!slot) return null;
  let account = null;
  try { account = syncConfig().account ?? null; } catch { /* blocked storage */ }

  slot.textContent = '';
  slot.className = `acct${account ? '' : ' out'}`;
  if (!account) {
    slot.title = 'Sync this log to your Google Drive';
    slot.appendChild(document.createTextNode('Sync'));
    return null;
  }

  const who = account.name || account.email || 'Signed in';
  slot.title = `${who}${account.email && account.email !== who ? ` · ${account.email}` : ''}`
    + ' — syncing to your Drive';
  const face = el('span', { class: 'acct-face', 'aria-hidden': 'true' },
    who.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(''));
  slot.appendChild(face);
  slot.appendChild(el('span', { class: 'acct-name' }, account.name || account.email || 'Account'));
  // Probe the image rather than trusting it: a Google avatar URL can 404 once
  // the picture changes, and a broken image is worse than initials.
  if (account.picture) {
    const img = new Image();
    img.onload = () => {
      face.style.backgroundImage = `url("${account.picture}")`;
      face.textContent = '';
    };
    img.src = account.picture;
  }
  return account;
}

/** The chip itself, so no page has to remember to put it in its own markup. */
function mountAccount() {
  const nav = document.querySelector('.nav');
  if (!nav || nav.querySelector('[data-account]')) return;
  const chip = el('a', { class: 'acct out', href: './sync.html', 'data-account': '' }, 'Sync');
  nav.insertBefore(chip, nav.querySelector('[data-theme-toggle]'));
  paintAccount();
  // Another tab signing in or out is the same event as this one doing it.
  addEventListener('storage', (e) => {
    if (!e.key || e.key === 'brewkit.sync.v1') paintAccount();
  });
}

export function boot() { initTheme(); mountAccount(); markNav(); }
