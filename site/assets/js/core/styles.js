// The three shots inside every shot.
//
// A dose of coffee does not have one correct yield. Stop at 1:1.5 and it is a
// ristretto, at 1:2 an espresso, at 1:3 a lungo — same puck, same grind, three
// different drinks, and which one you get is decided by when you cut. The app
// knew this only as a number typed in before the shot: one target, aimed at,
// and the whole pour narrated as distance from it.
//
// That is backwards. The interesting moment is mid-pour, when the cup is at
// 24 g and the question is whether to stop now or ride it to 36. Answering it
// needs two things on screen: where each style lands in grams, and how long
// until you get there.
//
// The grams are arithmetic on the dose and are true from the first drop. The
// seconds are a projection, and projections are where this gets honest — see
// `project` below.

/**
 * The classical ratios.
 *
 * `at` is the centre, `band` is the range that still counts as this drink.
 * The bands are contiguous and deliberately so: every ratio from 1:1 to 1:4
 * has a name, and a shot that lands at 1:1.8 is an espresso rather than an
 * error. Below 1:1 and above 1:4 nothing is claimed, because nothing is
 * conventionally agreed.
 *
 * These are the common modern definitions rather than a standard — there is no
 * standard — which is why they are one table in one place and not scattered
 * through the UI.
 */
export const STYLES = [
  {
    id: 'ristretto',
    label: 'Ristretto',
    at: 1.5,
    band: [1.0, 1.7],
    blurb: 'Cut short. Thicker, sweeter, less of everything that comes out late.',
  },
  {
    id: 'espresso',
    label: 'Espresso',
    at: 2.0,
    band: [1.7, 2.5],
    blurb: 'The middle. What most recipes and most cafés mean by a shot.',
  },
  {
    id: 'lungo',
    label: 'Lungo',
    at: 3.0,
    band: [2.5, 4.0],
    blurb: 'Run long. Weaker and more extracted — more of the late flavours, good and bad.',
  },
];

export const styleById = (id) => STYLES.find((s) => s.id === id) ?? null;

/**
 * How long the flow takes to stop climbing, in seconds.
 *
 * This is the whole reason the countdowns are not on screen from the start.
 * Espresso flow ramps: pre-infusion, then the pump comes up, then the puck
 * saturates, and only after that does flow mean anything you can divide by.
 * Measured on the two real shots in the log, flow goes 0.9 g/s at 2 s to a
 * peak near 2.4-2.9 g/s at 12-14 s, so an early projection divides by less
 * than half the flow the shot will actually have and is wrong by more than the
 * shot is long.
 *
 * Mean absolute error of the arrival estimate, by when it was made:
 *
 *     0-4 s    14.50 s
 *     4-6 s     7.49 s
 *     6-8 s     3.24 s
 *     8-10 s    1.00 s
 *     10 s+     0.16 s
 *
 * Eight seconds is where it becomes worth printing. Before that the landmarks
 * still show — their weights are exact — and the times say nothing rather than
 * saying something wrong.
 */
export const RAMP_S = 8;

/**
 * How far ahead a projection is still worth a number, in seconds.
 *
 * Past the ramp the estimate is good, but "good" was measured against arrivals
 * a few seconds out. Flow sags through the second half of a shot, so a constant
 * flow extrapolated a long way is optimistic, and neither real shot ran long
 * enough to check a lungo against. So a landmark further out than this is shown
 * as approximate rather than as a countdown.
 */
export const HORIZON_S = 12;

/**
 * Whether this method has styles at all.
 *
 * Ristretto and lungo are espresso words. A pour over has ratios too, but 1:15
 * against 1:17 is not two named drinks, and inventing names for them here would
 * be putting words in the mouth of a method that does not use them.
 */
export function stylesFor(method) {
  const id = typeof method === 'string' ? method : method?.id;
  return id === 'espresso' || id === 'milk' ? STYLES : null;
}

/**
 * Where each style lands, in grams, for this dose.
 *
 * Always available and always exact: it is a multiplication. `target` adds the
 * yield you actually aimed at as a fourth landmark, flagged, so the ladder
 * shows both the classical marks and your own — they are usually near each
 * other and occasionally not, and seeing that is the point.
 */
export function landmarks(method, dose, { target = null } = {}) {
  const styles = stylesFor(method);
  const d = Number(dose);
  if (!styles || !Number.isFinite(d) || d <= 0) return [];
  const out = styles.map((s) => ({
    id: s.id,
    label: s.label,
    ratio: s.at,
    grams: +(d * s.at).toFixed(1),
    blurb: s.blurb,
    isTarget: false,
  }));
  const t = Number(target);
  if (Number.isFinite(t) && t > 0) {
    // Your target is worth its own mark unless it is already sitting on one,
    // where a second tick 0.2 g away is noise rather than information.
    const near = out.some((m) => Math.abs(m.grams - t) < Math.max(0.5, d * 0.05));
    if (!near) {
      out.push({ id: 'target', label: 'Target', ratio: +(t / d).toFixed(2),
                 grams: +t.toFixed(1), blurb: 'What you aimed at before the shot.', isTarget: true });
    } else {
      const hit = out.find((m) => Math.abs(m.grams - t) < Math.max(0.5, d * 0.05));
      hit.isTarget = true;
    }
  }
  return out.sort((a, b) => a.grams - b.grams);
}

