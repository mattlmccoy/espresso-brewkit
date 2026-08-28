// Known scales. A driver is just a service/characteristic pair plus a decoder
// in the same declarative form the auto-decoder produces — so discovering a new
// scale and shipping support for it are the same act.

const u = (n) => `0000${n}-0000-1000-8000-00805f9b34fb`;

export const DRIVERS = [
  {
    id: 'lefu-fff0',
    name: 'Lefu FFF0',
    note: 'Lefu is an OEM; this covers INSMART and other rebadges of the same board.',
    service: u('fff0'),
    characteristic: u('fff3'),
    decoder: {
      kind: 'int', offset: 4, width: 2, littleEndian: true, signed: false, scale: 0.1,
      // The weight bytes are an unsigned magnitude; the sign is a bit in the
      // status byte. Decoding this as plain unsigned reports -416.4 g as
      // +416.4 g — a plausible-looking number, which is the dangerous kind of
      // wrong. Found only because negative reference masses were captured.
      sign: { offset: 2, mask: 0x10 },
      // Inferred, not confirmed: byte 2 bit 2 is set on every settled reading
      // and clear on the one frame whose value lagged the display. Used to
      // gate the "stable" indicator only — no measurement depends on it.
      stable: { offset: 2, mask: 0x04 },
    },
    // Frames are 12 06 <status> 00 <magnitude u16LE> 05 00. Byte 2 varies with
    // sign and settling, so match on the fixed header and trailer instead.
    match: (bytes) => bytes.length >= 8 && bytes[0] === 0x12 && bytes[1] === 0x06
      && bytes[3] === 0x00 && bytes[6] === 0x05,
    // Verified against 15 captures from an INSMART 5 kg / 0.1 g scale spanning
    // -416.4 g to +1547 g: every one decodes exactly. 0xFFFF x 0.1 = 6553.5 g
    // is also precisely the headroom a 5 kg scale needs at 0.1 g resolution.
    confidence: 'confirmed',
  },
  {
    id: 'sig-weight-scale',
    name: 'Bluetooth SIG Weight Scale',
    // Not reverse-engineered — this is the published GATT profile, so it is
    // implementable exactly rather than guessed at. Any scale that speaks the
    // standard works with no teaching step at all.
    note: 'The standard Weight Scale profile. Its resolution is 0.005 kg — 5 g '
      + 'steps — which is fine for bathroom scales and useless for dosing espresso. '
      + 'If your scale also exposes a vendor characteristic, that one is almost '
      + 'certainly finer; calibrate against it instead.',
    service: u('181d'),
    characteristic: u('2a9d'),
    decoder: {
      kind: 'int', offset: 1, width: 2, littleEndian: true, signed: false,
      // SI: 0.005 kg per count = 5 g. Imperial: 0.01 lb per count.
      scale: 5,
      scaleIf: { offset: 0, mask: 0x01, scale: 4.5359237 },
    },
    // The flags byte fixes the frame's exact length, which makes a strong
    // fingerprint: reserved bits must be clear, and each optional field the
    // flags claim must actually be present.
    match: (bytes) => {
      if (bytes.length < 3 || (bytes[0] & 0xf0) !== 0) return false;
      let need = 3;
      if (bytes[0] & 0x02) need += 7;   // time stamp
      if (bytes[0] & 0x04) need += 1;   // user id
      if (bytes[0] & 0x08) need += 4;   // BMI + height
      return bytes.length === need;
    },
    resolutionG: 5,
    confidence: 'spec',
  },
];

/* ------------------------------------------------------------------ sharing */
// Supporting "as many scales as possible" cannot mean guessing at vendor
// protocols — a driver with a wrong scale factor produces plausible numbers,
// which is the worst kind of wrong. It means making a scale someone has already
// taught shareable, so it is taught once by anyone rather than once by everyone.

export const PROFILE_VERSION = 1;

