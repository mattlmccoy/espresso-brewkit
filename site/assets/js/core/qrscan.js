// A QR reader, because the alternative was typing 87 characters.
//
// The laptop shows the offer as a QR and the phone's camera reads it: that half
// works, because following a URL is the one thing every phone camera has done
// for years. The return trip is the problem. `BarcodeDetector` is the browser's
// own reader, and it is in Chrome on Android and almost nowhere else — not
// Safari, not Firefox, and not reliably in Chrome on macOS. So on the machine
// most likely to be the laptop, the scan button never appeared and the reply
// got typed out by hand.
//
// This is the other half: enough of ISO/IEC 18004 to turn a camera frame into
// the string the phone is showing. Then pairing is two camera actions and no
// keyboard, on every browser.
//
// It cannot be a PIN, which is the obvious question. A WebRTC answer has to
// carry the phone's DTLS certificate fingerprint — 32 bytes the browser checks
// against the certificate itself, so it can be neither shortened nor derived —
// plus ICE credentials the browser chooses and will not let us set. That is
// about 256 bits of irreducible entropy against a six-digit PIN's twenty. The
// only way to trade the long code for a short one is a server in the middle to
// hold the description while the PIN names it, and there is no server here and
// deliberately so. So the code stays long and stops being typed.

import { GF, M_SPECS, blocksOf, MASKS, versionBits, size, reservation } from './qr.js';

const { EXP, LOG, mul } = GF;
const inv = (a) => EXP[255 - LOG[a]];

/* ------------------------------------------------- Reed–Solomon, in reverse */
// The encoder only ever multiplies. A reader has to divide: a camera frame is
// never a clean matrix, and a symbol with a smudge on it is exactly what error
// correction is for. Level M carries enough check bytes to fix about a tenth of
// the codewords, which is the difference between a scan that works at arm's
// length and one that needs the phone flat on the glass.

/**
 * Correct a block of `data ++ check` in place, or return null past hope.
 *
 * The generator in the encoder is built from roots α⁰…α^(d-1), so the syndromes
 * are R(α⁰)…R(α^(d-1)) and Forney carries an X_k factor that a first-root-α¹
 * convention would not. Getting that wrong gives a reader that quietly corrects
 * nothing, which is why the test corrupts real codewords by the hundred and
 * checks the bytes come back rather than checking that it did not throw.
 */
