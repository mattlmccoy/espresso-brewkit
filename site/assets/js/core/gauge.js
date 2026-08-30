// The shot dial as a mountable component.
//
// `dial.js` holds the geometry and `styles.js` the drinks; this is the part
// that turns them into elements. It exists because the viewer grew a dial and
// then the brew page needed the same one: two copies of forty lines of SVG
// plumbing would drift, and the first thing to drift would be which zone counts
// as "here" — which is the thing the dial is for.
//
// Everything is classes rather than ids, so a page can carry more than one.

import { arc, arcLength, point } from './dial.js';

const NS = 'http://www.w3.org/2000/svg';

const el = (name, cls) => {
  const node = document.createElementNS(NS, name);
  if (cls) node.setAttribute('class', cls);
  return node;
};

/**
 * Build a dial inside `root` and return a handle that paints it.
 *
 * `paint` takes the object `shotDial()` returns, or null to hide. It is called
 * ten times a second, so the zones and ticks — which only move when the dose or
 * the target does — are rebuilt from a signature rather than every frame.
 */
export function mountGauge(root, { arcTo = 'M14 108 A86 86 0 0 1 186 108' } = {}) {
  const svg = el('svg');
  svg.setAttribute('viewBox', '0 0 200 128');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Where the pour is');
  const track = el('path', 'g-track');
  track.setAttribute('d', arcTo);
  const zones = el('g', 'g-zones');
  const now = el('path', 'g-now');
  now.setAttribute('d', arcTo);
  const ticks = el('g', 'g-ticks');
  svg.append(track, zones, now, ticks);

  const read = document.createElement('div');
  read.className = 'g-read';
  const n = document.createElement('span');
  n.className = 'g-n';
  n.textContent = '0.0';
  const u = document.createElement('span');
  u.className = 'g-u';
  u.textContent = 'g';
  const sub = document.createElement('div');
  sub.className = 'g-sub';
  sub.textContent = '—';
  read.append(n, u, sub);

  root.append(svg, read);
  root.classList.add('gauge');

  let sig = '';

  function paint(d) {
    root.hidden = !d;
    if (!d) { sig = ''; return; }

    const next = `${d.top}|${d.marks.map((m) => m.grams).join(',')}`;
    if (sig !== next) {
      sig = next;
      zones.replaceChildren(...d.zones.map((z) => {
        const path = el('path', `g-zone z-${z.id}`);
        path.setAttribute('d', arc(z.fromFrac, z.toFrac));
        path.dataset.id = z.id;
        return path;
      }));
      ticks.replaceChildren(...d.marks.map((m) => {
        const [x, y] = point(m.frac);
        const line = el('line', `g-tick${m.isTarget ? ' is-target' : ''}`);
        line.setAttribute('x1', x.toFixed(1));
        line.setAttribute('y1', y.toFixed(1));
        // Ticks point inward from the arc, so they read as marks on the scale
        // rather than as spokes.
        line.setAttribute('x2', (100 + (x - 100) * 0.8).toFixed(1));
        line.setAttribute('y2', (108 + (y - 108) * 0.8).toFixed(1));
        return line;
      }));
    }

    for (const z of zones.children) {
      z.classList.toggle('here', d.style?.id === z.dataset.id);
    }
    now.style.strokeDasharray = String(arcLength());
    now.style.strokeDashoffset = String(arcLength() * (1 - d.frac));
    n.textContent = d.net.toFixed(1);
    sub.textContent = d.style
      ? `${d.style.label} · 1:${d.style.ratio}`
      : d.over ? `past the dial · ${d.top} g` : `under ristretto · ${d.top} g at the end`;
  }

  return { root, svg, zones, ticks, now, paint };
}
