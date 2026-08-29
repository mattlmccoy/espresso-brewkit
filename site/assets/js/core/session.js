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
// THREE WAYS FORWARD, AND THE SCREEN SAYS WHICH. Lifting the vessel is the
// cleanest signal there is, but it is invisible: a first user doses 18 g,
// watches the number sit there, and has no idea the app is waiting for them to
// pick the cup up. So the reading is also committed by simply holding still —
// a dose that has not moved in `holdFor` seconds is finished, whatever the cup
// is doing — and by a button, for anyone who would rather say so. The hold runs
// a visible countdown, because an automatic capture the user cannot see coming
// is the same mistake as the auto-tare: correct, and alarming.
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
  SETUP: 'setup',
  DOSE: 'dose',
  GRIND: 'grind',
  BREW: 'brew',
  RATE: 'rate',
};

export const STEP_ORDER = [STEP.SETUP, STEP.DOSE, STEP.GRIND, STEP.BREW, STEP.RATE];

export const STEP_HINT = {
  setup: 'Choose your coffee and grinder first — a shot records what it was made with.',
  dose: 'Put your beans on the scale. Tare a dosing cup first if you use one.',
  grind: 'Grind into the portafilter and set it on the scale.',
  brew: 'Lock in and put your cup on the scale. It will tare and time itself.',
  rate: 'How was it?',
};

/**
 * Each weighing step is three phases, because that is how the job is actually
 * done: fetch a container, fill it, take it away. Naming them is what lets the
 * screen say "put the portafilter on" instead of "grind into the portafilter
 * and set it on the scale" — an instruction for the whole step, given while you
 * are in the middle of one part of it.
 */
export const PHASE = { VESSEL: 'vessel', FILL: 'fill', READY: 'ready' };

export const VESSEL_NAME = { dose: 'dosing cup', grind: 'portafilter' };
const NEXT_NAME = { dose: 'the grind', grind: 'brewing' };

/**
 * How far off a target still counts as hitting it. A fraction, with a floor so
 * an 8 g single is not held to a tighter absolute window than an 18 g double.
 */
export function tolerance(target, { nearFrac = 0.12, nearMin = 1.5 } = {}) {
  return Math.max(nearMin, target * nearFrac);
}

/**
 * The dose as a bar: where you are, where you are aiming, and how much of a
 * miss still counts.
 *
 * The window is drawn as a region rather than the target as a line, because
 * that is what it is — landing anywhere in it ends the step. A line invites
 * chasing a number that the grinder cannot hit on purpose anyway.
 *
 * The scale runs past the window so an overshoot has somewhere to go. A bar
 * pinned at full tells you that you are over but not by how much, which is the
 * one thing you want to know when you have gone past.
 */
export function fillProgress(net, target, tol = tolerance(target)) {
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(net)) return null;
  const max = Math.max(target * 1.3, target + tol * 1.5);
  const delta = +(net - target).toFixed(2);
  return {
    frac: Math.max(0, Math.min(1, net / max)),
    lo: Math.max(0, (target - tol) / max),
    hi: Math.min(1, (target + tol) / max),
    mark: target / max,
    delta,
    over: net > target + tol,
    state: Math.abs(delta) <= tol ? 'in' : delta > 0 ? 'over' : 'under',
  };
}

/** The line under the step name: one instruction, for right now. */
export function prompt(s) {
  if (s.step !== STEP.DOSE && s.step !== STEP.GRIND) return STEP_HINT[s.step];
  const vessel = VESSEL_NAME[s.step];
  if (s.phase === PHASE.VESSEL) {
    return `Put your ${vessel} on the scale — it tares itself once it settles.`;
  }
  if (s.phase === PHASE.FILL) {
    const to = Number.isFinite(s.target) && s.target > 0 ? ` to ${s.target.toFixed(1)} g` : '';
    return s.step === STEP.DOSE
      ? `Tared. Dose your beans${to}.`
      : `Tared. Grind into it${to}.`;
  }
  const g = Number.isFinite(s.candidate) ? `${s.candidate.toFixed(1)} g` : 'That';
  return `${g} — lift the ${vessel} off to move on to ${NEXT_NAME[s.step]}.`;
}

