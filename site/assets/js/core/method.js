// What you are making, and therefore what the session should ask you for.
//
// This app was espresso-shaped: dose, grind, brew, rate, with a portafilter
// hardcoded into the middle of it. That is one recipe for one drink, and the
// machinery underneath — a scale that tares itself when a vessel lands, a
// weight aimed at a target, a curve of weight against time — is not espresso
// machinery at all. It is brewing machinery. A pour over is the same three
// phases with a different vessel and a target ten times larger; a flat white is
// espresso with one more weighing after it.
//
// So the step order, the vessel names, the targets and the vocabulary move out
// here as data, and the session machine reads them. Adding a method is adding a
// row, not adding a branch.

/** Every step any method can contain. Order within a method is the method's. */
export const STEP = {
  SETUP: 'setup',
  DOSE: 'dose',
  GRIND: 'grind',
  BREW: 'brew',
  MILK: 'milk',
  RATE: 'rate',
};

/**
 * A weighing step: fetch a vessel, fill it, take it away.
 *
 * `key`        where the committed weight is stored on the session
 * `vessel`     what to ask for, by name — this is the whole reason the prompt
 *              can say "put the portafilter on" rather than a generic sentence
 * `next`       what comes after, in words, for the "lift it off to move on" line
 * `targetFrom` a field to aim at instead of the session target, because grounds
 *              are aimed at the dose you actually weighed rather than at the
 *              dial setting you meant to hit
 * `fill`       the verb for the middle phase
 */
const ESPRESSO_WEIGH = {
  dose: { key: 'dose', vessel: 'dosing cup', next: 'the grind', fill: 'Dose your beans' },
  grind: { key: 'grounds', vessel: 'portafilter', next: 'brewing',
           targetFrom: 'dose', fill: 'Grind into it' },
};

export const METHODS = {
  espresso: {
    id: 'espresso',
    label: 'Espresso',
    blurb: 'Beans, grounds, and a shot pulled against a yield target.',
    order: [STEP.SETUP, STEP.DOSE, STEP.GRIND, STEP.BREW, STEP.RATE],
    weigh: ESPRESSO_WEIGH,
    // What the brew step is measuring. Espresso weighs what comes out of the
    // machine; a pour over weighs what you put into it. Same rising number, and
    // the difference matters to every label around it.
    brew: {
      label: 'Brew', measures: 'out', noun: 'yield', unit: 'g',
      hint: 'Lock in and put your cup on the scale. It will tare and time itself.',
    },
    defaults: { dose: 18, ratio: 2, timeS: 28 },
    ratioLabel: '1:X, yield over dose',
    // The band a healthy shot spends most of its time in, and the top of the
    // bar. A number tells you the flow rate; a bar tells you whether it is the
    // flow rate you wanted, which is the question you actually have.
    flow: { max: 3.2, good: [1.1, 2.2] },
    diagnose: true,
  },

  pourover: {
    id: 'pourover',
    label: 'Pour over',
    blurb: 'Beans, then water poured to a target over a few minutes.',
    // No portafilter, so no second weighing: you grind and it goes straight
    // into the filter. What gets weighed instead is the water.
    order: [STEP.SETUP, STEP.DOSE, STEP.BREW, STEP.RATE],
    weigh: {
      dose: { key: 'dose', vessel: 'dosing cup', next: 'brewing', fill: 'Dose your beans' },
    },
    brew: {
      label: 'Pour', measures: 'in', noun: 'water', unit: 'g',
      hint: 'Brewer and filter on the scale. It tares, then follows the water in.',
    },
    defaults: { dose: 22, ratio: 16, timeS: 180 },
    ratioLabel: '1:X, water over coffee',
    // A pour is poured in bursts an order of magnitude faster than espresso
    // flows, so the same bar with espresso's scale would sit pinned at full.
    flow: { max: 10, good: [3, 7] },
    // Channelling, a fast puck, a slow puck: all of it is espresso physics
    // read off an espresso curve. A pour over curve means different things and
    // deserves its own reading rather than a wrong one.
    diagnose: false,
  },

  milk: {
    id: 'milk',
    label: 'Milk drink',
    blurb: 'A shot, then milk weighed to the cup.',
    order: [STEP.SETUP, STEP.DOSE, STEP.GRIND, STEP.BREW, STEP.MILK, STEP.RATE],
    weigh: {
      ...ESPRESSO_WEIGH,
      grind: { ...ESPRESSO_WEIGH.grind, next: 'brewing' },
      milk: { key: 'milk', vessel: 'milk jug', next: 'rating',
              fill: 'Pour your milk in', target: 200 },
    },
    brew: {
      label: 'Brew', measures: 'out', noun: 'yield', unit: 'g',
      hint: 'Lock in and put your cup on the scale. It will tare and time itself.',
    },
    defaults: { dose: 18, ratio: 2, timeS: 28, milk: 200 },
    ratioLabel: '1:X, yield over dose',
    flow: { max: 3.2, good: [1.1, 2.2] },
    diagnose: true,
  },
};

