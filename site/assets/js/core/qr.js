// A QR encoder, because the alternative was pasting 830 characters twice.
//
// Written out rather than pulled in: this project ships no runtime
// dependencies, and a QR encoder is a few hundred lines of well-specified
// arithmetic rather than a judgement call. ISO/IEC 18004, byte mode, error
// correction level M, versions 1–15 — which covers anything this app needs to
// show, the largest being a URL with a packed session description in it.
//
// The point of it is the pairing. See core/sdp.js for how an 830-character
// offer becomes 87; that is what makes the code small enough to be a QR the
// iOS Camera app can read off a laptop screen from across a worktop, which in
// turn is what removes one of the two pastes entirely.

/* ------------------------------------------------------- Galois field GF(256) */
// QR's Reed–Solomon works over GF(256) with the primitive polynomial 0x11d.
// Logarithm tables turn multiplication into addition, which is what makes the
// generator polynomials cheap to build.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** The generator polynomial for `degree` error-correction codewords. */
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** The `degree` check codewords for one block of data. */
export function ecCodewords(data, degree) {
  const gen = generator(degree);
  const out = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ out[0];
    out.copyWithin(0, 1);
    out[degree - 1] = 0;
    for (let i = 0; i < degree; i++) out[i] ^= mul(gen[i + 1], factor);
  }
  return out;
}

/* ------------------------------------------------------------ version tables */
// Per version at error-correction level M: total codewords, EC codewords per
// block, and the block layout. Straight from the standard's tables; there is no
// deriving these.

const M_SPECS = {
  1:  { total: 26,   ec: 10, g1: 1, g2: 0 },
  2:  { total: 44,   ec: 16, g1: 1, g2: 0 },
  3:  { total: 70,   ec: 26, g1: 1, g2: 0 },
  4:  { total: 100,  ec: 18, g1: 2, g2: 0 },
  5:  { total: 134,  ec: 24, g1: 2, g2: 0 },
  6:  { total: 172,  ec: 16, g1: 4, g2: 0 },
  7:  { total: 196,  ec: 18, g1: 4, g2: 0 },
  8:  { total: 242,  ec: 22, g1: 2, g2: 2 },
  9:  { total: 292,  ec: 22, g1: 3, g2: 2 },
  10: { total: 346,  ec: 26, g1: 4, g2: 1 },
  11: { total: 404,  ec: 30, g1: 1, g2: 4 },
  12: { total: 466,  ec: 22, g1: 6, g2: 2 },
  13: { total: 532,  ec: 22, g1: 8, g2: 1 },
  14: { total: 581,  ec: 24, g1: 4, g2: 5 },
  15: { total: 655,  ec: 24, g1: 5, g2: 5 },
};

/** Where the alignment patterns go, by version. Empty for version 1. */
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66],
  15: [6, 26, 48, 70],
};

const blocksOf = (spec) => {
  const blocks = spec.g1 + spec.g2;
  const dataTotal = spec.total - spec.ec * blocks;
  const short = Math.floor(dataTotal / blocks);
  return { blocks, short, g1: spec.g1, g2: spec.g2, dataTotal };
};

/** How many bytes fit at level M in a given version. */
export function capacity(version) {
  const spec = M_SPECS[version];
  if (!spec) return 0;
  const { dataTotal } = blocksOf(spec);
  const countBits = version < 10 ? 8 : 16;
  return dataTotal - 1 - Math.ceil(countBits / 8);
}

/* --------------------------------------------------------------- the encoder */

function bitsFor(bytes, version) {
  const spec = M_SPECS[version];
  const { dataTotal } = blocksOf(spec);
  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  push(0b0100, 4);                                   // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacityBits = dataTotal * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);   // terminator
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }
  // Pad alternately with the two bytes the standard names, forever.
  const PAD = [0xec, 0x11];
  for (let i = 0; out.length < dataTotal; i++) out.push(PAD[i % 2]);
  return Uint8Array.from(out);
}

/** Split into blocks, add check codewords, and interleave as the standard says. */
function codewords(data, version) {
  const spec = M_SPECS[version];
  const { blocks, short, g1 } = blocksOf(spec);
  const dataBlocks = [];
  const ecBlocks = [];
  let at = 0;
  for (let i = 0; i < blocks; i++) {
    const len = i < g1 ? short : short + 1;
    const block = data.slice(at, at + len);
    at += len;
    dataBlocks.push(block);
    ecBlocks.push(ecCodewords(block, spec.ec));
  }
  const out = [];
  const longest = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) {
    for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < spec.ec; i++) for (const b of ecBlocks) out.push(b[i]);
  return Uint8Array.from(out);
}

/* ---------------------------------------------------------------- the matrix */

const size = (version) => version * 4 + 17;

function blank(version) {
  const n = size(version);
  return { n, mod: Array.from({ length: n }, () => new Int8Array(n).fill(-1)) };
}

