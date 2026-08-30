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

/**
 * Which shape a theme wants its dial to be.
 *
 * All of them the same one, now. It used to hand `machined` a ring and everyone
 * else a half circle, which meant a dial learnt on one theme could not be read
 * on another — and only the ring branch drew labels at all, so in four of the
 * five themes the bands were three unexplained shades. A theme changes the
 * material; it does not change the instrument.
 *
 * Kept as a function because the call sites read better for it and because the
 * next shape question will land here rather than in five pages.
 */
export function geoFor(_theme) {
  return GEO;
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
  let geo, svg, zones, labels, now, ticks, defs, fillRect, fillLine;
  let lastArgs = null;
  let n_, sub_, gap_, sig = '';

  function build(next) {
    geo = next;
    const viewBox = box ?? '0 0 220 200';
    const [, , vbW, vbH] = viewBox.split(/\s+/).map(Number);
    // Two rings at different radii, and nothing is drawn over anything. The old
    // dial put the progress arc on top of the zone bands at the same radius, so
    // the band you were actually in was destroyed by the arc that told you how
    // far along you were — the dial answered "how much" by erasing "which
    // drink".
    const bandGeo = { ...geo };
    const nowGeo = { ...geo, r: geo.r * 0.72 };

    svg = el('svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Where the pour is');

    // Paths the labels ride on, one per band, so a name can curve along the
    // thing it names instead of floating outside the rim at an angle.
    defs = el('defs');
    svg.append(defs);

    // THE CUP, IN THE DIAL'S OWN COORDINATES.
    // It used to be a CSS circle inset by a percentage of the box around the
    // dial, which is a different coordinate system with a different centre —
    // this dial's is at cy 112 of 200, six per cent below the middle — so its
    // radius could not match the ring it sat inside and visibly did not.
    // Drawn here it is concentric with the inner track by construction, at
    // every size and in every theme.
    const uid = Math.random().toString(36).slice(2, 8);
    const clip = el('clipPath');
    clip.setAttribute('id', `gfill-${uid}`);
    const bore = el('circle');
    bore.setAttribute('cx', geo.cx);
    bore.setAttribute('cy', geo.cy);
    bore.setAttribute('r', nowGeo.r);
    clip.append(bore);
    fillRect = el('rect', 'g-fill');
    fillRect.setAttribute('x', geo.cx - nowGeo.r);
    fillRect.setAttribute('width', nowGeo.r * 2);
    fillRect.setAttribute('clip-path', `url(#gfill-${uid})`);
    fillRect.setAttribute('y', geo.cy + nowGeo.r);
    fillRect.setAttribute('height', 0);
    // AN OPAQUE WELL UNDER THE NUMBER.
    // The fill is translucent, so before this the number's ground was
    // "whatever the page put behind the dial, plus however much coffee has
    // landed" — two variables, one of them moving. That is why the viewer's
    // tile had to be stripped of colour: no ink survives a ground that slides.
    // With the well the ground is --panel plus the fill and nothing else, at
    // any size, in any theme, on any page. The tile behind is then free to be
    // whatever it wants, because it is no longer under the number.
    const well = el('circle', 'g-well');
    well.setAttribute('cx', geo.cx);
    well.setAttribute('cy', geo.cy);
    well.setAttribute('r', nowGeo.r);

    fillLine = el('line', 'g-fill-top');
    fillLine.setAttribute('clip-path', `url(#gfill-${uid})`);
    fillLine.setAttribute('x1', geo.cx - nowGeo.r);
    fillLine.setAttribute('x2', geo.cx + nowGeo.r);
    fillLine.setAttribute('y1', geo.cy + nowGeo.r);
    fillLine.setAttribute('y2', geo.cy + nowGeo.r);

    const track = el('path', 'g-track');
    track.setAttribute('d', arc(0, 1, bandGeo));
    zones = el('g', 'g-zones');
    labels = el('g', 'g-labels');
    now = el('path', 'g-now');
    now.setAttribute('d', arc(0, 1, nowGeo));
    const nowTrack = el('path', 'g-nowtrack');
    nowTrack.setAttribute('d', arc(0, 1, nowGeo));
    ticks = el('g', 'g-ticks');

    svg.append(clip, well, fillRect, fillLine, track, zones, labels, nowTrack, now, ticks);

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
    const gap = document.createElement('div');
    gap.className = 'g-gap';
    gap.textContent = '';
    read.append(n, u, sub, gap);

    root.replaceChildren(svg, read);
    root.classList.add('gauge');
    // What the readout has to obey, published from the geometry rather than
    // guessed at by whoever styles it: how far the dial's centre sits from the
    // middle of the box, and how wide the clear bore inside the ring is. Both
    // as percentages of the drawn SVG, so they hold at any size.
    root.style.setProperty('--g-shift', `${((geo.cy - vbH / 2) / vbH * 100).toFixed(3)}%`);
    root.style.setProperty('--g-bore', `${(nowGeo.r * 2 / vbW * 100).toFixed(3)}%`);
    n_ = n; sub_ = sub; gap_ = gap;
    sig = '';
    geo.bandGeo = bandGeo;
    geo.nowGeo = nowGeo;
  }

  build(initial);

  /**
   * @param d      what `shotDial()` returned, or null to hide
   * @param flow   unused by the dial now; flow lives on the chart and the strip
   */
  function paint(d, opts = {}) {
    lastArgs = [d, opts];
    root.hidden = !d;
    if (!d) { sig = ''; return; }

    const { bandGeo, nowGeo } = geo;
    const next = `${d.top}|${d.bottom}|${d.marks.map((m) => m.grams).join(',')}`;
    if (sig !== next) {
      sig = next;
      const uid = Math.random().toString(36).slice(2, 8);
      defs.replaceChildren();
      zones.replaceChildren();
      labels.replaceChildren();

      for (const z of d.zones) {
        // A real gap between bands, not a hair. Three separated arcs read as
        // three named things; a continuous ring divided by colour reads as one
        // graduated scale, which is the rev-counter tell.
        const a = Math.min(1, z.fromFrac + 0.012);
        const b = Math.max(0, z.toFrac - 0.012);
        if (!(b > a)) continue;
        const path = el('path', `g-zone z-${z.id}`);
        path.setAttribute('d', arc(a, b, bandGeo));
        path.dataset.id = z.id;
        zones.append(path);

        // The name, curved along its own band, centred on it. Every band is
        // long enough for its whole word at every dose, because the scale is
        // anchored to the drinks — which is why nothing here is ever
        // abbreviated.
        const id = `gl-${uid}-${z.id}`;
        const guide = el('path');
        guide.setAttribute('id', id);
        // Just inside the band, so the name sits under the arc rather than on
        // top of it and the stroke can stay thin.
        guide.setAttribute('d', arc(a, b, { ...bandGeo, r: bandGeo.r - 13 }));
        defs.append(guide);
        const text = el('text', `g-label z-${z.id}`);
        text.dataset.id = z.id;
        const tp = el('textPath');
        tp.setAttribute('href', `#${id}`);
        tp.setAttribute('startOffset', '50%');
        tp.setAttribute('text-anchor', 'middle');
        tp.textContent = z.label;
        text.setAttribute('dy', '3');
        text.append(tp);
        labels.append(text);
      }

      // One mark, for the thing you are aiming at. The landmark ticks are gone:
      // a boundary between two named bands is already the tick, and a second
      // mark six units away from it is what made this look graduated.
      ticks.replaceChildren();
      const aim = d.marks.find((m) => m.isTarget);
      if (aim) {
        // Outside the band, short. It used to cross both rings like a needle.
        const [x1, y1] = point(aim.frac, { ...geo, r: geo.r + 8 });
        const [x2, y2] = point(aim.frac, { ...geo, r: geo.r + 16 });
        const line = el('line', 'g-tick is-target');
        line.setAttribute('x1', x1.toFixed(1)); line.setAttribute('y1', y1.toFixed(1));
        line.setAttribute('x2', x2.toFixed(1)); line.setAttribute('y2', y2.toFixed(1));
        ticks.append(line);
      }
    }

    for (const node of [...zones.children, ...labels.children]) {
      node.classList.toggle('here', d.style?.id === node.dataset.id);
    }
    const len = arcLength(nowGeo);
    now.style.strokeDasharray = String(len);
    now.style.strokeDashoffset = String(len * (1 - d.frac));

    // The cup, in the dial's own coordinates. `fill` is the fraction of the
    // vessel that is full, which is a different scale from the dial's own — a
    // cup starts at empty, the dial starts at 1:1 — so the caller supplies it.
    const f = Number.isFinite(opts.fill) ? Math.max(0, Math.min(1, opts.fill)) : null;
    const { r: bore } = geo.nowGeo;
    if (f === null) {
      fillRect.setAttribute('height', 0);
      fillLine.style.opacity = '0';
    } else {
      const top = geo.cy + bore - 2 * bore * f;
      fillRect.setAttribute('y', top.toFixed(2));
      fillRect.setAttribute('height', (geo.cy + bore - top).toFixed(2));
      fillLine.setAttribute('y1', top.toFixed(2));
      fillLine.setAttribute('y2', top.toFixed(2));
      fillLine.style.opacity = f > 0 ? '1' : '0';
    }

    n_.textContent = d.net.toFixed(1);
    sub_.textContent = d.style ? d.style.label
      : d.over ? 'Past lungo' : 'Under ristretto';
    // How far to the end of the band you are in — "how much longer", which the
    // dial is supposed to answer and never did.
    gap_.textContent = d.toNext && d.toNext.into
      ? `${d.toNext.grams} g to ${d.toNext.into.toLowerCase()}`
      : d.style ? `1:${d.style.ratio}` : '';
  }

  function setGeo(next) {
    if (next === geo) return;
    build(next);
    if (lastArgs) paint(...lastArgs);
  }

  return {
    root, paint, setGeo,
    get svg() { return svg; }, get zones() { return zones; },
    get ticks() { return ticks; }, get now() { return now; },
    get geo() { return geo; }, get ring() { return true; },
  };
}
