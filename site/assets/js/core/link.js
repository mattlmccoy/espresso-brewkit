// Streaming the pour from the laptop to a phone, with nothing in between.
//
// WHY NOT DRIVE. Sync exists to keep two devices holding the same log, and it
// is the wrong tool for watching a shot: it is a pull-merge-push against
// Google's servers, it needs an account on both ends, and it is seconds slow by
// construction. Worse, on an iPad it is the *only* way in, so a sign-in problem
// turns the whole viewer into a blank page. Watching a pour needs none of that.
// The two devices are usually a metre apart on the same Wi-Fi, and the data is
// a number ten times a second.
//
// SO: WebRTC, peer to peer. The frames go straight from one browser to the
// other — no server, no account, nothing hosted, and low enough latency that
// the phone and the laptop show the same number at the same time.
//
// THE AWKWARD PART IS INTRODUCTIONS. WebRTC cannot start without the two peers
// exchanging a description of themselves, and normally a signalling server does
// that. There is no server here, so the user does it: the laptop produces a
// code, the phone takes it and produces a reply, the laptop takes the reply.
// Two copies and two pastes. On Apple hardware that is nearly free, because
// Universal Clipboard means copying on the Mac makes it pasteable on the phone;
// everywhere else it is a message to yourself. It sounds clumsier than it is —
// it happens once per session and takes about fifteen seconds.
//
// NO ICE SERVERS. With none configured the browser offers only host candidates,
// which is to say addresses on the local network. That is a deliberate limit
// rather than an omission: it keeps the connection on the same Wi-Fi and out of
// anyone else's infrastructure, which is the same promise the rest of the app
// makes. Across networks it will not connect, and it says so instead of quietly
// relaying your shots through a stranger's TURN server.

export const LINK_VERSION = 1;
const GATHER_TIMEOUT_MS = 2500;

const enc = (obj) => {
  const json = JSON.stringify(obj);
  // btoa is Latin-1 only, and an SDP is ASCII, but a coffee name in a frame is
  // not — so go through UTF-8 explicitly rather than hoping.
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const dec = (code) => {
  const b64 = String(code).trim().replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
};

/** A pairing code, or a clear reason why it is not one. */
export function readCode(code, expect) {
  let parsed;
  try { parsed = dec(code); } catch { return { ok: false, error: 'That does not look like a pairing code.' }; }
  if (!parsed || parsed.v !== LINK_VERSION) {
    return { ok: false, error: 'That code came from a different version of brewkit.' };
  }
  if (parsed.t !== expect) {
    return { ok: false, error: parsed.t === 'offer'
      ? 'That is the laptop’s code. Paste it on the phone, not here.'
      : 'That is the phone’s reply. Paste it on the laptop, not here.' };
  }
  return { ok: true, sdp: { type: parsed.t, sdp: parsed.sdp } };
}

/**
 * Wait for ICE gathering, but not forever. A code is only useful once it
 * carries every address the peer can be reached on, and gathering normally
 * finishes in milliseconds on a LAN — but a browser that never fires the event
 * would otherwise leave the user staring at a button that does nothing.
 */
function gathered(pc, timeoutMs = GATHER_TIMEOUT_MS) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
    check();
  });
}

export class LiveLink {
  /**
   * @param role 'host' on the machine with the scale, 'viewer' on the phone
   * @param rtc  injectable factory, so the handshake can be tested without one
   */
  constructor({ role = 'host', rtc = null } = {}) {
    this.role = role;
    this.state = 'idle';
    this.onMessage = null;
    this.onState = null;
    this._make = rtc ?? (() => new RTCPeerConnection({ iceServers: [] }));
    this.pc = null;
    this.ch = null;
  }

  _set(state) {
    if (this.state === state) return;
    this.state = state;
    this.onState?.(state);
  }

  _wire(ch) {
    this.ch = ch;
    ch.onopen = () => this._set('open');
    ch.onclose = () => this._set('closed');
    ch.onmessage = (e) => {
      let msg = null;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.onMessage?.(msg);
    };
  }

  _watch(pc) {
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this._set('failed');
      else if (pc.connectionState === 'disconnected') this._set('waiting');
    };
  }

  /** Host: the code to carry to the phone. */
  async offer() {
    this.pc = this._make();
    this._watch(this.pc);
    // Unordered and unreliable on purpose: this is telemetry, and a frame that
    // arrives late is worse than one that never arrives, because every frame
    // carries the whole current state rather than a delta.
    this._wire(this.pc.createDataChannel('pour', { ordered: false, maxRetransmits: 0 }));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await gathered(this.pc);
    this._set('waiting');
    return enc({ v: LINK_VERSION, t: 'offer', sdp: this.pc.localDescription.sdp });
  }

  /** Viewer: take the laptop's code, hand back a reply. */
  async answer(code) {
    const read = readCode(code, 'offer');
    if (!read.ok) throw new Error(read.error);
    this.pc = this._make();
    this._watch(this.pc);
    this.pc.ondatachannel = (e) => this._wire(e.channel);
    await this.pc.setRemoteDescription(read.sdp);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await gathered(this.pc);
    this._set('waiting');
    return enc({ v: LINK_VERSION, t: 'answer', sdp: this.pc.localDescription.sdp });
  }

  /** Host: take the phone's reply, and the link is up. */
  async accept(code) {
    const read = readCode(code, 'answer');
    if (!read.ok) throw new Error(read.error);
    if (!this.pc) throw new Error('Make a pairing code first.');
    await this.pc.setRemoteDescription(read.sdp);
  }

  send(obj) {
    if (this.ch?.readyState !== 'open') return false;
    try { this.ch.send(JSON.stringify(obj)); return true; } catch { return false; }
  }

  close() {
    try { this.ch?.close(); } catch { /* already gone */ }
    try { this.pc?.close(); } catch { /* already gone */ }
    this.ch = null;
    this.pc = null;
    this._set('closed');
  }
}

/**
 * One frame of the pour, small enough to send ten times a second and complete
 * enough that losing one costs nothing. There are no deltas here by design:
 * every frame is the whole picture, which is what lets the channel be lossy.
 */
export function frameOf({ snap, sess, target, tol, coffee, elapsed, curve }) {
  return {
    k: 'f',
    w: Number.isFinite(snap?.net) ? +snap.net.toFixed(2) : null,
    q: Number.isFinite(snap?.flow) ? +snap.flow.toFixed(3) : null,
    t: Number.isFinite(elapsed) ? +elapsed.toFixed(1) : null,
    st: snap?.state ?? null,
    step: sess?.step ?? null,
    phase: sess?.phase ?? null,
    hint: sess?.hint ?? null,
    dose: sess?.dose ?? null,
    grounds: sess?.grounds ?? null,
    // The target for the step you are actually on: the dose while weighing,
    // the yield once it is pouring. Sent with its window so the phone can draw
    // the same bar without knowing the rule that produced it.
    target: Number.isFinite(target) ? +target.toFixed(1) : null,
    tol: Number.isFinite(tol) ? +tol.toFixed(2) : null,
    coffee: coffee ?? null,
    // A short tail of the curve, so a phone joining mid-shot is not blank.
    curve: Array.isArray(curve) ? curve.slice(-240).map(
      (p) => [+p.t.toFixed(2), +p.w.toFixed(2)]) : [],
  };
}