export function correct(block, ecLen) {
  const n = block.length;
  const synd = new Uint8Array(ecLen);
  let bad = false;
  for (let i = 0; i < ecLen; i++) {
    let v = 0;
    for (let j = 0; j < n; j++) v = mul(v, EXP[i]) ^ block[j];
    synd[i] = v;
    if (v !== 0) bad = true;
  }
  if (!bad) return block;

  // Berlekamp–Massey: the shortest register that generates the syndromes.
  let lam = new Uint8Array(ecLen + 1); lam[0] = 1;
  let prev = new Uint8Array(ecLen + 1); prev[0] = 1;
  let L = 0, m = 1, b = 1;
  for (let r = 0; r < ecLen; r++) {
    let d = synd[r];
    for (let i = 1; i <= L; i++) d ^= mul(lam[i], synd[r - i]);
    if (d === 0) { m++; continue; }
    const scale = mul(d, inv(b));
    const shifted = new Uint8Array(ecLen + 1);
    for (let i = 0; i + m <= ecLen; i++) shifted[i + m] = mul(scale, prev[i]);
    const next = new Uint8Array(ecLen + 1);
    for (let i = 0; i <= ecLen; i++) next[i] = lam[i] ^ shifted[i];
    if (2 * L <= r) { prev = lam; b = d; L = r + 1 - L; m = 1; } else { m++; }
    lam = next;
  }
  if (L > ecLen / 2) return null;                       // more errors than checks

  // Chien search: every position whose locator is a root of Λ.
  const positions = [];
  for (let j = 0; j < n; j++) {
    // Λ(α^-j) — position j counted from the end of the codeword.
    let v = 0;
    for (let i = 0; i <= L; i++) v ^= mul(lam[i], EXP[((255 - j) * i) % 255]);
    if (v === 0) positions.push(n - 1 - j);
  }
  if (positions.length !== L) return null;              // roots we cannot place

  // Ω = S·Λ mod x^ecLen, then Forney for each magnitude.
  const omega = new Uint8Array(ecLen);
  for (let i = 0; i < ecLen; i++) {
    let v = 0;
    for (let j = 0; j <= Math.min(i, L); j++) v ^= mul(synd[i - j], lam[j]);
    omega[i] = v;
  }
  for (const pos of positions) {
    const j = n - 1 - pos;
    const xInv = EXP[(255 - j) % 255];
    let num = 0;
    for (let i = 0; i < ecLen; i++) num ^= mul(omega[i], EXP[(LOG[xInv] * i) % 255]);
    // The formal derivative over GF(2) keeps only the odd-power terms.
    let den = 0;
    for (let i = 1; i <= L; i += 2) den ^= mul(lam[i], EXP[(LOG[xInv] * (i - 1)) % 255]);
    if (den === 0) return null;
    // Forney, with the X_k the first-root-α⁰ generator asks for. Leaving it out
    // costs nothing visible — the syndromes below still refuse the block — so
    // the symptom is a reader that simply never corrects anything.
    block[pos] ^= mul(EXP[j % 255], mul(num, inv(den)));
  }
  // Cheap and worth it: a wrong correction usually leaves a nonzero syndrome.
  for (let i = 0; i < ecLen; i++) {
    let v = 0;
    for (let j = 0; j < n; j++) v = mul(v, EXP[i]) ^ block[j];
    if (v !== 0) return null;
  }
  return block;
}

/* ------------------------------------------------------------ format information */

/** Level and mask out of the fifteen format bits, nearest valid codeword. */
export function readFormat(bits) {
  let best = null, bestDist = 4;
  for (let data = 0; data < 32; data++) {
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const valid = (((data << 10) | rem) ^ 0x5412) >>> 0;
    let dist = 0;
    for (let x = valid ^ bits; x; x &= x - 1) dist++;
    if (dist < bestDist) { bestDist = dist; best = data; }
  }
  // 0b01 is level M, which is the only level this project writes; a symbol at
  // another level still decodes, the level only names how much slack there was.
  return best === null ? null : { level: (best >> 3) & 3, mask: best & 7 };
}

/* ------------------------------------------------------- matrix to characters */

/**
 * A finished module matrix, read back as text.
 *
 * Separate from the geometry on purpose: everything above this line is about
 * cameras and everything below is arithmetic, and only one of the two can be
 * tested without a lens.
 */
