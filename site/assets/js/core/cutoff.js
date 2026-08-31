// Where to stop, so the cup lands on the target instead of past it.
//
// Everyone who has weighed a shot knows the failure: you aim for 36 g, you stop
// the pump at 36 g, and the cup settles at 38. The puck does not stop when the
// pump does. There is coffee in the basket, in the spout and in the air, and it
// all arrives after the decision.
//
// The correction is not a constant. What is still in flight is the flow rate
// times how long that machine keeps dripping, so at 1.2 g/s it is about a gram
// and at 2.6 g/s it is nearly three. A fixed "stop 2 g early" is wrong at both
// ends, and wrong in the direction that matters at the fast end, where the
// overshoot is biggest and the window to react is smallest.
//
// So the stop weight moves with the flow, and the drip time is measured per
// machine from your own shots rather than assumed (see kit.stopLag).
//
// WHY THIS IS ITS OWN FILE. It was arithmetic written out three times — twice
// on the laptop and once on the phone — and the three had drifted: the screen
// counted down to the stop weight while the SOUND counted down to the target,
// which is to say the one cue you use when you are not looking at the screen
// fired a gram and a half late, every time, by construction.

/** Seconds of warning before the stop. Long enough to put a hand on the paddle. */
export const LEAD_S = 5;
/** And the last stretch, where each second gets its own tick. */
export const TICK_FROM_S = 3;

/**
 * The stop weight, and how far away it is.
 *
 * `cap` bounds the correction as a fraction of the target. Flow is a smoothed
 * derivative of a scale reading, and a cup knocked or a hand resting on the
 * platter can put it briefly into double figures — uncapped, that says "stop at
 * 4 g" in the middle of a normal shot, which is a worse failure than the one
 * this is fixing. A quarter of the target is far past any real drip and still
 * finite.
 *
 * @param {{target:number, flow:number, lag:number, net:number, cap:number}} o
 * @returns {{at:number, trail:number, eta:number, lands:number, ready:boolean,
 *            due:boolean}|null}
 */
export function cutPoint({ target, flow, lag = 1, net = NaN, cap = 0.25 } = {}) {
  const t = Number(target);
  if (!Number.isFinite(t) || t <= 0) return null;
  const q = Number.isFinite(flow) && flow > 0 ? flow : 0;
  const l = Number.isFinite(lag) && lag > 0 ? lag : 0;
  // What the puck will still deliver after the pump stops.
  const trail = Math.min(q * l, t * cap);
  const at = t - trail;
  const w = Number(net);
  // Below a trickle the division is meaningless and the answer is not "any
  // second now", it is "there is no pour to time".
  const eta = q > 0.05 && Number.isFinite(w) ? (at - w) / q : NaN;
  return {
    at: +at.toFixed(2),
    trail: +trail.toFixed(2),
    eta,
    // Where this cup is heading if nothing changes.
    lands: Number.isFinite(w) ? +(w + trail).toFixed(2) : NaN,
    ready: Number.isFinite(eta) && eta > 0 && eta <= LEAD_S,
    // Stop now. Not `eta <= 0`: at 2 g/s a tenth of a second is 0.2 g, and the
    // cue has to leave time for a hand to move.
    due: Number.isFinite(eta) && eta <= 0.35,
  };
}
