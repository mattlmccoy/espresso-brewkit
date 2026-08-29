// Squeezing a session description down to something a camera can read.
//
// The pairing code is an SDP offer, and an SDP offer is 830 characters of
// which about eighty carry information. The rest is boilerplate both ends
// already agree on: the version line, the bundle group, the SCTP port, the
// message size. None of it varies, and none of it needs to travel.
//
// That matters because of what the code is FOR. Pasting 830 characters between
// two devices is unpleasant once and unbearable twice, so the pairing wants to
// be a QR code — and 830 bytes is a version-24 QR, 113 modules square, which a
// phone screen can just about show and a laptop webcam cannot reliably read.
// Strip it to the eighty that matter and it is a version-7 QR at 45 modules,
// which reads across a kitchen.
//
// WHAT ACTUALLY VARIES, for a data-channel-only connection with no ICE
// servers: the ICE username and password, the DTLS fingerprint, the setup role,
// and the host candidates. Six fields. Everything else is reconstructed.

const B64 = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const UNB64 = (str) => {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const line = (sdp, prefix) =>
  sdp.split(/\r?\n/).find((l) => l.startsWith(prefix))?.slice(prefix.length).trim() ?? null;

/* ---------------------------------------------------------------- candidates */

/**
 * One candidate, as few characters as it can be said in.
 *
 * Three shapes, because Chrome hides local IPs behind mDNS hostnames by
 * default — a privacy measure, and a 42-character one. A UUID is sixteen bytes
 * underneath, so it packs to twenty-two. Anything unrecognised is carried
 * verbatim rather than dropped: a candidate this does not understand is still
 * a candidate that might be the one that connects.
 */
export function packCandidate(cand) {
  const m = /^candidate:(\S+) (\d+) (udp|tcp) (\d+) (\S+) (\d+) typ (\w+)/i.exec(cand.trim());
  if (!m) return `r${B64(new TextEncoder().encode(cand.trim()))}`;
  const [, , , proto, , addr, port, typ] = m;
  if (typ !== 'host' || proto.toLowerCase() !== 'udp') {
    return `r${B64(new TextEncoder().encode(cand.trim()))}`;
  }
  const p = Number(port);
  const ip4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (ip4) {
    const bytes = [Number(ip4[1]), Number(ip4[2]), Number(ip4[3]), Number(ip4[4]),
                   (p >> 8) & 255, p & 255];
    return `4${B64(Uint8Array.from(bytes))}`;
  }
  const mdns = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i
    .exec(addr);
  if (mdns) {
    const hex = mdns.slice(1).join('');
    const bytes = [];
    for (let i = 0; i < 32; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    bytes.push((p >> 8) & 255, p & 255);
    return `m${B64(Uint8Array.from(bytes))}`;
  }
  return `r${B64(new TextEncoder().encode(cand.trim()))}`;
}

export function unpackCandidate(token, index = 0) {
  const kind = token[0];
  const body = token.slice(1);
  if (kind === 'r') return new TextDecoder().decode(UNB64(body));
  const b = UNB64(body);
  if (kind === '4') {
    const addr = `${b[0]}.${b[1]}.${b[2]}.${b[3]}`;
    const port = (b[4] << 8) | b[5];
    return candLine(addr, port, index);
  }
  if (kind === 'm') {
    const hex = [...b.slice(0, 16)].map((x) => x.toString(16).padStart(2, '0')).join('');
    const addr = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-`
      + `${hex.slice(16, 20)}-${hex.slice(20, 32)}.local`;
    const port = (b[16] << 8) | b[17];
    return candLine(addr, port, index);
  }
  return null;
}

// The foundation and priority are advisory; ICE only needs them to be
// consistent and ordered, and these are host candidates on one interface.
const candLine = (addr, port, index) =>
  `candidate:${1000000 + index} 1 udp ${2113937151 - index} ${addr} ${port} typ host generation 0`;

/* ---------------------------------------------------------------- the whole */

export const PACK_VERSION = 2;

/** An SDP, as the handful of fields that actually differ between two of them. */
export function pack(sdp) {
  const ufrag = line(sdp, 'a=ice-ufrag:');
  const pwd = line(sdp, 'a=ice-pwd:');
  const fp = line(sdp, 'a=fingerprint:');
  const setup = line(sdp, 'a=setup:') ?? 'actpass';
  if (!ufrag || !pwd || !fp) return null;
  const [algo, hex] = fp.split(/\s+/);
  if ((algo ?? '').toLowerCase() !== 'sha-256') return null;
  const bytes = hex.split(':').map((h) => parseInt(h, 16));
  if (bytes.length !== 32 || bytes.some((n) => !Number.isFinite(n))) return null;

  const cands = sdp.split(/\r?\n/)
    .filter((l) => l.startsWith('a=candidate:'))
    .map((l) => packCandidate(l.slice(2)));

  return [PACK_VERSION, ufrag, pwd, B64(Uint8Array.from(bytes)),
          setup === 'actpass' ? 'A' : setup === 'active' ? 'a' : 'p',
          cands.join('.')].join('~');
}

/** And back again, into something a browser will accept as a description. */
export function unpack(packed) {
  const parts = String(packed ?? '').split('~');
  if (parts.length < 6 || Number(parts[0]) !== PACK_VERSION) return null;
  const [, ufrag, pwd, fpB64, setupCode, candBlob] = parts;
  const fp = [...UNB64(fpB64)].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  if (fp.split(':').length !== 32) return null;
  const setup = setupCode === 'a' ? 'active' : setupCode === 'p' ? 'passive' : 'actpass';
  const cands = candBlob ? candBlob.split('.').map((c, i) => unpackCandidate(c, i)).filter(Boolean)
    : [];
  // The m= line's port has to be a candidate's, or the description is rejected
  // as having no transport. Any of them will do; the first is as good as any.
  const first = /(\d+) typ host/.exec(cands[0] ?? '');
  const port = first ? first[1] : '9';

  return [
    'v=0',
    'o=- 0 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    `m=application ${port} UDP/DTLS/SCTP webrtc-datachannel`,
    'c=IN IP4 0.0.0.0',
    ...cands.map((c) => `a=${c}`),
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n');
}
