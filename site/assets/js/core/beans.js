// How old the coffee actually is, and what that means.
//
// TWO CLOCKS, NOT ONE. Calendar days since roast is the number everyone quotes
// and it is wrong for anyone who freezes. Staling is chemistry — oxidation and
// volatile loss — and chemistry slows down when you make it cold. A bag roasted
// in January, frozen on day 5 and opened in June is not a five-month-old coffee;
// it is a five-day-old coffee that has been paused. So age accrues before the
// freezer and after it, and not during.
//
// Freezing slows staling; it does not stop it. Marin et al. (2008) found coffee
// sealed under <1% oxygen and frozen still lost volatiles over a year, and a
// 2024 study in Foods tracked the same effect across storage temperatures. The
// model here reflects that: frozen time is heavily discounted, not ignored.
//
// ONE WAY IN, ONE WAY OUT. The model above is a single freeze and a single
// thaw, and that is not a simplification — it is the protocol. Frozen beans are
// below the dew point, so the moment a portion is opened the air inside
// condenses onto it; put it back and that water freezes into the bean, and the
// next thaw brings more. Staling is hydrolytic as well as oxidative, so wet
// beans do not merely taste worse, they age faster. That is why the working
// method is to portion at the start and freeze the portions, not to freeze the
// bag and open it repeatedly: a 900 g purchase split into single-session
// portions of 130–150 g, vacuum-sealed and frozen on the same day, is six
// coffees each paused at day zero. Each portion comes out once. Nothing goes
// back. This module refuses to model a refreeze rather than pretending to,
// because a bag that has been round the loop three times has an age the
// calendar cannot recover.
//
// The rest windows below are roasting convention rather than a measured
// constant, and they vary by bean density and roast profile. What is not
// convention is the mechanism: roughly 40% of a bean's CO2 leaves in the first
// day and the rest over one to two weeks, and espresso is the brew method that
// cares most, because pressurised water meeting trapped gas is what channelling
// is made of. Darker roasts are more porous and degas faster; light roasts hold
// on longer.
//
// Sources:
//   Uman et al., "The effect of bean origin and temperature on grinding roasted
//     coffee", Scientific Reports 6:24483 (2016) — grinding cold narrows the
//     particle size distribution and lowers the mean.
//   SCA, "What is the Shelf Life of Roasted Coffee? A Literature Review on
//     Coffee Staling" (2012).
//   "Effect of Temperature and Storage on Coffee's Volatile Compound Profile
//     and Sensory Characteristics", Foods 13(24):3995 (2024).

export const ROAST_LEVELS = ['Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark'];

/** Days of rest before espresso stops fighting the CO2, by roast level. */
export const REST_WINDOW = {
  Light: [10, 14],
  'Medium-light': [8, 12],
  Medium: [7, 10],
  'Medium-dark': [5, 8],
  Dark: [4, 7],
};
const DEFAULT_REST = [7, 12];

/** Beyond this many days of accrued age, a bag is past its best. Convention. */
export const FADE_FROM = 28;
export const STALE_FROM = 45;

/**
 * Frozen time is not free, only cheap — and the discount is derived rather than
 * picked. Chemical reaction rates fall roughly by half per 10 °C (the Q10 rule,
 * a kinetics approximation, not a coffee measurement). A domestic freezer at
 * about −18 °C is some 38 °C below a kitchen, which is 3.8 of those steps:
 *
 *     2^-3.8 ≈ 1/14  →  about 0.07 days of staling per day frozen
 *
 * So a year in the freezer costs roughly a fortnight of shelf life, which is
 * the right order of magnitude for coffee that measurably but slowly loses
 * volatiles over a year of frozen storage.
 *
 * Vacuum sealing halves it again, because oxidation needs oxygen and the point
 * of pulling a vacuum is that there is much less of it left to react with. That
 * factor is a judgement, not a measurement, and it is stated as one.
 */
export const FREEZER_RATE = 0.07;
export const VACUUM_FACTOR = 0.5;

