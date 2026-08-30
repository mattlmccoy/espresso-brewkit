// SVG charting. No dependencies.
//
// Hand-rolled rather than pulling in Plotly (~3 MB) or Chart.js: the chart
// types here are few and specific, colours come from CSS custom properties so
// everything follows the light/dark theme for free, and the 3D view needs a
// regression plane rather than a generic surface. Output is plain SVG, so it
// scales, prints, and can be saved straight out of the page.

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, parent = null) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  if (parent) parent.appendChild(n);
  return n;
};

/** "Nice" axis ticks — round numbers covering [min,max]. */
export function ticks(min, max, count = 6) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10) * mag;
  const out = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) {
    out.push(Math.round(t / step) * step);
  }
  return out;
}

const fmtTick = (v) => {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1000 || a < 0.01) return v.toExponential(1);
  return String(Math.round(v * 1000) / 1000);
};

function pad(min, max, frac = 0.06) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  const p = (max - min) * frac;
  return [min - p, max + p];
}

/**
 * @param cap  true  — never scale past the natural width. Necessary for charts
 *                     whose aspect ratio is tall or square (a box plot, the 3D
 *                     view): stretched to a wide panel they grow taller than
 *                     the viewport.
 *             false — fill the container. Right for wide charts, which
 *                     otherwise leave dead space in a full-width panel.
 */
function frame(container, { width = 720, height = 440, m = { t: 16, r: 18, b: 52, l: 64 }, cap = true } = {}) {
  container.replaceChildren();
  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'chart',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    style: cap ? `max-width:${width}px` : null,
  }, container);
  return { svg, width, height, m, iw: width - m.l - m.r, ih: height - m.t - m.b };
}

function axes(f, xd, yd, xLabel, yLabel) {
  const { svg, m, iw, ih } = f;
  const sx = (v) => m.l + ((v - xd[0]) / (xd[1] - xd[0])) * iw;
  const sy = (v) => m.t + ih - ((v - yd[0]) / (yd[1] - yd[0])) * ih;

  const g = el('g', {}, svg);
  for (const t of ticks(xd[0], xd[1])) {
    const x = sx(t);
    el('line', { x1: x, y1: m.t, x2: x, y2: m.t + ih, class: 'grid' }, g);
    el('text', { x, y: m.t + ih + 20, class: 'tick', 'text-anchor': 'middle' }, g).textContent = fmtTick(t);
  }
  for (const t of ticks(yd[0], yd[1])) {
    const y = sy(t);
    el('line', { x1: m.l, y1: y, x2: m.l + iw, y2: y, class: 'grid' }, g);
    el('text', { x: m.l - 10, y: y + 4, class: 'tick', 'text-anchor': 'end' }, g).textContent = fmtTick(t);
  }
  el('line', { x1: m.l, y1: m.t + ih, x2: m.l + iw, y2: m.t + ih, class: 'axis' }, g);
  el('line', { x1: m.l, y1: m.t, x2: m.l, y2: m.t + ih, class: 'axis' }, g);

  if (xLabel) {
    el('text', { x: m.l + iw / 2, y: f.height - 8, class: 'axis-label', 'text-anchor': 'middle' }, svg)
      .textContent = xLabel;
  }
  if (yLabel) {
    el('text', {
      x: 14, y: m.t + ih / 2, class: 'axis-label', 'text-anchor': 'middle',
      transform: `rotate(-90 14 ${m.t + ih / 2})`,
    }, svg).textContent = yLabel;
  }
  return { sx, sy };
}

/**
 * Scatter plot with an optional fitted line and 95% confidence band for the
 * mean response. The band is the honest part: it widens away from x̄, which is
 * exactly where a small dataset stops supporting extrapolation.
 */