function placeFinder(m, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.n || cc >= m.n) continue;
      const edge = r === -1 || r === 7 || c === -1 || c === 7;
      const ring = (r === 0 || r === 6 || c === 0 || c === 6) && !edge;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m.mod[rr][cc] = edge ? 0 : ring || core ? 1 : 0;
    }
  }
}

function reserve(m, version) {
  placeFinder(m, 0, 0);
  placeFinder(m, 0, m.n - 7);
  placeFinder(m, m.n - 7, 0);
  // Timing patterns.
  for (let i = 8; i < m.n - 8; i++) {
    const bit = i % 2 === 0 ? 1 : 0;
    if (m.mod[6][i] === -1) m.mod[6][i] = bit;
    if (m.mod[i][6] === -1) m.mod[i][6] = bit;
  }
  // Alignment patterns, everywhere they do not collide with a finder.
  const centres = ALIGN[version] ?? [];
  for (const r of centres) {
    for (const c of centres) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= m.n - 9) || (r >= m.n - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          m.mod[r + dr][c + dc] =
            Math.max(Math.abs(dr), Math.abs(dc)) === 1 ? 0 : 1;
        }
      }
    }
  }
  m.mod[m.n - 8][8] = 1;   // the one module that is always dark
  // Format information areas, filled later but reserved now.
  for (let i = 0; i < 9; i++) {
    if (m.mod[8][i] === -1) m.mod[8][i] = -2;
    if (m.mod[i][8] === -1) m.mod[i][8] = -2;
  }
  for (let i = 0; i < 8; i++) {
    if (m.mod[8][m.n - 1 - i] === -1) m.mod[8][m.n - 1 - i] = -2;
    if (m.mod[m.n - 1 - i][8] === -1) m.mod[m.n - 1 - i][8] = -2;
  }
  // Version information, for version 7 and up.
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (bits >> i) & 1;
      const r = Math.floor(i / 3);
      const c = m.n - 11 + (i % 3);
      m.mod[r][c] = bit;
      m.mod[c][r] = bit;
    }
  }
}

function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return ((version << 12) | rem) >>> 0;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function placeData(m, bytes, mask) {
  let bit = 0;
  const total = bytes.length * 8;
  let up = true;
  for (let col = m.n - 1; col > 0; col -= 2) {
    if (col === 6) col--;                       // the vertical timing column
    for (let i = 0; i < m.n; i++) {
      const row = up ? m.n - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (m.mod[row][c] !== -1) continue;
        let v = 0;
        if (bit < total) {
          v = (bytes[bit >> 3] >> (7 - (bit & 7))) & 1;
          bit++;
        }
        m.mod[row][c] = MASKS[mask](row, c) ? v ^ 1 : v;
      }
    }
    up = !up;
  }
}

function placeFormat(m, mask) {
  // Level M is 00; then five bits of BCH, then the fixed XOR mask.
  let data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  // MOST SIGNIFICANT BIT FIRST, which is the whole of a bug that made every
  // symbol this ever drew invalid. Written the other way round the code still
  // decodes — with the reader in core/qrscan.js, which read it back in the
  // same wrong order. No real decoder would take it, and none did: a phone
  // pointed at one of these showed nothing at all, because a camera that
  // cannot parse the format block never reports finding a code.
  for (let i = 0; i < 15; i++) {
    const bit = (bits >> (14 - i)) & 1;
    // Top-left, in two runs that skip the timing row and column.
    if (i < 6) m.mod[8][i] = bit;
    else if (i === 6) m.mod[8][7] = bit;
    else if (i === 7) m.mod[8][8] = bit;
    else if (i === 8) m.mod[7][8] = bit;
    else m.mod[14 - i][8] = bit;
    // And the copy split across the other two corners. Seven bits go up the
    // left edge, not eight: the eighth cell down there is the module that is
    // always dark, and writing a format bit over it is a symbol that decoders
    // reject.
    if (i < 7) m.mod[m.n - 1 - i][8] = bit;
    else m.mod[8][m.n - 15 + i] = bit;
  }
}

/** The standard's four penalties, used to pick the least ugly mask. */
function penalty(m) {
  let score = 0;
  const n = m.n;
  const at = (r, c) => m.mod[r][c] & 1;
  for (const transpose of [false, true]) {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b < n; b++) {
        const prev = transpose ? at(b - 1, a) : at(a, b - 1);
        const cur = transpose ? at(b, a) : at(a, b);
        if (cur === prev) { run++; continue; }
        if (run >= 5) score += run - 2;
        run = 1;
      }
      if (run >= 5) score += run - 2;
    }
  }
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const s = at(r, c) + at(r, c + 1) + at(r + 1, c) + at(r + 1, c + 1);
      if (s === 0 || s === 4) score += 3;
    }
  }
  const PAT = [1, 0, 1, 1, 1, 0, 1];
  const hasPattern = (get) => {
    let hits = 0;
    for (let i = 0; i + 7 <= n; i++) {
      let ok = true;
      for (let k = 0; k < 7; k++) if (get(i + k) !== PAT[k]) { ok = false; break; }
      if (!ok) continue;
      const before = [i - 4, i - 3, i - 2, i - 1].every((x) => x < 0 || get(x) === 0);
      const after = [i + 7, i + 8, i + 9, i + 10].every((x) => x >= n || get(x) === 0);
      if (before || after) hits++;
    }
    return hits;
  };
  for (let a = 0; a < n; a++) {
    score += 40 * hasPattern((b) => at(a, b));
    score += 40 * hasPattern((b) => at(b, a));
  }
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dark += at(r, c);
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