export function decodeMatrix(mod) {
  const n = mod.length;
  if (n < 21 || (n - 17) % 4) return null;
  let version = (n - 17) / 4;
  if (!M_SPECS[version]) return null;

  // Version seven and up writes its own version down; believe that over the
  // geometry, which is an estimate made from three blurry squares.
  if (version >= 7) {
    let bits = 0;
    for (let i = 17; i >= 0; i--) bits = (bits << 1) | (mod[Math.floor(i / 3)][n - 11 + (i % 3)] & 1);
    let best = null, bestDist = 4;
    for (let v = 7; v <= 40; v++) {
      let dist = 0;
      for (let x = (versionBits(v) ^ bits) >>> 0; x; x &= x - 1) dist++;
      if (dist < bestDist) { bestDist = dist; best = v; }
    }
    if (best !== null) version = best;
    if (!M_SPECS[version] || size(version) !== n) return null;
  }

  // The format sits in two places so a damaged corner cannot cost the symbol.
  const copyA = [];
  for (let i = 0; i < 6; i++) copyA.push(mod[8][i] & 1);
  copyA.push(mod[8][7] & 1, mod[8][8] & 1, mod[7][8] & 1);
  for (let i = 9; i < 15; i++) copyA.push(mod[14 - i][8] & 1);
  const copyB = [];
  for (let i = 0; i < 7; i++) copyB.push(mod[n - 1 - i][8] & 1);
  for (let i = 7; i < 15; i++) copyB.push(mod[8][n - 15 + i] & 1);
  // Most significant bit first: the first cell of the run carries bit 14.
  const pack = (arr) => arr.reduce((acc, bit, i) => acc | (bit << (14 - i)), 0) >>> 0;
  const fmt = readFormat(pack(copyA)) ?? readFormat(pack(copyB));
  if (!fmt) return null;

  const spec = M_SPECS[version];
  const { blocks, short, g1 } = blocksOf(spec);
  const skip = reservation(version);

  // The same zigzag the encoder walks, unmasked on the way out.
  const bits = [];
  let up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const row = up ? n - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (skip.mod[row][c] !== -1) continue;
        const v = mod[row][c] & 1;
        bits.push(MASKS[fmt.mask](row, c) ? v ^ 1 : v);
      }
    }
    up = !up;
  }
  const all = [];
  for (let i = 0; i + 8 <= bits.length && all.length < spec.total; i += 8) {
    all.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }
  if (all.length < spec.total) return null;

  // Un-interleave. Data first, block by block in turn, then the check bytes the
  // same way — which is the only reason the check bytes survive a smudge that
  // takes out a run of adjacent modules.
  const lens = [];
  for (let i = 0; i < blocks; i++) lens.push(i < g1 ? short : short + 1);
  const dataTotal = lens.reduce((a, b) => a + b, 0);
  const dataOut = Array.from({ length: blocks }, () => []);
  let at = 0;
  for (let i = 0; i < Math.max(...lens); i++) {
    for (let b = 0; b < blocks; b++) if (i < lens[b]) dataOut[b].push(all[at++]);
  }
  const ecOut = Array.from({ length: blocks }, () => []);
  at = dataTotal;
  for (let i = 0; i < spec.ec; i++) for (let b = 0; b < blocks; b++) ecOut[b].push(all[at++]);

  const data = [];
  for (let b = 0; b < blocks; b++) {
    const whole = Uint8Array.from([...dataOut[b], ...ecOut[b]]);
    if (!correct(whole, spec.ec)) return null;
    for (let i = 0; i < lens[b]; i++) data.push(whole[i]);
  }

  // Byte mode only: it is the only mode this project writes, and guessing at
  // kanji from a half-read symbol is a way to return confident nonsense.
  let bitAt = 0;
  const take = (count) => {
    let v = 0;
    for (let k = 0; k < count; k++) {
      const idx = bitAt + k;
      v = (v << 1) | ((data[idx >> 3] >> (7 - (idx & 7))) & 1);
    }
    bitAt += count;
    return v;
  };
  if (take(4) !== 0b0100) return null;
  const len = take(version < 10 ? 8 : 16);
  if (len <= 0 || bitAt + len * 8 > data.length * 8) return null;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = take(8);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return null; }
}

/* --------------------------------------------------------------- the camera */

/**
 * Black and white, decided locally.
 *
 * A global threshold fails on the thing this is actually pointed at: a phone
 * screen held under a kitchen light, bright in one corner and in shadow at the
 * other. So the frame is divided into blocks and each gets the mean of its own
 * neighbourhood, which costs one pass and rescues most of them.
 */
