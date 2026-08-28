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

  /** Must be called from a user gesture. */
  async choose({ services = COMMON_SERVICES, namePrefix = null } = {}) {
    const opts = namePrefix
      ? { filters: [{ namePrefix }], optionalServices: services }
      : { acceptAllDevices: true, optionalServices: services };
    this.device = await navigator.bluetooth.requestDevice(opts);
    this.device.addEventListener('gattserverdisconnected', () => {
      this.server = null;
      this.chars = [];
      this.emit('disconnected', { name: this.device?.name ?? null });
    });
    return { name: this.device.name ?? '(unnamed)', id: this.device.id };
  }

  async connect() {
    if (!this.device) throw new Error('No device chosen.');
    this.server = await this.device.gatt.connect();
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