export class SessionMachine {
  /**
   * @param minMass  below this a settled reading is noise or an empty vessel
   * @param maxMass  above this it is a vessel, not a dose. A triple is ~25 g, so
   *                 45 g is well clear of any real dose while still excluding a
   *                 dosing cup someone forgot to tare — better to record nothing
   *                 and say so than to record the cup as coffee
   * @param dropG    fall in RAW weight that means the thing left the platform
   * @param settleFor seconds a reading must hold before it counts as a plateau
   * @param holdFor  seconds an unchanged plateau is committed after, with no
   *                 vessel lifted. Long enough that a slow pour cannot reach it
   *                 without pausing, short enough not to feel stuck. Any change
   *                 over 0.3 g restarts it, so adding more never trips it
   */
  constructor({ minMass = 1, maxMass = 45, dropG = 3, settleFor = 0.6, holdFor = 5,
                vesselMin = 20, vesselFor = 0.5, vesselBand = 1.0, vesselWithin = 2,
                nearFrac = 0.12, nearMin = 1.5 } = {}) {
    this.o = { minMass, maxMass, dropG, settleFor, holdFor,
               // A dosing cup is ~50 g and a portafilter ~470 g; the heaviest
               // dose anyone pulls is under 30. Twenty grams sits between them
               // with room on both sides.
               vesselMin, vesselFor, vesselBand,
               // Seconds from an empty platform to a still reading, under which
               // the weight was put there rather than poured there.
               vesselWithin,
               // "Near enough to your target to call it done." A fraction, with
               // a floor so an 8 g single is not held to ±1 g.
               nearFrac, nearMin };
    this.target = 18;
    this.reset();
  }

  /** The dose you are aiming for, which is what makes "done" knowable. */
  setTarget(g) {
    this.target = Number.isFinite(g) && g > 0 ? g : NaN;
  }

  /**
   * Grounds are aimed at the dose that was actually weighed, not at the dial
   * setting — you ground 18.2 g of beans, so 18.2 g is what should come out,
   * less whatever the grinder keeps.
   */
  targetFor() {
    if (this.step === STEP.GRIND && Number.isFinite(this.dose)) return this.dose;
    return this.target;
  }

  /** How far off the target still counts as hitting it. */
  tolerance(target = this.targetFor()) {
    return tolerance(target, this.o);
  }

  nearTarget(net) {
    const tgt = this.targetFor();
    if (!Number.isFinite(tgt) || tgt <= 0) return false;
    return Math.abs(net - tgt) <= this.tolerance(tgt);
  }

  reset() {
    this.step = STEP.SETUP;
    this.ready = false;
    this.phase = PHASE.VESSEL;
    this.dose = null;
    this.grounds = null;
    this.candidate = null;      // the settled reading we would commit right now
    this.auto = { dose: false, grounds: false };  // was it captured, or typed?
    this._lastRaw = null;
    this._settledSince = null;
    this._settledAt = null;
    // A vessel only counts once the platform has been seen empty. Without this,
    // the cup still standing there from the last step would be tared as the
    // next step's portafilter.
    this._sawEmpty = false;
    this._needTare = false;
    this._roseAt = null;
    this._recent = [];
    this._t = 0;
    this.holdLeft = null;       // seconds until an unattended capture, or null
    this.events = [];
  }

  /**
   * Setup is a step like any other; it advances on a choice rather than on a
   * weight. Making it a step is the point: a panel of selects sitting quietly
   * beside the flow is not something a first user knows to fill in, and a shot
   * that does not know its coffee is a shot no model can use afterwards.
   */
  setReady(ready) {
    this.ready = !!ready;
    if (this.ready && this.step === STEP.SETUP) {
      this.step = STEP.DOSE;
      // Nothing preceded this step, so whatever is on the scale is the cup you
      // meant to put there.
      this._enterVessel(true);
      this._log(this._t, 'Coffee and grinder chosen.');
      return STEP.DOSE;
    }
    return null;
  }

