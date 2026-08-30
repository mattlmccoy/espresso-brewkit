// The rest of the app, without leaving the page that is holding a connection.
//
// Two pages have the same problem for two different reasons. `live.html` owns
// the Bluetooth GATT connection to the scale, and a GATT connection belongs to
// the document that opened it: navigate away and the scale drops. `view.html`
// owns one end of a WebRTC peer connection, and a WebRTC description is good
// for exactly one connection, so navigating means pairing again.
//
// Same fix for both: the other pages open in a same-origin frame over the top,
// and the page holding the connection never navigates. The log they read is in
// local storage, which the frame shares, and the store modules already listen
// for `storage` events — which fire on other same-origin documents including
// frames — so a bag edited in the frame updates the page underneath it.
//
// It lives here rather than in either page because the second copy is where the
// drift starts, and the thing that would drift is which of them keeps a
// connection alive.

/**
 * The pages worth reaching without dropping a connection.
 *
 * Not Live and not the viewer: those are the two that hold connections, and
 * opening either inside the other is how you end up with two documents fighting
 * over one scale.
 */
export const BROWSE_PAGES = [
  { href: 'shots.html', label: 'Shots' },
  { href: 'advisor.html', label: 'Advisor' },
  { href: 'kit.html', label: 'Kit' },
  { href: 'lab.html', label: 'Lab' },
  { href: 'settings.html', label: 'Settings' },
];

/**
 * Build the overlay inside `root` and return a handle.
 *
 * `pages` is an array of `{ href, label }`. `backLabel` is what the button that
 * returns to the page underneath says — it names the thing you are going back
 * to, not the direction, because "Back" from a full-screen overlay is
 * ambiguous about whether it means the frame's own history.
 */
export function mountBrowse(root, { pages = [], backLabel = 'The shot', home = null } = {}) {
  root.classList.add('browse');
  root.hidden = true;

  const bar = document.createElement('div');
  bar.className = 'browse-bar';

  const back = document.createElement('button');
  back.className = 'primary';
  back.type = 'button';
  back.textContent = `← ${backLabel}`;

  const live = document.createElement('span');
  live.className = 'browse-live';
  live.textContent = '';

  const conn = document.createElement('span');
  conn.className = 'badge';
  conn.textContent = '';

  bar.append(back, live, conn);

  const frame = document.createElement('iframe');
  frame.title = 'Brewkit';
  root.replaceChildren(bar, frame);

  function open(href) {
    if (frame.getAttribute('src') !== `./${href}`) frame.setAttribute('src', `./${href}`);
    root.hidden = false;
    document.body.classList.add('browsing');
    back.focus();
  }

  function close() {
    root.hidden = true;
    document.body.classList.remove('browsing');
    // The frame keeps its page, so coming back is instant rather than a reload.
  }

  back.addEventListener('click', close);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) close(); });

  // A link back to the host page, followed inside the frame, would load a
  // second copy of it under the first — and on Live that second copy would go
  // looking for the scale the first one is holding. Same origin, so the frame's
  // own document can be patched to come back here instead.
  if (home) {
    frame.addEventListener('load', () => {
      let doc = null;
      try { doc = frame.contentDocument; } catch { return; }
      if (!doc) return;
      for (const a of doc.querySelectorAll(`a[href$="${home}"]`)) {
        a.addEventListener('click', (e) => { e.preventDefault(); close(); });
        a.title = `Back to ${backLabel.toLowerCase()}`;
      }
    });
  }

  /** The row of buttons that opens it. Built here so the two pages agree. */
  function buildRow(host) {
    host.classList.add('go-row');
    host.replaceChildren(...pages.map(({ href, label }) => {
      const b = document.createElement('button');
      b.className = 'ghost';
      b.type = 'button';
      b.dataset.go = href;
      b.textContent = label;
      b.addEventListener('click', () => open(href));
      return b;
    }));
    return host;
  }

  return {
    root, frame, open, close, buildRow,
    isOpen: () => !root.hidden,
    /** The pour, still moving while you are somewhere else. */
    setLive: (text) => { live.textContent = text ?? ''; },
    setConn: (text, tone = '') => {
      conn.textContent = text ?? '';
      conn.className = `badge ${tone}`.trim();
      conn.hidden = !text;
    },
  };
}
