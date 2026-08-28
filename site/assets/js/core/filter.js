// Weight-stream processing: flow-rate estimation and the brew state machine.
//
// Almost every BLE scale reports weight and nothing else — flow rate, if it
// shows one at all, is computed on the scale and thrown away. So brewkit
// computes its own, and the quality of that estimate is what makes a live
// readout worth looking at.
//
// See design/02-firmware.md; this is the same approach the DIY scale runs
// on-device, implemented here so it works with any scale today.

/**
 * Constant-velocity Kalman filter over [weight, flow], with step detection.
 *
 * The naive alternative — smooth the weight, then difference it — costs filter
 * delay twice and amplifies exactly the noise you just removed. Modelling flow
 * as a state instead means it is estimated from the whole history, optimally
 * weighted, with no differencing anywhere.
 *
 * The model says flow is constant and slowly varying, which is a genuinely good
 * description of espresso: the flow curve is smooth over hundreds of ms.
 *
 * It is a terrible description of putting 18 g of beans on the scale. A step has
 * no velocity, but a constant-velocity filter can only explain a sudden jump as
 * an enormous one, so it slingshots past the true weight and rings back — the
 * plain version of this filter overshot an 18 g step to 25 g and took 1.7 s to
 * settle, which is useless for weighing a dose.
 *
 * So a step is detected rather than filtered. A single large innovation is a
 * droplet impact or a knock and is damped; several in a row, all the same way,
 * are the world having genuinely changed, and the right response is to believe
 * the scale and start again with zero flow. That converges in two samples.
 */
export class FlowEstimator {
  /**
   * @param {number} sigmaMeas  measurement noise, grams (1σ). Scale-dependent;
   *                            0.02–0.05 g is typical for a decent BLE scale.
   * @param {number} sigmaAccel process noise as flow acceleration, g/s². Larger
   *                            tracks sudden changes faster but admits noise.
   *                            Once steps are detected rather than filtered this
   *                            no longer has to be big enough to chase them, so
   *                            it is set for flow smoothness alone: 1.0 roughly
   *                            halves steady-state flow noise against 2.0 while
   *                            costing about 0.15 s of lag on a flow ramp.
   */
  /**
   * @param {number} sigmaMeas  measurement noise, grams (1σ). Scale-dependent;
   *                            0.02–0.05 g is typical for a decent BLE scale.
   * @param {number} sigmaAccel process noise as flow acceleration, g/s². Larger
   *                            tracks sudden changes faster but admits noise.
   *                            Once steps are detected rather than filtered this
   *                            no longer has to be big enough to chase them, so
   *                            it is set for flow smoothness alone: 1.0 roughly
   *                            halves steady-state flow noise against 2.0 while
   *                            costing about 0.15 s of lag on a flow ramp.
   * @param {number} gate       innovations past this many σ are damped.
   * @param {number} maxInflate ceiling on that damping. Without one, an 18 g
   *                            step inflates R by ~10⁴ and the filter stops
   *                            responding at exactly the moment it should.
   * @param {number} stepGrams  innovation size that counts as a real step.
   * @param {number} stepHold   consecutive same-sign steps before believing it.
   */
  constructor({ sigmaMeas = 0.03, sigmaAccel = 1.0, gate = 4,
                maxInflate = 25, stepGrams = 1.0, stepHold = 2 } = {}) {
    this.R = sigmaMeas ** 2;
    this.sigmaMeas = sigmaMeas;
    this.qa = sigmaAccel ** 2;
    this.gate = gate;
    this.maxInflate = maxInflate;
    this.stepGrams = stepGrams;
    this.stepHold = stepHold;
    this.reset();
  }

  reset(w = 0) {
    this.w = w;
    this.q = 0;
    // P starts large: we do not yet trust the initial state.
    this.P = [[1, 0], [0, 1]];
    this.t = null;
    this.rejected = 0;
    this.steps = 0;
    this._run = 0;       // consecutive same-sign large innovations
    this._runSign = 0;
    this._calm = 0;      // consecutive small innovations
  }

