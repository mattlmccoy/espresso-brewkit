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
// decided in coach.js, which has no DOM and is tested on its own.
//
// THE SHAPE, AND HOW IT GOT HERE
// Four directions were drawn and compared — an instrument, an object, a
// typeface and a liquid. The typeface won, and then took three passes to sit
// right. It was a full-width pane (a banner, not a window). Then a small window
// with the message inside it, which made the window a container for text rather
// than a character in it. It is neither now: the box is HIM — a little terminal
// with nothing in it but his face — and what he says spawns out of it in a
// bubble with a tail pointing back at him.
//
// That split is what lets him be alive. A box holding a paragraph cannot blink
// without the paragraph jumping; a box holding a seven-character face can blink,
// glance around, and type, because nothing else is in there to disturb.
//
// Everything is text: no SVG, no viewBox, no palette of its own. It scales with
// font-size, inherits the theme's ink, and is native to the terminal theme
// rather than tolerated by it.

/**
 * The faces, and why these characters rather than better-looking ones.
 *
 * The app self-hosts a LATIN-ONLY SUBSET of Space Mono. A character outside it
 * still renders — the browser falls back to a system monospace — so the failure
 * is silent and looks very nearly right, which is the worst kind. Measured
 * against a glyph known to be present, the real advance is 24.48 px at 40 px
 * and the fallback's is 24.09. Every good-looking candidate for the alarmed
 * face — U+0298, U+25A1, U+2299, U+229A — came back at 24.09, which means none
 * of them are in the font at all.
 *
 * So every glyph here is confirmed present by measurement, and a test holds the
 * line by comparing advances against a reference glyph rather than by asking
 * whether the result is monospace — which the fallback also is, and which is
 * exactly how this would have shipped broken.
 *
 * EVERY VARIANT IS THE SAME LENGTH. A blink or a glance that changed the string
 * width would shove the box a pixel sideways on every blink, so the face always
 * occupies seven cells and only what is inside them moves.
 */
export const FACES = {
  //        open        eyes shut      looking off to one side
  idle:    { open: '[ ·_· ]', blink: '[ -_- ]', glance: ['[·_·  ]', '[  ·_·]'] },
  watch:   { open: '[ o_o ]', blink: '[ -_- ]', glance: ['[o_o  ]', '[  o_o]'] },
  // Wide-eyed and not blinking. Something is going wrong; he is staring at it.
  alert:   { open: '[ °_° ]', blink: null, glance: [] },
  // Eyes already closed by the smile, so there is nothing left to shut.
  pleased: { open: '[ ^_^ ]', blink: null, glance: [] },
  think:   { open: '[ ·~· ]', blink: '[ -~- ]', glance: ['[·~·  ]', '[  ·~·]'] },
  // Already shut. Blinking would be opening his eyes, which is the opposite.
  flat:    { open: '[ -_- ]', blink: null, glance: [] },
};

/**
 * What each mood is FOR. A character with six expressions and no rule about
 * which is which uses them decoratively, and then the face stops carrying
 * information. `tone` is the only thing that ever takes colour, so he stays
 * monochrome until something is genuinely worth a colour.
 */
export const MOODS = {
  idle:    { label: 'idle',     tone: '' },
  watch:   { label: 'watching', tone: '' },
  alert:   { label: 'alert',    tone: 'warn' },
  pleased: { label: 'good',     tone: 'good' },
  think:   { label: 'reading',  tone: '' },
  flat:    { label: 'under',    tone: '' },
};

const still = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

/**
 * Draw Pip into `host` and return the handle the page drives.
 *
 * The API is the one every earlier version had, so nothing that mounts him
 * needs to know he stopped being a drawing.
 */
