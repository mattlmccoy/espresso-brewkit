// The walkthrough that plays on the home page.
//
// A screen recording would have been less code. It would also have been a file
// to host, wrong the moment the interface changed, unreadable at a phone's
// width, and stuck in whichever theme the recorder happened to be using. This
// draws the same story out of the same numbers the app itself would show, in
// the current palette, at whatever size the page gives it.
//
// The timing and the physics live here, with no DOM in sight, because that is
// the half worth testing: a tour that claims to show an 18 g dose should
// actually pass through 18 g, and a curve that claims to be a shot should have
// a flat pre-infusion and a falling flow rate at the end.

/** The story, in order. Durations are what each beat needs to be readable. */
export const SCENES = [
  { id: 'pair', short: 'Pair', ms: 4600, step: '00',
    title: 'Pair the scale once',
    caption: 'Bluetooth, straight from the browser. Every visit after this it reconnects on its '
      + 'own, without the chooser.' },
  { id: 'dose', short: 'Dose', ms: 7400, step: '01',
    title: 'Dose without touching anything',
    caption: 'Put the cup down and it tares itself. Fill until the bar says you are inside the '
      + 'window.' },
  { id: 'grind', short: 'Grind', ms: 6800, step: '02',
    title: 'Lift it off and it moves on',
    caption: 'Portafilter on, tare, grind in. The session follows the scale rather than waiting '
      + 'to be clicked.' },
  { id: 'brew', short: 'Brew', ms: 8600, step: '03',
    title: 'The pour, as it happens',
    caption: 'First drop starts the clock. Flow rate live, and a stop called early enough that '
      + 'the drips still land on target.' },
  { id: 'read', short: 'Read', ms: 6200, step: '04',
    title: 'And what to change',
    caption: 'Every shot keeps its curve, so the next one can be argued with rather than guessed '
      + 'at.' },
];

export const TOTAL_MS = SCENES.reduce((a, s) => a + s.ms, 0);

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Smoothstep: things in this app have mass, and nothing snaps. */
export const ease = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
/** Map a sub-range of a scene onto 0..1, eased. Everything below is built of these. */
export const seg = (u, a, b) => ease((u - a) / (b - a));

/* ------------------------------------------------------------------- clock */

/**
 * Scene timing, and nothing else. Deliberately not a renderer: the page asks
 * where we are and draws it, which keeps every timing rule testable without a
 * browser and lets the same clock drive a completely different picture.
 */
export class Tour {
  constructor({ scenes = SCENES, loop = true, onChange = null } = {}) {
    this.scenes = scenes;
    this.loop = loop;
    this.onChange = onChange;
    this.i = 0;
    this.t = 0;          // ms elapsed within the current scene
    this.playing = true;
    this.done = false;   // only reachable with loop: false
  }

  get scene() { return this.scenes[this.i]; }
  /** How far through the current scene, 0..1. */
  get u() { return this.scene ? clamp01(this.t / this.scene.ms) : 0; }
  /** How far through the whole tour, 0..1 — what the progress rail draws. */
  get progress() {
    let before = 0;
    for (let k = 0; k < this.i; k++) before += this.scenes[k].ms;
    return clamp01((before + this.t) / this.scenes.reduce((a, s) => a + s.ms, 0));
  }

  /**
   * Advance by a frame. Deliberately takes the delta rather than reading a
   * clock, so a test can step it exactly and a page can hand it whatever
   * requestAnimationFrame reports — including the enormous delta a tab
   * returning from the background produces, which is why it is capped.
   */
  tick(dtMs) {
    if (!this.playing || this.done) return false;
    let dt = Math.min(Math.max(dtMs, 0), 120);
    let moved = false;
    while (dt > 0) {
      const left = this.scene.ms - this.t;
      if (dt < left) { this.t += dt; break; }
      dt -= left;
      this.t = 0;
      if (this.i + 1 < this.scenes.length) { this.i += 1; moved = true; continue; }
      if (this.loop) { this.i = 0; moved = true; continue; }
      this.i = this.scenes.length - 1;
      this.t = this.scene.ms;
      this.done = true;
      this.playing = false;
      moved = true;
      break;
    }
    if (moved) this.onChange?.(this.i);
    return moved;
  }

  seek(i) {
    const n = this.scenes.length;
    const next = ((i % n) + n) % n;
    const moved = next !== this.i;
    this.i = next;
    this.t = 0;
    this.done = false;
    this.onChange?.(this.i);
    return moved;
  }

  next() { return this.seek(this.i + 1); }
  prev() { return this.seek(this.t > 900 ? this.i : this.i - 1); }
  play() { this.playing = true; this.done = false; }
  pause() { this.playing = false; }
  toggle() { this.playing ? this.pause() : this.play(); }
  /** Jump to the last frame of a scene — what reduced motion shows instead. */
  rest(i = this.i) { this.i = i; this.t = this.scenes[i].ms; this.playing = false; }
}

/* ------------------------------------------------------------------ scales */

export const DOSE_TARGET = 18.0;
export const YIELD_TARGET = 36.0;
export const CUP_G = 52;
export const PORTAFILTER_G = 469;
export const DOSED_G = 18.2;
export const GROUND_G = 17.9;
export const FIRST_DRIP_S = 5.8;
export const SHOT_S = 27.5;