  /** True once the reading has stopped moving — what a scale's own display waits
   *  for before it stops blinking, and what a dose weight should be taken on. */
  get settled() {
    return this._calm >= 4 && Math.abs(this.q) < 0.05;
  }

  /**
   * @param {number} t  timestamp in seconds (monotonic)
   * @param {number} z  measured weight in grams
   * @returns {{weight:number, flow:number, innovation:number, outlier:boolean}}
   */
  step(t, z) {
    if (this.t === null) {
      this.t = t;
      this.w = z;
      return { weight: this.w, flow: 0, innovation: 0, outlier: false, step: false, settled: false };
    }
    const dt = t - this.t;
    this.t = t;
    // Out-of-order or duplicate timestamps would make F and Q nonsense.
    if (!(dt > 0) || dt > 5) {
      this.reset(z);
      this.t = t;
      return { weight: z, flow: 0, innovation: 0, outlier: false, step: true, settled: false };
    }

    // --- predict: w += q·dt, q unchanged ---
    const w = this.w + this.q * dt;
    const q = this.q;
    const [[p00, p01], [p10, p11]] = this.P;
    // P = F P Fᵀ + Q, with Q the discrete white-noise-acceleration model.
    const dt2 = dt * dt, dt3 = dt2 * dt, dt4 = dt2 * dt2;
    const P00 = p00 + dt * (p01 + p10) + dt2 * p11 + (this.qa * dt4) / 4;
    const P01 = p01 + dt * p11 + (this.qa * dt3) / 2;
    const P10 = p10 + dt * p11 + (this.qa * dt3) / 2;
    const P11 = p11 + this.qa * dt2;

    // --- update ---
    const y = z - w;                 // innovation
    const S = P00 + this.R;          // innovation variance
    const norm = Math.abs(y) / Math.sqrt(S);

    // Is this a one-off disturbance, or has the world changed? A run of large
    // innovations all in the same direction is the second: a cup set down, beans
    // poured in, the portafilter lifted out.
    const big = Math.abs(y) > this.stepGrams && norm > this.gate;
    const sign = Math.sign(y);
    if (big && sign === this._runSign) this._run++;
    else if (big) { this._run = 1; this._runSign = sign; }
    else { this._run = 0; this._runSign = 0; }
    this._calm = norm > this.gate ? 0 : this._calm + 1;

    if (this._run >= this.stepHold) {
      // Believe the scale. Zeroing flow is the important half: carrying the
      // velocity the step implied is exactly what causes the overshoot.
      this.w = z;
      this.q = 0;
      this.P = [[this.R * 4, 0], [0, 1]];
      this.steps++;
      this._run = 0; this._runSign = 0; this._calm = 0;
      return { weight: z, flow: 0, innovation: y, outlier: false, step: true, settled: false };
    }

    // Droplet impacts and knocks are large, one-sided, short outliers — not the
    // Gaussian noise the standard update assumes. Inflate R for this step rather
    // than rejecting: a genuine fast transient also produces a large innovation,
    // and hard rejection would blind the filter exactly when the world changes.
    // The ceiling matters — uncapped, the inflation from a real step is large
    // enough to freeze the filter until the step detector above catches it.
    const outlier = norm > this.gate;
    const R = outlier
      ? this.R * Math.min(this.maxInflate, (norm / this.gate) ** 2)
      : this.R;
    if (outlier) this.rejected++;
    const S2 = P00 + R;

    const k0 = P00 / S2;
    const k1 = P10 / S2;

    this.w = w + k0 * y;
    this.q = q + k1 * y;
    this.P = [
      [(1 - k0) * P00, (1 - k0) * P01],
      [P10 - k1 * P00, P11 - k1 * P01],
    ];

    return { weight: this.w, flow: this.q, innovation: y, outlier,
             step: false, settled: this.settled };
  }
}

export const BREW = {
  IDLE: 'idle',
  AWAITING_VESSEL: 'awaiting_vessel',
  AWAITING_FLOW: 'awaiting_flow',
  EXTRACTING: 'extracting',
  DRIPPING: 'dripping',
  COMPLETE: 'complete',
};

