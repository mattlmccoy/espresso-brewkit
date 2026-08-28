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

/** What to actually do about a bag you are about to freeze, or just took out. */
export const FREEZER_ADVICE = [
  'Freeze in single-dose portions. Every thaw and refreeze pulls moisture onto the beans, so a '
    + 'bag opened repeatedly loses most of the benefit.',
  'Vacuum-seal or push the air out. Freezing slows oxidation; it does not remove the oxygen.',
  'Freeze it fresh. The freezer preserves whatever state you put in, so a bag frozen at day 4 '
    + 'comes out at roughly day 4 — but one frozen at day 40 comes out at day 40.',
  'Grinding straight from frozen is fine, and there is evidence it helps: colder beans fracture '
    + 'into a narrower particle size distribution (Uman et al., Scientific Reports, 2016). Let a '
    + 'sealed portion reach room temperature before opening it if you would rather avoid '
    + 'condensation.',
];