export function scatter(container, { points, fit, xLabel, yLabel, flagged = new Set(), onHover,
                                     box = null }) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  if (!xs.length) return;
  const xd = pad(Math.min(...xs), Math.max(...xs));
  const yd = pad(Math.min(...ys), Math.max(...ys));

  const f = frame(container, { cap: false, ...(box ?? {}) });
  const { sx, sy } = axes(f, xd, yd, xLabel, yLabel);

  if (fit?.ok) {
    const steps = 60;
    const band = [];
    const lo = [];
    for (let i = 0; i <= steps; i++) {
      const x = xd[0] + ((xd[1] - xd[0]) * i) / steps;
      const y = fit.predict(x);
      const half = fit.tCrit * fit.seMean(x);
      band.push([sx(x), sy(y + half)]);
      lo.push([sx(x), sy(y - half)]);
    }
    el('path', {
      d: `M${band.map((p) => p.join(',')).join('L')}L${lo.reverse().map((p) => p.join(',')).join('L')}Z`,
      class: 'band',
    }, f.svg);
    el('line', {
      x1: sx(xd[0]), y1: sy(fit.predict(xd[0])),
      x2: sx(xd[1]), y2: sy(fit.predict(xd[1])),
      class: 'fit',
    }, f.svg);
  }

  const g = el('g', {}, f.svg);
  points.forEach((p, i) => {
    const c = el('circle', {
      cx: sx(p.x), cy: sy(p.y), r: 5,
      class: flagged.has(i) ? 'pt pt-flag' : 'pt',
    }, g);
    const title = el('title', {}, c);
    title.textContent = p.label ?? `(${fmtTick(p.x)}, ${fmtTick(p.y)})`;
    if (onHover) c.addEventListener('mouseenter', () => onHover(i));
  });
}

/** Residuals vs fitted. Structure here means the linear model is wrong. */
export function residuals(container, { fit, points, xLabel = 'Fitted value' }) {
  if (!fit?.ok) return;
  const pts = points.map((p, i) => ({ x: fit.predict(p.x), y: fit.resid[i] })).filter((p) => Number.isFinite(p.y));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const yMax = Math.max(...ys.map(Math.abs)) || 1;
  const xd = pad(Math.min(...xs), Math.max(...xs));
  const yd = [-yMax * 1.2, yMax * 1.2];

  const f = frame(container, { height: 260, cap: false });
  const { sx, sy } = axes(f, xd, yd, xLabel, 'Residual');
  el('line', { x1: f.m.l, y1: sy(0), x2: f.m.l + f.iw, y2: sy(0), class: 'zero' }, f.svg);
  const g = el('g', {}, f.svg);
  for (const p of pts) el('circle', { cx: sx(p.x), cy: sy(p.y), r: 4, class: 'pt' }, g);
}

/** Box plot with whiskers at the 1.5×IQR fence and outliers drawn separately. */
export function boxplot(container, { values, label = '' }) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 4) return;
  const q = (p) => {
    const pos = (v.length - 1) * p;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (pos - lo);
  };
  const q1 = q(0.25), med = q(0.5), q3 = q(0.75), iqr = q3 - q1;
  const fenceLo = q1 - 1.5 * iqr, fenceHi = q3 + 1.5 * iqr;
  const inside = v.filter((x) => x >= fenceLo && x <= fenceHi);
  const whiskLo = Math.min(...inside), whiskHi = Math.max(...inside);
  const out = v.filter((x) => x < fenceLo || x > fenceHi);

  const f = frame(container, { width: 340, height: 420, m: { t: 20, r: 20, b: 44, l: 64 } });
  const yd = pad(Math.min(...v), Math.max(...v), 0.12);
  const sy = (y) => f.m.t + f.ih - ((y - yd[0]) / (yd[1] - yd[0])) * f.ih;

  for (const t of ticks(yd[0], yd[1])) {
    el('line', { x1: f.m.l, y1: sy(t), x2: f.m.l + f.iw, y2: sy(t), class: 'grid' }, f.svg);
    el('text', { x: f.m.l - 10, y: sy(t) + 4, class: 'tick', 'text-anchor': 'end' }, f.svg).textContent = fmtTick(t);
  }
  const cx = f.m.l + f.iw / 2;
  const bw = Math.min(120, f.iw * 0.5);

  el('line', { x1: cx, y1: sy(whiskHi), x2: cx, y2: sy(q3), class: 'axis' }, f.svg);
  el('line', { x1: cx, y1: sy(whiskLo), x2: cx, y2: sy(q1), class: 'axis' }, f.svg);
  el('line', { x1: cx - bw / 4, y1: sy(whiskHi), x2: cx + bw / 4, y2: sy(whiskHi), class: 'axis' }, f.svg);
  el('line', { x1: cx - bw / 4, y1: sy(whiskLo), x2: cx + bw / 4, y2: sy(whiskLo), class: 'axis' }, f.svg);
  el('rect', { x: cx - bw / 2, y: sy(q3), width: bw, height: Math.max(1, sy(q1) - sy(q3)), class: 'box' }, f.svg);
  el('line', { x1: cx - bw / 2, y1: sy(med), x2: cx + bw / 2, y2: sy(med), class: 'median' }, f.svg);
  for (const o of out) el('circle', { cx, cy: sy(o), r: 5, class: 'pt pt-flag' }, f.svg);
  if (label) {
    el('text', { x: cx, y: f.height - 12, class: 'axis-label', 'text-anchor': 'middle' }, f.svg).textContent = label;
  }
}