export function mountPip(host, { onDismiss = null, name = 'pip' } = {}) {
  host.replaceChildren();
  host.classList.add('pip');

  // ---- the little terminal, which is him -----------------------------------
  const box = document.createElement('div');
  box.className = 'pip-box';

  const bar = document.createElement('div');
  bar.className = 'pip-bar';
  const who = document.createElement('span');
  who.className = 'pip-who';
  // The full address, as on a real prompt. Shortened to just "pip" for a while
  // when the bar was a reversed strip and space was tight; the bezel has room.
  who.textContent = name + '@brewkit';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'pip-x';
  close.setAttribute('aria-label', 'Turn the coach off');
  close.textContent = '×';
  bar.append(who, close);

  const screen = document.createElement('div');
  screen.className = 'pip-screen';
  const face = document.createElement('span');
  face.className = 'pip-face';
  // The face is the only thing that says what state he is in once the state
  // word left the title bar, so it carries the name rather than being hidden.
  face.setAttribute('role', 'img');
  const caret = document.createElement('span');
  caret.className = 'pip-caret';
  caret.setAttribute('aria-hidden', 'true');
  screen.append(face, caret);
  box.append(bar, screen);

  // ---- what he says, spawning off him --------------------------------------
  const bubble = document.createElement('div');
  bubble.className = 'pip-bubble';
  bubble.hidden = true;
  const say$ = document.createElement('p');
  say$.className = 'pip-say';
  // Typed out one character at a time, so the visible node mutates constantly.
  // Announcing that would read the message letter by letter, so the live region
  // is a separate hidden node that gets the whole line once.
  say$.setAttribute('aria-hidden', 'true');
  const live = document.createElement('span');
  live.className = 'pip-live';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  // Where an answer goes when he has asked something. Empty and absent the
  // rest of the time, which is nearly always.
  const choices = document.createElement('div');
  choices.className = 'pip-choices';
  choices.hidden = true;
  bubble.append(say$, choices);

  host.append(box, bubble, live);

  let mood = 'idle';
  let holdTimer = null;
  let blinkTimer = null;
  let glanceTimer = null;
  let typeTimer = null;

  const facesFor = () => FACES[mood] ?? FACES.idle;
  const showFace = (s) => { face.textContent = s; };
  const rest = () => showFace(facesFor().open);

  function wear(m) {
    const v = MOODS[m] ?? MOODS.idle;
    mood = m;
    rest();
    face.setAttribute('aria-label', `${name}, ${v.label}`);
    host.dataset.mood = m;
    host.dataset.tone = v.tone;
    schedule();
  }

  /**
   * Blinking, and the occasional glance away.
   *
   * On an irregular timer, because a blink on a fixed interval reads as a
   * metronome and is the thing that makes an animated face feel dead. Both are
   * done by swapping the string rather than by CSS, since what changes is which
   * characters he is made of.
   */
  function schedule() {
    clearTimeout(blinkTimer);
    clearTimeout(glanceTimer);
    if (still()) return;
    const f = facesFor();
    if (f.blink) {
      blinkTimer = setTimeout(function again() {
        showFace(facesFor().blink ?? facesFor().open);
        setTimeout(rest, rand(90, 150));
        blinkTimer = setTimeout(again, rand(2600, 6800));
      }, rand(1800, 5200));
    }
    if (f.glance.length) {
      glanceTimer = setTimeout(function again() {
        const g = facesFor().glance;
        if (g.length) {
          showFace(g[Math.floor(Math.random() * g.length)]);
          setTimeout(rest, rand(600, 1100));
        }
        glanceTimer = setTimeout(again, rand(5000, 13000));
      }, rand(4000, 9000));
    }
  }

  /** Type it in, the way a terminal fills a line. */
  function type(message) {
    clearTimeout(typeTimer);
    if (still()) { say$.textContent = message; return; }
    say$.textContent = '';
    const chars = [...message];
    // Rate scaled so a long line does not outlast the moment it is about — a
    // fixed per-character delay makes a 90-character finding take two seconds.
    const step = Math.min(18, Math.max(6, 620 / Math.max(1, chars.length)));
    let i = 0;
    (function tick() {
      say$.textContent = chars.slice(0, ++i).join('');
      if (i < chars.length) typeTimer = setTimeout(tick, step);
    })();
  }

  function say(message, { mood: m = 'idle', ms = 0 } = {}) {
    clearTimeout(holdTimer);
    wear(m);
    bubble.hidden = false;
    choices.hidden = true;
    choices.replaceChildren();
    host.classList.add('is-talking');
    live.textContent = message;
    type(message);
    if (ms > 0) holdTimer = setTimeout(() => hide(), ms);
  }

  /**
   * Say something and wait for an answer, in the bubble he already has.
   *
   * The one thing he is ever asked is what "go away" meant, and that question
   * belongs to him: a modal dialog for it would be the app interrupting to ask
   * how you would like to stop being interrupted. `options` is
   * [{ label, act }]; answering closes the bubble and runs the act, and there
   * is no timer on it — a question that withdraws itself was not a question.
   */
  function ask(message, options = []) {
    say(message, { mood: 'think' });
    choices.replaceChildren(...options.map((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pip-choice';
      b.textContent = o.label;
      b.addEventListener('click', () => { hide(); o.act?.(); });
      return b;
    }));
    choices.hidden = options.length === 0;
  }

  /**
   * Stop talking. The bubble goes; HE stays.
   *
   * Which is the whole reason the message left the box. A window holding a
   * paragraph has to disappear when the paragraph does, and a coach that
   * vanishes between remarks reads as broken rather than as quiet. A little
   * terminal with a face and a blinking caret is exactly as sensible with
   * nothing to say as with something.
   */
  function hide() {
    clearTimeout(holdTimer);
    clearTimeout(typeTimer);
    bubble.hidden = true;
    say$.textContent = '';
    choices.hidden = true;
    choices.replaceChildren();
    live.textContent = '';
    host.classList.remove('is-talking');
    wear(mood === 'alert' || mood === 'pleased' || mood === 'flat' ? mood : 'idle');
  }

  function destroy() {
    for (const t of [holdTimer, blinkTimer, glanceTimer, typeTimer]) clearTimeout(t);
    host.replaceChildren();
    host.classList.remove('pip', 'is-talking');
    delete host.dataset.mood;
    delete host.dataset.tone;
  }

  close.addEventListener('click', () => { hide(); onDismiss?.(); });
  wear('idle');

  return {
    say,
    ask,
    hide,
    destroy,
    mood: wear,
    get current() { return mood; },
    get talking() { return !bubble.hidden; },
    get text() { return live.textContent; },
    // For tests and for anything that wants to know what he looks like now.
    get face() { return face.textContent; },
  };
}

