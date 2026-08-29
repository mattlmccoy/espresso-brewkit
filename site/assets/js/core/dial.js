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

import { stylesFor, landmarks, ladderScale, styleOf } from './styles.js';

/**
 * A half circle, opening upward, in a 200x116 box.
 *
 * The numbers are the laptop's, kept so the two dials are the same shape at
 * different sizes rather than two dials that happen to both be round.
 */
export const GEO = { cx: 100, cy: 108, r: 86 };

/** Length of the full arc, for stroke-dasharray. */
export const arcLength = (geo = GEO) => geo.r * Math.PI;

/**
 * A point on the arc. Fraction 0 is the left end, 1 the right.
 *
 * Left to right, so it fills the way a bar does and the way English reads.
 * Getting this backwards puts every band on the opposite side of the dial from
 * the arc that is supposed to reach it, and it looks plausible either way.
 */
export function point(frac, geo = GEO) {
  const a = Math.PI * Math.max(0, Math.min(1, frac));
  return [geo.cx - geo.r * Math.cos(a), geo.cy - geo.r * Math.sin(a)];
}

/** An arc between two fractions, as an SVG path. Empty when there is no span. */
export function arc(from, to, geo = GEO) {
  const a = Math.max(0, Math.min(1, from));
  const b = Math.max(0, Math.min(1, to));
  if (!(b > a)) return '';
  const [x1, y1] = point(a, geo);
  const [x2, y2] = point(b, geo);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${geo.r} ${geo.r} 0 0 1 `
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
  const top = ladderScale(marks);
  if (!(top > 0)) return null;

  const w = Number.isFinite(net) ? Math.max(0, net) : 0;
  const frac = Math.max(0, Math.min(1, w / top));
  const zones = styles.map((s) => {
    const from = d * s.band[0];
    const to = Math.min(top, d * s.band[1]);
    return {
      id: s.id,
      label: s.label,
      from: +from.toFixed(1),
      to: +to.toFixed(1),
      fromFrac: Math.max(0, Math.min(1, from / top)),
      toFrac: Math.max(0, Math.min(1, to / top)),
      // Which zone the cup is in is asked of the ratio, not of the drawn arc.
      // `to` is clipped to the end of the dial, so testing against it would
      // call a shot that ran past the dial "below the first band" — which is
      // the opposite of what it is.
      here: w >= from && w < d * s.band[1],
      passed: w >= d * s.band[1],
    };
  });

  return {
    top: +top.toFixed(1),
    net: +w.toFixed(2),
    frac,
    zones,
    marks: marks.map((m) => ({ ...m, frac: Math.max(0, Math.min(1, m.grams / top)) })),
    // What it is right now, from the same classifier the log uses, so the dial
    // and the saved shot can never disagree about what was pulled. Null below
    // the first band and above the last, where nothing is conventionally named.
    style: styleOf(method, d, w),
    over: w > top,
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
  return {
    top: d.top,
    frac: d.frac,
    style: d.style,
    // Bottom-up, because that is the way a cup fills.
    marks: d.marks.map((m) => ({ ...m, height: m.frac })),
  };
}