export const BREW_LABEL = {
  idle: 'Idle',
  awaiting_vessel: 'Place your cup',
  awaiting_flow: 'Ready — pull the shot',
  extracting: 'Extracting',
  dripping: 'Dripping',
  complete: 'Shot complete',
};

/**
 * Espresso shot state machine. Mirrors design/02-firmware.md.
 *
 * Every automatic transition can be forced by the caller — the machine is a
 * convenience, not a cage, and when it guesses wrong the user must be able to
 * just start the timer.
 */
export class BrewMachine {
  constructor(opts = {}) {
    this.o = {
      vesselMin: 20,        // g, a cup is at least this heavy
      vesselStable: 0.4,    // s of stability before auto-tare
      stableBand: 0.3,      // g, spread that counts as "not moving"
      flowStart: 0.3,       // g/s sustained to call it flowing
      flowStartFor: 0.2,    // s
      flowEnd: 0.15,        // g/s under which the shot is ending
      flowEndFor: 1.5,      // s
      dripSettle: 3.0,      // s after flow stops before the shot is final
      removalDrop: 20,      // g, a decrease this large is the cup leaving
      ...opts,
    };
    this.reset();
  }

  reset() {
    this.state = BREW.IDLE;
    this.t0 = null;
    this.tFirstDrip = null;
    this.tare = 0;
    this.curve = [];
    this.peakFlow = 0;
    this._since = null;
    this._recent = [];
    this._lastRaw = 0;
    this._flowHist = [];
  }

