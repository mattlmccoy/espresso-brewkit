// What is worth saying, and — mostly — whether to say anything at all.
//
// This is the judgement half of the character in pip.js, kept apart from it so
// it can be argued with in a test rather than through a screenshot. No DOM in
// this file.
//
// THE PROBLEM WITH ASSISTANTS
// Clippy was not hated for being animated. It was hated for interrupting
// confidently, with things you already knew, that you could not act on, and had
// not asked for. Every one of those is a decision this file makes, so the rules
// are here rather than implied:
//
//   1. Silence is the default and the common output. `live()` returning null is
//      the successful case, not a gap.
//   2. Nothing is said twice. A session-long memory of what has been said, keyed
//      on the finding rather than the wording.
//   3. During the pour, only what is worth knowing WHILE IT POURS. There is
//      exactly one thing you can do mid-shot — stop it — so anything that
//      resolves to "grind differently next time" waits for the rating screen.
//   4. Confidence is inherited, not invented. Every line traces to a claim in
//      knowledge.js and is hedged by that claim's evidence class. If the
//      knowledge bank calls something contested, so does the character.
//
// The fourth is the one that makes this different from a tips list. An app that
// says "flow is climbing, you have a channel" with total assurance, on a signal
// that cannot distinguish a channel from the machine ramping, is worse than an
// app that says nothing.

import { CLAIMS, FLOW_BAND, grindMove, GRINDER_STEPS } from './knowledge.js';
import { diagnose } from './diagnose.js';

const F = (v) => (typeof v === 'number' ? v
  : v === '' || v === null || v === undefined ? NaN : Number(v));

/** Attach the hedge a claim's evidence class earns, so nothing overstates. */
function voiced(claimId, text) {
  const c = CLAIMS[claimId];
  if (!c) return text;
  if (c.confidence === 'contested') return `${text} (though this one is genuinely disputed.)`;
  return text;
}

/* ------------------------------------------------------------------- during */

/**
 * What to say while it is pouring, or null.
 *
 * `state` is the live session: { elapsed, net, flow, trend, target, dose,
 * running }. `said` is the set of ids already used this session and is mutated.
 *
 * Ranked, and only the top one is returned — a character that queues up three
 * remarks during a twenty-second shot is the failure mode this is trying to
 * avoid. Everything here is either time-critical or a genuine surprise; the
 * analysis waits.
 *
 * AND EVERY LINE IS ONE SHORT SENTENCE. There are a few seconds of attention
 * available during a pour, most of it on the cup, and the first version of
 * these ran to three lines and was cut off by the panel — which was the layout
 * telling the truth about how much anyone was going to read. The reasoning is
 * not lost; it is on the rating screen, where there is time for it.
 */
export function live(state, said = new Set(), opts = {}) {
  const { elapsed, net, flow, trend, target } = state ?? {};
  const t = F(elapsed);
  const w = F(net);
  const q = F(flow);
  if (!state?.running || !(t > 0)) return null;

  const out = (id, mood, text, ms = 7000) => {
    if (said.has(id)) return null;
    said.add(id);
    return { id, mood, text, ms };
  };

  // Nothing before there is a shot to read. The opening ramp is not a
  // diagnosis, and commenting on it is exactly the noise this is avoiding.
  if (t < 6) return null;

  // THERE WAS A COUNTDOWN HERE, and taking it out is the point of this file.
  // "About 3 s to 36 g" is true, it is timely, and the page is already showing
  // it — the dial counts down, the ladder marks it, a tile says "cut in", and a
  // sound plays. A character that leans in to tell you the thing you are
  // already looking at is precisely the assistant everyone remembers hating.
  // The test that caught it asserts silence through an ordinary shot, which is
  // the behaviour worth protecting.

  // A step in the flow, live. The same reading as the post-shot one and the
  // same hedge: this is what a channel looks like, and a scale cannot tell it
  // from the machine ramping. There is nothing to do about it now, so it is
  // phrased as something to notice rather than something to fix — mid-shot
  // advice you cannot act on is the definition of the thing being avoided.
  if (Number.isFinite(trend) && trend > 0.28 && t > 8) {
    const r = out('stepping', 'alert', 'Flow jumped. That is a channel’s shape.');
    if (r) return r;
  }

  // Flow far outside the band a shot normally runs at, once there is enough
  // shot to be sure it is not the ramp.
  if (Number.isFinite(q) && t > 10) {
    if (q > FLOW_BAND[1] * 1.6) {
      const r = out('fast', 'alert', `${q.toFixed(1)} g/s — running very free.`);
      if (r) return r;
    } else if (q > 0.05 && q < FLOW_BAND[0] * 0.45) {
      const r = out('slow', 'alert', `${q.toFixed(2)} g/s — close to choking.`);
      if (r) return r;
    }
  }

  return null;
}