export function binarize(grey, w, h, block = 8) {
  const bw = Math.max(1, Math.ceil(w / block));
  const bh = Math.max(1, Math.ceil(h / block));
  const means = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sum = 0, count = 0, min = 255, max = 0;
      for (let y = by * block; y < Math.min(h, (by + 1) * block); y++) {
        for (let x = bx * block; x < Math.min(w, (bx + 1) * block); x++) {
          const v = grey[y * w + x];
          sum += v; count++;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      // A block of flat colour has no edge in it, so its own mean is a
      // meaningless threshold — borrow from the neighbours instead.
      means[by * bw + bx] = max - min > 24 ? sum / count : -1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sum = 0, count = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const yy = by + dy, xx = bx + dx;
          if (yy < 0 || xx < 0 || yy >= bh || xx >= bw) continue;
          const m = means[yy * bw + xx];
          if (m >= 0) { sum += m; count++; }
        }
      }
      const thr = count ? sum / count : 128;
      for (let y = by * block; y < Math.min(h, (by + 1) * block); y++) {
        for (let x = bx * block; x < Math.min(w, (bx + 1) * block); x++) {
          out[y * w + x] = grey[y * w + x] < thr ? 1 : 0;
        }
      }
    }
  }
  return out;
}

/** Greyscale, from whatever a canvas handed over. */
export function greyscale(data, w, h) {
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  return out;
}

// The three squares in the corners, which are the only things in a QR code
// guaranteed to be there whatever the payload. Their giveaway is a run of
// dark-light-dark-light-dark in the ratio 1:1:3:1:1 through the centre, and it
// holds along a row, a column and both diagonals — which is what makes it
// findable without knowing where to look.
const FINDER = [1, 1, 3, 1, 1];

function ratioOk(runs, ratio) {
  const total = runs.reduce((a, b) => a + b, 0);
  const span = ratio.reduce((a, b) => a + b, 0);
  if (total < span) return false;
  const unit = total / span;
  return ratio.every((want, i) => Math.abs(runs[i] - want * unit) < unit * 0.6 * Math.max(1, want * 0.5));
}

/** Walk one line and report the centre of the middle run of any match. */
function scanLine(get, length, ratio = FINDER) {
  const span = ratio.reduce((a, b) => a + b, 0);
  const hits = [];
  const runs = [0, 0, 0, 0, 0];
  let state = 0;
  const record = (end) => {
    const total = runs.reduce((a, b) => a + b, 0);
    hits.push({ centre: end - runs[4] - runs[3] - runs[2] / 2, unit: total / span });
  };
  for (let i = 0; i < length; i++) {
    const dark = get(i);
    if (dark === (state % 2 === 0 ? 1 : 0)) {
      runs[state]++;
    } else if (state === 4) {
      if (ratioOk(runs, ratio)) record(i);
      runs.copyWithin(0, 2);
      runs[2] = runs[4];
      runs[3] = 1; runs[4] = 0;
      state = 3;
    } else {
      runs[++state] = 1;
    }
  }
  if (state === 4 && ratioOk(runs, ratio)) record(length);
  return hits;
}

/** Finder centres: candidates from the rows, confirmed down the columns. */
export function findFinders(bits, w, h) {
  const found = [];
  const step = Math.max(1, Math.floor(h / 220));
  for (let y = step; y < h; y += step) {
    for (const hit of scanLine((x) => bits[y * w + x], w)) {
      const x = Math.round(hit.centre);
      if (x < 0 || x >= w) continue;
      // Confirm vertically through the same centre: a run of five bands across
      // a row is common in ordinary pictures, in both directions much less so.
      const vert = scanLine((yy) => bits[yy * w + x], h)
        .find((v) => Math.abs(v.centre - y) < hit.unit * 2);
      if (!vert) continue;
      const cx = hit.centre, cy = vert.centre;
      const unit = (hit.unit + vert.unit) / 2;
      const near = found.find((f) => Math.hypot(f.x - cx, f.y - cy) < unit * 2);
      if (near) {
        near.x = (near.x * near.n + cx) / (near.n + 1);
        near.y = (near.y * near.n + cy) / (near.n + 1);
        near.unit = (near.unit * near.n + unit) / (near.n + 1);
        near.n++;
      } else {
        found.push({ x: cx, y: cy, unit, n: 1 });
      }
    }
  }
  // A single stray row can fake one; three rows agreeing cannot as easily.
  return found.filter((f) => f.n >= 2).sort((a, b) => b.n - a.n);
}