const day = (v) => {
  if (!v) return null;
  const t = Date.parse(`${String(v).slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(t) ? t : null;
};
const daysBetween = (a, b) => Math.max(0, Math.round((b - a) / 86400000));

/**
 * @returns {{calendar:number|null, effective:number|null, frozenDays:number,
 *            inFreezer:boolean, known:boolean}}
 */
export function beanAge(bag, at = new Date()) {
  const now = at instanceof Date ? at.getTime() : Date.parse(at);
  const roast = day(bag?.roast_date);
  if (roast === null || !Number.isFinite(now)) {
    return { known: false, calendar: null, effective: null, frozenDays: 0, inFreezer: false };
  }
  const calendar = daysBetween(roast, now);
  const frozen = day(bag?.frozen_at);
  const thawed = day(bag?.thawed_at);

  if (frozen === null) {
    return { known: true, calendar, effective: calendar, frozenDays: 0, inFreezer: false };
  }
  // Before the freezer, it aged normally.
  const beforeFreeze = daysBetween(roast, Math.min(frozen, now));
  const inFreezer = thawed === null || thawed > now;
  const frozenUntil = inFreezer ? now : thawed;
  const frozenDays = daysBetween(frozen, frozenUntil);
  const sinceThaw = inFreezer ? 0 : daysBetween(thawed, now);
  const rate = FREEZER_RATE * (bag?.vacuum_sealed ? VACUUM_FACTOR : 1);

  return {
    known: true,
    calendar,
    effective: Math.round(beforeFreeze + frozenDays * rate + sinceThaw),
    rate,
    frozenDays,
    inFreezer,
  };
}

/**
 * Where a bag is in the freezer cycle, and whether the freezer is still an
 * option for it.
 *
 * Three states, and only two legal moves: never → frozen → thawed. There is no
 * edge back. Offering one would be offering a mistake with a button, and the
 * age model behind it cannot represent the result anyway — `beanAge` carries a
 * single frozen interval, so a second freeze would silently overwrite the first
 * and report a bag as younger than it is.
 */
export function freezeState(bag, at = new Date()) {
  const now = at instanceof Date ? at.getTime() : Date.parse(at);
  const frozen = day(bag?.frozen_at);
  const thawed = day(bag?.thawed_at);
  if (frozen === null) {
    return { state: 'never', canFreeze: true, canThaw: false,
      note: 'Freeze it fresh and in single-session portions: the freezer preserves whatever state '
        + 'you put in, so day 4 keeps, and day 40 keeps too.' };
  }
  if (thawed === null || thawed > now) {
    return { state: 'frozen', canFreeze: false, canThaw: true, since: bag.frozen_at,
      note: 'Take it out once, and use it. Let a sealed portion reach room temperature before '
        + 'opening it, or the air inside will condense straight onto the beans.' };
  }
  return { state: 'thawed', canFreeze: false, canThaw: false, since: bag.thawed_at,
    note: REFREEZE_REFUSAL };
}

export const REFREEZE_REFUSAL =
  'This portion has already been out, so the freezer is finished with it. Frozen beans sit well '
  + 'below the dew point: opening them condenses water onto the beans, refreezing locks that water '
  + 'in, and each round trip adds more. Staling is hydrolytic as well as oxidative, so the result '
  + 'ages faster than the bag it came from — and its age stops being something a date can recover. '
  + 'Portion at the start instead, and bring out one portion at a time.';

/**
 * Was this shot ground from beans that were still frozen?
 *
 * Only the first shot off a portion is. The rest of that portion spends the
 * session on the counter, so "this bag was frozen once" is not the question —
 * "is this the first dose since it came out" is. It matters because cold beans
 * fracture differently: Uman et al. (2016) found lower bean temperature gives a
 * smaller mean particle size and a narrower distribution, which at a fixed dial
 * setting is a finer grind and a slower shot. Recording it is what keeps that
 * one shot from being read as the bag's resistance.
 */
export function fromFrozen(bag, priorShots = [], at = new Date()) {
  const thawed = day(bag?.thawed_at);
  if (thawed === null) return false;
  const now = at instanceof Date ? at.getTime() : Date.parse(at);
  if (!Number.isFinite(now) || now < thawed) return false;
  // Same day the portion came out, and nothing pulled from it since.
  if (daysBetween(thawed, now) > 0) return false;
  return !priorShots.some((s) => {
    if (s?.bag_id !== bag?.id) return false;
    const t = day(s.timestamp ?? s.at);
    return t !== null && t >= thawed;
  });
}

export const restWindow = (level) => REST_WINDOW[level] ?? DEFAULT_REST;

/**
 * What the age means for the next shot. Phases, not a score: "12 days" says
 * nothing on its own, and the same 12 days is early for a light roast and
 * squarely in the window for a dark one.
 */
export function freshness(bag, at = new Date()) {
  const age = beanAge(bag, at);
  if (!age.known) {
    return { phase: 'unknown', tone: '', label: 'No roast date',
      detail: 'Add a roast date and this becomes a rest window rather than a guess.', age };
  }
  const [restMin, restMax] = restWindow(bag?.roast_level);
  const d = age.effective;
  const frozenNote = age.inFreezer
    ? ` In the freezer since ${bag.frozen_at} — ageing is close to paused, so this counts `
      + `${d} days rather than ${age.calendar}.`
    : age.frozenDays
      ? ` ${age.frozenDays} of those days were frozen and count for little, which is why this `
        + `says ${d} days rather than ${age.calendar}.`
      : '';

  if (d < restMin) {
    return { phase: 'degassing', tone: 'warn', label: `${d} days — still degassing`, age,
      detail: `A ${(bag?.roast_level ?? 'medium').toLowerCase()} roast usually wants `
        + `${restMin}–${restMax} days. Roughly 40% of the CO2 leaves in the first day and the rest `
        + 'over one to two weeks, and espresso is the method that minds most: pressurised water '
        + 'meeting trapped gas is what channelling is made of.' + frozenNote,
      action: `Give it ${restMin - d} more day${restMin - d === 1 ? '' : 's'}, or expect fast, `
        + 'gassy, sour shots and grind finer than you otherwise would.' };
  }
  if (d <= restMax) {
    return { phase: 'opening', tone: 'ok', label: `${d} days — coming into its window`, age,
      detail: `Rested enough to pull. ${restMin}–${restMax} days is the usual window for this roast `
        + 'level, and the last of the CO2 is still leaving, so expect the dial to move a little day '
        + 'to day.' + frozenNote };
  }
  if (d <= FADE_FROM) {
    return { phase: 'peak', tone: 'ok', label: `${d} days off roast`, age,
      detail: 'Past degassing and not yet fading — the stretch where the grind should stay put '
        + 'from one day to the next.' + frozenNote };
  }
  if (d <= STALE_FROM) {
    return { phase: 'fading', tone: 'flag', label: `${d} days — fading`, age,
      detail: 'Aromatics are going. Expect it to taste flatter and, as the bean loses CO2 and takes '
        + 'on moisture, to run faster than it used to at the same setting.' + frozenNote,
      action: 'Grind a little finer to hold the shot time, and use it up.' };
  }
  return { phase: 'past', tone: 'warn', label: `${d} days — past it`, age,
    detail: 'Well beyond the month that roasted coffee generally holds its character for. Still '
      + 'safe, just no longer telling you much about the coffee — or about your dial.' + frozenNote,
    action: 'Worth replacing before drawing conclusions from these shots.' };
}

/** The protocol, in the order you actually do it. */
export const FREEZER_ADVICE = [
  'Portion before you freeze, not after. Split the purchase into single-session amounts — a '
    + 'week or so each — on the day it arrives. The portion, not the bag, is the unit that goes '
    + 'in and comes out.',
  'Vacuum-seal each portion. Freezing slows oxidation; it does not remove the oxygen, and a '
    + 'sealed portion is also what keeps freezer air off the beans.',
  'Freeze it fresh. The freezer preserves whatever state you put in, so a portion frozen at day 4 '
    + 'comes out at roughly day 4 — but one frozen at day 40 comes out at day 40.',
  'One portion out at a time, and never back in. Frozen beans are below the dew point, so opening '
    + 'a portion condenses water onto it; refreezing seals that water in, and staling is '
    + 'hydrolytic as well as oxidative. A portion that has been out is out.',
  'Let the sealed portion reach room temperature before you open it — that is what stops the '
    + 'condensation. Grinding the first dose straight from frozen is fine, and there is evidence '
    + 'it helps: colder beans fracture into a narrower particle size distribution (Uman et al., '
    + 'Scientific Reports, 2016). Expect that one shot to run slower than the rest of the portion.',
];