  /** Jump to a step by hand. Automation continues from wherever you land. */
  goto(step) {
    if (!STEP_ORDER.includes(step)) return;
    this.step = step;
    this.candidate = null;
    this._enterVessel(true);
  }

  /**
   * Back to looking for a container, with the software tare cleared.
   *
   * `sawEmpty` is whether the platform can be trusted as it stands. After an
   * automatic advance it cannot: the cup that ended the last step may still be
   * sitting there, and taring it as the next step's portafilter would be
   * exactly the auto-tare bug again. A jump made by hand is different — someone
   * clicking "Grind" with the portafilter already on the scale means it.
   */
  _enterVessel(sawEmpty = false) {
    this.phase = PHASE.VESSEL;
    this._sawEmpty = sawEmpty;
    this._needTare = true;
    this._restartPlateau();
  }

  /**
   * Has the raw reading stopped moving? Independent of the flow estimator,
   * which is answering a different question and answers it slowly after a step.
   */
  _stableRaw(t, raw, seconds, band) {
    this._recent.push([t, raw]);
    while (this._recent.length && t - this._recent[0][0] > seconds) this._recent.shift();
    if (this._recent.length < 3 || t - this._recent[0][0] < seconds * 0.8) return false;
    const vals = this._recent.map((r) => r[1]);
    return Math.max(...vals) - Math.min(...vals) < band;
  }

  /**
   * One plateau tracker, pointed at whatever the current phase cares about:
   * the raw weight while looking for a vessel, the tared weight while filling.
   * Two trackers would be two things to keep in step for no gain.
   */
  _plateau(t, v, settled, band, need) {
    if (!settled) { this._settledAt = null; this._settledSince = null; return false; }
    if (this._settledAt === null || Math.abs(v - this._settledAt) > band) {
      this._settledAt = v;
      this._settledSince = t;
      return false;
    }
    return t - this._settledSince >= need;
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
    const out = { committed: null, advancedTo: null, tareTo: null };
    const prevRaw = this._lastRaw;
    this._lastRaw = raw;
    this._t = t;
    if (prevRaw === null) return out;

    const weighing = this.step === STEP.DOSE || this.step === STEP.GRIND;
    if (!weighing) { this.holdLeft = null; return out; }

    // Asked for by goto() or by a commit: clear the software tare so the next
    // vessel is measured from the platform rather than from the last one.
    if (this._needTare) { this._needTare = false; out.tareTo = 0; }

    // Anything light enough is "nothing on the scale", which is what re-arms
    // vessel detection.
    if (raw < this.o.vesselMin) this._sawEmpty = true;

    // When the reading last left an empty platform. A cup is *placed* — it goes
    // from nothing to its full weight in one movement — while a dose is poured,
    // and climbs over seconds. That difference is the only thing separating a
    // 30 g cup from a 30 g dose on a scale someone tared themselves.
    if (raw < this.o.minMass) this._roseAt = null;
    else if (this._roseAt === null) this._roseAt = t;

    if (this.phase === PHASE.VESSEL) {
      // Stillness is judged from the raw stream rather than from the flow
      // estimator's `settled`, which is about whether coffee is running and
      // stays false for a second or two after any large step. A cup that has
      // landed is still immediately, and should be tared immediately.
      if (!this._stableRaw(t, raw, this.o.vesselFor, this.o.vesselBand)) return out;

      // Heavier than any dose, or light enough to be one but placed in a single
      // movement: either way, a container.
      const placed = this._roseAt !== null && t - this._roseAt <= this.o.vesselWithin;
      if (this._sawEmpty && raw >= this.o.vesselMin && (raw > this.o.maxMass || placed)) {
        out.tareTo = +raw.toFixed(2);
        this.phase = PHASE.FILL;
        this._restartPlateau();
        this._log(t, `Tared the ${VESSEL_NAME[this.step]} at ${raw.toFixed(1)} g.`);
        return out;
      }
      // Still, and at a weight a dose could be: beans straight onto a scale you
      // tared yourself. There is no vessel coming, and waiting for one would
      // strand the flow on a step already finished.
      if (net >= this.o.minMass && net <= this.o.maxMass) {
        this.phase = PHASE.FILL;
        this._restartPlateau();
      } else {
        return out;
      }
    }

    const plausible = net >= this.o.minMass && net <= this.o.maxMass;
    if (settled && plausible) {
      if (this._plateau(t, net, settled, 0.3, this.o.settleFor)) {
        this.candidate = +net.toFixed(2);
        if (this.nearTarget(net)) {
          // It knows you are done, so it says so and waits. Running a clock at
          // someone who has been told exactly what to do next is just noise.
          this.phase = PHASE.READY;
          this.holdLeft = null;
        } else {
          // No target, or nowhere near it: the app cannot tell finished from
          // paused, so the countdown is the fallback it had before.
          const held = t - this._settledSince;
          this.holdLeft = Math.max(0, +(this.o.holdFor - held).toFixed(1));
          if (held >= this.o.holdFor) return this._commit(t, 'after holding still', out);
        }
      }
    } else if (!plausible) {
      this._restartPlateau();
      // Emptied back out below a dose: still filling, not finished.
      if (this.phase === PHASE.READY && net < this.o.minMass) this.phase = PHASE.FILL;
    }

    // Raw falling away is the thing leaving the platform — never a tare, which
    // leaves raw exactly where it was.
    if (prevRaw - raw > this.o.dropG) {
      if (this.candidate !== null) {
        return this._commit(t, `when the ${VESSEL_NAME[this.step]} came off`, out);
      }
      // A drop with no candidate is a tare, or a vessel going on and off. It is
      // not the end of a step, and advancing on it would skip the weighing the
      // user is still in the middle of.
      this._clearCandidate();
    }
    return out;
  }

