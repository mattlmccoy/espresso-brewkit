// The replay panel: the brew stage, playing back.
//
// Built out of the same parts the live pour is built out of — the same dial,
// the same plot, the same ladder — because a replay that renders the shot
// differently from the screen you watched is a second opinion about your own
// coffee. If the dial said espresso at 24 g during the pour, it says espresso
// at 24 g in the replay, for the arithmetic reason that it is the same code.
//
// What it does NOT reuse is Live's markup. The pour column on Live is wired to
// a session, a scale and a coach; borrowing it would mean a replay could only
// exist on the one page that already has all three, and the whole point is that
// a saved replay is watchable from the log weeks later.
//
// CLEAR REPLAY MODE. The panel says, continuously and without a caption, that
// this is a recording: the transport is the loudest thing in it, the elapsed
// time reads as a position in a length rather than as a stopwatch, and the
// whole panel carries a marked border so it can never be mistaken for a shot
// happening now. That last one matters more than it sounds — the numbers are
// live-looking and moving, and a screen that shows a pour in progress that is
// not in progress is the one genuinely bad outcome here.

import { el } from '../ui.js';
import { Replay, SPEEDS } from './replay.js';
import { livePlot } from './chart.js';
import { mountGauge, geoFor } from './gauge.js';
import { shotDial } from './dial.js';
import { landmarks, styleOf } from './styles.js';

const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');

/**
 * Mount a replay of one shot inside `root`.
 *
 * `shot` supplies what the curve cannot: the dose the dial is scaled to, the
 * target the plot draws its line at, and which drink this was. A replay with no
 * dose still plays — it just has a weight and a curve rather than a dial, which
 * is the honest rendering of a shot logged without one.
 *
 * Returns a handle with `destroy`, so a page that swaps replays does not leave
 * a frame loop running behind the one on screen.
 */
