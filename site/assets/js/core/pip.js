// Pip: the thing in the corner that watches your shot.
//
// The obvious reference is Clippy, and the obvious risk is being Clippy. What
// made that assistant hated was not that it was animated — it was that it
// interrupted confidently with things you already knew, could not act on, and
// had not asked for. So the rules it broke are the rules here:
//
//   1. Say nothing rather than say something obvious. Silence is a valid
//      output and the common one.
//   2. Never say the same thing twice in a session.
//   3. During the pour, only what is worth knowing WHILE IT POURS. Advice you
//      can only act on next time waits until next time.
//   4. Always dismissible, and stays dismissed.
//
// This module is the face and the voice. It holds no opinions: what to say is
// decided in coach.js, which has no DOM and is tested on its own. Splitting
// them means the judgement can be argued with in a test rather than through a
// screenshot.

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, cls, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  if (cls) n.setAttribute('class', cls);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/**
 * The moods, and what each one is FOR. A character with six expressions and no
 * rule about which is which ends up using them decoratively, and then the face
 * stops carrying information — it becomes a mascot rather than an instrument.
 * Each of these maps to a class of thing the coach can conclude.
 */
export const MOODS = {
  // Nothing happening. The resting state, and where it returns to. `wave` is
  // how much of the bean's own crease survives in the mouth — at rest it is the
  // full S, which is what keeps the character a coffee bean rather than a ball
  // with a face on it.
  idle: { brow: 0, eye: 1, mouth: 0.06, wave: 1, lean: -6, look: [0, 0] },
  // A shot is running and being read. Leaning in, eyes down on the cup.
  watch: { brow: -1, eye: 1.12, mouth: 0.02, wave: 0.8, lean: -2, look: [0, 1] },
  // Something is going wrong now, and there may be time to act.
  alert: { brow: -4, eye: 1.32, mouth: -0.2, wave: 0.15, lean: -9, look: [0, -0.3] },
  // It went well. The only mood allowed to be cheerful — a face that is always
  // pleased is not telling you anything.
  pleased: { brow: 1.5, eye: 0.5, mouth: 0.44, wave: 0, lean: -4, look: [0, 0] },
  // Working something out. Eyes up and away, which is the universal tell.
  think: { brow: -2, eye: 0.95, mouth: 0.05, wave: 0.9, lean: -12, look: [-1, -0.8] },
  // It went badly, and the shot is over. Not alarm; disappointment.
  flat: { brow: 2.5, eye: 0.72, mouth: -0.28, wave: 0.2, lean: -3, look: [0, 0.5] },
};

/**
 * Draw Pip into `host` and return the handle the page drives.
 *
 * The character is one SVG with named parts rather than a sprite sheet or a
 * canvas: every expression is the same six shapes at different values, so a
 * mood is an interpolation and not an asset, and it inherits the theme's ink
 * like everything else on the page.
 */
