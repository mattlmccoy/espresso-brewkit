// The shot dial as a mountable component.
//
// `dial.js` holds the geometry and `styles.js` the drinks; this is the part
// that turns them into elements. It exists because the viewer grew a dial and
// then the brew page needed the same one: two copies of forty lines of SVG
// plumbing would drift, and the first thing to drift would be which zone counts
// as "here" — which is the thing the dial is for.
//
// Everything is classes rather than ids, so a page can carry more than one.
//
// The shape is a parameter rather than a constant. A half circle is right for a
// panel that also has a chart in it; a near-full ring is right for a screen
// organised around the dial itself. Both are the same arithmetic, so a theme
// can ask for either without a second implementation to keep in step.

import { GEO, RING, arc, arcLength, point } from './dial.js';

const NS = 'http://www.w3.org/2000/svg';

const el = (name, cls) => {
  const node = document.createElementNS(NS, name);
  if (cls) node.setAttribute('class', cls);
  return node;
};

/** How many minor ticks go round the rim. Decoration, and a sense of travel. */
const RIM_TICKS = 60;

/**
 * Which shape a theme wants its dial to be.
 *
 * Shape is the one part of a theme that CSS cannot express: a path's geometry
 * is in the path. So the table lives here, next to the shapes, rather than as
 * a condition repeated on every page that mounts one. Anything not listed gets
 * the half circle, which is the shape that fits in a panel with a chart in it.
 */
export function geoFor(theme) {
  return theme === 'machined' ? RING : GEO;
}

/**
 * Build a dial inside `root` and return a handle that paints it.
 *
 * `paint` takes the object `shotDial()` returns, or null to hide. It is called
 * ten times a second, so the zones and ticks — which only move when the dose or
 * the target does — are rebuilt from a signature rather than every frame.
 *
 * Mounting again replaces what was there, which is how a theme change swaps the
 * half circle for the ring.
 */