/* ------------------------------------------------------ him, on every page */
//
// HE IS ONE CHARACTER, NOT ONE PER SCREEN.
//
// He lived inside the pour panel on Live, which meant he existed for the eleven
// steps of a shot that involve pouring and vanished for the ones that do not —
// gone at setup, gone while you dose, gone while you grind — and did not exist
// at all on the pages where you read what he had been watching. A coach who is
// only there while coffee is coming out is not a coach, he is a readout.
//
// So the whole arrangement — the character, the on/off preference, the question
// the x asks, and the way back once he is gone — lives here and every page
// installs it the same way. What he SAYS is still the page's business: Live has
// a scale and a session to talk about, Shots has a log. Presence is shared;
// having something to say is not.

/**
 * Put Pip in `host`, with his own switch and his own way back.
 *
 * @param host        where he goes; emptied and filled
 * @param prefs       the prefs module, passed in so this file stays DOM-only
 * @param quietLabel  what "not now" means on this page, e.g. 'this shot'
 * @returns a handle: say/ask/mood/hide pass through to him when he is up and
 *          are no-ops when he is not, so callers never have to null-check.
 */
export function installPip(host, prefs, { name = 'pip', quietLabel = 'for now' } = {}) {
  if (!host) return { say() {}, mood() {}, hide() {}, ask() {}, get talking() { return false; },
                      get up() { return false; }, destroy() {} };

  const slot = document.createElement('div');
  // Addressable: the page's CSS and the suite both need to find where he is.
  slot.className = 'pip-slot';
  const stub = document.createElement('div');
  stub.className = 'pip-stub';
  stub.hidden = true;
  const face = document.createElement('span');
  face.className = 'stub-face';
  face.setAttribute('aria-hidden', 'true');
  face.textContent = FACES.flat.open;
  const why = document.createElement('span');
  why.className = 'stub-why';
  const wake = document.createElement('button');
  wake.className = 'ghost';
  wake.type = 'button';
  wake.textContent = 'Wake him';
  stub.append(face, why, wake);
  host.replaceChildren(slot, stub);

  let him = null;
  // Quiet is not off. Closing him used to mean one of the two and the tap could
  // not say which, so it asks — and both answers leave a way back.
  let quiet = false;

  const on = () => prefs.prefs().coach !== false;

  function paint() {
    const away = !on() || quiet;
    stub.hidden = !away;
    slot.hidden = away;
    if (away) why.textContent = on() ? `pip is quiet ${quietLabel}` : 'pip is off';
  }

  function build() {
    if (!on() || quiet) { him?.destroy(); him = null; paint(); return; }
    paint();
    if (him) return;
    him = mountPip(slot, { name, onDismiss: () => {
      him?.ask(`Quiet ${quietLabel}, or off for good?`, [
        { label: quietLabel, act: () => { quiet = true; build(); } },
        { label: 'off', act: () => { prefs.set({ coach: false }); build(); } },
      ]);
    } });
  }

  wake.addEventListener('click', () => {
    quiet = false;
    if (!on()) prefs.set({ coach: true });
    build();
  });
  const stop = prefs.subscribe?.(build);
  build();

  return {
    get up() { return !!him; },
    get talking() { return !!him?.talking; },
    get face() { return him?.face ?? ''; },
    say: (...a) => him?.say(...a),
    ask: (...a) => him?.ask(...a),
    mood: (m) => him?.mood(m),
    hide: () => him?.hide(),
    /** Quiet him without touching the preference — a new shot clears it. */
    unquiet() { if (quiet) { quiet = false; build(); } },
    destroy() { stop?.(); him?.destroy(); him = null; },
  };
}
