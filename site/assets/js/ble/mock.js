// A synthetic scale, so the whole pipeline — framing, decode, filter, state
// machine, UI, shot capture — is testable with no hardware present. It emits
// the same 'frame' events as ScaleLink, in a plausible unknown-vendor layout.

export class MockScale extends EventTarget {
  constructor({ hz = 10, noise = 0.03 } = {}) {
    super();
    this.hz = hz;
    this.noise = noise;
    this.grams = 0;
    this.seq = 0;
    this.timer = null;
    // Full 128-bit UUIDs, as a real device reports them. The abbreviated form
    // this used to carry was not parseable as a UUID anywhere it was handled.
    this.chars = [{
      service: '0000fff0-0000-1000-8000-00805f9b34fb',
      uuid: '0000fff1-0000-1000-8000-00805f9b34fb',
      notify: true, read: false, write: false,
    }];
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  frame() {
    // Header, u16BE centigrams, sequence, XOR check — a common shape.
    const v = Math.max(0, Math.round((this.grams + (Math.random() - 0.5) * this.noise * 2) * 100));
    const b = [0xaa, 0x05, 0x01, (v >> 8) & 255, v & 255, this.seq & 255, 0];
    b[6] = b.slice(0, 6).reduce((x, y) => x ^ y, 0);
    this.seq++;
    return Uint8Array.from(b);
  }

  async choose() { return { name: 'Mock Scale', id: 'mock' }; }
  async reopen(id, { name = 'Mock Scale' } = {}) { return { name, id: id ?? 'mock', viaPermission: true }; }
  async connect() {
    this.live = true;
    this.emit('connected', { name: 'Mock Scale', services: 1, characteristics: 1 });
    return this.chars;
  }

  get connected() { return !!this.live; }

  /** A plausible battery, so the chrome around it can be exercised. */
  async battery() { return 76; }

  async subscribeAll() {
    this.timer = setInterval(() => {
      this.emit('frame', { uuid: this.chars[0].uuid, service: this.chars[0].service,
        bytes: this.frame(), at: performance.now() / 1000 });
    }, 1000 / this.hz);
    this.emit('subscribed', { uuids: [this.chars[0].uuid] });
    return [this.chars[0].uuid];
  }

  /** Drive a realistic espresso shot: cup on, pre-infusion, ramp, taper, cup off. */
  runShot({ cup = 120, target = 36, onDone } = {}) {
    const t0 = performance.now() / 1000;
    this.grams = 0;
    setTimeout(() => { this.grams = cup; }, 400);
    const tick = setInterval(() => {
      const t = performance.now() / 1000 - t0;
      if (t < 1.2) return;
      const shot = t - 1.2;
      if (shot > 6 && this.grams - cup < target) {
        const q = Math.min(2.1, (shot - 6) * 0.9) * (shot > 26 ? 0.45 : 1);
        this.grams += q / this.hz;
      } else if (this.grams - cup >= target) {
        clearInterval(tick);
        setTimeout(() => { onDone?.(); }, 4500);
      }
    }, 1000 / this.hz);
    return () => clearInterval(tick);
  }

  disconnect() {
    clearInterval(this.timer);
    this.timer = null;
    this.live = false;
    this.emit('disconnected', {});
  }
}

/**
 * Emits the frame layout captured from a real Lefu-based scale (INSMART 5 kg):
 * 12 06 05 00 <weight u16LE, 0.1 g> 05 00, on service FFF0 characteristic FFF3.
 * Used to test driver auto-detection without the hardware present.
 */
export class LefuMockScale extends MockScale {
  constructor(opts = {}) {
    super(opts);
    this.chars = [{
      service: '0000fff0-0000-1000-8000-00805f9b34fb',
      uuid: '0000fff3-0000-1000-8000-00805f9b34fb',
      notify: true, read: false, write: false,
    }];
  }

  frame() {
    const g = this.grams + (Math.random() - 0.5) * this.noise * 2;
    const v = Math.round(Math.abs(g) * 10);
    // Byte 2: bit 2 = settled, bit 4 = negative. Magnitude is always unsigned.
    const status = 0x01 | 0x04 | (g < 0 ? 0x10 : 0x00);
    return Uint8Array.from([0x12, 0x06, status, 0x00, v & 0xff, (v >> 8) & 0xff, 0x05, 0x00]);
  }
}