/** Correlation matrix as a heatmap. Diverging scale centred on zero. */
export function heatmap(container, { matrix, labels }) {
  const n = labels.length;
  const cell = 62;
  const left = 132, top = 108;
  const f = frame(container, {
    width: left + n * cell + 20, height: top + n * cell + 24, m: { t: 0, r: 0, b: 0, l: 0 },
  });

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const r = matrix[i][j];
      const x = left + j * cell, y = top + i * cell;
      const t = Number.isFinite(r) ? r : 0;
      // Positive -> accent, negative -> cool. Alpha carries magnitude.
      const fill = t >= 0
        ? `color-mix(in oklab, var(--pos) ${Math.abs(t) * 100}%, transparent)`
        : `color-mix(in oklab, var(--neg) ${Math.abs(t) * 100}%, transparent)`;
      el('rect', { x, y, width: cell - 3, height: cell - 3, rx: 4, fill, class: 'cell' }, f.svg);
      el('text', {
        x: x + (cell - 3) / 2, y: y + (cell - 3) / 2 + 4,
        class: 'cell-text', 'text-anchor': 'middle',
      }, f.svg).textContent = Number.isFinite(r) ? r.toFixed(2) : '—';
    }
    el('text', { x: left - 10, y: top + i * cell + cell / 2, class: 'tick', 'text-anchor': 'end' }, f.svg)
      .textContent = labels[i];
    const lx = left + i * cell + (cell - 3) / 2;
    el('text', {
      x: lx, y: top - 10, class: 'tick', 'text-anchor': 'start',
      transform: `rotate(-45 ${lx} ${top - 10})`,
    }, f.svg).textContent = labels[i];
  }
}

/**
 * 3D scatter with a fitted regression plane, orthographic projection,
 * drag to rotate. Painter's algorithm on depth for correct occlusion.
 */