/**
 * Which finder is which.
 *
 * The three sit at the corners of a right angle. The two furthest apart are the
 * ends of the hypotenuse, so the third is the top-left, and the sign of the
 * cross product says which of the other two is along the top.
 */
export function orient(fs) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const [a, b, c] = fs;
  const pairs = [[d(b, c), a, b, c], [d(a, c), b, a, c], [d(a, b), c, a, b]];
  pairs.sort((p, q) => q[0] - p[0]);
  const [, tl, p, q] = pairs[0];
  const cross = (p.x - tl.x) * (q.y - tl.y) - (p.y - tl.y) * (q.x - tl.x);
  return cross < 0 ? { tl, tr: q, bl: p } : { tl, tr: p, bl: q };
}

/* ------------------------------------------------------ perspective sampling */
// A phone held at a comfortable angle is not parallel to a webcam, so the
// symbol on screen is a general quadrilateral rather than a square. Three
// finders give an affine guess; the alignment pattern near the far corner gives
// the fourth point that turns it into a perspective one, which is the
// difference between reading a code held square-on and one held at all.

function squareToQuad(x0, y0, x1, y1, x2, y2, x3, y3) {
  const dx3 = x0 - x1 + x2 - x3;
  const dy3 = y0 - y1 + y2 - y3;
  if (dx3 === 0 && dy3 === 0) {
    return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
  }
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const denom = dx1 * dy2 - dx2 * dy1;
  const a13 = (dx3 * dy2 - dx2 * dy3) / denom;
  const a23 = (dx1 * dy3 - dx3 * dy1) / denom;
  return [x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0,
          y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0,
          a13, a23, 1];
}

const adjoint = (m) => [
  m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
  m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
  m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
];

// Plain row-major 3x3. Transposing it by accident costs nothing that looks like
// an error: the finders are still found, the dimension is still right, and every
// frame simply fails to decode.
const times = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
  a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
  a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
  a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
  a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
  a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
  a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];

/** Grid coordinates in, image coordinates out. */
export function quadToQuad(src, dst) {
  return times(squareToQuad(...dst), adjoint(squareToQuad(...src)));
}

export function apply(m, x, y) {
  const d = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / d, (m[3] * x + m[4] * y + m[5]) / d];
}

/** Read the module at each grid centre, voting over a small neighbourhood. */
function sampleGrid(bits, w, h, n, tf) {
  const mod = Array.from({ length: n }, () => new Int8Array(n));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const [x, y] = apply(tf, c + 0.5, r + 0.5);
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) return null;
      // Three of five: one stray pixel on a module edge should not flip it.
      let dark = 0;
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const xx = Math.min(w - 1, Math.max(0, xi + dx));
        const yy = Math.min(h - 1, Math.max(0, yi + dy));
        dark += bits[yy * w + xx];
      }
      mod[r][c] = dark >= 3 ? 1 : 0;
    }
  }
  return mod;
}

/** One line as runs of a single colour, which is easier to reason about. */
function runsOf(get, length) {
  const out = [];
  let colour = get(0), start = 0;
  for (let i = 1; i <= length; i++) {
    const c = i < length ? get(i) : -1;
    if (c === colour) continue;
    out.push({ colour, start, len: i - start });
    colour = c; start = i;
  }
  return out;
}

/**
 * Centres of anything shaped like an alignment pattern along one line.
 *
 * Through the middle of one the runs go: the outer ring, a gap, the single dark
 * centre module, a gap, the outer ring again. Only the middle three are a
 * module wide each — the outer two run into whatever data module sits beside
 * the pattern, and about half of those are dark, so insisting all five measure
 * one module throws away most of the lines that actually cross one. That was
 * the whole reason a tilted symbol never read: the pattern was there, in focus,
 * and never matched.
 */
