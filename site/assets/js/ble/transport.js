// Web Bluetooth transport.
//
// THE CONSTRAINT THAT SHAPES THIS FILE: Web Bluetooth will not let you
// enumerate a GATT service you did not declare up front. `acceptAllDevices`
// gets you the device picker, but `getPrimaryServices()` then returns only
// services listed in `optionalServices`. There is no "list everything" call.
//
// So exploring an undocumented scale means guessing its service UUID. In
// practice cheap scales use one of a short list of module defaults (TI, Nordic,
// Telink, and the usual Chinese BLE modules), which is what COMMON_SERVICES is.
// If a device's service is not in that list it will appear to have no services
// at all — that is this API's behaviour, not a broken scale.

const short = (n) => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;

/**
 * Wide sweep: every 16-bit service UUID in the ranges cheap BLE modules
 * actually use. Declaring ~750 UUIDs is unusual but legal, and it is the
 * difference between seeing an unknown scale's service and seeing nothing.
 *
 *   0xFFxx  vendor/proprietary — where nearly every no-name scale lives
 *   0xFExx  Bluetooth SIG member services
 *   0x18xx  SIG standard services (Weight Scale is 0x181D)
 */
export function sweepServices() {
  const out = [];
  for (const base of [0xff00, 0xfe00, 0x1800]) {
    for (let i = 0; i < 256; i++) out.push(short(base + i));
  }
  return [...new Set([...out, ...VENDOR_SERVICES])];
}

/** 128-bit services belonging to specific vendors or module makers. */
export const VENDOR_SERVICES = [
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',   // Nordic UART — very common relabel
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',   // Microchip transparent UART (Acaia)
  '0000fe80-0000-1000-8000-00805f9b34fb',
];

/** Service UUIDs worth asking for when we do not know what we are talking to. */
export const COMMON_SERVICES = [
  short(0x181d),  // Weight Scale (SIG standard — rare in practice, but correct)
  short(0x181b),  // Body Composition
  short(0xffe0), short(0xffe5), short(0xfff0), short(0xff00), short(0xffb0),
  short(0xfee7), short(0xfe59), short(0x1820), short(0xfff1), short(0xffd0),
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',   // Nordic UART — very common relabel
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',   // Microchip transparent UART (Acaia)
  '0000fe80-0000-1000-8000-00805f9b34fb',
];

export const isSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.bluetooth;

/**
 * Web Bluetooth needs a user gesture and a secure context. GitHub Pages is
 * HTTPS so the second is satisfied in production but not over plain http on a
 * LAN address, which is a common way to be confused during development.
 */
export function unsupportedReason() {
  if (typeof navigator === 'undefined') return 'No browser environment.';
  if (!window.isSecureContext) {
    return 'Web Bluetooth needs a secure context. Use https:// or http://localhost.';
  }
  if (!navigator.bluetooth) {
    return 'This browser has no Web Bluetooth. Chrome, Edge and Opera support it; '
      + 'Firefox and Safari do not, and on iOS no browser does.';
  }
  return null;
}

