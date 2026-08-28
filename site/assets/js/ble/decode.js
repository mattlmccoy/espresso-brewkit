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

/**
 * Decoders are described declaratively so a discovered one can be serialized.
 *
 * `sign` handles the case that motivated it: a scale whose weight bytes are
 * always an unsigned magnitude, with a status byte elsewhere carrying the sign
 * as a bit. Decoding such a frame as plain unsigned silently reports −416 g as
 * +416 g, which reads as a plausible number rather than an obvious fault.
 *
 * `scaleIf` handles a frame that carries its own units — the SIG Weight Scale
 * profile puts a metric/imperial bit in its flags byte, so the scale factor is
 * a property of the frame rather than of the device. A driver that assumed one
 * or the other would be wrong by a factor of 2.2 on a scale set to the other,
 * which is far too plausible a number to catch by eye.
 */
export function applyCandidate(c, bytes) {
  if (bytes.length < c.offset + c.width) return NaN;
  let scale = c.scale;
  if (c.scaleIf) {
    if (bytes.length <= c.scaleIf.offset) return NaN;
    if (bytes[c.scaleIf.offset] & c.scaleIf.mask) scale = c.scaleIf.scale;
  }
  let v;
  if (c.kind === 'ascii') {
    const s = String.fromCharCode(...bytes.slice(c.offset, c.offset + c.width));
    const n = parseFloat(s.replace(/[^0-9.\-+]/g, ''));
    if (!Number.isFinite(n)) return NaN;
    v = n * scale;
  } else {
    v = readInt(bytes, c.offset, c.width, c.littleEndian, c.signed) * scale;
  }
  if (c.sign) {
    if (bytes.length <= c.sign.offset) return NaN;
    if (bytes[c.sign.offset] & c.sign.mask) v = -v;
  }
  return v;
}

/** Is this frame flagged as a settled reading? Undefined when unknown. */
export function isStable(c, bytes) {
  if (!c?.stable || bytes.length <= c.stable.offset) return undefined;
  return (bytes[c.stable.offset] & c.stable.mask) !== 0;
}

export function describeCandidate(c) {
  const sign = c.sign ? `, sign @${c.sign.offset}&0x${c.sign.mask.toString(16)}` : '';
  const alt = c.scaleIf
    ? `, ×${c.scaleIf.scale} when @${c.scaleIf.offset}&0x${c.scaleIf.mask.toString(16)}` : '';
  if (c.kind === 'ascii') return `ASCII ×${c.scale} @${c.offset}+${c.width}${sign}${alt}`;
  return `${c.signed ? 'i' : 'u'}${c.width * 8}${c.littleEndian ? 'LE' : 'BE'} ×${c.scale} `
    + `@${c.offset}${sign}${alt}`;
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

  // A magnitude-plus-sign-bit frame cannot be fitted by any plain encoding, so
  // if the references include negatives and nothing fits, look for a bit
  // elsewhere in the frame that tracks the sign.
  if (!out.length && samples.some((s) => s.grams < 0)) {
    const MASKS = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80];
    for (let so = 0; so < len; so++) {
      for (const mask of MASKS) {
        // The bit must actually separate negatives from positives.
        const separates = samples.every((s) => ((s.bytes[so] & mask) !== 0) === (s.grams < 0));
        if (!separates) continue;
        const abs = samples.map((s) => ({ bytes: s.bytes, grams: Math.abs(s.grams) }));
        for (const c of findCandidates(abs, { maxError, limit: 4 })) {
          if (c.offset === so) continue;   // the sign byte cannot also be the value
          out.push({ ...c, sign: { offset: so, mask } });
        }
      }
    }
  }

  out.sort((a, b) => a.error - b.error);
  // Collapse near-duplicates that read the same bytes at the same scale.
  const seen = new Set();
  return out.filter((c) => {
    const key = `${c.kind}${c.offset}${c.width}${c.scale}${c.sign ? c.sign.offset + ':' + c.sign.mask : ''}`;
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

/** Parse a hex string back to bytes, tolerating spaces and 0x prefixes. */
export function unhex(str) {
  const clean = String(str).replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
  const pairs = clean.match(/../g) ?? [];
  return Uint8Array.from(pairs.map((h) => parseInt(h, 16)));
}