export function mountReplay(root, { shot = {}, curve = [], onClose = null,
                                    autoplay = false, clock = {} } = {}) {
  const dose = Number(shot.dose_g);
  const target = Number(shot.yield_g);
  const method = shot.method || 'espresso';

  root.classList.add('replay');
  root.replaceChildren();

  // ---- the head: what this is, and the way out ------------------------------
  const head = el('div', { class: 'replay-head' },
    el('span', { class: 'tag' }, 'Replay'),
    el('span', { class: 'replay-of' },
      [shot.shot_id?.replace('shot-', '#'), shot.bean_name || shot.roaster]
        .filter(Boolean).join(' · ')));
  if (onClose) {
    head.append(el('button', { class: 'ghost replay-x', type: 'button',
      onclick: () => { handle.destroy(); onClose(); } }, 'Close'));
  }

  // ---- the stage: the dial, the numbers, the curve ---------------------------
  const big = el('div', { class: 'replay-n' }, el('b', {}, '0.0'), el('i', {}, 'g'));
  const dialBox = el('div', { class: 'replay-dial' });
  const gauge = dose > 0 ? mountGauge(dialBox, { geo: geoFor() }) : null;
  const plot = el('div', { class: 'replay-plot' });

  const stat = (k) => {
    const v = el('b', {}, '—');
    // Its own classes, not Live's `.pn`: those live in live.html's own <style>,
    // so on the Shots page this row rendered as unstyled runs of text. A shared
    // panel cannot depend on the CSS of one page that happens to use it.
    return { node: el('div', { class: 'replay-stat' },
      el('span', { class: 'replay-k' }, k), el('span', { class: 'replay-v' }, v)), v };
  };
  const sFlow = stat('Flow');
  const sRatio = stat('Ratio');
  const sStyle = stat('Style');
  const nums = el('div', { class: 'replay-nums' }, sFlow.node, sRatio.node, sStyle.node);

  const ladder = el('div', { class: 'replay-ladder' });

  // ---- the transport --------------------------------------------------------
  const playBtn = el('button', { class: 'primary replay-play', type: 'button' }, 'Play');
  const scrub = el('input', { class: 'replay-scrub', type: 'range',
    min: '0', max: '1000', value: '0', step: '1',
    'aria-label': 'Position in the shot' });
  const clockOut = el('span', { class: 'replay-clock' }, '0.0 / 0.0 s');
  const speedBtns = SPEEDS.map((x) => el('button',
    { class: 'ghost replay-speed', type: 'button', 'data-speed': String(x) }, `${x}×`));
  const bar = el('div', { class: 'replay-bar' },
    playBtn, scrub, clockOut, el('span', { class: 'replay-speeds' }, ...speedBtns));

  root.append(head, el('div', { class: 'replay-stage' },
    el('div', { class: 'replay-left' }, big, dialBox, nums),
    el('div', { class: 'replay-right' }, plot, ladder)), bar);

  // ---- the machine ----------------------------------------------------------
  const rep = new Replay(curve, { onTick: paint, ...clock });

  function paintPlot(trace) {
    const w = Math.max(320, Math.round(plot.clientWidth || 520));
    const h = Math.max(180, Math.round(plot.clientHeight || 240));
    // The flow trace is derived from the part of the curve that has played, not
    // from the whole shot — otherwise the flow line arrives before the weight
    // line that produces it, which reads as the future being drawn already.
    const fs = trace.length > 4
      ? trace.map((p, i, a) => {
        const j = Math.max(0, i - 3);
        const dt = a[i][0] - a[j][0];
        return [p[0], dt > 1e-6 ? Math.max(0, (a[i][1] - a[j][1]) / dt) : 0];
      }) : [];
    livePlot(plot, {
      weight: trace, flow: fs,
      target: Number.isFinite(target) ? target : NaN,
      // THE AXIS DOES NOT GROW. A live chart widens as the shot runs because the
      // end is unknown; here it is known, and a rescaling axis makes the trace
      // stand still while the grid slides under it — which is the opposite of
      // watching a pour. Fixed to the whole shot, the curve sweeps across.
      tMax: rep.duration,
      width: w, height: h,
    });
  }

  function paint(s) {
    big.firstChild.textContent = fmt(s.w, 1);
    sFlow.v.textContent = `${fmt(s.flow, 2)} g/s`;
    sRatio.v.textContent = dose > 0 && s.w > 0 ? `1:${fmt(s.w / dose, 2)}` : '—';
    const style = styleOf(method, dose, s.w);
    sStyle.v.textContent = style?.label ?? '—';
    if (gauge) {
      gauge.paint(shotDial(method, dose,
        { net: s.w, target: Number.isFinite(target) ? target : null }));
    }
    paintLadder(s.w);
    paintPlot(s.trace);
    playBtn.textContent = s.playing ? 'Pause' : (rep.ended ? 'Again' : 'Play');
    playBtn.setAttribute('aria-pressed', String(s.playing));
    clockOut.textContent = `${fmt(s.t, 1)} / ${fmt(s.duration, 1)} s`;
    // Not while a finger is on it: writing the value back mid-drag fights the
    // drag.
    if (document.activeElement !== scrub) {
      scrub.value = String(Math.round((s.t / (s.duration || 1)) * 1000));
    }
    for (const b of speedBtns) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s.speed));
    }
    root.classList.toggle('is-playing', s.playing);
  }

  // The landmarks do not move: the dose and the target are fixed for the whole
  // replay, so the rungs are built once and only their state changes.
  const rungs = dose > 0
    ? landmarks(method, dose, { target: Number.isFinite(target) ? target : null })
      .map((m) => ({ m, node: el('span', { class: 'replay-rung' },
        el('b', {}, m.label), el('i', {}, `${fmt(m.grams, 1)} g`)) }))
    : [];
  ladder.append(...rungs.map((r) => r.node));

  function paintLadder(w) {
    // Which one you are IN, not which one you have passed: the rung that is
    // lit is the one this weight is on its way to.
    const next = rungs.find((r) => w < r.m.grams);
    for (const r of rungs) {
      r.node.classList.toggle('past', w >= r.m.grams);
      r.node.classList.toggle('here', r === next);
    }
  }

  playBtn.addEventListener('click', () => rep.toggle());
  scrub.addEventListener('input', () => {
    rep.seek((Number(scrub.value) / 1000) * rep.duration);
  });
  for (const b of speedBtns) {
    b.addEventListener('click', () => rep.setSpeed(Number(b.dataset.speed)));
  }
  // Space is what every player in the world uses, and this panel is a player.
  // Scoped to the panel, so it cannot eat the space bar of a page behind it.
  root.tabIndex = -1;
  root.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); rep.toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); rep.seek(rep.t + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); rep.seek(rep.t - 1); }
  });

  let resizeTimer = null;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => paintPlot(rep.data.pts.filter((p) => p[0] <= rep.t)), 120);
  };
  addEventListener('resize', onResize);

  const handle = {
    root, replay: rep,
    play: () => rep.play(),
    destroy() {
      rep.destroy();
      removeEventListener('resize', onResize);
      clearTimeout(resizeTimer);
    },
  };

  // Painted once at zero so the panel is the shot at its start rather than
  // empty boxes waiting for a press.
  rep.seek(0);
  if (!rep.playable) {
    playBtn.disabled = true;
    scrub.disabled = true;
    clockOut.textContent = 'Nothing recorded';
  } else if (autoplay) {
    rep.play();
  }
  return handle;
}
