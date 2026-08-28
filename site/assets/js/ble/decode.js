// Candidate-encoding search for undocumented scales.
//
// Most cheap BLE scales notify a short fixed-layout frame containing the weight
// as an integer in some byte order at some offset with some scale factor. There
// are only a few hundred plausible combinations, so rather than reading a
// datasheet that does not exist, put known masses on the scale and search.

const WIDTHS = [2, 3, 4];
const SCALES = [1, 0.1, 0.01, 0.001];

function readInt(bytes, off, width, littleEndian, signed) {
  let v = 0;
  for (let i = 0; i < width; i++) {
    const b = bytes[off + (littleEndian ? i : width - 1 - i)];
    v += b * 256 ** i;
  }
  if (signed) {
    const half = 256 ** width / 2;
    if (v >= half) v -= 256 ** width;
  }
  return v;
}

/** Decoders are described declaratively so a discovered one can be serialized. */
export function applyCandidate(c, bytes) {
  if (bytes.length < c.offset + (c.kind === 'ascii' ? c.width : c.width)) return NaN;
  if (c.kind === 'ascii') {
    const s = String.fromCharCode(...bytes.slice(c.offset, c.offset + c.width));
    const n = parseFloat(s.replace(/[^0-9.\-+]/g, ''));
    return Number.isFinite(n) ? n * c.scale : NaN;
  }
  return readInt(bytes, c.offset, c.width, c.littleEndian, c.signed) * c.scale;
}

export function describeCandidate(c) {
  if (c.kind === 'ascii') return `ASCII ×${c.scale} @${c.offset}+${c.width}`;
  return `${c.signed ? 'i' : 'u'}${c.width * 8}${c.littleEndian ? 'LE' : 'BE'} ×${c.scale} @${c.offset}`;
}

/**
 * @param samples [{bytes: Uint8Array|number[], grams: number}]  at least two
 *                distinct reference masses, ideally three including zero.
 * @returns candidates sorted by worst-case error, best first.
 */
export function findCandidates(samples, { maxError = 0.35, limit = 12 } = {}) {
  if (samples.length < 2) return [];
  const len = Math.min(...samples.map((s) => s.bytes.length));
  const spread = Math.max(...samples.map((s) => s.grams)) - Math.min(...samples.map((s) => s.grams));
  if (!(spread > 1)) return [];  // all references the same: nothing to solve

  const out = [];
  const consider = (c) => {
    let worst = 0;
    for (const s of samples) {
      const v = applyCandidate(c, s.bytes);
      if (!Number.isFinite(v)) return;
      const e = Math.abs(v - s.grams);
      if (e > worst) worst = e;
      if (worst > maxError) return;
    }
    out.push({ ...c, error: worst });
  };

  for (const width of WIDTHS) {
    for (let offset = 0; offset + width <= len; offset++) {
      for (const littleEndian of [false, true]) {
        for (const signed of [false, true]) {
          for (const scale of SCALES) {
            consider({ kind: 'int', offset, width, littleEndian, signed, scale });
          }
        }
      }
    }
  }
  // ASCII digit runs, as used by Felicita and some clones.
  for (let width = 4; width <= 8; width++) {
    for (let offset = 0; offset + width <= len; offset++) {
      const printable = samples.every((s) =>
        [...s.bytes.slice(offset, offset + width)].every((b) => b >= 0x20 && b <= 0x7e));
      if (!printable) continue;
      for (const scale of [1, 0.1, 0.01]) consider({ kind: 'ascii', offset, width, scale });
    }
  }

  out.sort((a, b) => a.error - b.error);
  // Collapse near-duplicates that read the same bytes at the same scale.
  const seen = new Set();
  return out.filter((c) => {
    const key = `${c.kind}${c.offset}${c.width}${c.scale}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

/**
 * Which byte positions move at all across a set of frames? Run this first: it
 * narrows where to look and exposes counters and checksums, which change on
 * every frame regardless of weight.
 */
export function volatility(frames) {
  if (!frames.length) return [];
  const len = Math.min(...frames.map((f) => f.length));
  const out = [];
  for (let i = 0; i < len; i++) {
    const vals = new Set(frames.map((f) => f[i]));
    out.push({ index: i, distinct: vals.size, constant: vals.size === 1,
               value: vals.size === 1 ? frames[0][i] : null });
  }
  return out;
}

export const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