function alignmentHits(get, length, unit) {
  const runs = runsOf(get, length);
  const hits = [];
  const near = (r) => Math.abs(r.len - unit) <= unit * 0.65;
  for (let i = 0; i + 4 < runs.length; i++) {
    const [a, b, c, d, e] = runs.slice(i, i + 5);
    if (a.colour !== 1 || b.colour !== 0 || c.colour !== 1 || d.colour !== 0 || e.colour !== 1) continue;
    if (!near(b) || !near(c) || !near(d)) continue;
    if (a.len < unit * 0.4 || e.len < unit * 0.4) continue;
    hits.push({ centre: c.start + c.len / 2, unit: (b.len + c.len + d.len) / 3 });
  }
  return hits;
}

/**
 * Candidate centres for the alignment pattern, nearest guess first.
 *
 * A plural, and that is the point. Five alternating single modules is one of
 * the commonest shapes in a QR data area, so a window around the predicted
 * position holds several convincing candidates and picking the closest is a
 * coin toss — one that costs the whole frame when it loses. The caller tries
 * them in turn and lets the decoder say which was right, which it can do with
 * certainty: a grid sampled off the true one fails the format BCH, or the
 * Reed–Solomon, or the mode nibble, or UTF-8, and essentially never fails all
 * four to land on a plausible string.
 */
export function alignmentCandidates(bits, w, h, ex, ey, unit, { span: spanMod = 5, limit = 6 } = {}) {
  const span = Math.max(6, Math.round(unit * spanMod));
  const x0 = Math.max(0, Math.round(ex - span));
  const x1 = Math.min(w - 1, Math.round(ex + span));
  const y0 = Math.max(0, Math.round(ey - span));
  const y1 = Math.min(h - 1, Math.round(ey + span));
  if (x1 - x0 < 5 || y1 - y0 < 5) return [];
  const found = [];
  for (let y = y0; y <= y1; y++) {
    for (const hit of alignmentHits((i) => bits[y * w + x0 + i], x1 - x0 + 1, unit)) {
      const cx = x0 + hit.centre;
      const xi = Math.round(cx);
      if (xi < 0 || xi >= w) continue;
      const vert = alignmentHits((i) => bits[(y0 + i) * w + xi], y1 - y0 + 1, unit)
        .map((v) => ({ ...v, centre: y0 + v.centre }))
        .find((v) => Math.abs(v.centre - y) < unit * 1.5);
      if (!vert) continue;
      const near = found.find((f) => Math.hypot(f.x - cx, f.y - vert.centre) < unit);
      if (near) {
        near.x = (near.x * near.n + cx) / (near.n + 1);
        near.y = (near.y * near.n + vert.centre) / (near.n + 1);
        near.n++;
      } else {
        found.push({ x: cx, y: vert.centre, n: 1 });
      }
    }
  }
  return found
    .filter((f) => f.n >= 2)
    .sort((a, b) => Math.hypot(a.x - ex, a.y - ey) - Math.hypot(b.x - ex, b.y - ey))
    .slice(0, limit);
}

/**
 * A camera frame in, the string it is showing out, or null.
 *
 * Null is the ordinary case rather than a failure: the caller points this at a
 * video and calls it on every frame, and most frames have nothing in them.
 */
export function scan(imageData) {
  const { width: w, height: h } = imageData;
  const grey = greyscale(imageData.data, w, h);
  const bits = binarize(grey, w, h);
  const finders = findFinders(bits, w, h);
  if (finders.length < 3) return null;

  // More than three means false positives; the best-attested three win, but a
  // fourth square in the frame should not cost the symbol, so a few triples
  // are tried before giving up on the frame.
  const tries = [];
  for (let a = 0; a < Math.min(finders.length, 5); a++) {
    for (let b = a + 1; b < Math.min(finders.length, 5); b++) {
      for (let c = b + 1; c < Math.min(finders.length, 5); c++) {
        tries.push([finders[a], finders[b], finders[c]]);
      }
    }
  }
  for (const trio of tries.slice(0, 6)) {
    const text = fromTrio(bits, w, h, trio);
    if (text) return text;
  }
  return null;
}