/**
 * When a landmark arrives, and whether that is worth saying.
 *
 * The arithmetic is the simplest possible: distance over flow, minus the drip
 * that is still coming after you cut. It is deliberately not corrected for the
 * flow trend. Fitting the decline and solving the quadratic was tried and
 * measured against both real curves, and it was worse at every lead time
 * (1.33 s mean error against 1.18 s), because the trend is a second derivative
 * of a noisy signal and the noise costs more than the curvature buys.
 *
 * What the projection is corrected for is the lag: the number that matters is
 * not when the cup reads 36 g, it is when to *cut* so the cup ends at 36 g,
 * and the puck keeps dripping in between. That lag is learned per machine
 * elsewhere and passed in here.
 *
 * `state` is the honesty:
 *   passed      already gone by
 *   near        cut for this one now-ish; a countdown is shown
 *   far         out past the horizon; approximate, no countdown
 *   settling    flow is still ramping, so no time is claimed at all
 *   stalled     nothing is flowing
 */
export function project(mark, { net, flow, elapsed, lag = 1.0 } = {}) {
  const g = Number(mark?.grams);
  const w = Number(net);
  if (!Number.isFinite(g) || !Number.isFinite(w)) return null;
  const base = { ...mark, eta: null, at: null, state: 'settling' };
  if (w >= g) return { ...base, state: 'passed', eta: 0, at: Number(elapsed) || null };

  // The ramp is checked first on purpose. Three seconds into a shot there is
  // often no flow yet — pre-infusion, or the puck still wetting — and "not
  // flowing" reads as a fault when it is the normal opening of every shot.
  // Before the ramp is over the honest answer is that there is nothing to say.
  if (!Number.isFinite(elapsed) || elapsed < RAMP_S) return base;
  const f = Number(flow);
  if (!Number.isFinite(f) || f <= 0.05) return { ...base, state: 'stalled' };

  // Cut this many seconds from now and the drip carries it the rest of the way.
  const eta = (g - f * lag - w) / f;
  if (!Number.isFinite(eta)) return base;
  const clamped = Math.max(0, eta);
  return {
    ...base,
    eta: clamped,
    at: +(elapsed + clamped).toFixed(1),
    state: clamped > HORIZON_S ? 'far' : 'near',
  };
}

/**
 * Stops a countdown flickering back into an estimate.
 *
 * A mark whose arrival is hovering around the horizon crosses it repeatedly as
 * the flow estimate wobbles, and the cell alternates between "~12 s" and "cut
 * in 12.0 s" several times a second. In a normal shot the crossing happens once
 * and in one direction, so once a mark has been close enough to count down it
 * keeps counting down. The caller owns the set and empties it between shots.
 */
export function settle(rungs, seen) {
  if (!seen) return rungs;
  for (const r of rungs) {
    if (r.state === 'near') seen.add(r.id);
    else if (r.state === 'far' && seen.has(r.id)) r.state = 'near';
  }
  return rungs;
}

/** Every landmark projected at once, in weight order. */
export function ladder(method, dose, snap = {}) {
  return settle(
    landmarks(method, dose, { target: snap.target ?? null })
      .map((m) => project(m, snap))
      .filter(Boolean),
    snap.seen);
}

/**
 * What a finished shot turned out to be.
 *
 * The same table read backwards, so the log can say "ristretto" rather than
 * "1.48" and the analysis can eventually ask whether your ristrettos rate
 * better than your lungos. Returns null outside the bands rather than
 * stretching a name over a 1:6 — an unnamed shot is a fact, a misnamed one is
 * a small lie in a dataset.
 */
export function styleOf(method, dose, yieldG) {
  const styles = stylesFor(method);
  const d = Number(dose);
  const y = Number(yieldG);
  if (!styles || !Number.isFinite(d) || !Number.isFinite(y) || d <= 0 || y <= 0) return null;
  const r = y / d;
  const hit = styles.find((s) => r >= s.band[0] && r < s.band[1]);
  return hit ? { id: hit.id, label: hit.label, ratio: +r.toFixed(2) } : null;
}

/**
 * The ladder as a position, for drawing.
 *
 * The scale runs to a little past the furthest landmark so the last tick is not
 * jammed against the end, and so a shot that runs long has somewhere to go.
 */
export function ladderScale(marks) {
  const top = marks.reduce((a, m) => Math.max(a, Number(m.grams) || 0), 0);
  return top > 0 ? +(top * 1.12).toFixed(1) : 0;
}