/* -------------------------------------------------------------------- after */

/**
 * The full read on a finished shot, ranked, most useful first.
 *
 * Returns [{ id, mood, text, why, confidence }]. `why` is the reasoning behind
 * the line for anyone who wants it; the character shows `text` and offers the
 * rest.
 *
 * `history` is the user's own past shots, and it is what makes this more than a
 * lookup table — two readings below cannot be made from one shot at all.
 */
export function after(shot, history = [], opts = {}) {
  const out = [];
  const rank = { high: 0, medium: 1, low: 2 };
  const tags = String(shot?.tags ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const ratio = F(shot?.ratio);
  const time = F(shot?.time_s);
  const rating = F(shot?.rating);

  // ---- the curve and the taste, from the rules that already exist ----
  for (const f of diagnose(shot ?? {})) {
    out.push({
      id: f.code,
      mood: f.severity === 'high' ? 'alert' : f.severity === 'medium' ? 'think' : 'idle',
      text: `${f.title}. ${f.action}`,
      why: f.detail,
      confidence: f.severity === 'low' ? 'practice' : 'established',
      order: rank[f.severity],
    });
  }

  // ---- what only a log can say, part one: is this repeatable? ----
  // Slow but consistent is a grind problem. Slow and erratic is a puck problem.
  // No single shot contains this, and it is the discrimination people most
  // often get wrong — the app is uniquely placed to make it, so it does.
  const peers = comparable(shot, history);
  if (peers.length >= 4) {
    const times = peers.map((r) => F(r.time_s)).filter(Number.isFinite);
    const cv = spread(times);
    if (Number.isFinite(cv)) {
      if (cv > 0.12) {
        out.push({
          id: 'erratic', mood: 'think', order: 0.5,
          text: `Your last ${times.length} shots on this setting ranged `
            + `${Math.min(...times).toFixed(0)}–${Math.max(...times).toFixed(0)} s. That spread is `
            + 'the puck, not the grind — even out the bed before you touch the dial.',
          why: voiced('varianceDiscriminates', CLAIMS.varianceDiscriminates.because),
          confidence: 'practice',
        });
      } else if (cv < 0.05 && times.length >= 5) {
        out.push({
          id: 'repeatable', mood: 'pleased', order: 2.5,
          text: `${times.length} shots on this setting inside ${(cv * 100).toFixed(0)}% of each `
            + 'other. Whatever you are doing at the grinder and the tamp, keep doing it.',
          why: 'Consistency is the thing nearly every tested intervention actually improves, '
            + 'and the thing that makes every other change readable. A change you make on top '
            + 'of a repeatable shot means something; the same change on top of a scattered one '
            + 'is noise.',
          confidence: 'practice',
        });
      }
    }
  }

  // ---- what only a log can say, part two: are you past the peak? ----
  // Grinding finer stops raising extraction at some point and then lowers it.
  // If the last moves were finer and the shots got slower without getting
  // better, the reflex "go finer again" is the wrong answer, and nothing but
  // the history can tell.
  const drift = finerAndWorse(shot, history);
  if (drift) {
    out.push({
      id: 'past_peak', mood: 'alert', order: 0.2,
      text: 'You have gone finer twice and it has got slower without getting better. That is '
        + 'what the far side of the extraction peak looks like — try coarser with a longer '
        + 'ratio instead.',
      why: voiced('finerIsNotMonotonic', CLAIMS.finerIsNotMonotonic.because),
      confidence: 'established',
    });
  }

  // ---- the drink it actually was ----
  if (Number.isFinite(ratio) && Number.isFinite(time)) {
    const band = ratio < 1.6 ? 'ristretto' : ratio < 2.35 ? 'espresso'
      : ratio < 2.9 ? 'long' : 'lungo';
    if (band === 'ristretto' && tags.includes('sour')) {
      out.push({
        id: 'ristretto_sour', mood: 'think', order: 1.5,
        text: 'A shot this short cannot reach a high yield — the arithmetic will not allow it. '
          + 'If you want more sweetness, take it further rather than finer.',
        why: voiced('ratioSetsEy', CLAIMS.ratioSetsEy.because),
        confidence: 'established',
      });
    }
  }

  // ---- the one worth ending on ----
  if (Number.isFinite(rating) && rating >= 8 && !out.some((o) => o.order < 1)) {
    out.push({
      id: 'good', mood: 'pleased', order: 3,
      text: 'Nothing stood out in the curve and you liked it. Write down where the grinder is.',
      why: 'The useful thing about a good shot is the settings, and they are the thing people '
        + 'reliably fail to record.',
      confidence: 'practice',
    });
  }

  return out.sort((a, b) => a.order - b.order).slice(0, 4);
}

/* ---------------------------------------------------------------- utilities */

/** Coefficient of variation, which is the spread that survives a change of units. */
export function spread(values) {
  const v = values.filter(Number.isFinite);
  if (v.length < 3) return NaN;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  if (!(m > 0)) return NaN;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
  return sd / m;
}

/**
 * Past shots that are actually comparable with this one.
 *
 * Same coffee, same grinder, same grind setting, and a dose within half a gram.
 * Anything looser and the spread being measured is the spread of the user's
 * recipes rather than of their technique, which would turn the consistency
 * reading into noise dressed as a diagnosis.
 */
export function comparable(shot, history) {
  if (!shot) return [];
  const g = F(shot.grind_setting);
  const d = F(shot.dose_g);
  return (history ?? []).filter((r) => r
    && r.shot_id !== shot.shot_id
    && (!shot.bag_id || r.bag_id === shot.bag_id)
    && (!shot.grinder_id || r.grinder_id === shot.grinder_id)
    && (!Number.isFinite(g) || Math.abs(F(r.grind_setting) - g) < 1e-9)
    && (!Number.isFinite(d) || Math.abs(F(r.dose_g) - d) <= 0.5)
    && Number.isFinite(F(r.time_s)));
}

/**
 * Have the last two grind moves been finer, and has it not helped?
 *
 * "Not helped" is deliberately conservative: slower AND not better rated. A
 * slower shot that tasted better is the move working, and the point of the
 * check is to catch the case where someone is walking down the wrong side of
 * the extraction peak because the reflex says finer.
 */
export function finerAndWorse(shot, history) {
  const rows = (history ?? [])
    .filter((r) => r && (!shot?.bag_id || r.bag_id === shot.bag_id)
      && Number.isFinite(F(r.grind_setting)) && Number.isFinite(F(r.time_s)))
    .slice(-4);
  // Two past shots plus this one is three settings, which is the minimum that
  // can show a direction AND a consequence. Asking for three past shots wanted
  // four in total and quietly never fired.
  if (rows.length < 2 || !Number.isFinite(F(shot?.grind_setting))) return false;
  const seq = [...rows, shot];
  // `finer` is a smaller setting on most grinders, and kit.js records which way
  // round a given grinder runs; without that this stays a comparison of the
  // last three rather than an assumption about direction.
  const last3 = seq.slice(-3);
  const g = last3.map((r) => F(r.grind_setting));
  const ts = last3.map((r) => F(r.time_s));
  const ratings = last3.map((r) => F(r.rating));
  const wentFiner = g[1] < g[0] && g[2] < g[1];
  const gotSlower = ts[2] > ts[0];
  const notBetter = !(Number.isFinite(ratings[2]) && Number.isFinite(ratings[0])
    && ratings[2] > ratings[0]);
  return wentFiner && gotSlower && notBetter;
}

/**
 * "Four seconds faster" as a grind move, in the user's own units where they
 * are known.
 *
 * Wraps the physics in knowledge.js and adds the honesty the physics needs: it
 * is a first-order model that is known to under-predict, so it reports a range
 * rather than a number, and it refuses to give steps for a conical grinder,
 * where a single step size is geometrically wrong however it was obtained.
 */
export function grindAdvice({ nowSeconds, wantSeconds, grinderId = null }) {
  const spec = grinderId ? GRINDER_STEPS[grinderId] : null;
  const move = grindMove({
    nowSeconds, wantSeconds,
    micronsPerStep: spec && !spec.conical ? spec.microns : null,
  });
  if (!move) return null;
  const dir = move.direction;
  if (move.steps) {
    return { ...move, say: `About ${move.steps} ${move.steps === 1 ? 'step' : 'steps'} ${dir} — `
      + `but the model under-predicts, so try one and read it rather than jumping the whole way.` };
  }
  return { ...move, say: `Roughly ${move.atLeast}–${move.upTo} microns ${dir}`
    + (spec?.conical ? '. Your grinder is a conical, so there is no honest microns-per-click for '
      + 'it — the gap changes differently as you move along the cone.' : '.') };
}