/** The order the method picker and the hold gesture cycle through. */
export const METHOD_ORDER = ['espresso', 'pourover', 'milk'];

export const methodOf = (id) => METHODS[id] ?? METHODS.espresso;

/** The next method in the cycle — what a press-and-hold on the scale does. */
export function nextMethod(id) {
  const i = METHOD_ORDER.indexOf(methodOf(id).id);
  return METHODS[METHOD_ORDER[(i + 1) % METHOD_ORDER.length]];
}

/** Step labels, which are mostly but not entirely shared between methods. */
export function stepLabel(method, step) {
  const m = methodOf(method);
  if (step === STEP.BREW) return m.brew.label;
  return { setup: 'Setup', dose: 'Dose', grind: 'Grind', milk: 'Milk', rate: 'Rate' }[step] ?? step;
}

/** The two-digit number beside each step, which depends on the method's order. */
export function stepNumber(method, step) {
  const i = methodOf(method).order.indexOf(step);
  return i < 0 ? '--' : String(i).padStart(2, '0');
}

export const STEP_HINT = {
  setup: 'Choose your coffee and grinder first — a shot records what it was made with.',
  dose: 'Put your beans on the scale. Tare a dosing cup first if you use one.',
  grind: 'Grind into the portafilter and set it on the scale.',
  milk: 'Put your milk jug on the scale and pour to the target.',
  rate: 'How was it?',
};

/** The whole-step instruction, for a step that is not one of the weighings. */
export function stepHint(method, step) {
  if (step === STEP.BREW) return methodOf(method).brew.hint;
  return STEP_HINT[step] ?? '';
}

/**
 * What the brew step is aiming at.
 *
 * Espresso multiplies the dose by the ratio to get a yield in the cup. A pour
 * over multiplies it by a much larger ratio to get water in the brewer. Same
 * arithmetic, opposite side of the coffee, and the label has to say which.
 */
export function brewTarget(method, dose, ratio) {
  const m = methodOf(method);
  const d = Number(dose);
  const r = Number(ratio);
  if (!Number.isFinite(d) || !Number.isFinite(r) || d <= 0 || r <= 0) return NaN;
  return +(d * r).toFixed(1);
}


/* -------------------------------------------------------------- flow rate */

/**
 * Flow as a position on a bar, not just a number.
 *
 * This is the one thing every expensive scale draws that this app only printed
 * as digits, and the reason they all draw it is that "1.87" is a fact while a
 * bar two thirds of the way along a marked band is an answer. Read from across
 * a kitchen, only one of those works.
 */
export function flowBar(method, flow) {
  const f = methodOf(method).flow ?? { max: 3.2, good: [1.1, 2.2] };
  if (!Number.isFinite(flow) || flow < 0) return null;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const [lo, hi] = f.good;
  return {
    frac: clamp(flow / f.max),
    lo: clamp(lo / f.max),
    hi: clamp(hi / f.max),
    max: f.max,
    state: flow < lo ? 'low' : flow > hi ? 'high' : 'good',
  };
}