export function surface3d(container, { points, model, labels, size = 560 }) {
  let yaw = -0.7, pitch = 0.72;

  const xs = points.map((p) => p.x1);
  const zs = points.map((p) => p.x2);
  const ys = points.map((p) => p.y);
  const rx = [Math.min(...xs), Math.max(...xs)];
  const rz = [Math.min(...zs), Math.max(...zs)];
  const ry = [Math.min(...ys), Math.max(...ys)];
  const norm = (v, r) => (r[1] === r[0] ? 0.5 : (v - r[0]) / (r[1] - r[0])) - 0.5;

  function project(x, y, z) {
    // Rotate about the vertical (y) axis, then tilt.
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    const y1 = y * cp - z1 * sp;
    const depth = y * sp + z1 * cp;
    // 0.5 rather than something larger: the corner of a unit cube sits at
    // 0.5·√3 ≈ 0.866 of the half-extent, so any bigger scale clips the
    // bounding box at some rotations.
    const k = size * 0.5;
    return { px: size / 2 + x1 * k, py: size / 2 - y1 * k, depth };
  }

  // The SVG is created once and only its children are redrawn. Rebuilding the
  // element on every frame would detach the node the pointer capture is bound to
  // and, before this was restructured, leaked a fresh set of listeners per frame.
  container.replaceChildren();
  const svg = el('svg', {
    viewBox: `0 0 ${size} ${size}`,
    class: 'chart chart-3d',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    style: `max-width:${size}px`,
  }, container);

  function draw() {
    svg.replaceChildren();
    const items = [];

    // Bounding-box wireframe. Without it a plane and a cloud of dots float in
    // undifferentiated space and the rotation is impossible to read; the box is
    // what makes the orientation legible.
    const C = [-0.5, 0.5];
    const corners = [];
    for (const x of C) for (const y of C) for (const z of C) corners.push([x, y, z]);
    const EDGES = [[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
    for (const [a, b] of EDGES) {
      const p1 = project(...corners[a]);
      const p2 = project(...corners[b]);
      items.push({
        depth: Math.min(p1.depth, p2.depth) - 1e3, // always behind the data
        draw: () => el('line', {
          x1: p1.px, y1: p1.py, x2: p2.px, y2: p2.py, class: 'box3d',
        }, svg),
      });
    }

    // Plane as a quad mesh so it occludes points correctly cell by cell.
    if (model?.ok) {
      const N = 10;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => {
            const X = rx[0] + ((rx[1] - rx[0]) * a) / N;
            const Z = rz[0] + ((rz[1] - rz[0]) * b) / N;
            return project(norm(X, rx), norm(model.predict(X, Z), ry), norm(Z, rz));
          });
          items.push({
            depth: corners.reduce((s, c) => s + c.depth, 0) / 4,
            draw: () => el('polygon', {
              points: corners.map((c) => `${c.px},${c.py}`).join(' '),
              class: 'plane',
            }, svg),
          });
        }
      }
    }

    for (const p of points) {
      const q = project(norm(p.x1, rx), norm(p.y, ry), norm(p.x2, rz));
      items.push({
        depth: q.depth,
        draw: () => {
          const c = el('circle', { cx: q.px, cy: q.py, r: 6, class: 'pt pt-3d' }, svg);
          el('title', {}, c).textContent = p.label
            ?? `${fmtTick(p.x1)}, ${fmtTick(p.x2)} → ${fmtTick(p.y)}`;
        },
      });
    }

    items.sort((a, b) => a.depth - b.depth).forEach((it) => it.draw());

    if (labels) {
      const legend = el('g', {}, svg);
      labels.slice(0, 3).forEach((t, i) => {
        el('text', { x: 12, y: 20 + i * 17, class: 'tick' }, legend).textContent = t;
      });
    }
  }

  // Pointer events cover mouse, touch and pen with one path, and pointer capture
  // keeps the drag alive when the cursor leaves the element — no window listeners.
  let last = null;
  svg.addEventListener('pointerdown', (e) => {
    last = { x: e.clientX, y: e.clientY };
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!last) return;
    // Scale by the on-screen size so a drag rotates by the same amount
    // regardless of how the SVG has been scaled to fit its container.
    const scale = size / (svg.getBoundingClientRect().width || size);
    yaw += (e.clientX - last.x) * 0.01 * scale;
    pitch = Math.max(-1.4, Math.min(1.4, pitch + (e.clientY - last.y) * 0.01 * scale));
    last = { x: e.clientX, y: e.clientY };
    draw();
  });
  const end = (e) => {
    last = null;
    if (svg.hasPointerCapture?.(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  draw();
}

/**
 * The live pour: weight and flow together, against a reference.
 *
 * Weight alone is the least informative thing a scale can draw — it only ever
 * goes up, and every shot looks like the same tilted line. Flow is where the
 * shape is, and the shape is what says whether the puck held. Both share the
 * time axis and get their own vertical scale, so neither has to be rescaled to
 * fit the other.
 *
 * `ghost` is the point of the whole thing: a previous shot's weight curve drawn
 * underneath, so a pour is judged against something rather than against nothing.
 * Pulling to match a curve you already liked is a far more direct instruction
 * than "aim for 28 seconds".
 */
/**
 * The value at a given rank, for scaling an axis to the data rather than to
 * the worst sample in it.
 *
 * Exported so a test can hold it to the thing it exists for: a brief spike
 * must not move it, and a sustained level must.
 */
export function percentile(values, p) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return 0;
  const i = Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))));
  return v[i];
}