/**
 * What the scale reads during the dose, and what the page should be saying.
 *
 * The beats are the real ones from `session.js`: an empty platform, a vessel
 * that lands and settles, a tare that happens because the vessel settled, and
 * then a fill. `raw` is what a scale with no software in front of it would
 * show; `net` is what the app shows, which is the whole point of the tare.
 */
export function dosePhase(u) {
  if (u < 0.13) return { phase: 'vessel', raw: 0, net: 0, tare: 0,
    prompt: 'Place the dosing cup on the scale' };
  if (u < 0.26) {
    const k = seg(u, 0.13, 0.26);
    return { phase: 'vessel', raw: CUP_G * k, net: CUP_G * k, tare: 0,
      prompt: 'Place the dosing cup on the scale' };
  }
  if (u < 0.36) return { phase: 'tare', raw: CUP_G, net: 0, tare: CUP_G,
    prompt: 'Tared — the cup is now zero' };
  if (u < 0.82) {
    // Beans arrive in scoops rather than as a ramp, so the readout twitches the
    // way a real one does. The wobble is a fixed function of u, not noise: a
    // tour that looked different every loop would read as a bug.
    const k = seg(u, 0.36, 0.82);
    const scoop = 0.35 * Math.sin(k * Math.PI * 5.5) * (1 - k);
    const net = Math.max(0, DOSED_G * k + scoop);
    return { phase: 'fill', raw: CUP_G + net, net, tare: CUP_G,
      prompt: `Fill to ${DOSE_TARGET.toFixed(1)} g` };
  }
  return { phase: 'ready', raw: CUP_G + DOSED_G, net: DOSED_G, tare: CUP_G,
    prompt: 'In the window — lift it off when you are ready' };
}

/** The same three beats again, with a portafilter, which is the joke of step 02. */
export function grindPhase(u) {
  if (u < 0.16) return { phase: 'lift', raw: 0, net: 0, tare: 0,
    prompt: `Dose captured: ${DOSED_G.toFixed(1)} g` };
  if (u < 0.3) {
    const k = seg(u, 0.16, 0.3);
    return { phase: 'vessel', raw: PORTAFILTER_G * k, net: PORTAFILTER_G * k, tare: 0,
      prompt: 'Put the portafilter on the scale' };
  }
  if (u < 0.4) return { phase: 'tare', raw: PORTAFILTER_G, net: 0, tare: PORTAFILTER_G,
    prompt: 'Tared — grind into it' };
  if (u < 0.84) {
    const k = seg(u, 0.4, 0.84);
    const net = GROUND_G * k;
    return { phase: 'fill', raw: PORTAFILTER_G + net, net, tare: PORTAFILTER_G,
      prompt: 'Grinding' };
  }
  return { phase: 'ready', raw: PORTAFILTER_G + GROUND_G, net: GROUND_G, tare: PORTAFILTER_G,
    prompt: 'Ready to brew' };
}

/**
 * Flow rate through a shot, in g/s.
 *
 * Nothing comes out during pre-infusion, flow climbs as the puck wets through,
 * and it falls away at the end as the puck erodes and channels open. That last
 * part matters: a curve that rises and then stops flat is not what an espresso
 * looks like, and this picture is the first impression of a tool whose whole
 * claim is that it reads curves properly.
 */
export function flowAt(t) {
  if (t <= FIRST_DRIP_S) return 0;
  const s = t - FIRST_DRIP_S;
  return 2.784 * (1 - Math.exp(-s / 1.9)) * Math.exp(-s / 26);
}

/**
 * The pour up to time `t`, as the app would have recorded it: weight by
 * integration, flow alongside. Sampled at 10 Hz, which is what the scale sends.
 */
export function curveTo(t, { dt = 0.1 } = {}) {
  const weight = [];
  const flow = [];
  let w = 0;
  for (let x = 0; x <= t + 1e-9; x += dt) {
    const f = flowAt(x);
    w += f * dt;
    weight.push([+x.toFixed(2), +w.toFixed(3)]);
    flow.push([+x.toFixed(2), +f.toFixed(3)]);
  }
  return { weight, flow, final: w };
}

/** Where the whole curve ends up, so the scale of the plot never jumps. */
export const FINAL_G = curveTo(SHOT_S).final;

/**
 * The pour, scene-relative. A short beat of stillness at each end: the cup
 * arriving, and the drips landing after the pump stops — which is the thing the
 * early cut is for, so it is worth showing rather than cutting away from.
 */
export function brewPhase(u) {
  const lead = 0.07, tail = 0.86;
  if (u < lead) return { t: 0, running: false, prompt: 'Cup on, portafilter locked in' };
  if (u >= tail) {
    return { t: SHOT_S, running: false, stopped: true,
      prompt: `Stopped at ${YIELD_TARGET.toFixed(0)} g — the drips brought it home` };
  }
  const t = ((u - lead) / (tail - lead)) * SHOT_S;
  const { final } = curveTo(t);
  return { t, running: true, weight: final,
    prompt: t < FIRST_DRIP_S ? 'Pre-infusion' : `${flowAt(t).toFixed(2)} g/s` };
}

/** The verdict, revealed a piece at a time so it can be read rather than flashed. */
export function readPhase(u) {
  return {
    showRatio: u > 0.1,
    showTime: u > 0.24,
    showFlow: u > 0.38,
    showVerdict: u > 0.54,
    stars: Math.min(4, Math.floor(seg(u, 0.66, 0.95) * 4.999)),
  };
}
