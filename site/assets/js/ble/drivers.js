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
    decoder: { kind: 'int', offset: 4, width: 2, littleEndian: true, signed: false, scale: 0.1 },
    // Frames are 12 06 05 00 <weight u16LE> 05 00 — everything but bytes 4–5 is fixed.
    match: (bytes) => bytes.length >= 8 && bytes[0] === 0x12 && bytes[1] === 0x06
      && bytes[2] === 0x05 && bytes[6] === 0x05,
    // Confirmed on an INSMART 5 kg / 0.1 g scale: 0 g and 587.0 g both decode
    // exactly, and 0xFFFF x 0.1 = 6553.5 g is the headroom a 5 kg scale needs.
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