function fromTrio(bits, w, h, trio) {
  const { tl, tr, bl } = orient(trio);
  const unit = (tl.unit + tr.unit + bl.unit) / 3;
  if (!(unit > 0.7)) return null;

  // Modules across, from the finder spacing. Valid dimensions are 4v+17, so the
  // estimate is snapped to the nearest one rather than trusted.
  const across = (Math.hypot(tr.x - tl.x, tr.y - tl.y) / unit
                + Math.hypot(bl.x - tl.x, bl.y - tl.y) / unit) / 2 + 7;
  let n = Math.round((Math.round(across) - 17) / 4) * 4 + 17;
  if (n < 21 || n > size(15)) return null;
  const version = (n - 17) / 4;

  // Three points give an affine map; the far corner is guessed from them.
  const brx = tr.x + bl.x - tl.x;
  const bry = tr.y + bl.y - tl.y;
  const src3 = [3.5, 3.5, n - 3.5, 3.5, n - 3.5, n - 3.5, 3.5, n - 3.5];
  let tf = quadToQuad(src3, [tl.x, tl.y, tr.x, tr.y, brx, bry, bl.x, bl.y]);

  // Square on to the camera, three points are the whole story and this is the
  // end of it. It is also the cheap case, so it is tried before any hunting.
  const read = (t) => {
    const mod = sampleGrid(bits, w, h, n, t);
    return mod ? decodeMatrix(mod) : null;
  };
  const straight = read(tf);
  if (straight || version < 2) return straight;

  // Held at an angle it is not: an affine map cannot express a keystone, and
  // the far corner guessed from the other three drifts by whole modules. The
  // alignment pattern is the fourth point that fixes it.
  const [ex, ey] = apply(tf, n - 6.5, n - 6.5);
  const src4 = [3.5, 3.5, n - 3.5, 3.5, n - 6.5, n - 6.5, 3.5, n - 3.5];

  // How wrong that estimate is depends on how hard the perspective is, and the
  // hard cases are exactly the ones that need it. A gentle tilt puts it within
  // a module; a phone leaning well back puts it ten modules out, because the
  // far corner is extrapolated from three points by a map that cannot bend.
  // So the window opens in stages rather than being one guess at a good size:
  // near candidates get tried first and cheaply, and a wide sweep only happens
  // on frames that have already failed everything closer.
  // And the modules down there are not the size they are up at the finders. A
  // symbol leaning away has a near edge half again as wide as its far one, so
  // hunting a five-module pattern at the finders' module size looks for
  // something the wrong size and finds nothing at all. The transform knows the
  // local scale even while it has the position wrong, so ask it.
  // The transform's own local scale is the best single guess, but under a steep
  // lean it is itself wrong — it comes from the same map that put the position
  // ten modules out. Measured on a hard case: true module 5.6 px, transform
  // said 3.5, finders said 4.8, and searching at any one of those alone finds
  // nothing. So a spread is tried, cheapest first. A wrong size costs one pass
  // that matches nothing; a missing size costs the frame.
  const [nx, ny] = apply(tf, n - 5.5, n - 6.5);
  const local = Math.hypot(nx - ex, ny - ey);
  const units = [...new Set([local, unit, unit * 1.35, local * 1.6, unit * 0.75]
    .map((u) => +u.toFixed(2)))].filter((u) => u > 0.7);

  const seen = [];
  for (const spanMod of [5, 10, 18]) {
   for (const u of units) {
    for (const hit of alignmentCandidates(bits, w, h, ex, ey, u, { span: spanMod, limit: 8 })) {
      if (seen.some((p) => Math.hypot(p.x - hit.x, p.y - hit.y) < unit)) continue;
      seen.push(hit);
      if (seen.length > 22) return null;
      const text = read(quadToQuad(src4,
        [tl.x, tl.y, tr.x, tr.y, hit.x, hit.y, bl.x, bl.y]));
      if (text) return text;
    }
   }
  }
  return null;
}