/** Round a scale top up to something a person would have chosen. */
function niceTop(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

export function livePlot(container, {
  weight = [], flow = [], ghost = [], ghostFlow = [], target = NaN,
  firstDrip = NaN, width = 720, height = 380,
} = {}) {
  const m = { t: 14, r: 46, b: 38, l: 46 };
  container.replaceChildren();
  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'chart live', role: 'img',
    // Not `none`: stretching the box to the container scaled 11px ticks to
    // about 4px on a phone and turned the end marker into an ellipse.
    preserveAspectRatio: 'xMidYMid meet',
  }, container);
  const iw = width - m.l - m.r, ih = height - m.t - m.b;

  const allT = [...weight, ...ghost].map((p) => p[0]);
  const tMax = Math.max(12, ...allT, Number.isFinite(firstDrip) ? firstDrip + 2 : 0);
  const wMax = Math.max(
    Number.isFinite(target) ? target * 1.12 : 0,
    10, ...[...weight, ...ghost].map((p) => p[1]),
  );
  const hasFlow = flow.length > 0 || ghostFlow.length > 0;
  // AN AXIS ONE BAD SAMPLE CANNOT SET.
  //
  // This was the raw maximum, and a hand resting on the scale for a moment
  // pushed it to 50 g/s — so the real 1-3 g/s pour spent the rest of the shot
  // squashed onto the floor of the chart, unreadable, because of a transient
  // that lasted a fraction of a second. A knock, the cup shifting or a
  // portafilter going back in does the same thing.
  //
  // The ninetieth percentile is the bound instead: a spike is a few samples
  // out of a few hundred and cannot move it, while the plateau a real pour
  // spends most of its time at does. The headroom on top is still needed —
  // without it the peak sample lands exactly on the frame and reads as a
  // border rather than as a series.
  const flowVals = [...flow, ...ghostFlow].map((q) => q[1]).filter(Number.isFinite);
  const fTrue = flowVals.length ? Math.max(...flowVals) : 0;
  const fMax = niceTop(Math.max(1.2, percentile(flowVals, 0.9)) * 1.15);

  const sx = (t) => m.l + (t / tMax) * iw;
  const sy = (w) => m.t + ih - (w / wMax) * ih;
  // Clamped, so a sample above the axis rides the top of the plot instead of
  // being drawn off the canvas. It is still not silent — see the note by the
  // flow axis, which says what the real peak was.
  const sf = (f) => m.t + ih - (Math.min(f, fMax) / fMax) * ih;

  for (const t of ticks(0, tMax, 6)) {
    el('line', { x1: sx(t), y1: m.t, x2: sx(t), y2: m.t + ih, class: 'grid' }, svg);
    el('text', { x: sx(t), y: m.t + ih + 17, class: 'tick', 'text-anchor': 'middle' }, svg)
      .textContent = fmtTick(t);
  }
  for (const w of ticks(0, wMax, 5)) {
    el('line', { x1: m.l, y1: sy(w), x2: m.l + iw, y2: sy(w), class: 'grid' }, svg);
    el('text', { x: m.l - 7, y: sy(w) + 4, class: 'tick', 'text-anchor': 'end' }, svg)
      .textContent = fmtTick(w);
  }
  // Only when there is a flow series to scale. The viewer passes weight and a
  // target and no flow at all, and this drew it a full g/s axis — six numbers
  // in the flow colour, for a line that is not on the chart.
  if (hasFlow) {
    for (const f of ticks(0, fMax, 4)) {
      el('text', { x: m.l + iw + 7, y: sf(f) + 4, class: 'tick tick-alt', 'text-anchor': 'start' }, svg)
        .textContent = fmtTick(f);
    }
  }

  const path = (pts, scale, cls) => {
    if (pts.length < 2) return;
    el('path', {
      d: 'M' + pts.map(([t, v]) => `${sx(t).toFixed(1)},${scale(v).toFixed(1)}`).join('L'),
      class: cls,
    }, svg);
  };

  // The reference goes down first so the live pour draws over it.
  path(ghost, sy, 'ghost');
  path(ghostFlow, sf, 'ghost ghost-flow');

  if (Number.isFinite(target) && target > 0 && target <= wMax) {
    el('line', { x1: m.l, y1: sy(target), x2: m.l + iw, y2: sy(target), class: 'target' }, svg);
    el('text', { x: m.l + iw - 4, y: sy(target) - 6, class: 'tick', 'text-anchor': 'end' }, svg)
      .textContent = `target ${target.toFixed(1)} g`;
  }
  if (Number.isFinite(firstDrip) && firstDrip > 0) {
    el('line', { x1: sx(firstDrip), y1: m.t, x2: sx(firstDrip), y2: m.t + ih, class: 'marker' }, svg);
  }

  path(flow, sf, 'flowline');
  path(weight, sy, 'weightline');

  // Where the pour has got to, so the eye finds it without hunting.
  const last = weight.at(-1);
  if (last) el('circle', { cx: sx(last[0]), cy: sy(last[1]), r: 4.5, class: 'pt' }, svg);

  // `unit` opts out of the uppercase the axis label carries, which turned these
  // into G and G / S — gauss, and a letter-spaced acronym.
  el('text', { x: m.l, y: m.t - 3, class: 'axis-label unit' }, svg).textContent = 'yield (g)';
  if (hasFlow) {
    // Anchored to the right edge: left-anchored it ran off the end of the plot
    // and rendered as "flow (g/", because the right margin is 46px and the
    // label is wider than that.
    // If anything went over the top, say so rather than letting a clamped line
    // pass for a real reading. An axis that ignores a spike must not hide it.
    const over = fTrue > fMax * 1.001;
    el('text', { x: width - 4, y: m.t - 3, class: 'axis-label alt unit',
      'text-anchor': 'end' }, svg).textContent = over
      ? `flow (g/s) \u00b7 peak ${fmtTick(fTrue)}`
      : 'flow (g/s)';
  }
  el('text', { x: m.l + iw / 2, y: height - 6, class: 'axis-label unit', 'text-anchor': 'middle' },
    svg).textContent = 'seconds';
  return svg;
}
