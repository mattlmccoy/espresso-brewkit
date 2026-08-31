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
//
// WHY IT IS TYPE AND NOT A DRAWING
// Four directions were drawn and compared — an instrument, an object, a
// typeface and a liquid — and building the chosen one for real changed its
// shape. As a pitch it was an avatar sitting beside a speech bubble, like the
// other three. But a terminal already HAS somewhere for a face and somewhere
// for output, in the same shell; the avatar-plus-bubble arrangement was a habit
// carried over from characters that need it. So Pip is one small pane: a title
// bar saying whose process this is, and a line with the face, what it has to
// say, and a caret.
//
// Everything else follows. No SVG, no viewBox, no second palette: it is text,
// so it scales with font-size, inherits the theme's ink like any other element,
// and is native to the terminal theme rather than tolerated by it.

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
 * So every glyph below is confirmed present by measurement, and a test holds
 * the line by comparing advances against a reference glyph rather than by
 * asking whether the result is monospace — which the fallback also is, and
 * which is exactly how this would have shipped broken.
 */
export const FACES = {
  idle:    '[ ·_· ]',
  watch:   '[ o_o ]',
  alert:   '[ °_° ]',
  pleased: '[ ^_^ ]',
  think:   '[ ·~· ]',
  flat:    '[ -_- ]',
};

/**
 * What each mood is FOR. A character with six expressions and no rule about
 * which is which uses them decoratively, and then the face stops carrying
 * information. `tone` is the only thing that ever takes colour, so the pane
 * stays monochrome until something is genuinely worth a colour.
 */
export const MOODS = {
  idle:    { state: 'idle',     tone: '' },
  watch:   { state: 'watching', tone: '' },
  alert:   { state: 'alert',    tone: 'warn' },
  pleased: { state: 'good',     tone: 'good' },
  think:   { state: 'reading',  tone: '' },
  flat:    { state: 'under',    tone: '' },
};

/**
 * Draw Pip into `host` and return the handle the page drives.
 *
 * The API is the one the drawn version had, so nothing that mounts it needs to
 * know it stopped being a drawing.
 */
export function mountPip(host, { onDismiss = null, name = 'pip' } = {}) {
  host.replaceChildren();
  host.classList.add('pip');

  const bar = document.createElement('div');
  bar.className = 'pip-bar';
  const who = document.createElement('span');
  who.className = 'pip-who';
  who.textContent = name + '@brewkit';
  const state = document.createElement('span');
  state.className = 'pip-state';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'pip-x';
  close.setAttribute('aria-label', 'Turn the coach off');
  close.textContent = '×';
  close.addEventListener('click', () => { hide(); onDismiss?.(); });
  bar.append(who, state, close);

  const line = document.createElement('div');
  line.className = 'pip-line';
  const face = document.createElement('span');
  face.className = 'pip-face';
  // The face is decoration over information the state word and the message
  // already carry, so a screen reader is not made to spell out punctuation.
  face.setAttribute('aria-hidden', 'true');
  // The caret lives INSIDE the line of text, not beside it, because that is the
  // grammar of a prompt: a caret follows what was typed. As a sibling it was
  // pushed to the far right of the pane by the flex row, which reads as a
  // status lamp rather than a cursor — and on a message long enough to wrap it
  // would have sat against the first line while the text ran on below it.
  const text = document.createElement('p');
  text.className = 'pip-text';
  const msg = document.createElement('span');
  msg.className = 'pip-say';
  msg.setAttribute('role', 'status');
  msg.setAttribute('aria-live', 'polite');
  const caret = document.createElement('span');
  caret.className = 'pip-caret';
  caret.setAttribute('aria-hidden', 'true');
  text.append(msg, caret);
  line.append(face, text);

  host.append(bar, line);

  let mood = 'idle';
  let holdTimer = null;

  function wear(m) {
    const v = MOODS[m] ?? MOODS.idle;
    mood = m;
    face.textContent = FACES[m] ?? FACES.idle;
    state.textContent = v.state;
    host.dataset.mood = m;
    host.dataset.tone = v.tone;
  }

  function say(message, { mood: m = 'idle', ms = 0 } = {}) {
    clearTimeout(holdTimer);
    msg.textContent = message;
    host.classList.add('is-talking');
    wear(m);
    if (ms > 0) holdTimer = setTimeout(() => hide(), ms);
  }

  /**
   * Stop talking — but the pane stays.
   *
   * A prompt with nothing to say is still a prompt, and its blinking caret is
   * the whole of "still watching". The drawn version had to disappear when it
   * had nothing to say, because a face with an empty speech bubble beside it
   * looks broken. This one does not.
   */
  function hide() {
    clearTimeout(holdTimer);
    msg.textContent = '';
    host.classList.remove('is-talking');
    wear(mood === 'alert' || mood === 'pleased' || mood === 'flat' ? mood : 'idle');
  }

  function destroy() {
    clearTimeout(holdTimer);
    host.replaceChildren();
    host.classList.remove('pip', 'is-talking');
    delete host.dataset.mood;
    delete host.dataset.tone;
  }

  wear('idle');

  return {
    say,
    hide,
    destroy,
    mood: wear,
    get current() { return mood; },
    get talking() { return host.classList.contains('is-talking'); },
    get text() { return msg.textContent; },
  };
}