  _restartPlateau() {
    this._settledAt = null;
    this._settledSince = null;
    this.holdLeft = null;
  }

  /** Nothing on the platform is a dose any more, candidate included. */
  _clearCandidate() {
    this.candidate = null;
    this._restartPlateau();
  }

  /**
   * Take the candidate and move on. Called three ways — the vessel lifted, the
   * reading holding still, or the button — because the signal differs but what
   * happens next does not.
   */
  _commit(t, why, out = { committed: null, advancedTo: null, tareTo: null }) {
    if (this.candidate === null) return out;
    if (this.step === STEP.DOSE) {
      this.dose = this.candidate;
      this.auto.dose = true;
      out.committed = 'dose';
      this._log(t, `Dose ${this.dose} g captured ${why}.`);
      this.step = STEP.GRIND;
    } else if (this.step === STEP.GRIND) {
      this.grounds = this.candidate;
      this.auto.grounds = true;
      out.committed = 'grounds';
      this._log(t, `Grounds ${this.grounds} g captured ${why}.`);
      this.step = STEP.BREW;
    } else {
      return out;
    }
    out.advancedTo = this.step;
    this._clearCandidate();
    // The next step starts by looking for its own container, from a platform
    // this one has not seen empty yet.
    this._enterVessel();
    if (out.tareTo === null) out.tareTo = 0;
    this._needTare = false;
    return out;
  }

  /** The same capture, asked for by hand rather than waited for. */
  commit() {
    return this._commit(this._t, 'because you said so');
  }

  /** Retention, once both ends are known. */
  get retention() {
    return Number.isFinite(this.dose) && Number.isFinite(this.grounds)
      ? +(this.dose - this.grounds).toFixed(2) : null;
  }

  snapshot() {
    return {
      step: this.step,
      phase: this.phase,
      vessel: VESSEL_NAME[this.step] ?? null,
      target: this.targetFor(),
      hint: prompt({ step: this.step, phase: this.phase, candidate: this.candidate,
                     target: this.targetFor() }),
      dose: this.dose,
      grounds: this.grounds,
      candidate: this.candidate,
      holdLeft: this.candidate === null ? null : this.holdLeft,
      retention: this.retention,
      auto: { ...this.auto },
      events: this.events.slice(-6).reverse(),
    };
  }
}