export function mountGauge(root, { geo: initial = GEO, box = null } = {}) {
  // Everything the SVG is made of, rebuilt when the shape changes. They are
  // `let` rather than `const` because a theme swap replaces the instrument
  // without the page having to know it happened.
  let geo, ring, svg, zones, now, head, ticks, flowNow, inner;
  // The last thing painted, so a rebuild comes back showing what was on it. A
  // dial that goes blank until the next reading is a dial that looks broken
  // for as long as nothing is pouring.
  let lastArgs = null;

  function build(next) {
  geo = next;
  ring = geo === RING || geo.span > Math.PI;
  const viewBox = box ?? (ring ? '0 0 200 200' : '0 0 200 128');
  const whole = arc(0, 1, geo);

  svg = el('svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Where the pour is');

  // The rim: minor ticks all the way round, under everything. They say nothing
  // on their own — they are what makes the travelling arc read as travelling.
  const rim = el('g', 'g-rim');
  for (let i = 0; i <= RIM_TICKS; i++) {
    const f = i / RIM_TICKS;
    const [x, y] = point(f, geo);
    const line = el('line', `g-rim-t${i % 10 === 0 ? ' is-major' : ''}`);
    const inner = i % 10 === 0 ? 0.88 : 0.93;
    line.setAttribute('x1', x.toFixed(1));
    line.setAttribute('y1', y.toFixed(1));
    line.setAttribute('x2', (geo.cx + (x - geo.cx) * inner).toFixed(1));
    line.setAttribute('y2', (geo.cy + (y - geo.cy) * inner).toFixed(1));
    rim.append(line);
  }

  const track = el('path', 'g-track');
  track.setAttribute('d', whole);
  zones = el('g', 'g-zones');
  now = el('path', 'g-now');
  now.setAttribute('d', whole);
  // The leading edge, as an object rather than as the end of a stroke. A shot
  // arriving somewhere is easier to see than a stroke being slightly longer.
  head = el('circle', 'g-head');
  head.setAttribute('r', '4.5');
  ticks = el('g', 'g-ticks');
  // Flow, on its own inner track, so the two things a pour is doing — how much
  // and how fast — are both on the instrument instead of one of them being a
  // number somewhere else.
  const flowTrack = el('path', 'g-flowtrack');
  flowNow = el('path', 'g-flow');

  inner = { ...geo, r: geo.r * 0.72 };
  const innerWhole = arc(0, 1, inner);
  flowTrack.setAttribute('d', innerWhole);
  flowNow.setAttribute('d', innerWhole);

  svg.append(rim, flowTrack, flowNow, track, zones, now, head, ticks);

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

  root.replaceChildren(svg, read);
  root.classList.add('gauge');
  root.classList.toggle('is-ring', ring);
  n_ = n; sub_ = sub;
  sig = '';
  }

  let n_, sub_, sig = '';
  build(initial);

  /**
   * @param d      what `shotDial()` returned, or null to hide
   * @param flow   g/s right now, for the inner track
   * @param flowMax the top of the flow scale
   */
  function paint(d, { flow = null, flowMax = 4 } = {}) {
    lastArgs = [d, { flow, flowMax }];
    root.hidden = !d;
    if (!d) { sig = ''; return; }

    const next = `${d.top}|${d.marks.map((m) => m.grams).join(',')}`;
    if (sig !== next) {
      sig = next;
      zones.replaceChildren(...d.zones.map((z) => {
        const path = el('path', `g-zone z-${z.id}`);
        path.setAttribute('d', arc(z.fromFrac, z.toFrac, geo));
        path.dataset.id = z.id;
        return path;
      }));
      ticks.replaceChildren(...d.marks.flatMap((m) => {
        const [x, y] = point(m.frac, geo);
        const line = el('line', `g-tick${m.isTarget ? ' is-target' : ''}`);
        line.setAttribute('x1', x.toFixed(1));
        line.setAttribute('y1', y.toFixed(1));
        // Ticks point inward from the arc, so they read as marks on the scale
        // rather than as spokes.
        line.setAttribute('x2', (geo.cx + (x - geo.cx) * 0.8).toFixed(1));
        line.setAttribute('y2', (geo.cy + (y - geo.cy) * 0.8).toFixed(1));
        if (!ring) return [line];
        // A ring has room to name its marks; a half circle inside a panel with
        // a chart under it does not, and a label there would sit on the number.
        //
        // Outside the rim, not inside it. Inside is where the reading lives,
        // and a label there lands on top of the one number the whole
        // instrument exists to show — which is what the first attempt did.
        const [lx, ly] = point(m.frac, { ...geo, r: geo.r * 1.13 });
        const label = el('text', `g-label${m.isTarget ? ' is-target' : ''}`);
        label.setAttribute('x', lx.toFixed(1));
        label.setAttribute('y', (ly + 3).toFixed(1));
        // The whole word. Chopping it to four characters gave RIST, ESPR and
        // LUNG, which are not words and read as a rendering fault rather than
        // as a label — and the space outside the rim was never the constraint.
        label.textContent = m.label.toUpperCase();
        return [line, label];
      }));
    }

    for (const z of zones.children) {
      z.classList.toggle('here', d.style?.id === z.dataset.id);
    }
    const len = arcLength(geo);
    now.style.strokeDasharray = String(len);
    now.style.strokeDashoffset = String(len * (1 - d.frac));
    const [hx, hy] = point(d.frac, geo);
    head.setAttribute('cx', hx.toFixed(1));
    head.setAttribute('cy', hy.toFixed(1));

    const hasFlow = Number.isFinite(flow) && flow > 0;
    flowNow.style.display = hasFlow ? '' : 'none';
    if (hasFlow) {
      const innerLen = arcLength(inner);
      const f = Math.max(0, Math.min(1, flow / flowMax));
      flowNow.style.strokeDasharray = String(innerLen);
      flowNow.style.strokeDashoffset = String(innerLen * (1 - f));
    }

    n_.textContent = d.net.toFixed(1);
    sub_.textContent = d.style
      ? `${d.style.label} · 1:${d.style.ratio}`
      : d.over ? `past the dial · ${d.top} g` : `under ristretto · ${d.top} g at the end`;
  }

  /**
   * Swap the shape, keeping the reading.
   *
   * A theme change is the only caller. Rebuilding and leaving the dial empty
   * would blank it until the next sample, which on a scale that has settled is
   * forever.
   */
  function setGeo(next) {
    if (next === geo) return;
    build(next);
    if (lastArgs) paint(...lastArgs);
  }

  return { root, paint, setGeo,
           get svg() { return svg; }, get zones() { return zones; },
           get ticks() { return ticks; }, get now() { return now; },
           get head() { return head; }, get geo() { return geo; },
           get ring() { return ring; } };
}