export function serializeProfile(profile) {
  return JSON.stringify({
    brewkit_profile: PROFILE_VERSION,
    name: profile.name ?? 'Scale',
    bleName: profile.bleName ?? null,
    characteristic: profile.uuid ?? profile.decoder?.uuid ?? null,
    decoder: profile.decoder,
    exported_at: new Date().toISOString(),
  }, null, 2);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Parse a shared profile, refusing anything that would decode to garbage.
 *
 * An imported decoder is executed against live frames, so a malformed one does
 * not fail loudly — it produces numbers. Every field is checked rather than
 * trusted, and the error says which one was wrong.
 */
export function parseProfile(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'That is not valid JSON.' }; }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'That file is not a profile.' };
  if (raw.brewkit_profile !== PROFILE_VERSION) {
    return { ok: false, error: `Expected a brewkit profile of version ${PROFILE_VERSION}; `
      + `this one says ${JSON.stringify(raw.brewkit_profile ?? null)}.` };
  }
  const uuid = String(raw.characteristic ?? '').toLowerCase();
  if (!UUID_RE.test(uuid)) {
    return { ok: false, error: 'The characteristic is not a 128-bit UUID in 8-4-4-4-12 form.' };
  }
  const d = raw.decoder;
  if (!d || typeof d !== 'object') return { ok: false, error: 'The profile has no decoder.' };
  if (d.kind !== 'int' && d.kind !== 'ascii') {
    return { ok: false, error: `Unknown decoder kind ${JSON.stringify(d.kind ?? null)}.` };
  }
  for (const key of ['offset', 'width', 'scale']) {
    if (!Number.isFinite(d[key])) return { ok: false, error: `The decoder's ${key} is not a number.` };
  }
  if (!(d.offset >= 0 && d.width > 0 && d.width <= 8 && d.scale !== 0)) {
    return { ok: false, error: 'The decoder\u2019s offset, width or scale is out of range.' };
  }
  for (const [key, bits] of [['sign', d.sign], ['stable', d.stable], ['scaleIf', d.scaleIf]]) {
    if (bits === undefined || bits === null) continue;
    if (!Number.isFinite(bits.offset) || !Number.isFinite(bits.mask) || bits.offset < 0) {
      return { ok: false, error: `The decoder's ${key} flag is malformed.` };
    }
  }
  return {
    ok: true,
    profile: {
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Imported scale',
      bleName: typeof raw.bleName === 'string' ? raw.bleName : null,
      uuid,
      decoder: { ...d, kind: d.kind },
    },
  };
}

/** Does a connected device look like a scale we already know? */
export function matchByCharacteristic(chars) {
  for (const d of DRIVERS) {
    const hit = chars.find((c) => c.uuid === d.characteristic && c.notify);
    if (hit) return d;
  }
  return null;
}

/**
 * Do two decoders mean the same thing?
 *
 * Used to notice that a scale's remembered profile predates a fix to the driver
 * for that same scale — the case that motivated it being a profile saved before
 * the sign bit was understood, which decoded −416 g as +416 g and would have
 * gone on doing so forever, because a saved decoder was never revisited.
 */
export function sameDecoder(a, b) {
  if (!a || !b) return false;
  const norm = (d) => JSON.stringify({
    kind: d.kind ?? 'int', offset: d.offset, width: d.width,
    littleEndian: !!d.littleEndian, signed: !!d.signed, scale: d.scale,
    sign: d.sign ? [d.sign.offset, d.sign.mask] : null,
    scaleIf: d.scaleIf ? [d.scaleIf.offset, d.scaleIf.mask, d.scaleIf.scale] : null,
  });
  return norm(a) === norm(b);
}

/**
 * Confirm a driver against a frame before trusting it. Two different scales can
 * share the FFF0/FFF3 pair — it is a generic module default, not a vendor
 * identifier — so the UUID alone is a hint, and the frame shape is the check.
 */
export function confirm(driver, bytes) {
  return typeof driver?.match === 'function' ? !!driver.match(bytes) : false;
}
