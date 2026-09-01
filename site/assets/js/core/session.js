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

// The steps, the orders and the vessel names live in method.js: what the
// session asks you for depends on what you are making, and a machine with an
// espresso-shaped step list baked into it can only ever make espresso.
export { STEP, STEP_HINT } from './method.js';
import { STEP, METHODS, methodOf, stepHint } from './method.js';

/** Espresso's order, for the callers that predate methods. */
export const STEP_ORDER = METHODS.espresso.order;

/**
 * Each weighing step is three phases, because that is how the job is actually
 * done: fetch a container, fill it, take it away. Naming them is what lets the
 * screen say "put the portafilter on" instead of "grind into the portafilter
 * and set it on the scale" — an instruction for the whole step, given while you
 * are in the middle of one part of it.
 */
export const PHASE = { VESSEL: 'vessel', FILL: 'fill', READY: 'ready' };

/** Espresso's vessels, for the callers that predate methods. */
export const VESSEL_NAME = Object.fromEntries(
  Object.entries(METHODS.espresso.weigh).map(([k, v]) => [k, v.vessel]));

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
export function prompt(s, method = 'espresso') {
  const m = methodOf(method);
  const w = m.weigh[s.step];
  if (!w) return stepHint(m.id, s.step);
  if (s.disturbed) {
    return 'Hand on the scale — nothing is being captured. Take your time; the reading picks '
      + 'up again when you let go.';
  }
  if (s.phase === PHASE.VESSEL) {
    return `Put your ${w.vessel} on the scale — it tares itself once it settles.`;
  }
  // Settled, and nowhere near what was asked for. Saying "dose your beans"
  // here would be the app keeping its doubts to itself: it has a reading, it
  // has decided not to act on it, and the only person who can resolve that is
  // holding the cup.
  if (Number.isFinite(s.offTarget) && s.offTarget !== 0 && Number.isFinite(s.candidate)) {
    const off = Math.abs(s.offTarget).toFixed(1);
    return `${s.candidate.toFixed(1)} g — ${off} g ${s.offTarget < 0 ? 'under' : 'over'} your `
      + `target, so nothing is being captured on its own. Keep going, or lift the `
      + `${w.vessel} off to use it anyway.`;
  }
  // A clock is running and the panel below is showing it tick. Saying "dose
  // your beans" over the top of that is the app telling you two things at once.
  if (Number.isFinite(s.holdLeft) && Number.isFinite(s.candidate)) {
    return `${s.candidate.toFixed(1)} g — capturing that in ${Math.ceil(s.holdLeft)} s. `
      + `Keep going to change it, or lift the ${w.vessel} off now.`;
  }
  if (s.phase === PHASE.FILL) {
    const to = Number.isFinite(s.target) && s.target > 0 ? ` to ${s.target.toFixed(1)} g` : '';
    return `Tared. ${w.fill}${to}.`;
  }
  const g = Number.isFinite(s.candidate) ? `${s.candidate.toFixed(1)} g` : 'That';
  return `${g} — lift the ${w.vessel} off to move on to ${w.next}.`;
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
  constructor({ method = 'espresso',
                minMass = 1, maxMass = 45, dropG = 3, liftFor = 0.25, settleFor = 0.6, holdFor = 5,
                vesselMin = 20, vesselFor = 0.5, vesselBand = 1.0, vesselWithin = 2,
                nearFrac = 0.12, nearMin = 1.5 } = {}) {
    this.o = { minMass, maxMass, dropG,
               // How long the platform has to stay down before a fall counts as
               // a lift rather than a tap or a knock. Two or three frames.
               liftFor,
               settleFor, holdFor,
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
    this.m = methodOf(method);
    this.target = this.m.defaults.dose;
    this.reset();
  }

  /** What is being made. Everything the machine asks for follows from this. */
  get method() { return this.m.id; }

  /**
   * Switch method mid-session.
   *
   * Deliberately keeps what has already been weighed. Realising halfway through
   * that this is going to be a flat white does not un-weigh the beans, and
   * throwing away a dose because the drink changed would make the control
   * unusable — which matters, because it is reachable from the scale itself.
   */
  setMethod(id) {
    const next = methodOf(id);
    if (next.id === this.m.id) return this.m;
    const prev = this.m;
    this.m = next;
    if (!Number.isFinite(this.target) || this.target <= 0) this.target = next.defaults.dose;
    // The current step may not exist in the new method — a pour over has no
    // grind step. Land on the next thing you would have done anyway that the
    // new method also does: walk forward through the OLD order until a step
    // both methods share. Anything cleverer risks going backwards over work
    // already finished, which matters because this is reachable from the scale
    // and an accidental switch should never cost a weighing.
    if (!next.order.includes(this.step)) {
      const was = prev.order;
      const from = was.indexOf(this.step);
      this.step = was.slice(from + 1).find((x) => next.order.includes(x))
        ?? next.order[next.order.length - 1];
      this._enterVessel(true);
    }
    this._log(this._t, `Brew method: ${next.label}.`);
    return next;
  }

  /** The weighing config for a step, or null if that step is not a weighing. */
  weighFor(step = this.step) { return this.m.weigh[step] ?? null; }

  /**
   * Is there a capture undo() could take back from here?
   *
   * The exact question undo() answers, without doing it: walk back through the
   * order for the nearest earlier step whose weigh key holds a real number. The
   * phone uses this to know whether to offer its Undo — the laptop can see the
   * captured numbers on screen, the phone only sees what the frame carries.
   */
  canUndo() {
    const order = this.m.order;
    const here = order.indexOf(this.step);
    for (let i = here; i > 0; i--) {
      const w = this.m.weigh[order[i - 1]];
      if (w && Number.isFinite(this[w.key])) return true;
    }
    return false;
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
    const w = this.weighFor();
    if (!w) return this.target;
    // Grounds are aimed at the dose that was actually weighed, not at the dial
    // setting — you ground 18.2 g of beans, so 18.2 g is what should come out.
    if (w.targetFrom && Number.isFinite(this[w.targetFrom])) return this[w.targetFrom];
    // A milk target is its own number, not a fraction of the coffee.
    if (Number.isFinite(w.target)) return this.targets?.[this.step] ?? w.target;
    return this.target;
  }

  /** Override the target for one step — milk, mostly, where 200 g is a guess. */
  setStepTarget(step, g) {
    this.targets = { ...(this.targets ?? {}) };
    if (Number.isFinite(g) && g > 0) this.targets[step] = g;
    else delete this.targets[step];
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
    this.milk = null;
    this.candidate = null;      // the settled reading we would commit right now
    this._tare = 0;             // the software tare this step is working against
    this._vesselRaw = null;     // what this step's vessel weighs empty
    this.disturbed = false;     // something big is on the platform that is not coffee
    this.at = {};               // wall-clock ms when each weighing was captured
    this.auto = { dose: false, grounds: false, milk: false };  // captured, or typed?
    this._lastRaw = null;
    this._settledSince = null;
    this._settledAt = null;
    // A vessel only counts once the platform has been seen empty. Without this,
    // the cup still standing there from the last step would be tared as the
    // next step's portafilter.
    this._sawEmpty = false;
    this._needTare = false;
    this._roseAt = null;
    this._fellAt = null;
    this._rest = [];
    this._recent = [];
    this._t = 0;
    this.holdLeft = null;       // seconds until an unattended capture, or null
    this.offTarget = null;      // how far a held reading is from the target, or null
    // A lift-commit that can still be undone by the vessel coming back heavier.
    this._revert = null;
    this.events = [];
  }

  /**
   * Setup is a step like any other; it advances on a choice rather than on a
   * weight. Making it a step is the point: a panel of selects sitting quietly
   * beside the flow is not something a first user knows to fill in, and a shot
   * that does not know its coffee is a shot no model can use afterwards.
   */
  /**
   * Record whether setup has everything it needs. Deliberately does NOT advance.
   *
   * It used to. The selects are prefilled from the last session, so having a
   * coffee chosen was true the instant the page loaded, and step 00 was over
   * before anyone saw it — which meant the bag was never re-confirmed. The bag
   * is the field most likely to have changed since yesterday (you finish one
   * and open another) and the one that quietly poisons the most: roast age, the
   * per-bag model, and what is left in the hopper all key off it. A remembered
   * value is a good proposal and a bad assumption.
   */
  setReady(ready) {
    this.ready = !!ready;
    return null;
  }

  /**
   * Leave setup, on purpose. The one deliberate act that starts a session.
   *
   * @returns the step it moved to, or null if it could not or did not need to.
   */
  begin() {
    if (!this.ready || this.step !== STEP.SETUP) return null;
    this.step = this.m.order[1];
    // Nothing preceded this step, so whatever is on the scale is the cup you
    // meant to put there.
    this._enterVessel(true);
    this._log(this._t, 'Coffee and grinder confirmed.');
    return this.step;
  }

  /** Jump to a step by hand. Automation continues from wherever you land. */
  goto(step) {
    if (!this.m.order.includes(step)) return;
    this.step = step;
    this.candidate = null;
    // A deliberate jump is not an accidental lift; nothing to second-guess.
    this._revert = null;
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
    this._vesselRaw = null;
    this._sawEmpty = sawEmpty;
    this._needTare = true;
    this._restartPlateau();
  }

  /**
   * Has the raw reading stopped moving? Independent of the flow estimator,
   * which is answering a different question and answers it slowly after a step.
   */
  /**
   * What the platform read a moment ago — a fixed lag, not a smoothing.
   *
   * A rolling average or median is exactly wrong here: both converge on the new
   * level, so a real lift stops looking like a fall within a few frames. A
   * lagged sample does not converge. Against a reading from 0.6 s ago, a cup
   * lifted is a large fall for the whole 0.6 s it takes the window to refill,
   * and a tap — up and back inside 300 ms — is no fall at all, because 0.6 s
   * ago the platter was resting at exactly the weight it has returned to.
   */
  _laggedRaw(t, raw) {
    this._rest.push([t, raw]);
    while (this._rest.length > 1 && t - this._rest[0][0] > 0.6) this._rest.shift();
    return this._rest[0][1];
  }

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
    const out = { committed: null, advancedTo: null, tareTo: null, revertedTo: null };
    const prevRaw = this._lastRaw;
    this._lastRaw = raw;
    this._t = t;
    if (prevRaw === null) return out;

    // REVERTING AN ADVANCE THAT A LIFT MADE BY MISTAKE.
    //
    // Lifting the vessel commits the weight and moves on — but lifting the
    // portafilter to knock in the last few grams looks exactly the same to a
    // scale, and it was advancing to the brew step with the grind half taken.
    // So a lift-commit is provisional for a few seconds: if the same vessel
    // comes back with MORE in it than was captured, the lift meant "not done",
    // and the step and the weight both go back to where they were. Checked
    // before the weighing gate because the step it is reverting FROM (brew) is
    // not itself a weighing step.
    if (this._revert) {
      const r = this._revert;
      const back = raw - r.vesselRaw;
      const isVessel = back > this.o.minMass && back <= this.o.maxMass;
      if (t > r.until) {
        this._revert = null;
      } else if (isVessel && back > r.was + 0.3) {
        // Held briefly, so a hand reaching in or a knock does not trip it.
        if (r.since === null || Math.abs(raw - r.at) > this.o.vesselBand) {
          r.since = t; r.at = raw;
        } else if (t - r.since >= this.o.vesselFor) {
          this._revert = null;
          this.step = r.step;
          this[r.key] = null;
          this.auto[r.key] = false;
          if (this.at) delete this.at[r.key];
          out.tareTo = +r.vesselRaw.toFixed(2);
          this._tare = out.tareTo;
          this._vesselRaw = +r.vesselRaw.toFixed(2);
          this._sawEmpty = false;
          this.phase = PHASE.FILL;
          this._restartPlateau();
          this.candidate = +back.toFixed(2);
          out.revertedTo = r.step;
          this._log(t, `Back to ${this.weighFor().vessel} — ${back.toFixed(1)} g in it now, `
            + `more than the ${r.was} g that was captured.`);
          return out;
        }
      } else {
        r.since = null; r.at = null;
      }
    }

    const weighing = this.step === STEP.DOSE || this.step === STEP.GRIND;
    if (!weighing) { this.holdLeft = null; this.offTarget = null; return out; }

    // Asked for by goto() or by a commit: clear the software tare so the next
    // vessel is measured from the platform rather than from the last one.
    if (this._needTare) { this._needTare = false; out.tareTo = 0; this._tare = 0; }

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
      // A vessel we have already weighed, coming back with something in it.
      //
      // Most people do not grind with the portafilter sitting on the scale —
      // it lives in the grinder's fork. So the real sequence is: portafilter
      // on, tare, carry it to the grinder, grind, bring it back. Taring it
      // again on the way back would zero the grounds along with the basket and
      // measure nothing, which is exactly what used to happen: that whole
      // workflow captured nothing at all.
      //
      // Knowing what the empty vessel weighed is what makes the return
      // readable. Heavier than it was by more than a dose's minimum, and the
      // difference IS the fill.
      if (this._vesselRaw !== null && raw > this._vesselRaw + this.o.minMass
          && raw - this._vesselRaw <= this.o.maxMass) {
        out.tareTo = +this._vesselRaw.toFixed(2);
        this._tare = out.tareTo;
        this.phase = PHASE.FILL;
        this._restartPlateau();
        this._log(t, `${this.weighFor().vessel} back on with `
          + `${(raw - this._vesselRaw).toFixed(1)} g in it.`);
        return out;
      }

      const placed = this._roseAt !== null && t - this._roseAt <= this.o.vesselWithin;
      if (this._sawEmpty && raw >= this.o.vesselMin && (raw > this.o.maxMass || placed)) {
        out.tareTo = +raw.toFixed(2);
        // What this vessel weighs empty, so it can be recognised coming back.
        this._vesselRaw = +raw.toFixed(2);
        // Kept here too: the brew machine owns the tare, but "is the vessel
        // still on the platform" is a question only this side asks.
        this._tare = out.tareTo;
        this.phase = PHASE.FILL;
        this._restartPlateau();
        this._log(t, `Tared the ${this.weighFor().vessel} at ${raw.toFixed(1)} g.`);
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

    // A hand in the cup weighs more than any dose. Saying so is worth a state
    // of its own: the number on screen is meaningless while it is true, and a
    // readout that just shows 240 g without comment reads as a broken scale
    // rather than as an arm.
    this.disturbed = this.phase !== PHASE.VESSEL && net > this.o.maxMass * 2.5;
    if (this.disturbed) {
      // Nothing decided while somebody's hand is on the platform. The candidate
      // survives — it is what they are in the middle of correcting.
      this._restartPlateau();
      this._fellAt = null;
      return out;
    }

    const plausible = net >= this.o.minMass && net <= this.o.maxMass;
    if (settled && plausible) {
      if (this._plateau(t, net, settled, 0.3, this.o.settleFor)) {
        this.candidate = +net.toFixed(2);
        const tgt = this.targetFor();
        const aimed = Number.isFinite(tgt) && tgt > 0;
        // WHICH WAY ROUND THIS GOES IS THE WHOLE BEHAVIOUR, and it was wrong.
        //
        // It used to count down when the reading was nowhere near the target
        // and wait when it was on it, reasoning that a reading on target has
        // already told you what to do. Read back as behaviour that is exactly
        // inverted: 8 g of beans against an 18 g target auto-advanced after
        // five seconds, and 17.4 g — a perfectly good dose — sat there asking.
        // The app was confidently accepting the readings it had most reason to
        // doubt, and doubting the ones it should have been sure of.
        //
        // Confidence has to run the other way. A settled plateau inside the
        // window is a finished dose, so it commits on a countdown you can see
        // and interrupt. A settled plateau well outside it is either a dose in
        // progress or a mistake, and neither is something to advance past on a
        // timer: it holds, says what is odd, and waits to be told.
        if (aimed && !this.nearTarget(net)) {
          // Still filling, and that is not a hedge: 8 g when you asked for 18
          // means keep going, which is what this phase means. The candidate is
          // kept so the button can take it if you disagree.
          this.offTarget = +(net - tgt).toFixed(1);
          this.holdLeft = null;
        } else {
          this.offTarget = null;
          const held = t - this._settledSince;
          this.holdLeft = Math.max(0, +(this.o.holdFor - held).toFixed(1));
          if (held >= this.o.holdFor) {
            return this._commit(t, aimed ? 'once the dose settled on target'
              : 'after holding still', out);
          }
        }
      }
    } else if (!plausible) {
      this._restartPlateau();
      // Emptied back out below a dose: still filling, not finished.
      if (this.phase === PHASE.READY && net < this.o.minMass) this.phase = PHASE.FILL;
    }

    // The step ends when the thing being weighed is no longer on the scale.
    //
    // That used to be read as a fall — raw dropping by more than dropG — and a
    // fall is not the same claim. Reaching into the cup to take a few beans
    // back out puts a hand on the platter, which reads as hundreds of grams for
    // a second or two; letting go is then a fall of exactly that size, and the
    // step committed the overshoot and moved on while somebody was still
    // fixing it. There is no adjusting a dose you are no longer on.
    //
    // So the test is absolute rather than relative: the vessel is gone when the
    // scale is no longer carrying the vessel's own weight. A hand coming off
    // returns the platter to roughly where it was, which is nowhere near empty,
    // so it says nothing. A cup lifted takes 52 g with it and the platform ends
    // up below its own tare, which is unambiguous.
    // The scale has its own tare button and people use it. When raw drops to
    // zero in one jump the hardware re-zeroed, so the vessel now reads 0 and
    // the software tare has to follow — otherwise every later reading looks
    // like the vessel is missing. Same rule the brew machine uses on the same
    // signal, deliberately: two different answers to "did the scale just
    // re-zero" is two things to keep in step.
    if (Math.abs(raw) < 0.5 && Math.abs(prevRaw - raw) > 5) this._tare = 0;

    const gone = this._needTare || this.phase === PHASE.VESSEL
      ? raw < this.o.minMass
      // With a vessel tared away, "empty" means below the vessel's own weight.
      // With no vessel — beans onto a scale tared by hand — it means the
      // platform is bare.
      : (this._tare > 0 ? raw < this._tare - this.o.dropG : raw < this.o.minMass);

    // And it has to STAY gone. A finger tapped on the platter is a rise and a
    // fall of exactly this size, and one sample at a time it is
    // indistinguishable from a cup being lifted — so tapping the scale used to
    // commit the step whatever the tap meant. A fifth of a second costs nobody
    // anything and makes the signal mean what it says.
    if (gone) {
      if (this._fellAt === null) this._fellAt = t;
    } else {
      this._fellAt = null;
    }
    if (this._fellAt !== null && t - this._fellAt >= this.o.liftFor) {
      this._fellAt = null;
      if (this.candidate !== null) {
        return this._commit(t, `when the ${this.weighFor()?.vessel ?? 'vessel'} came off`, out);
      }
      // An empty platform with no candidate behind it is a vessel going on and
      // off, or a tare. It is not the end of a step, and advancing on it would
      // skip the weighing someone is still in the middle of — but it does mean
      // we are waiting for a vessel again, and the one we already measured may
      // be about to come back with the grounds in it.
      this._clearCandidate();
      if (this.phase !== PHASE.VESSEL) {
        this.phase = PHASE.VESSEL;
        this._sawEmpty = true;
        this._restartPlateau();
      }
    }
    return out;
  }

  _restartPlateau() {
    this._settledAt = null;
    this._settledSince = null;
    this.holdLeft = null;
    this.offTarget = null;
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
    const w = this.weighFor();
    if (!w) return out;
    this[w.key] = this.candidate;
    this.auto[w.key] = true;
    // Wall-clock, not scale time: the gap this is for can be minutes, and the
    // scale's clock is only monotonic within a connection.
    this.at = { ...(this.at ?? {}), [w.key]: Date.now() };
    out.committed = w.key;
    // The value and the reason ride along so a trace can record which rule
    // fired, which is the whole question when a capture surprises somebody.
    out.value = this[w.key];
    out.why = why;
    const name = w.key === 'grounds' ? 'Grounds' : w.key[0].toUpperCase() + w.key.slice(1);
    this._log(t, `${name} ${this[w.key]} g captured ${why}.`);
    // A LIFT-COMMIT IS PROVISIONAL. If this was the vessel coming off — the one
    // signal that cannot tell "done" from "lifting to add more" — remember what
    // the vessel weighs empty and what was captured, so that the vessel coming
    // back heavier within the window undoes this advance rather than starting a
    // brew on a half-ground dose. Only when there is a vessel to recognise: a
    // dose poured onto a bare scale has no empty weight to come back to.
    this._revert = (why.includes('came off') && this._vesselRaw !== null)
      ? { step: this.step, key: w.key, vesselRaw: this._vesselRaw, was: this[w.key],
          until: t + 15, since: null, at: null }
      : null;
    const i = this.m.order.indexOf(this.step);
    this.step = this.m.order[Math.min(this.m.order.length - 1, i + 1)];
    out.advancedTo = this.step;
    this._clearCandidate();
    // The next step starts by looking for its own container, from a platform
    // this one has not seen empty yet.
    this._enterVessel();
    if (out.tareTo === null) out.tareTo = 0;
    this._tare = 0;
    this._needTare = false;
    return out;
  }

  /** The same capture, asked for by hand rather than waited for. */
  commit() {
    return this._commit(this._t, 'because you said so');
  }

  /**
   * Take back the last capture and go back to the step that made it.
   *
   * The one thing automation cannot do for you. Everything else the session
   * decides, it decides from the scale — but "that was wrong" is information
   * only a person has, and until now correcting it meant walking to the laptop,
   * which is the exact situation the whole hands-free flow exists to avoid.
   *
   * Only ever undoes a weighing. There is nothing to take back at setup, and a
   * poured shot is not undone by forgetting its weight.
   */
  undo() {
    const order = this.m.order;
    const here = order.indexOf(this.step);
    for (let i = here; i > 0; i--) {
      const step = order[i - 1] ?? null;
      const w = this.m.weigh[step];
      if (!w || !Number.isFinite(this[w.key])) continue;
      const was = this[w.key];
      this[w.key] = null;
      this.auto[w.key] = false;
      if (this.at) delete this.at[w.key];
      this.step = step;
      this._clearCandidate();
      this._revert = null;
      // Back to looking for a vessel, and trusting the platform as it stands:
      // undoing is a deliberate act by someone standing at the scale, who can
      // see what is on it.
      this._enterVessel(true);
      this._log(this._t, `Took back the ${was} g ${w.key === 'grounds' ? 'grounds' : w.key}.`);
      return { step, key: w.key, was };
    }
    return null;
  }

  /**
   * Seconds between the grind finishing and the pump starting.
   *
   * Ground coffee starts degassing and cooling the moment it leaves the burrs,
   * so two otherwise identical shots pulled thirty seconds and five minutes
   * after grinding are not the same shot. It is free to record — both
   * timestamps already exist — and nothing else logs it, because nothing else
   * owns both ends of the gap.
   */
  puckPrep(startedAt = Date.now()) {
    const ground = this.at?.grounds ?? this.at?.dose ?? null;
    if (!ground) return null;
    const secs = (startedAt - ground) / 1000;
    // A negative gap means the clock moved or the steps were driven by hand out
    // of order; an enormous one means the session was left open overnight.
    return secs >= 0 && secs < 3600 ? +secs.toFixed(1) : null;
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
      disturbed: this.disturbed,
      method: this.m.id,
      methodLabel: this.m.label,
      order: this.m.order,
      vessel: this.weighFor()?.vessel ?? null,
      target: this.targetFor(),
      hint: prompt({ step: this.step, phase: this.phase, candidate: this.candidate,
                     target: this.targetFor(), disturbed: this.disturbed,
                     offTarget: this.candidate === null ? null : this.offTarget,
                     holdLeft: this.candidate === null ? null : this.holdLeft }, this.m.id),
      dose: this.dose,
      grounds: this.grounds,
      milk: this.milk,
      candidate: this.candidate,
      holdLeft: this.candidate === null ? null : this.holdLeft,
      offTarget: this.candidate === null ? null : this.offTarget,
      // The full hold window, so a viewer with no session of its own can draw
      // the countdown bar against the same scale the laptop does.
      holdFor: this.o.holdFor,
      // Whether an undo would find anything to take back — the phone's Undo
      // button turns on and off with this.
      canUndo: this.canUndo(),
      retention: this.retention,
      auto: { ...this.auto },
      events: this.events.slice(-6).reverse(),
    };
  }
}