export function mountPip(host, { onDismiss = null, name = 'Pip' } = {}) {
  host.replaceChildren();
  host.classList.add('pip');

  const fig = document.createElement('div');
  fig.className = 'pip-fig';

  const svg = el('svg', 'pip-svg', { viewBox: '0 0 100 100', role: 'img' });
  const title = el('title', null);
  title.textContent = name;
  svg.append(title);

  // A bean lying on its side, and the proportion is the whole recognition: at
  // 39x33 this was a ball with a face on it. A roasted arabica bean is about
  // 1.4 times as long as it is wide, and it is the silhouette plus the crease
  // that say "coffee" before anything else is read.
  const body = el('ellipse', 'pip-body', { cx: 50, cy: 52, rx: 42, ry: 30 });
  const gloss = el('ellipse', 'pip-gloss', {
    cx: 34, cy: 34, rx: 14, ry: 7, transform: 'rotate(-20 34 34)' });

  const brows = el('g', 'pip-brows');
  const browL = el('path', 'pip-brow', {});
  const browR = el('path', 'pip-brow', {});
  brows.append(browL, browR);

  // Whites and pupils, not dots. A pupil that can move is most of what makes a
  // face look like it is attending to something — the character watches the cup
  // while it fills and looks away while it is working something out, and that
  // costs two attributes rather than a second set of drawings.
  const eyes = el('g', 'pip-eyes');
  const eyeL = el('ellipse', 'pip-eye', { cx: 35, cy: 44, rx: 6.2, ry: 7 });
  const eyeR = el('ellipse', 'pip-eye', { cx: 65, cy: 44, rx: 6.2, ry: 7 });
  const pupL = el('circle', 'pip-pupil', { cx: 35, cy: 44, r: 3 });
  const pupR = el('circle', 'pip-pupil', { cx: 65, cy: 44, r: 3 });
  eyes.append(eyeL, eyeR, pupL, pupR);

  // THE CREASE, WHICH IS ALSO THE MOUTH.
  // A real bean's crease is a soft S down its long axis, not a straight line.
  // Drawn as one it is simultaneously the bean's defining feature and a wry
  // mouth, so the character does not need both — and as an expression grows the
  // S flattens into a plain smile or frown, because a wavy grin reads as noise.
  const mouth = el('path', 'pip-mouth', {});

  const g = el('g', 'pip-all');
  g.append(body, gloss, brows, eyes, mouth);
  svg.append(g);
  fig.append(svg);

  const bubble = document.createElement('div');
  bubble.className = 'pip-bubble';
  bubble.hidden = true;
  const text = document.createElement('p');
  text.className = 'pip-text';
  // Announced politely: this is commentary, and a screen reader should not have
  // it cut across whatever the user is actually doing.
  bubble.setAttribute('role', 'status');
  bubble.setAttribute('aria-live', 'polite');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'pip-x ghost';
  close.setAttribute('aria-label', `Dismiss ${name}`);
  close.textContent = '×';
  close.addEventListener('click', () => { hide(); onDismiss?.(); });
  bubble.append(text, close);

  host.append(bubble, fig);

  let mood = 'idle';
  let blinkTimer = null;
  let holdTimer = null;

  /** Set every shape from one mood. No mood owns a drawing; they own numbers. */
  function wear(m) {
    const v = MOODS[m] ?? MOODS.idle;
    mood = m;
    // Brows are arcs, not bars: a straight line above an eye reads as a
    // floating rectangle, and the curve is what attaches it to the face. The
    // inner end drops as `brow` goes negative, which is the whole of a frown.
    for (const [b, cx, sign] of [[browL, 35, 1], [browR, 65, -1]]) {
      const inner = cx + 9 * sign;
      const outer = cx - 9 * sign;
      b.setAttribute('d', `M${outer} ${(32 - v.brow * 0.5).toFixed(1)} `
        + `Q${cx} ${(28 - v.brow * 0.4).toFixed(1)} ${inner} ${(32 + v.brow).toFixed(1)}`);
    }
    for (const e of [eyeL, eyeR]) e.setAttribute('ry', (7 * v.eye).toFixed(2));
    // The pupil stays inside its own white, so `look` is a fraction of the room
    // there is rather than a pixel offset that would slide off a squinting eye.
    const [lx, ly] = v.look;
    for (const [p, cx] of [[pupL, 35], [pupR, 65]]) {
      p.setAttribute('cx', (cx + lx * 2.4).toFixed(2));
      p.setAttribute('cy', (44 + ly * 2.6 * v.eye).toFixed(2));
      p.setAttribute('r', (3 * Math.min(1, v.eye)).toFixed(2));
    }
    // Two control points: the S at rest, collapsing toward one curve as the
    // expression takes over. Both ends stay pinned to the bean, so only the
    // middle ever moves.
    const sag = v.mouth * 26;
    const w = v.wave * 4.5;
    mouth.setAttribute('d', `M23 60 C33 ${(60 + sag + w).toFixed(1)} `
      + `41 ${(60 + sag - w).toFixed(1)} 50 ${(60 + sag * 0.9).toFixed(1)} `
      + `C59 ${(60 + sag + w).toFixed(1)} 67 ${(60 + sag - w).toFixed(1)} 77 60`);
    g.setAttribute('transform', `rotate(${v.lean} 50 52)`);
    host.dataset.mood = m;
  }

  function blink() {
    for (const e of [eyeL, eyeR]) e.setAttribute('ry', '0.9');
    for (const p of [pupL, pupR]) p.setAttribute('r', '0');
    setTimeout(() => {
      const v = MOODS[mood] ?? MOODS.idle;
      for (const e of [eyeL, eyeR]) e.setAttribute('ry', (7 * v.eye).toFixed(2));
      for (const p of [pupL, pupR]) p.setAttribute('r', (3 * Math.min(1, v.eye)).toFixed(2));
    }, 110);
  }

  // Irregular, because a blink on a fixed interval reads as a machine and is
  // the thing that makes an animated face feel dead.
  function scheduleBlink() {
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => { blink(); scheduleBlink(); }, 2200 + Math.random() * 4200);
  }

  function say(message, { mood: m = 'idle', ms = 0 } = {}) {
    clearTimeout(holdTimer);
    text.textContent = message;
    bubble.hidden = false;
    host.classList.add('is-talking');
    wear(m);
    if (ms > 0) holdTimer = setTimeout(() => hide(), ms);
  }

  function hide() {
    clearTimeout(holdTimer);
    bubble.hidden = true;
    host.classList.remove('is-talking');
    wear(mood === 'alert' || mood === 'pleased' || mood === 'flat' ? mood : 'idle');
  }

  function destroy() {
    clearTimeout(blinkTimer);
    clearTimeout(holdTimer);
    host.replaceChildren();
    host.classList.remove('pip', 'is-talking');
  }

  wear('idle');
  scheduleBlink();

  return {
    say,
    hide,
    destroy,
    mood: wear,
    get current() { return mood; },
    get talking() { return !bubble.hidden; },
    get text() { return text.textContent; },
  };
}