export class ScaleLink extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.server = null;
    this.chars = [];
    this.subscribed = [];
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  /** A live GATT server is the only honest definition of connected. */
  get connected() { return !!this.server; }

  _bind(device) {
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => {
      this.server = null;
      this.chars = [];
      this.emit('disconnected', { name: this.device?.name ?? null });
    });
    return { name: device.name ?? '(unnamed)', id: device.id };
  }

  /** Must be called from a user gesture. */
  async choose({ services = COMMON_SERVICES, namePrefix = null, wide = false, extra = [] } = {}) {
    const list = [...new Set([...(wide ? sweepServices() : services), ...extra])];
    const opts = namePrefix
      ? { filters: [{ namePrefix }], optionalServices: list }
      : { acceptAllDevices: true, optionalServices: list };
    return this._bind(await navigator.bluetooth.requestDevice(opts));
  }

  /**
   * A device this origin already holds a persisted permission for.
   *
   * `getDevices()` is the only way to skip the chooser — `requestDevice()`
   * always shows it, by design, because it is the permission prompt. Without
   * this, "my scale" can never be one click; it is always a menu dive through a
   * list of everything in the room.
   *
   * It is not universally available and the permission can be revoked in
   * browser settings, so this returns null rather than throwing and the caller
   * falls back to asking.
   */
  static async knownDevices() {
    if (!navigator.bluetooth?.getDevices) return null;
    try { return await navigator.bluetooth.getDevices(); } catch { return null; }
  }

  /**
   * Reopen a saved scale with as little ceremony as the browser allows.
   *
   * Best case, the permission is still held and this connects silently. Failing
   * that it still asks — but filtered to this one device, so the chooser is a
   * confirmation rather than a search. `viaPermission` says which happened, so
   * the UI can tell the truth about it.
   */
  async reopen(id, { name = null, services = COMMON_SERVICES, extra = [], wide = false } = {}) {
    const known = await ScaleLink.knownDevices();
    const match = known?.find((d) => d.id === id)
      ?? (name ? known?.find((d) => d.name === name) : null);
    if (match) return { ...this._bind(match), viaPermission: true };

    const list = [...new Set([...(wide ? sweepServices() : services), ...extra])];
    // An exact name filter, not a prefix: the point is to surface one scale.
    const opts = name
      ? { filters: [{ name }], optionalServices: list }
      : { acceptAllDevices: true, optionalServices: list };
    return { ...this._bind(await navigator.bluetooth.requestDevice(opts)), viaPermission: false };
  }

  /**
   * @param timeoutMs  A scale that is asleep or out of range does not refuse the
   *                   connection, it simply never answers. Without a deadline the
   *                   UI sits on "connecting" forever with nothing to act on.
   */
  async connect({ timeoutMs = 15000 } = {}) {
    if (!this.device) throw new Error('No device chosen.');
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        `${this.device?.name ?? 'The scale'} did not answer within ${Math.round(timeoutMs / 1000)} s. `
        + 'BLE scales sleep after a minute or two idle and stop advertising while another app holds '
        + 'them — wake it with a tap, close any other app connected to it, and try again.')), timeoutMs);
    });
    try {
      this.server = await Promise.race([this.device.gatt.connect(), deadline]);
    } catch (err) {
      try { this.device?.gatt?.disconnect(); } catch { /* nothing to close */ }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    this.chars = [];
    let services = [];
    try {
      services = await this.server.getPrimaryServices();
    } catch {
      services = [];
    }
    for (const svc of services) {
      let cs = [];
      try { cs = await svc.getCharacteristics(); } catch { continue; }
      for (const c of cs) {
        this.chars.push({
          service: svc.uuid,
          uuid: c.uuid,
          notify: c.properties.notify || c.properties.indicate,
          read: c.properties.read,
          write: c.properties.write || c.properties.writeWithoutResponse,
          ref: c,
        });
      }
    }
    this.emit('connected', {
      name: this.device.name ?? '(unnamed)',
      services: services.length,
      characteristics: this.chars.length,
    });
    return this.chars;
  }

  /** Subscribe to every notifying characteristic and emit each frame. */
  async subscribeAll() {
    const ok = [];
    for (const c of this.chars.filter((x) => x.notify)) {
      try {
        await c.ref.startNotifications();
        const handler = (e) => {
          const v = e.target.value;
          const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
          this.emit('frame', { uuid: c.uuid, service: c.service, bytes, at: performance.now() / 1000 });
        };
        c.ref.addEventListener('characteristicvaluechanged', handler);
        this.subscribed.push({ c, handler });
        ok.push(c.uuid);
      } catch { /* some characteristics advertise notify but refuse it */ }
    }
    this.emit('subscribed', { uuids: ok });
    return ok;
  }

  /** Some scales need a wake/identify write before they will notify. */
  async write(uuid, bytes) {
    const c = this.chars.find((x) => x.uuid === uuid && x.write);
    if (!c) throw new Error('No writable characteristic ' + uuid);
    const data = Uint8Array.from(bytes);
    if (c.ref.properties.writeWithoutResponse) await c.ref.writeValueWithoutResponse(data);
    else await c.ref.writeValue(data);
  }

  disconnect() {
    for (const { c, handler } of this.subscribed) {
      try { c.ref.removeEventListener('characteristicvaluechanged', handler); } catch { /* gone */ }
    }
    this.subscribed = [];
    try { this.device?.gatt?.disconnect(); } catch { /* already gone */ }
    this.server = null;
  }
}
