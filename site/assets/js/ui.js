// Shared chrome: theme toggle and current-page nav marking.

const THEME_KEY = 'brewkit.theme';

export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* blocked storage */ }
  if (saved === 'dark' || saved === 'light') {
    document.documentElement.setAttribute('data-theme', saved);
  }
  const btn = document.querySelector('[data-theme-toggle]');
  if (!btn) return;
  const paint = () => {
    const explicit = document.documentElement.getAttribute('data-theme');
    const dark = explicit
      ? explicit === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    btn.textContent = dark ? 'Light' : 'Dark';
    btn.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
  };
  btn.addEventListener('click', () => {
    const explicit = document.documentElement.getAttribute('data-theme');
    const dark = explicit
      ? explicit === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
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

export function boot() { initTheme(); markNav(); }
