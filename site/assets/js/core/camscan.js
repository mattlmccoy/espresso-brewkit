// Reading a QR code off a camera, on whichever device is doing the looking.
//
// This was written once, inline, on the laptop — where the job is to read the
// phone's reply off the phone's screen. The phone needs exactly the same thing
// pointed the other way, and for a reason that only shows up once someone
// actually uses the app: `view.html` saved to an iOS home screen is a separate
// browser context, and the iOS Camera app opens scanned links in SAFARI. So the
// URL trick that makes the first leg of pairing free — scan the laptop, Safari
// opens the viewer with the code in the fragment — cannot reach the installed
// app at all. The installed app has to do its own looking.
//
// So it lives here, and both sides use it.

/**
 * A camera pointed at a QR code, until it finds one it likes.
 *
 * `accept` is what makes this reusable: each side is looking for a different
 * kind of code, and a scanner that fires on the first symbol it sees will
 * happily hand the laptop back its own offer. It returns the value to keep, or
 * null to go on looking — so it doubles as the place to unwrap a code out of a
 * URL, which is the form the laptop's QR takes.
 */
export class CamScan {
  /**
   * @param {HTMLVideoElement} video where the preview goes
   * @param {{accept:(raw:string)=>(string|null),
   *          facingMode?:string, decode?:(img:ImageData)=>(string|null)}} o
   */
  constructor(video, { accept, facingMode = 'environment', decode = null } = {}) {
    this.video = video;
    this.accept = accept ?? ((v) => v || null);
    this.facingMode = facingMode;
    this.decode = decode;
    this.stream = null;
    this.onFound = null;
    this.timer = null;
  }

  get running() { return !!this.stream; }

  /**
   * Whether this device can do it at all, so a button can be absent rather than
   * broken.
   *
   * `navigator.mediaDevices` is itself undefined outside a secure context, so
   * this covers the case that would otherwise be baffling: the app served over
   * plain HTTP on a LAN — which is exactly how the dev server runs it — cannot
   * open a camera at all, at any permission setting. Over HTTPS, or from a home
   * screen, or on localhost, it can. `whyNot` is what to say about it.
   */
  static get possible() { return !!navigator.mediaDevices?.getUserMedia; }

  /** Why the camera is not on offer, in terms of the thing to do about it. */
  static get whyNot() {
    if (CamScan.possible) return '';
    if (!window.isSecureContext) {
      return 'A camera needs a secure page, and this one was served over plain http — '
        + 'so scanning is off here, though everything else works. Opening the app over '
        + 'https, or from its home-screen icon, brings it back.';
    }
    return 'This browser will not open a camera.';
  }

