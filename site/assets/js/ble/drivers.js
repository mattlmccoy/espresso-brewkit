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
];

/** Does a connected device look like a scale we already know? */
export function matchByCharacteristic(chars) {
  for (const d of DRIVERS) {
    const hit = chars.find((c) => c.uuid === d.characteristic && c.notify);
    if (hit) return d;
  }
  return null;
}

/**
 * Confirm a driver against a frame before trusting it. Two different scales can
 * share the FFF0/FFF3 pair — it is a generic module default, not a vendor
 * identifier — so the UUID alone is a hint, and the frame shape is the check.
 */
export function confirm(driver, bytes) {
  return typeof driver?.match === 'function' ? !!driver.match(bytes) : false;
}
