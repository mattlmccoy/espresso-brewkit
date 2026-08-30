// The shot as a dial, with the three drinks marked on it.
//
// The laptop already had a dial, drawn straight into live.html: a 180° arc with
// a target window on it, for weighing beans. The phone had a bar and a chart
// and no dial at all, which is backwards — the phone is the screen you are
// actually looking at while the shot pours, and it was the one showing least.
//
// So the geometry moves out here where both can have it, and it grows the thing
// the bar could never show: where the pour is against the drinks it could still
// become. A bar says 24 of 36 grams. A dial with zones on it says you are past
// ristretto, inside espresso, and a long way from lungo — which is the same
// number and a different question, and the second one is the one you are asking
// with a cup in your hand.
//
// Pure geometry and arithmetic. No DOM: the two pages draw very differently
// from the same numbers, and a module that returned elements would have to pick
// one of them.

import { stylesFor, landmarks, styleOf } from './styles.js';

/**
 * Two thirds of a circle, opening at the bottom, in a 220x200 box.
 *
 * It was a half circle, and a design review was blunt about the result: it read
 * as a bad speedometer. Part of that was the sweep. A half circle has nowhere
 * to put a label except outside the arc or under it, and it leaves the middle —
 * the only place the reading belongs — as a hole.
 *
 * 240° opening at the bottom gives the bands room to be named on themselves and
 * puts the number inside the instrument. One shape for every theme, so a dial
 * learnt on one is readable on the next; what a theme changes is the material.
 *
 * `a0` is where fraction 0 sits and `span` how far the scale sweeps, in radians.
 */
export const GEO = { cx: 110, cy: 112, r: 86, a0: -Math.PI / 6, span: Math.PI * 4 / 3 };

/** Kept as an alias: every theme now uses one shape. */
export const RING = GEO;

/**
 * The dial's domain, as ratios of the dose.
 *
 * It used to run from zero to a little past the lungo mark, which wasted the
 * first 30% of the sweep on ratios below 1:1 — unnamed, unbanded, and nothing
 * ever in them — and cut the lungo band off at 1:3.36 of a drink defined to
 * 1:4. Anchoring it to the drinks instead fixes the band positions at every
 * dose: ristretto always ends at 0.233, espresso at 0.5. Labels can be laid out
 * once and can never collide, which is why they never need abbreviating.
 */
export const DOMAIN = [1.0, 4.0];

const spanOf = (geo) => (Number.isFinite(geo?.span) ? geo.span : Math.PI);

/** Length of the full arc, for stroke-dasharray. */
export const arcLength = (geo = GEO) => geo.r * spanOf(geo);

/**
 * A point on the arc. Fraction 0 is the start of the sweep, 1 the end.
 *
 * For the half circle that is left to right, so it fills the way a bar does and
 * the way English reads. Getting this backwards puts every band on the opposite
 * side of the dial from the arc that is supposed to reach it, and it looks
 * plausible either way.
 */
export function point(frac, geo = GEO) {
  const a = (geo.a0 ?? 0) + spanOf(geo) * Math.max(0, Math.min(1, frac));
  return [geo.cx - geo.r * Math.cos(a), geo.cy - geo.r * Math.sin(a)];
}

/** An arc between two fractions, as an SVG path. Empty when there is no span. */
export function arc(from, to, geo = GEO) {
  const a = Math.max(0, Math.min(1, from));
  const b = Math.max(0, Math.min(1, to));
  if (!(b > a)) return '';
  const [x1, y1] = point(a, geo);
  const [x2, y2] = point(b, geo);
  // Past half a turn SVG needs telling, or it draws the short way round and the
  // band silently becomes its own complement.
  const large = (b - a) * spanOf(geo) > Math.PI ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${geo.r} ${geo.r} 0 ${large} 1 `
    + `${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/**
 * The whole dial for a shot in progress.
 *
 * Zones are the style bands from `styles.js` scaled by the dose, so they are
 * contiguous and the gaps between them are not gaps: every yield from 1:1 to
 * the top of the dial sits inside a named drink or below the first one. The
 * scale runs to a little past the lungo mark, the same top the ladder uses, so
 * the two agree about where the pour is.
 *
 * Returns null when the method has no styles — a pour over has ratios but not
 * these names, and a dial claiming otherwise would be making them up.
 */
export function shotDial(method, dose, { net = 0, target = null } = {}) {
  const styles = stylesFor(method);
  const d = Number(dose);
  if (!styles || !Number.isFinite(d) || d <= 0) return null;

  const marks = landmarks(method, d, { target });
  const [lo, hi] = DOMAIN;
  const bottom = d * lo;
  const top = d * hi;
  if (!(top > bottom)) return null;

  // Where a weight sits on the dial. The scale starts at 1:1, so anything under
  // it pins to the start rather than occupying a third of the sweep saying
  // nothing.
  const place = (g) => Math.max(0, Math.min(1, (g - bottom) / (top - bottom)));

  const w = Number.isFinite(net) ? Math.max(0, net) : 0;
  const frac = place(w);
  const zones = styles.map((s) => {
    const from = d * s.band[0];
    const to = d * s.band[1];
    return {
      id: s.id,
      label: s.label,
      from: +from.toFixed(1),
      to: +Math.min(to, top).toFixed(1),
      fromFrac: place(from),
      toFrac: place(to),
      // Which zone the cup is in is asked of the ratio, not of the drawn arc.
      // Testing against the clipped end would call a shot that ran past the
      // dial "below the first band", which is the opposite of what it is.
      here: w >= from && w < to,
      passed: w >= to,
    };
  });

  return {
    top: +top.toFixed(1),
    bottom: +bottom.toFixed(1),
    net: +w.toFixed(2),
    frac,
    zones,
    marks: marks.map((m) => ({ ...m, frac: place(m.grams) })),
    // What it is right now, from the same classifier the log uses, so the dial
    // and the saved shot can never disagree about what was pulled. Null below
    // the first band and above the last, where nothing is conventionally named.
    style: styleOf(method, d, w),
    over: w > top,
    // How far to the end of the band you are in — the third question the dial
    // is meant to answer, and the one it never showed.
    toNext: (() => {
      const here = zones.find((z) => z.here);
      if (!here) return null;
      const next = styles[styles.findIndex((x) => x.id === here.id) + 1];
      return { grams: +(d * (here.to / d) - w).toFixed(1),
               into: next ? next.label : null };
    })(),
  };
}

/**
 * How full the cup is, for something drawn as a volume rather than an arc.
 *
 * The same fraction as the dial, and deliberately the same source: a screen
 * showing a dial at two thirds and a glass at half is a screen that has two
 * opinions. What this adds is where the marks sit as heights, so a fill can
 * carry the same landmarks the dial does.
 */
export function shotVolume(method, dose, { net = 0, target = null } = {}) {
  const d = shotDial(method, dose, { net, target });
  if (!d) return null;
  // A cup fills from empty, not from 1:1.
  //
  // The dial starts at 1:1 because ratios below it are not a drink and wasted a
  // third of its sweep. A cup has no such excuse: it starts at zero, and
  // borrowing the dial's domain made a cup 24 g into a 36 g shot look 11% full
  // rather than two thirds. Same numbers, different question, so a different
  // scale — and the marks have to move with it or they stop meaning heights.
  const top = d.top;
  const place = (g) => Math.max(0, Math.min(1, g / top));
  return {
    top,
    frac: place(d.net),
    style: d.style,
    // Bottom-up, because that is the way a cup fills.
    marks: d.marks.map((m) => ({ ...m, height: place(m.grams), frac: place(m.grams) })),
  };
}
