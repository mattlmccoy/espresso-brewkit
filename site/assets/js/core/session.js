// The session, driven by the scale rather than by clicking.
//
// Everything needed to step through dose → grind → brew is already in the weight
// stream. What makes it readable is not clever event detection — a scale-side
// tare and a lifted vessel both just drop the reported number, and nothing in
// the stream tells them apart. It is that **a vessel is not dose-sized**:
//
//     dosing cup on      52 g    too heavy to be a dose  → ignored
//     press tare          0 g    a drop, but nothing was ever a candidate → ignored
//     beans in         18.2 g    plausible               → candidate
//     lift cup off      -52 g    a drop, with a candidate → COMMIT 18.2 g
//     portafilter on   469 g     too heavy               → ignored
//     press tare          0 g    ignored
//     grind into it    17.9 g    plausible               → candidate
//     carry to machine -521 g    → COMMIT 17.9 g
//
// So the rule is: remember the last settled reading that could plausibly be
// coffee, and commit it when the weight falls away. A drop with no candidate
// behind it is a vessel being taken off or a tare being pressed, and it means
// nothing — which is exactly why the machine must sit still through it rather
// than advancing.
//
// The upper bound is doing the real work. A triple is about 25 g, so anything
// past 45 g is a container, and containers are the only thing that could
// otherwise be mistaken for coffee.
//
// One thing this cannot do: if you dose into an untared cup, brewkit only ever
// sees cup-plus-beans, which is not dose-sized, so nothing is captured. It says
// so rather than recording the cup as coffee.
//
// Nothing here is silent. Every captured value is displayed and editable, and
// every step stays reachable by hand — the auto-tare bug was not caused by
// automation, it was caused by automation you could not see.

export const STEP = {
  DOSE: 'dose',
  GRIND: 'grind',
  BREW: 'brew',
  RATE: 'rate',
};

export const STEP_ORDER = [STEP.DOSE, STEP.GRIND, STEP.BREW, STEP.RATE];

export const STEP_HINT = {
  dose: 'Put your beans on the scale. Tare a dosing cup first if you use one.',
  grind: 'Grind into the portafilter and set it on the scale.',
  brew: 'Lock in and put your cup on the scale. It will tare and time itself.',
  rate: 'How was it?',
};

export class SessionMachine {
  /**
   * @param minMass  below this a settled reading is noise or an empty vessel
   * @param maxMass  above this it is a vessel, not a dose. A triple is ~25 g, so
   *                 45 g is well clear of any real dose while still excluding a
   *                 dosing cup someone forgot to tare — better to record nothing
   *                 and say so than to record the cup as coffee
   * @param dropG    fall in RAW weight that means the thing left the platform
   * @param settleFor seconds a reading must hold before it counts as a plateau
   */
  constructor({ minMass = 1, maxMass = 45, dropG = 3, settleFor = 0.6 } = {}) {
    this.o = { minMass, maxMass, dropG, settleFor };
    this.reset();
  }

  reset() {
    this.step = STEP.DOSE;
    this.dose = null;
    this.grounds = null;
    this.candidate = null;      // the settled reading we would commit right now
    this.auto = { dose: false, grounds: false };  // was it captured, or typed?
    this._lastRaw = null;
    this._settledSince = null;
    this._settledAt = null;
    this.events = [];
  }

  /** Jump to a step by hand. Automation continues from wherever you land. */
  goto(step) {
    if (!STEP_ORDER.includes(step)) return;
    this.step = step;
    this.candidate = null;
    this._settledSince = null;
  }

  /** Record what the machine decided, so the UI can explain itself. */
  _log(t, text) {
    this.events.push({ t, text });
    if (this.events.length > 40) this.events.shift();
  }

  set(field, value) {
    if (field === 'dose') { this.dose = value; this.auto.dose = false; }
    if (field === 'grounds') { this.grounds = value; this.auto.grounds = false; }
  }

  /**
   * @param t        seconds
   * @param raw      untared weight as the scale reports it
   * @param net      weight after any tare, which is what the user sees
   * @param settled  the estimator's view of whether the reading has stopped moving
   * @returns {{committed: string|null, advancedTo: string|null}}
   */
  step_(t, raw, net, settled) {
    const out = { committed: null, advancedTo: null };
    const prevRaw = this._lastRaw;
    this._lastRaw = raw;
    if (prevRaw === null) return out;

    const weighing = this.step === STEP.DOSE || this.step === STEP.GRIND;
    if (!weighing) return out;

    // A plateau: settled, held, and in a range a dose could actually occupy.
    const plausible = net >= this.o.minMass && net <= this.o.maxMass;
    if (settled && plausible) {
      if (this._settledAt === null || Math.abs(net - this._settledAt) > 0.3) {
        this._settledAt = net;
        this._settledSince = t;
      } else if (t - this._settledSince >= this.o.settleFor) {
        this.candidate = +net.toFixed(2);
      }
    } else if (!plausible) {
      this._settledAt = null;
      this._settledSince = null;
    }

    // Raw falling away is the thing leaving the platform — never a tare, which
    // leaves raw exactly where it was.
    if (prevRaw - raw > this.o.dropG) {
      if (this.candidate !== null) {
        if (this.step === STEP.DOSE) {
          this.dose = this.candidate;
          this.auto.dose = true;
          out.committed = 'dose';
          this._log(t, `Dose ${this.dose} g captured when the cup came off.`);
          this.step = STEP.GRIND;
        } else {
          this.grounds = this.candidate;
          this.auto.grounds = true;
          out.committed = 'grounds';
          this._log(t, `Grounds ${this.grounds} g captured when the portafilter came off.`);
          this.step = STEP.BREW;
        }
        out.advancedTo = this.step;
      }
      // A drop with no candidate is a tare, or a vessel going on and off. It is
      // not the end of a step, and advancing on it would skip the weighing the
      // user is still in the middle of.
      this.candidate = null;
      this._settledAt = null;
      this._settledSince = null;
    }
    return out;
  }

  /** Retention, once both ends are known. */
  get retention() {
    return Number.isFinite(this.dose) && Number.isFinite(this.grounds)
      ? +(this.dose - this.grounds).toFixed(2) : null;
  }

  snapshot() {
    return {
      step: this.step,
      hint: STEP_HINT[this.step],
      dose: this.dose,
      grounds: this.grounds,
      candidate: this.candidate,
      retention: this.retention,
      auto: { ...this.auto },
      events: this.events.slice(-6).reverse(),
    };
  }
}
