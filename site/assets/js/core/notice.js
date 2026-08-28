// Explanatory notes that stop explaining once you have read them.
//
// A first-run explanation and a permanent fixture are different things, and the
// site had been treating them the same. Three stacked paragraphs about browser
// support are genuinely useful the first time and pure furniture on the two
// hundredth, especially on a dashboard whose whole promise is that it fits one
// screen.
//
// So every recurring note carries an id and a dismiss. Dismissal is per-note and
// permanent, and there is one control that brings them all back — because a
// preference you cannot reverse is a trap, not a preference.

const KEY = 'brewkit.dismissed.v1';

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}
function write(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* blocked storage */ }
}

export const isDismissed = (id) => !!read()[id];
export const dismissedCount = () => Object.keys(read()).length;

export function dismiss(id) {
  const all = read();
  all[id] = new Date().toISOString();
  write(all);
  emit();
}

export function restoreAll() {
  write({});
  emit();
}

/**
 * Wire up every `[data-notice]` in the document.
 *
 * Markup stays declarative — the note is written where it belongs in the page,
 * with an id — and this hides the ones already dismissed and adds the control
 * to dismiss the rest. Notes without an id are left alone, because a warning
 * about the shot in front of you is not the kind you dismiss forever.
 */
export function initNotices(root = document) {
  for (const node of root.querySelectorAll('[data-notice]')) {
    const id = node.getAttribute('data-notice');
    if (!id) continue;
    if (isDismissed(id)) { node.hidden = true; continue; }
    node.hidden = false;
    if (node.querySelector('.notice-x')) continue;
    node.classList.add('has-x');
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'notice-x';
    x.title = 'Hide this note for good';
    x.setAttribute('aria-label', 'Hide this note for good');
    x.textContent = '×';
    x.addEventListener('click', () => { dismiss(id); node.hidden = true; });
    node.appendChild(x);
  }
}

/** A control that says how many are hidden and puts them back. */
export function restoreControl(target, { onRestore } = {}) {
  const paint = () => {
    const n = dismissedCount();
    target.textContent = n ? `Restore ${n} hidden note${n === 1 ? '' : 's'}` : 'No notes hidden';
    target.disabled = !n;
  };
  target.addEventListener('click', () => {
    restoreAll();
    initNotices();
    paint();
    onRestore?.();
  });
  subscribe(paint);
  paint();
  return paint;
}