  async start() {
    if (this.stream) return;
    // WHAT KIND OF ELEMENT THIS IS, SAID BEFORE IT IS GIVEN A STREAM.
    // iOS begins loading the moment srcObject is assigned, and a video not yet
    // marked muted and inline goes down Safari's fullscreen path; setting the
    // attributes afterwards interrupts the load it already started, and the
    // play() that follows rejects with AbortError. Set first, assign second.
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('autoplay', '');
    this.video.muted = true;
    // And visible before play: iOS will not start a video with no layout box.
    this.video.hidden = false;
    try {
      // `environment` on a phone reading a laptop across the counter, `user` on
      // a laptop reading a phone held up to it. An exact constraint would fail
      // outright on a device with one camera, which is the wrong trade: a laptop
      // that offers its only camera is fine, a laptop that refuses to scan is
      // not.
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.facingMode },
      });
      this.video.srcObject = this.stream;
      await this._play();
    } catch (err) {
      // NOTHING HALF-STARTED IS LEFT BEHIND. This used to throw straight to the
      // caller with the element already unhidden and, past getUserMedia, the
      // camera still held — so a failure showed a large empty grey box, kept the
      // hardware, and left `running` true, which turned the next press of the
      // button into a silent no-op that just stopped a scan never started.
      this.stop();
      throw err;
    }
    this._loop();
  }

  /**
   * Play, and do not take a rejection at face value.
   *
   * A muted inline video with a live stream generally renders whether or not
   * play() resolves, and on iOS that promise rejects for reasons that have
   * nothing to do with whether frames are arriving — a competing load, a
   * backgrounded tab. The question worth asking is the one the scanner actually
   * depends on: are there frames? If there are, it is running.
   */
  async _play() {
    try {
      await this.video.play();
    } catch (err) {
      if (!(await this._frames())) throw err;
    }
  }

  /** Whether the element is decoding: videoWidth is 0 until the first frame. */
  _frames(ms = 1500) {
    return new Promise((done) => {
      const t0 = Date.now();
      const tick = () => {
        if (this.video.videoWidth > 0) return done(true);
        if (!this.stream || Date.now() - t0 > ms) return done(false);
        setTimeout(tick, 60);
      };
      tick();
    });
  }

  /**
   * What went wrong, in terms of the thing to do about it.
   *
   * The raw message is the wrong thing to show. "The operation was aborted" is
   * what iOS says when the camera is held by something else, and the something
   * else is nearly always the Camera app you just used to scan the very code
   * that brought you here — it keeps the hardware while it is still open behind
   * Safari. Told that, the fix is obvious and takes a second. Told "the
   * operation was aborted", nobody has ever known what to do next.
   */
  static why(err) {
    const name = err?.name ?? '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'The camera was not permitted for this page. Safari asks once per '
        + 'site — Settings \u203a Safari \u203a Camera lets you undo a no.';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return 'No camera this page can open.';
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      return 'Something else has the camera. The Camera app holds it while it is '
        + 'still open behind Safari, which is easy to hit right after scanning — '
        + 'close it, and any other tab using the camera, then try again.';
    }
    return err?.message ? String(err.message).replace(/\.+$/, '') : 'The camera would not start';
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.hidden = true;
    this.video.srcObject = null;
  }

  /**
   * One frame, downscaled.
   *
   * A module has to be a few pixels across to be read, and it is at 640 wide,
   * while a full-resolution frame is four times the work for nothing.
   */
  _frame() {
    const v = this.video;
    const w = Math.min(640, v.videoWidth || 640);
    const h = Math.round((v.videoHeight || 480) * (w / (v.videoWidth || 640)));
    if (!w || !h) return null;
    this.canvas ??= document.createElement('canvas');
    this.ctx ??= this.canvas.getContext('2d', { willReadFrequently: true });
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.drawImage(v, 0, 0, w, h);
    return this.ctx.getImageData(0, 0, w, h);
  }

  async _loop() {
    if (!this.stream) return;
    // The browser's own reader where it exists, ours where it does not.
    // BarcodeDetector is missing from Safari and Firefox and unreliable in
    // desktop Chrome — which is to say, missing from the device most likely to
    // be the laptop — so it is a fast path and never the requirement.
    this.detector ??= 'BarcodeDetector' in window
      ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
    let value = null;
    try {
      if (this.detector) {
        const found = await this.detector.detect(this.video);
        for (const f of found) {
          const ok = this.accept(f.rawValue);
          if (ok) { value = ok; break; }
        }
      }
      if (!value && this.decode) {
        const frame = this._frame();
        if (frame) value = this.accept(this.decode(frame));
      }
    } catch { /* a frame that would not decode is not an error */ }
    if (!this.stream) return;
    if (value) { this.stop(); this.onFound?.(value); return; }
    this.timer = setTimeout(() => this._loop(), 120);
  }
}

/**
 * A packed description, however it arrived.
 *
 * The laptop's QR is a URL — `view.html#p=<code>` — because the iOS Camera app
 * reads one natively and offers to open it, which is the whole first leg of
 * pairing for the cost of a glance. Read by a camera inside the app instead,
 * the same symbol is a URL that must not be navigated to; what is wanted is the
 * code out of its fragment. The phone's own reply QR is the bare code. Both
 * forms come through here so neither caller has to know which it is looking at.
 */
export function codeFrom(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = /[#&?]p=([^&\s]+)/.exec(s);
  const candidate = m ? decodeURIComponent(m[1]) : s;
  // Every packed description opens with its format version and a tilde. It is
  // a weak check and it is the right one: a stronger one would have to parse,
  // and a camera pointed at a kitchen sees a great many things that are not
  // this, none of which start like it.
  return /^\d+~/.test(candidate) ? candidate : null;
}