/**
 * Encode text as a QR matrix.
 *
 * @returns {{n: number, dark: (r: number, c: number) => boolean, version: number}|null}
 *          null when the text is too long for the versions supported here,
 *          which is a caller's problem to report rather than a crash.
 */
export function encode(text) {
  const bytes = new TextEncoder().encode(String(text));
  const version = Object.keys(M_SPECS).map(Number).sort((a, b) => a - b)
    .find((v) => bytes.length <= capacity(v));
  if (!version) return null;

  const data = codewords(bitsFor(bytes, version), version);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    // Function patterns and the format/version areas go down first; the areas
    // are marked reserved rather than filled, so the data walk skips them and
    // the format bits can be written over them afterwards.
    const m = blank(version);
    reserve(m, version);
    placeData(m, data, mask);
    placeFormat(m, mask);
    const score = penalty(m);
    if (!best || score < best.score) best = { m, score, mask };
  }
  const { m } = best;
  return { n: m.n, version, mask: best.mask, dark: (r, c) => (m.mod[r][c] & 1) === 1,
           matrix: m.mod };
}

/**
 * Read a matrix this module produced back into bytes.
 *
 * Not a QR decoder — it assumes a perfect matrix and the version it was told.
 * It exists so the encoder can be tested against itself end to end, which is
 * the only check available without shipping a decoder or a camera. It cannot
 * catch a mistake made identically in both directions, so the placement rules
 * are also asserted against the standard's fixed patterns separately.
 */
export function readBack(qr) {
  const spec = M_SPECS[qr.version];
  const { blocks, short, g1 } = blocksOf(spec);
  const n = qr.n;
  const mod = qr.matrix;
  // Rebuild the reservation map so the walk skips exactly what it skipped.
  const skip = blank(qr.version);
  reserve(skip, qr.version);
  const bits = [];
  let up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const row = up ? n - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (skip.mod[row][c] !== -1) continue;
        const v = mod[row][c] & 1;
        bits.push(MASKS[qr.mask](row, c) ? v ^ 1 : v);
      }
    }
    up = !up;
  }
  const all = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    all.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }
  // Un-interleave back into blocks, then drop the check codewords.
  const lens = [];
  for (let i = 0; i < blocks; i++) lens.push(i < g1 ? short : short + 1);
  const out = Array.from({ length: blocks }, () => []);
  let at = 0;
  const longest = Math.max(...lens);
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < blocks; b++) if (i < lens[b]) out[b].push(all[at++]);
  }
  const data = out.flat();
  // Undo the header: mode nibble, length, then the payload.
  const countBytes = qr.version < 10 ? 1 : 2;
  const stream = [];
  for (const byte of data) stream.push(byte);
  let bitAt = 4;
  const take = (count) => {
    let v = 0;
    for (let k = 0; k < count; k++) {
      const idx = bitAt + k;
      v = (v << 1) | ((stream[idx >> 3] >> (7 - (idx & 7))) & 1);
    }
    bitAt += count;
    return v;
  };
  const len = take(countBytes * 8);
  const bytes = [];
  for (let i = 0; i < len; i++) bytes.push(take(8));
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/* ------------------------------------------------------- shared with the reader */
// The decoder in core/qrscan.js needs the same field arithmetic, the same
// version tables and the same idea of which cells are not data. Exported rather
// than duplicated: two copies of the standard's tables is two chances to get
// them wrong, and only one of them would have a test.

export const GF = { EXP, LOG, mul };
export { M_SPECS, blocksOf, MASKS, versionBits, size };

/** Which cells are function patterns, so a reader skips exactly what we skipped. */
export function reservation(version) {
  const m = blank(version);
  reserve(m, version);
  return m;
}

/** The matrix as an SVG string, quiet zone included, scaling to its container. */
export function svg(text, { margin = 4, title = 'Pairing code' } = {}) {
  const qr = encode(text);
  if (!qr) return null;
  const dim = qr.n + margin * 2;
  const rects = [];
  for (let r = 0; r < qr.n; r++) {
    let run = 0;
    for (let c = 0; c <= qr.n; c++) {
      if (c < qr.n && qr.dark(r, c)) { run++; continue; }
      if (run) rects.push(`<rect x="${c - run + margin}" y="${r + margin}" width="${run}" height="1"/>`);
      run = 0;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" `
    + `role="img" aria-label="${title}" shape-rendering="crispEdges">`
    + `<rect width="${dim}" height="${dim}" fill="#fff"/>`
    + `<g fill="#000">${rects.join('')}</g></svg>`;
}