  /**
   * Which way flow is heading right now, g/s per second, over the last few
   * seconds — the same quantity the post-shot diagnosis calls `flow_slope_late`,
   * but available while there is still something you can do about it.
   *
   * NaN until there is enough shot to judge: an opinion formed during the
   * opening ramp would say "rising" on every shot ever pulled.
   */
  flowTrend(window = 6, minElapsed = 9) {
    const h = this._flowHist;
    if (this.t0 === null || h.length < 8) return NaN;
    if (h.at(-1)[0] - this.t0 < minElapsed) return NaN;
    const from = h.at(-1)[0] - window;
    const pts = h.filter((p) => p[0] >= from);
    if (pts.length < 6) return NaN;
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p[0], 0) / n;
    const my = pts.reduce((a, p) => a + p[1], 0) / n;
    let sxy = 0, sxx = 0;
    for (const [x, y] of pts) { const dx = x - mx; sxy += dx * (y - my); sxx += dx * dx; }
    return sxx > 1e-9 ? sxy / sxx : NaN;
  }

  arm() { this.reset(); this.state = BREW.AWAITING_VESSEL; }

  /** Force the timer to start now, whatever the machine thinks. */
  startNow(t, raw) {
    this.tare = raw;
    this.t0 = t;
    this.state = BREW.EXTRACTING;
    this.curve = [];
  }

  stopNow() {
    if (this.state === BREW.EXTRACTING || this.state === BREW.DRIPPING) {
      this.state = BREW.COMPLETE;
    }
  }

  _stableFor(t, raw, seconds) {
    this._recent.push([t, raw]);
    while (this._recent.length && t - this._recent[0][0] > seconds) this._recent.shift();
    if (this._recent.length < 3 || t - this._recent[0][0] < seconds * 0.8) return false;
    const vals = this._recent.map((r) => r[1]);
    return Math.max(...vals) - Math.min(...vals) < this.o.stableBand;
  }

  _held(cond, t, seconds) {
    if (!cond) { this._since = null; return false; }
    if (this._since === null) this._since = t;
    return t - this._since >= seconds;
  }

  /**
   * @param t    seconds
   * @param raw  filtered weight, grams, as reported by the scale (untared)
   * @param flow g/s from the estimator
   */
  step(t, raw, flow) {
    const prevRaw = this._lastRaw;
    this._lastRaw = raw;

    // The scale has its own tare button and people use it — it is right there
    // under their thumb. Pressing it drops the reading to zero, and carrying a
    // software tare on top of that would show a large negative number. So when
    // the reading jumps to zero, follow it.
    if (Math.abs(raw) < 0.5 && Math.abs(prevRaw - raw) > 5) this.tare = 0;

    // Idle means idle. Weighing beans, taring, swapping a dosing cup for a
    // portafilter — none of that is a shot, and the machine has no business
    // reacting to it. Only arm() and startNow() leave this state.
    //
    // Getting this wrong was not subtle: a scale-side tare reads as a large
    // decrease, which used to trip the vessel-removed branch below and silently
    // arm vessel detection. The next heavy thing set down — a portafilter —
    // auto-tared, so the display read 0 g with 521 g sitting on the platform.
    if (this.state === BREW.IDLE) return this.snapshot(t, raw, flow);

    // A rapid decrease is the vessel being removed — never the shot ending.
    // Confusing the two truncates or duplicates a record, so it is checked
    // before anything else and from any live state.
    if (prevRaw - raw > this.o.removalDrop) {
      const done = this.state === BREW.COMPLETE || this.state === BREW.DRIPPING;
      this.reset();
      if (!done) this.state = BREW.AWAITING_VESSEL;
      return this.snapshot(t, raw, flow);
    }

    const net = raw - this.tare;

    switch (this.state) {
      case BREW.AWAITING_VESSEL:
        if (raw > this.o.vesselMin && this._stableFor(t, raw, this.o.vesselStable)) {
          this.tare = raw;
          this.state = BREW.AWAITING_FLOW;
          this._since = null;
        }
        break;

      case BREW.AWAITING_FLOW:
        if (this._held(flow > this.o.flowStart, t, this.o.flowStartFor)) {
          this.t0 = t;
          this.tFirstDrip = t;
          this.state = BREW.EXTRACTING;
          this._since = null;
          this.curve = [];
        }
        break;

      case BREW.EXTRACTING:
        this.curve.push([+(t - this.t0).toFixed(3), +net.toFixed(2)]);
        this._flowHist.push([t, flow]);
        while (this._flowHist.length && t - this._flowHist[0][0] > 12) this._flowHist.shift();
        if (flow > this.peakFlow) this.peakFlow = flow;
        if (this._held(flow < this.o.flowEnd, t, this.o.flowEndFor)) {
          this.state = BREW.DRIPPING;
          this._since = t;
        }
        break;

      case BREW.DRIPPING:
        this.curve.push([+(t - this.t0).toFixed(3), +net.toFixed(2)]);
        if (t - this._since >= this.o.dripSettle) this.state = BREW.COMPLETE;
        break;
    }
    return this.snapshot(t, raw, flow);
  }

  snapshot(t, raw, flow) {
    const running = this.t0 !== null
      && (this.state === BREW.EXTRACTING || this.state === BREW.DRIPPING);
    return {
      state: this.state,
      label: BREW_LABEL[this.state],
      net: raw - this.tare,
      elapsed: this.t0 === null ? 0 : (this.state === BREW.COMPLETE
        ? (this.curve.length ? this.curve.at(-1)[0] : 0) : t - this.t0),
      running,
      flow,
      trend: this.flowTrend(),
      peakFlow: this.peakFlow,
      firstDrip: this.tFirstDrip === null || this.t0 === null ? null : this.tFirstDrip - this.t0,
    };
  }
}

/**
 * Predictive stop. After the pump cuts, 1–3 g still drips from the puck, so
 * stopping at the target overshoots by that much every time.
 *
 * lag is learnable per machine: every completed shot gives
 * (weight at stop signal, final weight), and the ratio to flow at that moment
 * converges after a handful of shots.
 */
export function stopSignalWeight(target, flow, lagSeconds = 1.0) {
  return target - flow * Math.max(0, lagSeconds);
}

export function updateStopLag(prev, weightAtSignal, finalWeight, flowAtSignal, alpha = 0.25) {
  if (!(flowAtSignal > 0.05)) return prev;
  const observed = (finalWeight - weightAtSignal) / flowAtSignal;
  if (!Number.isFinite(observed)) return prev;
  return Math.min(3, Math.max(0.2, prev * (1 - alpha) + observed * alpha));
}
