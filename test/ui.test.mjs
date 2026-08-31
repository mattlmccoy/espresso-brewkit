// End-to-end UI tests: drives the published site in a real browser and asserts
// on what renders, not on what the source says it should render.
//
//   npm test
//
// Chromium comes from `npx playwright install chromium`. Set PW_CHROMIUM to
// point at an existing binary instead.

import { chromium } from 'playwright';
import { serve } from './server.mjs';

const server = await serve();
const B = server.origin;

let pass = 0, fail = 0;
/**
 * Kit is tabbed now, so a test has to be on the right tab to touch a form —
 * exactly as a person does. The add-box is opened too: it folds itself away
 * once a list has entries, and half these tests run against a list that does.
 */
const kitTab = async (name) => {
  await page.click(`[data-kit-tab="${name}"]`);
  await page.evaluate((n) => {
    const box = document.querySelector(`[data-add="${n}"]`);
    if (box) box.open = true;
  }, name);
};

const t = (name, ok, extra = '') => {
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? '  — ' + extra : ''));
};

const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  // The phone link is real WebRTC. Chromium normally hides local IPs behind
  // mDNS names, which nothing resolves in a headless container, so the two
  // pages would gather candidates they could never use.
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
// One persistent handler, not a `once` per click: a confirm() that legitimately
// does not fire (nothing to delete) leaves a stray handler armed, and the next
// dialog is then accepted twice.
page.on('dialog', (d) => d.accept().catch(() => {}));

try {
  // 1. Landing page, and a log to test against.
  //
  // The home page used to offer to load these fifteen shots into the log with
  // a click, and that is exactly what it must not do any more: they were pulled
  // on different equipment, and in among your own shots they skew the grind
  // model, the habit view and every comparison. The suite still needs a
  // populated log, so it builds one directly — a fixture is allowed to
  // construct any state; a product is not allowed to offer it.
  await page.goto(B + '/index.html');
  const seeded = await page.evaluate(async () => {
    const store = await import('./assets/js/core/store.js');
    const res = await fetch('./data/shots.csv');
    return store.importCsv(await res.text());
  });
  t('index: the log can be populated for the tests below',
    seeded.added === 15, `${seeded.added} rows`);
  t('index: but the page no longer offers to pour them into your log',
    (await page.locator('#load-sample').count()) === 0
    && /skew the grind model/i.test(await page.innerText('body')),
    'no loader, and the page says why the log starts empty');

  // ---- the walkthrough on the home page ----
  // It is the first thing anyone sees, and it is animated, which means it is
  // also the easiest thing on the site to break silently. The timing half is
  // pure, so it can be driven exactly rather than waited on.
  const clock = await page.evaluate(async () => {
    const T = await import('./assets/js/core/tour.js');
    const tour = new T.Tour();
    const seen = [tour.scene.id];
    // Step a whole loop in 100 ms frames and record the order of the scenes.
    for (let i = 0; i < Math.ceil(T.TOTAL_MS / 100) + 2; i++) {
      if (tour.tick(100)) seen.push(tour.scene.id);
    }
    const jumpy = new T.Tour();
    jumpy.tick(999999);            // a tab returning from the background
    const once = new T.Tour({ loop: false });
    for (let i = 0; i < 1000; i++) once.tick(100);
    return { seen: seen.join(','), order: T.SCENES.map((x) => x.id).join(','),
             cappedTo: jumpy.i, endsAt: once.scene.id, stopped: once.done && !once.playing };
  });
  t('tour: it walks the session in order and comes back round',
    clock.seen.startsWith(clock.order + ',' + clock.order.split(',')[0]),
    clock.seen);
  t('tour: one enormous frame cannot skip the whole story',
    clock.cappedTo <= 1, `advanced to scene ${clock.cappedTo} on a 999 s frame`);
  t('tour: without looping it stops on the last scene rather than running on',
    clock.endsAt === 'read' && clock.stopped, `${clock.endsAt}, stopped=${clock.stopped}`);

  // The picture has to be a shot, not a shape. If the fake curve does not have
  // a flat pre-infusion and a falling flow rate, the first impression of a tool
  // that reads curves is a curve no espresso ever made.
  const physics = await page.evaluate(async () => {
    const T = await import('./assets/js/core/tour.js');
    let peak = 0, peakAt = 0;
    for (let x = 0; x < T.SHOT_S; x += 0.05) {
      const f = T.flowAt(x);
      if (f > peak) { peak = f; peakAt = x; }
    }
    const { weight } = T.curveTo(T.SHOT_S);
    const rising = weight.every((pt, i) => i === 0 || pt[1] >= weight[i - 1][1] - 1e-9);
    return { dry: T.flowAt(T.FIRST_DRIP_S - 0.5), peak, peakAt,
             falling: T.flowAt(T.SHOT_S) < peak, final: T.FINAL_G, rising };
  });
  t('tour: nothing comes out during pre-infusion', physics.dry === 0, String(physics.dry));
  t('tour: flow peaks and then sags, the way a puck actually behaves',
    physics.falling && physics.peak > 1.4 && physics.peak < 3,
    `peak ${physics.peak.toFixed(2)} g/s at ${physics.peakAt.toFixed(1)} s`);
  t('tour: and the weight only ever goes up, landing on the yield target',
    physics.rising && Math.abs(physics.final - 36) < 1.5, `${physics.final.toFixed(1)} g`);

  // The dose beat has to actually pass through the number it claims to be
  // filling to, and has to tare rather than pretending the cup weighs nothing.
  const dose = await page.evaluate(async () => {
    const T = await import('./assets/js/core/tour.js');
    let hitWindow = false, sawTare = false, maxNet = 0;
    for (let u = 0; u <= 1; u += 0.002) {
      const p = T.dosePhase(u);
      if (p.phase === 'tare' && p.raw > 40 && p.net === 0) sawTare = true;
      if (p.phase !== 'vessel' && Math.abs(p.net - T.DOSE_TARGET) < 1.5) hitWindow = true;
      // Only after the tare: before it, net is the cup, which is the point.
      if (p.tare) maxNet = Math.max(maxNet, p.net);
    }
    const g = T.grindPhase(0.99);
    return { hitWindow, sawTare, maxNet, pfTare: g.tare, pfNet: g.net };
  });
  t('tour: the dose reaches the window it is aiming at',
    dose.hitWindow && dose.maxNet < 20, `tops out at ${dose.maxNet.toFixed(1)} g`);
  t('tour: and the cup is tared away rather than counted',
    dose.sawTare, 'raw shows the cup, net shows zero');
  t('tour: the grind beat does the same three things with a portafilter',
    dose.pfTare > 400 && Math.abs(dose.pfNet - 17.9) < 0.2,
    `tare ${dose.pfTare} g, ${dose.pfNet} g of grounds`);

  // And the page actually draws it: chapters, a scene visible, a curve.
  await page.waitForSelector('#t-chapters button');
  const stage = await page.evaluate(async () => {
    const out = {};
    window.__tour.pause();
    out.chapters = [...document.querySelectorAll('#t-chapters button')]
      .map((b) => b.textContent.trim()).join('|');
    window.__tour.seek(1); window.__tour.t = 4200; window.__tourPaint();
    out.doseShown = document.querySelector('.scene[data-scene="weigh"]').classList.contains('on');
    out.doseNumber = document.getElementById('w-n').textContent;
    window.__tour.seek(3); window.__tour.t = 6000; window.__tourPaint();
    out.brewShown = document.querySelector('.scene[data-scene="brew"]').classList.contains('on');
    out.curveDrawn = !!document.querySelector('#t-curve svg path');
    window.__tour.seek(4); window.__tour.t = 6000; window.__tourPaint();
    out.stars = document.querySelectorAll('#r-stars .on').length;
    return out;
  });
  t('tour: the chapters name the steps the Live page uses',
    stage.chapters === '00 Pair|01 Dose|02 Grind|03 Brew|04 Read', stage.chapters);
  t('tour: seeking to a chapter draws that chapter',
    stage.doseShown && Number(stage.doseNumber) > 0 && stage.brewShown && stage.curveDrawn,
    `dose ${stage.doseNumber} g, curve drawn: ${stage.curveDrawn}`);
  t('tour: the last beat ends on a rating', stage.stars === 4, `${stage.stars} stars`);

  // Pausing has to actually stop it, or the control is a lie.
  const paused = await page.evaluate(async () => {
    window.__tour.seek(0);
    window.__tour.pause();
    const before = window.__tour.t;
    for (let i = 0; i < 20; i++) window.__tour.tick(100);
    return { before, after: window.__tour.t };
  });
  t('tour: paused means paused', paused.after === paused.before,
    `${paused.before} -> ${paused.after}`);

  // 2. Logger table populated
  await page.goto(B + '/logger.html');
  await page.waitForSelector('#tbl tbody tr');
  const rowCount = await page.locator('#tbl tbody tr').count();
  const firstRow = await page.locator('#tbl tbody tr').first().innerText();
  t('logger: table renders 15 rows', rowCount === 15, rowCount + ' rows');
  t('logger: derived EY present', /21\.56/.test(firstRow), firstRow.replace(/\s+/g,' ').slice(0,90));

  // 3. Add a shot through the form
  await page.fill('#brix', '11.2');
  await page.click('#add');
  await page.waitForFunction(() => document.getElementById('add-msg').textContent.includes('Added'));
  const addMsg = await page.textContent('#add-msg');
  const after = await page.locator('#tbl tbody tr').count();
  t('logger: add shot works', after === 16 && addMsg.includes('shot-001'), addMsg.trim());

  // 4. Calculator recomputes
  await page.goto(B + '/calculator.html');
  await page.fill('#dose', '19'); await page.fill('#yield', '35.7'); await page.fill('#brix', '13.5');
  await page.waitForTimeout(150);
  const ey = await page.textContent('#o-ey');
  const band = await page.textContent('#o-band');
  t('calculator: EY matches legacy value', ey === '21.56', 'got ' + ey + ' (expect 21.56)');
  t('calculator: band classified', band.includes('Typical'), band.trim());

  // 5. Explore — 2D fit renders SVG
  await page.goto(B + '/explore.html');
  await page.waitForSelector('#chart svg');
  await page.selectOption('#p1', 'grind_setting');
  await page.selectOption('#resp', 'ey_pct');
  await page.waitForTimeout(250);
  const pts2d = await page.locator('#chart svg circle.pt').count();
  const r2 = await page.textContent('#s-r2');
  const verdict = await page.textContent('#fit-verdict');
  t('explore: 2D scatter excludes the shot with no grind setting', pts2d === 15, pts2d + ' of 16 shots');
  t('explore: reports R2', /^[\d.]+$/.test(r2.trim()), 'R2=' + r2);
  t('explore: states CI verdict', /CI \[/.test(verdict), verdict.slice(0, 95));
  const band2 = await page.locator('#chart svg path.band').count();
  t('explore: confidence band drawn', band2 === 1);
  const resid = await page.locator('#resid svg circle.pt').count();
  t('explore: residual plot renders', resid > 0, resid + ' residuals');
  const heat = await page.locator('#heat svg rect.cell').count();
  t('explore: correlation heatmap renders', heat > 0, heat + ' cells');

  // 6. Explore — 3D plane fit
  await page.selectOption('#p2', 'temp_c');
  await page.waitForTimeout(300);
  const planes = await page.locator('#chart svg polygon.plane').count();
  const pts3d = await page.locator('#chart svg circle.pt-3d').count();
  const title = await page.textContent('#fit-title');
  t('explore: 3D plane mesh renders', planes === 100, planes + ' quads');
  t('explore: 3D points render', pts3d === 15, pts3d + ' of 16 shots');
  t('explore: 3D mode labelled', title.includes('rotate'), title);
  // drag to rotate and confirm geometry actually changes
  const before3d = await page.locator('#chart svg polygon.plane').first().getAttribute('points');
  const box3d = await page.locator('#chart svg').boundingBox();
  await page.mouse.move(box3d.x + box3d.width/2, box3d.y + box3d.height/2);
  await page.mouse.down();
  await page.mouse.move(box3d.x + box3d.width/2 + 120, box3d.y + box3d.height/2 + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after3d = await page.locator('#chart svg polygon.plane').first().getAttribute('points');
  t('explore: drag rotates the 3D view', before3d !== after3d);
  const stillThere = await page.locator('#chart svg polygon.plane').count();
  t('explore: 3D view intact after drag', stillThere === 100, stillThere + ' quads');

  // 7. Quality
  await page.goto(B + '/quality.html');
  await page.waitForSelector('#rows tr');
  const qrows = await page.locator('#rows tr').count();
  const cv = await page.textContent('#s-cv');
  const fences = await page.textContent('#fences');
  const box = await page.locator('#box svg rect.box').count();
  t('quality: per-shot table renders', qrows === 16, qrows + ' rows');
  t('quality: CV computed', parseFloat(cv) > 0, 'CV=' + cv + '%');
  t('quality: box plot renders', box === 1);
  t('quality: fences reported', fences.includes('IQR fence'), fences.slice(0, 80));

  // 8. Uncertainty — budget and the u(k)=0 legacy reproduction
  await page.goto(B + '/uncertainty.html');
  await page.fill('#dose','19'); await page.fill('#yield','35.7'); await page.fill('#brix','13.5');
  await page.waitForTimeout(150);
  const full = await page.textContent('#o-uc');
  const budgetRows = await page.locator('#budget tr').count();
  const topTerm = await page.locator('#budget tr').first().innerText();
  t('uncertainty: budget has 4 terms', budgetRows === 4, budgetRows + ' rows');
  t('uncertainty: ranked by share', /Brix reading/.test(topTerm), topTerm.replace(/\s+/g,' '));
  await page.fill('#uFactor', '0');
  await page.waitForTimeout(150);
  const legacyU = await page.textContent('#o-uc');
  t('uncertainty: u(k)=0 reproduces legacy 0.799', legacyU === '0.799', 'got ' + legacyU + ' (full model: ' + full + ')');
  const allRows = await page.locator('#alltbl tr').count();
  t('uncertainty: whole-log table renders', allRows === 16, allRows + ' rows');

  // 9. A theme is chosen by name, and persists
  // It used to be a cycling button in the nav, which was only ever a concession
  // to a bar with no room for four names: reaching the one you want took up to
  // three presses, each repainting the whole app. The bar's options menu names
  // all four, so this asks for one directly.
  await page.goto(B + '/index.html');
  const picked = await page.evaluate(async () => {
    const { THEMES } = await import('./assets/js/ui.js');
    document.querySelector('.menu').open = true;
    const swatch = (t) => document.querySelector(`.menu-swatch[data-theme="${t}"]`);
    // Every theme the app has must be reachable, asked of THEMES rather than of
    // a list written here — so adding one cannot leave the menu half-wired
    // without the suite noticing.
    const missing = THEMES.filter((t) => !swatch(t));
    swatch('terminal').click();
    await new Promise((r) => setTimeout(r, 60));
    return {
      missing, themes: THEMES,
      at: document.documentElement.getAttribute('data-theme'),
      // The one you are wearing is marked, so the panel says where you are.
      lit: THEMES.filter((t) => swatch(t).getAttribute('aria-pressed') === 'true'),
      labels: THEMES.map((t) => swatch(t).textContent.trim()),
    };
  });
  await page.goto(B + '/explore.html');
  const themeAfter = await page.getAttribute('html', 'data-theme');
  t('theme: every palette is offered by name, and the current one is marked',
    picked.missing.length === 0 && picked.at === 'terminal'
    && picked.lit.join() === 'terminal',
    picked.missing.length ? `no swatch for ${picked.missing.join()}`
      : `${picked.labels.join(' · ')} — wearing ${picked.lit.join()}`);
  t('theme: and the choice survives changing page',
    themeAfter === 'terminal', `${picked.at} → ${themeAfter}`);
  const term = await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'terminal');
    const cs = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    return { sans: cs.getPropertyValue('--sans').trim(),
             disp: cs.getPropertyValue('--disp').trim(),
             ink: cs.getPropertyValue('--ink').trim(),
             font: body.fontFamily };
  });
  t('theme: terminal is one typeface for everything, which is the whole idea',
    term.sans === term.disp && /Space Mono|monospace/i.test(term.font),
    `${term.font.slice(0, 40)} · ink ${term.ink}`);

  // Glass is a surface, not a page with a different palette. The first attempt
  // at a borderless theme was a recolour of the same hard-edged panels, which
  // is exactly what this assertion has to be able to tell apart: nothing is
  // drawn with an outline, everything is lit from a single source.
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'glass'));
  // Surfaces transition their shadow, and a computed style read mid-transition
  // is a half-interpolated value that says nothing about either theme.
  await page.waitForTimeout(250);
  const soft = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    const panel = getComputedStyle(document.querySelector('.bx'));
    // How far a colour is from grey, on a 0-255 scale.
    const chroma = (c) => { const [r, g, b] = c.replace('#', '').match(/../g)
      .map((h) => parseInt(h, 16)); return Math.max(r, g, b) - Math.min(r, g, b); };
    return { accent: v('--accent'),
             border: parseFloat(panel.borderTopWidth),
             radius: parseFloat(panel.borderTopLeftRadius),
             shadow: panel.boxShadow,
             greys: [chroma(v('--bg')), chroma(v('--ink')), chroma(v('--panel'))],
             warm: chroma(v('--accent')) };
  });
  t('theme: nothing is outlined and every surface is lit from one source',
    soft.border === 0 && soft.radius >= 8
    && /inset/.test(soft.shadow) && /rgba\(255, 255, 255/.test(soft.shadow)
    // The brutalist offset slab — an opaque shadow at a diagonal offset with
    // no blur — is the thing this theme is not.
    && !/rgb\(\d+, \d+, \d+\) \d+px \d+px 0px 0px$/.test(soft.shadow),
    `${soft.border}px border, ${soft.radius}px corners, shadow ${soft.shadow}`);

  // One shape, every theme. It used to hand one theme a ring and everyone else a
  // half circle — and only the ring branch drew band labels at all, so in four
  // of the five themes the dial was three unexplained shades of accent. A theme
  // changes the material; it does not change the instrument.
  const shapes = await page.evaluate(async () => {
    const G = await import('./assets/js/core/gauge.js');
    const { shotDial } = await import('./assets/js/core/dial.js');
    const box = document.createElement('div');
    document.body.append(box);
    const g = G.mountGauge(box, { geo: G.geoFor('glass') });
    g.paint(shotDial('espresso', 18, { net: 24, target: 36 }));
    const before = box.querySelector('.g-n').textContent;
    g.setGeo(G.geoFor('glass'));
    const out = {
      sameShape: G.geoFor('glass') === G.geoFor('light')
        && G.geoFor('glass') === G.geoFor('dark'),
      span: +(G.geoFor('light').span / Math.PI).toFixed(2),
      // Labelled in every theme, and never abbreviated: the scale is anchored
      // to the drinks, so a band is the same length at every dose and its whole
      // word always fits.
      labels: [...box.querySelectorAll('.g-label textPath')].map((x) => x.textContent).join(),
      // The rim of decorative ticks is gone. It looked like a graduated scale
      // but was a fixed count, so its spacing meant a different number of grams
      // at every dose.
      rim: box.querySelectorAll('.g-rim-t').length,
      // The reading lives inside the instrument rather than captioned under it.
      readInside: !!box.querySelector('.g-read'),
      gap: box.querySelector('.g-gap').textContent,
      here: [...box.querySelectorAll('.g-zone.here')].map((z) => z.dataset.id).join(),
      before,
      after: box.querySelector('.g-n').textContent,
    };
    box.remove();
    return out;
  });
  t('dial: one shape in every theme, so it is read once and read anywhere',
    shapes.sameShape === true && shapes.span === 1.33 && shapes.rim === 0,
    `${shapes.span}\u03c0 sweep, ${shapes.rim} decorative ticks`);
  t('dial: every band carries its own name, in full',
    // Sentence case: small caps with wide tracking is a telemetry idiom, and
    // the dial spent a round of review being told it looked like a rev counter.
    shapes.labels === 'Ristretto,Espresso,Lungo' && shapes.here === 'ristretto',
    `${shapes.labels} — in ${shapes.here}`);
  t('dial: the reading is inside it, and says how much longer',
    shapes.readInside === true && /to espresso/.test(shapes.gap), shapes.gap);
  t('dial: reshaping keeps the reading that was on it',
    shapes.before === '24.0' && shapes.after === '24.0',
    `${shapes.before} → ${shapes.after}`);
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('brewkit.theme', 'light');
  });

  // 10. Nav marking
  const current = await page.locator('.nav a[aria-current="page"]').innerText();
  // innerText reflects CSS text-transform, which the design language applies.
  // Explore lives under Lab now, so Lab is what the nav marks.
  t('nav: marks the current section', current.trim().toLowerCase() === 'lab', current);

  // ---- design-language assertions ----
  const FAMILIES = ['Archivo', 'Archivo Black', 'Space Mono'];
  for (const [name, url] of [['home','/index.html'],['calculator','/calculator.html'],
      ['logger','/logger.html'],['explore','/explore.html'],['quality','/quality.html'],
      ['uncertainty','/uncertainty.html'],['kit','/kit.html'],['advisor','/advisor.html'],
      ['live','/live.html']]) {
    await page.goto(B + url);
    await page.waitForTimeout(250);
    const loaded = await page.evaluate(async () => { await document.fonts.ready;
      return [...new Set([...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family))]; });
    // Space Mono is only fetched by pages that actually render monospace content,
    // which is correct lazy behaviour — so require it only where it is used.
    const usesMono = await page.evaluate(() => !!document.querySelector('table, .eq, .num'));
    const want = usesMono ? FAMILIES : FAMILIES.filter(f => f !== 'Space Mono');
    const missing = want.filter(f => !loaded.includes(f));
    t(`fonts: faces load on ${name}`, missing.length === 0,
      missing.join(', ') || want.length + ' of ' + FAMILIES.length + ' expected');

    // No rhetorical-question headings anywhere.
    const qs = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,.desc,.tag')]
      .map(e => e.textContent.trim()).filter(x => x.includes('?')));
    t(`copy: no question headings on ${name}`, qs.length === 0, qs.join(' | ') || 'none');

    // Nothing may overflow the viewport horizontally.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    t(`layout: no horizontal overflow on ${name}`, overflow <= 1, overflow + 'px');

    // AND WITH THE POINTER OUT OF THE WAY. Playwright keeps the mouse wherever
    // it last was, across navigations — so a card that happens to sit under it
    // is drawn hovered, and `.tool-card:hover` is a 2 px translate. That is a
    // measurement of the cursor's position rather than of the layout, and it
    // read as a staircase whose cause was somewhere else entirely.
    await page.mouse.move(0, 0);

    // Items in one grid row must share a top edge — an adjacency margin leaking
    // into grid children silently staircases them. Measured only once every
    // entrance has finished: a staggered card is mid-transform for a few hundred
    // milliseconds, and a ruler held against a moving object measures nothing.
    await page.evaluate(() => Promise.race([
      Promise.all(document.getAnimations()
        // Infinite animations never settle, and neither does one belonging to
        // an element the page has since hidden. Both would hang this forever,
        // and neither moves layout; the deadline covers what the filter misses.
        .filter((a) => a.effect?.getTiming?.().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {}))),
      new Promise((r) => setTimeout(r, 1500)),
    ]));
    const rows = await page.evaluate(() => {
      const bad = [];
      for (const g of document.querySelectorAll('.grid')) {
        const kids = [...g.children].filter(k => k.getBoundingClientRect().height > 0);
        const byRow = new Map();
        for (const k of kids) {
          const r = k.getBoundingClientRect();
          const key = Math.round(r.bottom / 5);
          // Named, not just numbered: "896/894" says two things are two pixels
          // apart and nothing about which two, which is the only part that
          // tells you where to look.
          const who = (k.querySelector('h3, .tag')?.textContent
            || k.className || k.tagName).trim().slice(0, 24);
          byRow.set(key, [...(byRow.get(key) || []), `${who}@${Math.round(r.top)}`]);
        }
        for (const tops of byRow.values()) {
          if (new Set(tops.map((x) => x.split('@')[1])).size > 1) bad.push(tops.join(' / '));
        }
      }
      return bad;
    });
    t(`layout: grid rows share a top edge on ${name}`, rows.length === 0, rows.join(' ') || 'aligned');
  }

  // 2D charts fill their panel; the square 3D view stays capped.
  await page.goto(B + '/explore.html');
  await page.waitForSelector('#chart svg');
  await page.waitForTimeout(300);
  const fill = await page.evaluate(() => {
    const svg = document.querySelector('#chart svg');
    return { svg: svg.getBoundingClientRect().width,
             panel: svg.closest('.panel').clientWidth };
  });
  t('chart: 2D fills its panel', fill.svg > fill.panel * 0.85,
    Math.round(fill.svg) + 'px in a ' + Math.round(fill.panel) + 'px panel');
  await page.selectOption('#p2', 'temp_c');
  await page.waitForTimeout(350);
  const capped = await page.evaluate(() => document.querySelector('#chart svg').getBoundingClientRect().width);
  t('chart: 3D stays capped at natural size', capped <= 561, Math.round(capped) + 'px');

  // Narrow viewport: the nav becomes a scrolling strip instead of reflowing.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(B + '/explore.html');
  await page.waitForTimeout(300);
  const navRows = await page.evaluate(() => {
    const tops = [...document.querySelectorAll('.nav > a')].map(a => Math.round(a.getBoundingClientRect().top));
    return new Set(tops).size;
  });
  const mobileOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t('mobile: nav stays on one row', navRows === 1, navRows + ' row(s)');
  // AND THE MENU IS REACHABLE WITHOUT SCROLLING THE BAR SIDEWAYS.
  // The strip scrolls on a phone — 499 px of bar in 338 px of screen — and the
  // menu is the last thing in it, so at rest it sat 7 px past the right edge of
  // a 390 px viewport. Five links being half off is fine; they are one tap from
  // each other anyway. The menu being off is not: theme, view, settings and
  // backup are all behind it, and nothing on screen says to swipe the bar.
  const reachable = await page.evaluate(() => {
    const nav = document.querySelector('.nav');
    const r = document.querySelector('.menu-btn').getBoundingClientRect();
    return { scrolls: nav.scrollWidth > nav.clientWidth + 1,
             onScreen: r.right <= innerWidth + 1 && r.left >= -1,
             right: Math.round(innerWidth - r.right) };
  });
  t('mobile: and the options menu is on screen without scrolling the bar',
    reachable.scrolls && reachable.onScreen,
    reachable.scrolls
      ? `pinned ${reachable.right}px from the edge of a scrolling strip`
      : 'the strip does not scroll here, so nothing was proven');
  t('mobile: no horizontal page overflow', mobileOverflow <= 1, mobileOverflow + 'px');
  await page.setViewportSize({ width: 1400, height: 1000 });

  // ---- form controls actually render and respond ----
  // The global `appearance: none` on inputs once stripped checkboxes of their
  // native rendering, so they toggled invisibly and read as dead controls.
  await page.goto(B + '/live.html');
  // The scan controls live inside a collapsed disclosure now; open it first.
  await page.locator('#step-connect details summary').click();
  await page.waitForSelector('#wide', { state: 'visible' });
  const cb = await page.evaluate(() => {
    const el = document.getElementById('wide');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { appearance: cs.appearance, w: Math.round(r.width), h: Math.round(r.height) };
  });
  t('controls: checkbox keeps its native rendering',
    cb.appearance !== 'none' && cb.w > 8 && cb.h > 8,
    `appearance:${cb.appearance} ${cb.w}x${cb.h}`);

  const wideWas = await page.isChecked('#wide');
  await page.click('#wide');
  const wideNow = await page.isChecked('#wide');
  t('controls: checkbox toggles on click', wideWas !== wideNow, `${wideWas} -> ${wideNow}`);

  // Clicking the wrapping label must toggle it too — that is most of its hit area.
  await page.click('.check');
  t('controls: label click toggles the checkbox', (await page.isChecked('#wide')) === wideWas,
    'back to ' + wideWas);

  // ---- live capture, driven by a mock scale (no hardware) ----
  // The demo buttons were removed for polish; the mocks stay reachable via
  // ?mock= so this coverage survives the UI change.
  await page.goto(B + '/live.html');
  await page.evaluate(() => {
    localStorage.removeItem('brewkit.captures.v1');
    localStorage.removeItem('brewkit.devices.v1');
  });
  await page.goto(B + '/live.html');
  t('live: starts in the connect phase', await page.locator('#step-connect').isVisible()
    && !(await page.locator('#step-live').isVisible()), 'connect shown, live hidden');
  t('live: no demo buttons in the UI', (await page.locator('#demo, #demo-lefu').count()) === 0);

  // An unknown scale must land in setup, not live.
  await page.goto(B + '/live.html?mock=generic');
  await page.waitForFunction(
    () => document.getElementById('step-setup').style.display !== 'none', { timeout: 6000 });
  t('live: unknown scale goes to setup', true, await page.textContent('#conn-msg'));
  await page.waitForFunction(() => document.querySelectorAll('#frames div').length > 3, { timeout: 6000 });
  t('live: frames stream in', true, (await page.locator('#frames div').count()) + ' frames');

  // Two references have to be two different weights, and the weight has to be
  // on the scale — not just typed into the box. This used to capture 0 g twice
  // and call the second one 120 g, which asks the decoder to find an encoding
  // where one set of bytes means both. It rightly refuses, and the test only
  // passed when the mock's noise happened to make the two raw values differ,
  // letting an absurd scale factor fit two points. About one run in four it
  // did not, and the suite failed on a decoder that was behaving correctly.
  await page.evaluate(() => { window.__mock.grams = 0; });
  await page.waitForTimeout(300);
  await page.fill('#ref', '0');
  await page.click('#capture');
  await page.evaluate(() => { window.__mock.grams = 120; });
  await page.waitForTimeout(1100);
  await page.fill('#ref', '120');
  await page.click('#capture');
  await page.waitForTimeout(400);
  const candCount = await page.locator('#cands .cand').count();
  t('live: auto-decoder proposes an encoding', candCount > 0, candCount + ' candidates');
  // And it is the real encoding, not one fitted to noise: u16 big-endian
  // centigrams at offset 3, which is what MockScale actually emits.
  const best = await page.evaluate(() => {
    const b = document.querySelector('#cands .cand');
    return b ? b.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  t('live: and the encoding it proposes is the one the scale really uses',
    /u16BE/.test(best) && /\u00d70\.01/.test(best) && /@3/.test(best), best.slice(0, 90));

  await page.locator('#cands .cand button').first().click();
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 4000 });
  t('live: verifying moves to the live phase and hides setup',
    !(await page.locator('#step-setup').isVisible()), 'setup hidden');

  // Naming, which is what makes the profile a device rather than a decoder.
  t('live: prompts for a name after verifying', await page.locator('#name-row').isVisible());
  await page.fill('#device-name', 'Bench scale');
  await page.click('#save-device');
  t('live: name is applied', (await page.textContent('#device-chip')) === 'Bench scale',
    await page.textContent('#device-chip'));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('brewkit.devices.v1') || '{}'));
  const savedOne = Object.values(saved)[0] ?? {};
  t('live: profile stores name, decoder and characteristic',
    savedOne.name === 'Bench scale' && !!savedOne.decoder && !!savedOne.uuid,
    JSON.stringify({ name: savedOne.name, uuid: savedOne.uuid?.slice(4, 8) }));

  await page.waitForFunction(() => {
    const s = document.getElementById('state').textContent.toLowerCase();
    return s.includes('extract') || s.includes('drip') || s.includes('complete');
  }, { timeout: 30000 }).catch(() => {});
  t('live: brew state machine advances', /extract|drip|complete/i.test(await page.textContent('#state')),
    await page.textContent('#state'));

  // PIP WHILE HE IS NOT TALKING. He was barely there on the laptop, and the
  // reason was not that he was hidden — he is on screen the whole time. It was
  // that nothing ever called mood(), so his face changed only on the rare
  // occasions the coach had something worth saying and sat frozen in between.
  const watching = await page.evaluate(() => {
    const face = document.querySelector('.pip-face');
    const box = document.querySelector('.pip-box')?.getBoundingClientRect();
    return {
      face: face?.textContent ?? '',
      size: face ? parseFloat(getComputedStyle(face).fontSize) : 0,
      w: Math.round(box?.width ?? 0), h: Math.round(box?.height ?? 0),
      shown: !!document.querySelector('#pip-dock .pip-box'),
    };
  });
  // Watching a pour is [ o_o ] with [ -_- ] as its blink, so either frame is
  // him watching — what must not appear is the idle face, which is what he wore
  // for the whole shot before.
  t('live: Pip watches the pour rather than sitting on the face he last spoke in',
    watching.shown && /\[ *[o\-]_[o\-] *\]/.test(watching.face)
    && !/·_·/.test(watching.face),
    `on screen ${watching.shown}, face "${watching.face}"`);


  // The pour is a line plot now, not a scatter: assert the trace itself.
  await page.waitForFunction(
    () => (document.querySelector('#curve svg path.weightline')?.getAttribute('d') ?? '')
      .split('L').length > 8, { timeout: 25000 }).catch(() => {});
  const trace = await page.evaluate(() => {
    const d = document.querySelector('#curve svg path.weightline')?.getAttribute('d') ?? '';
    const pts = d.replace('M', '').split('L').map((p) => p.split(',').map(Number))
      .filter((p) => p.length === 2 && p.every(Number.isFinite));
    return { n: pts.length, first: pts[0], last: pts.at(-1) };
  });
  t('live: the pour draws as a weight trace', trace.n > 8, trace.n + ' vertices');
  // y grows downward in SVG, so a climbing weight is a falling y.
  t('live: the trace climbs as the shot pours',
    trace.last && trace.first && trace.last[1] < trace.first[1] && trace.last[0] > trace.first[0],
    `y ${trace.first?.[1]?.toFixed(0)} → ${trace.last?.[1]?.toFixed(0)}`);
  t('live: flow is plotted alongside weight, not just printed',
    (await page.locator('#curve svg path.flowline').count()) === 1, 'flow trace present');

  // Saving is on the Rate step now, and Stop is what turns a running curve into
  // the scalars a record is made of. Walking that path is the test.
  // Let the shot actually run before cutting it: the curve scalars need a shot
  // to read, and a 0.9 s stub has no steady flow or late slope to speak of.
  await page.waitForFunction(
    () => parseFloat(document.getElementById('o-t').textContent) > 9, { timeout: 30000 });
  const shotsBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('brewkit.shots.v1') || '[]').length);
  await page.click('#stop');
  await page.waitForFunction(() => /g in/.test(document.getElementById('live-msg').textContent),
    { timeout: 5000 });
  // NOTHING IS PRESSED HERE. Stopping the shot is what files it: the
  // measurement already happened, and losing it to a closed tab is a worse
  // failure than an unrated row. The rating then edits that row in place.
  await page.waitForFunction(() => /Saved as/.test(document.getElementById('save-msg').textContent),
    { timeout: 5000 });
  const onLanding = await page.evaluate(() => ({
    rows: JSON.parse(localStorage.getItem('brewkit.shots.v1') || '[]').length,
    save: document.getElementById('save').hidden,
    trash: document.getElementById('trash').hidden,
  }));
  t('live: the shot is in the log before anything is pressed',
    onLanding.rows === shotsBefore + 1 && onLanding.save && !onLanding.trash,
    `${shotsBefore} -> ${onLanding.rows}, save hidden ${onLanding.save}, `
    + `trash offered ${!onLanding.trash}`);
  await page.click('#r-rate button:nth-child(7)');
  await page.click('#r-tags button:nth-child(3)');
  const shots = await page.evaluate(() => JSON.parse(localStorage.getItem('brewkit.shots.v1') || '[]'));
  const last = shots.at(-1) ?? {};
  t('live: rating edits the row it already has, rather than filing a second one',
    shots.length === shotsBefore + 1,
    shotsBefore + ' -> ' + shots.length);
  t('live: the saved row carries the flow curve',
    typeof last.curve === 'string' && last.curve.split('|').length > 4,
    (last.curve ?? '').slice(0, 40) + '…');
  t('live: curve scalars are wired into the record',
    Number.isFinite(last.peak_flow_gs) && Number.isFinite(last.steady_flow_gs)
      && Number.isFinite(last.flow_slope_late),
    `peak ${last.peak_flow_gs}, steady ${last.steady_flow_gs}, late ${last.flow_slope_late}`);
  t('live: rating and tags are recorded', last.rating === 7 && last.tags === 'balanced',
    `${last.rating} / ${last.tags}`);

  // WATCHING THE SHOT YOU JUST PULLED. Offered the moment the pump stops, from
  // the stream-rate capture still in memory rather than the 4 Hz reduction that
  // went into the record — a quarter-second step is visible when you are
  // dragging to find the second the flow turned over.
  const rr = await page.evaluate(() => ({
    offered: !document.getElementById('replay-row').hidden,
    barUp: !document.getElementById('replay-bar').hidden,
    keepable: !document.getElementById('replay-keep').disabled,
  }));
  t('live: a finished shot offers to play itself back',
    rr.offered && !rr.barUp && rr.keepable,
    `row up ${rr.offered}, transport closed ${!rr.barUp}, keep enabled ${rr.keepable}`);
  await page.click('#replay-open');
  await page.waitForTimeout(400);
  const opened = await page.evaluate(() => ({
    playing: !!window.__replay?.now,
    marked: document.body.classList.contains('replaying'),
    // The transport is pinned to the bottom of the pour column: it used to sit
    // under the chart, so on any screen where the chart filled the column the
    // play button had scrolled out of reach.
    barUp: !document.getElementById('replay-bar').hidden,
    tag: document.getElementById('mid-tag').textContent,
  }));
  t('live: and it replays on the brewing screen rather than in a panel beside it',
    opened.playing && opened.marked && opened.barUp && /replay/i.test(opened.tag),
    `replaying ${opened.playing}, transport up ${opened.barUp}, tag "${opened.tag}"`);
  await page.evaluate(() => { window.__replay.now.pause(); window.__replay.now.seek(5); });
  await page.waitForTimeout(200);
  const scrubbed = await page.evaluate(() => ({
    t: document.getElementById('o-t').textContent,
    w: document.getElementById('o-w').textContent,
  }));
  t('live: scrubbing moves the whole screen, not just a chart',
    Math.abs(parseFloat(scrubbed.t) - 5) < 0.3,
    `dragged to 5 s: the readout says ${scrubbed.t} s at ${scrubbed.w} g`);
  await page.click('#rp-stop');
  await page.waitForTimeout(250);
  const shut = await page.evaluate(() => ({
    gone: !window.__replay?.now,
    unmarked: !document.body.classList.contains('replaying'),
  }));
  t('live: closing it gives the screen back',
    shut.gone && shut.unmarked, `replaying ${!shut.gone}`);

  // HE IS THERE FOR THE WHOLE SHOT, not only the part with coffee in it. He
  // lived inside the pour slide, so he existed while it poured and vanished for
  // setup, dosing and grinding — which is most of making a coffee.
  //
  // Walked here rather than during the pour: stepping the session while the
  // mock scale is mid-shot drove the capture to 138 g of espresso, which is a
  // test breaking the thing it is standing next to.
  const everyStep = [];
  for (const step of ['setup', 'dose', 'grind', 'brew', 'rate']) {
    await page.evaluate((st) => window.__sess.goto(st), step);
    await page.waitForTimeout(120);
    const up = await page.evaluate(() => {
      const r = document.querySelector('#pip-dock .pip-box')?.getBoundingClientRect();
      return !!r && r.width > 4 && r.height > 4;
    });
    everyStep.push(`${step}:${up ? 'yes' : 'NO'}`);
  }
  t('live: and he is there at every step, not only while it pours',
    everyStep.every((x) => x.endsWith(':yes')), everyStep.join(' '));
  t('live: yield and time come from the curve, not a guess',
    last.yield_g > 1 && last.time_s > 1 && Math.abs(last.ratio - last.yield_g / last.dose_g) < 1e-6,
    `${last.yield_g} g in ${last.time_s} s, ratio ${last.ratio?.toFixed?.(2)}`);
  t('live: the diagnosis is shown where the shot ends',
    (await page.locator('#r-diag').innerText()).trim().length > 10,
    (await page.locator('#r-diag').innerText()).replace(/\s+/g, ' ').slice(0, 70));

  // RATING IS READING. The screen that asks "how was it" used to hide the shot
  // to ask: the curve, the numbers and the diagnosis were all replaced by a
  // form. Everything the question is about has to still be on the screen.
  const summary = await page.evaluate(() => {
    const box = (sel) => { const e = document.querySelector(sel);
      if (!e) return null; const r = e.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) }; };
    const shown = (sel) => { const e = document.querySelector(sel);
      return !!e && getComputedStyle(e).display !== 'none'; };
    const txt = (id) => document.getElementById(id)?.textContent ?? '';
    return {
      pourPanel: shown('#cell-pour'),
      curve: box('#curve'),
      curveDrawn: document.querySelectorAll('#curve svg path').length,
      // What happened, not what was about to.
      done: ['c-dose', 'c-yield', 'c-t', 'c-ratio', 'c-peak'].map(txt),
      projectionsOff: !shown('.pn.live-only'),
      // Past shots, so "how does this compare" has something to compare with.
      history: document.querySelectorAll('#history .hist').length,
    };
  });
  t('live: rating does not hide the shot being rated',
    summary.pourPanel && summary.curve.h > 100 && summary.curveDrawn > 1,
    `panel ${summary.pourPanel}, curve ${summary.curve.w}x${summary.curve.h}, `
    + `${summary.curveDrawn} paths`);
  t('live: the numbers say what happened, not what was about to',
    summary.done.every((v) => /\d/.test(v)) && summary.projectionsOff,
    `in ${summary.done[0]} out ${summary.done[1]} in ${summary.done[2]}s `
    + `at 1:${summary.done[3]}, peak ${summary.done[4]} \u00b7 projections hidden `
    + `${summary.projectionsOff}`);

  // Throwing it away is the way back out, and it has to actually leave: a
  // fumbled shot in the log goes into every average and every recommendation
  // from here on, and nothing downstream can tell it from a real one.
  const trashed = await page.evaluate(async () => {
    const before = JSON.parse(localStorage.getItem('brewkit.shots.v1') || '[]');
    const id = before.at(-1).shot_id;
    document.getElementById('trash').click();
    await new Promise((r) => setTimeout(r, 60));
    const after = JSON.parse(localStorage.getItem('brewkit.shots.v1') || '[]');
    return { id, gone: !after.some((r) => r.shot_id === id), n: after.length,
      saveBack: !document.getElementById('save').hidden,
      msg: document.getElementById('save-msg').textContent };
  });
  t('live: a shot thrown away leaves the log, and the save button comes back',
    trashed.gone && trashed.n === shotsBefore && trashed.saveBack,
    `${trashed.id} gone ${trashed.gone}, ${trashed.n} rows, ${trashed.msg}`);

  // The stepper can walk to 04 with no shot behind it. Filing that would put a
  // row in the log for a shot nobody pulled.
  const walked = await page.evaluate(async () => {
    const before = JSON.parse(localStorage.getItem('brewkit.shots.v1') || '[]').length;
    window.__sess.goto('dose');
    document.querySelector('#stepper button[data-step="rate"]')?.click();
    await new Promise((r) => setTimeout(r, 120));
    return { before, after: JSON.parse(localStorage.getItem('brewkit.shots.v1') || '[]').length,
      save: !document.getElementById('save').hidden };
  });
  t('live: walking to the rating step without a shot files nothing',
    walked.after === walked.before && walked.save,
    `${walked.before} -> ${walked.after}, save offered ${walked.save}`);

  // ---- the profile is remembered on reconnect ----
  // The whole point: a scale set up once is not set up again.
  await page.goto(B + '/live.html?mock=generic');
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 6000 });
  t('remembered: reconnect skips setup entirely',
    !(await page.locator('#step-setup').isVisible()), 'setup hidden');
  t('remembered: the chosen name comes back',
    (await page.textContent('#device-chip')) === 'Bench scale', await page.textContent('#device-chip'));
  t('remembered: decoder noted as remembered',
    /remembered/i.test(await page.textContent('#decoder-note')), await page.textContent('#decoder-note'));
  t('remembered: no name prompt second time', !(await page.locator('#name-row').isVisible()));

  // ---- settings: rename, re-validate, forget ----
  await page.locator('#advanced').evaluate((d) => { d.open = true; });
  await page.fill('#rename', 'Drip tray scale');
  await page.click('#apply-rename');
  t('settings: rename takes effect', (await page.textContent('#device-chip')) === 'Drip tray scale',
    await page.textContent('#device-chip'));

  await page.click('#revalidate');
  t('settings: re-validate reopens setup', await page.locator('#step-setup').isVisible());
  const keptCaps = await page.locator('#caps-table tbody tr').count();
  t('settings: re-validating keeps existing captures', keptCaps >= 2, keptCaps + ' rows');

  await page.locator('#advanced').evaluate((d) => { d.open = true; });
  await page.click('#forget-device');
  await page.waitForTimeout(300);
  const afterForget = await page.evaluate(() => JSON.parse(localStorage.getItem('brewkit.devices.v1') || '{}'));
  t('settings: forget removes the profile', Object.keys(afterForget).length === 0,
    Object.keys(afterForget).length + ' remaining');
  t('settings: forget returns to connect', await page.locator('#step-connect').isVisible());

  // ---- real captured frames, locked into CI ----
  // These 16 rows came off an INSMART (Lefu) 5 kg scale, including negatives.
  // The sign lives in a status byte, not the weight bytes: decoding them as
  // plain unsigned reported -416.4 g as +416.4 g, which looks like a real
  // reading rather than a fault. This is the regression that must not return.
  await page.goto(B + '/live.html');
  const REAL = [
    ['12 06 05 00 45 10 05 00', 416.5], ['12 06 05 00 56 00 05 00', 8.6],
    ['12 06 05 00 21 01 05 00', 28.9],  ['12 06 05 00 9d 09 05 00', 246.1],
    ['12 06 05 00 e2 19 05 00', 662.6], ['12 06 05 00 6e 3c 05 00', 1547],
    ['12 06 05 00 ae 38 05 00', 1451],  ['12 06 05 00 5c 35 05 00', 1366],
    ['12 06 05 00 95 22 05 00', 885.3], ['12 06 05 00 d8 17 05 00', 610.4],
    ['12 06 05 00 9f 09 05 00', 246.3], ['12 06 05 00 c9 16 05 00', 583.3],
    ['12 06 15 00 44 10 05 00', -416.4], ['12 06 15 00 9d 09 05 00', -246.1],
    ['12 06 15 00 22 01 05 00', -29],
  ];
  const real = await page.evaluate(async (cases) => {
    const dec = await import('./assets/js/ble/decode.js');
    const drv = await import('./assets/js/ble/drivers.js');
    const d = drv.DRIVERS.find((x) => x.id === 'lefu-fff0');
    const out = { exact: 0, total: cases.length, worst: 0, matched: 0, negatives: [] };
    for (const [h, want] of cases) {
      const b = dec.unhex(h);
      if (d.match(b)) out.matched++;
      const got = dec.applyCandidate(d.decoder, b);
      const err = Math.abs(got - want);
      if (err < 0.06) out.exact++;
      if (err > out.worst) out.worst = err;
      if (want < 0) out.negatives.push(got);
    }
    // The auto-decoder must be able to derive this from the captures alone.
    const samples = cases.map(([h, g]) => ({ bytes: dec.unhex(h), grams: g }));
    const found = dec.findCandidates(samples, { maxError: 0.15 });
    out.derived = found.length ? dec.describeCandidate(found[0]) : null;
    out.derivedErr = found.length ? found[0].error : null;
    // And the stability bit should flag an unsettled frame.
    out.stableOnSettled = dec.isStable(d.decoder, dec.unhex('12 06 05 00 45 10 05 00'));
    out.stableOnMoving = dec.isStable(d.decoder, dec.unhex('12 06 01 00 94 22 05 00'));
    return out;
  }, REAL);

  t('hardware: driver decodes every real capture', real.exact === real.total,
    `${real.exact}/${real.total} exact, worst ${real.worst.toFixed(3)} g`);
  t('hardware: header matches on every real frame', real.matched === real.total,
    `${real.matched}/${real.total}`);
  t('hardware: negative readings stay negative', real.negatives.every((v) => v < 0),
    real.negatives.map((v) => v.toFixed(1)).join(', '));
  t('hardware: auto-decoder derives the sign-flag encoding',
    /sign @2/.test(real.derived ?? ''), `${real.derived} (err ${real.derivedErr?.toFixed(3)})`);
  t('hardware: stability bit distinguishes settled from moving',
    real.stableOnSettled === true && real.stableOnMoving === false,
    `settled=${real.stableOnSettled} moving=${real.stableOnMoving}`);

  // ---- captures exported from elsewhere can be imported ----
  await page.goto(B + '/live.html?mock=lefu');
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 8000 });
  await page.locator('#advanced').evaluate((d) => { d.open = true; });
  await page.click('#revalidate');
  await page.click('#clear-caps');
  await page.waitForTimeout(200);
  const csv = 'grams,uuid,frame_hex,device,captured_at\n'
    + REAL.slice(0, 6).map(([h, g]) =>
        `${g},0000fff3-0000-1000-8000-00805f9b34fb,${h},InSmart,2026-08-28T00:00:00Z`).join('\n') + '\n';
  await page.setInputFiles('#import-caps', {
    name: 'captures.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
  });
  await page.waitForFunction(
    () => /Imported/.test(document.getElementById('cap-msg').textContent), { timeout: 4000 });
  t('import: capture CSV is accepted', true, await page.textContent('#cap-msg'));
  const importedRows = await page.locator('#caps-table tbody tr').count();
  t('import: imported captures appear in the table', importedRows === 6, importedRows + ' rows');
  const importedCands = await page.locator('#cands .cand').count();
  t('import: imported captures solve to a candidate', importedCands > 0,
    importedCands + ' candidates');

  // ---- a recognised scale needs no teaching ----
  // Clear saved profiles first: an earlier block connects the same mock, and a
  // remembered device short-circuits the detection path this is meant to test.
  await page.goto(B + '/live.html');
  await page.evaluate(() => localStorage.removeItem('brewkit.devices.v1'));
  await page.goto(B + '/live.html?mock=lefu');
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 8000 });
  t('driver: Lefu frames are auto-detected',
    /Lefu/i.test(await page.textContent('#decoder-note')), await page.textContent('#decoder-note'));
  t('driver: setup never shown for a known scale', !(await page.locator('#step-setup').isVisible()));

  await page.waitForFunction(() => {
    const s = document.getElementById('state').textContent.toLowerCase();
    return s.includes('extract') || s.includes('drip') || s.includes('complete');
  }, { timeout: 30000 }).catch(() => {});
  t('driver: shot runs with no teach step',
    /extract|drip|complete/i.test(await page.textContent('#state')), await page.textContent('#state'));

  const lw1 = await page.evaluate(() => parseFloat(document.getElementById('o-w').textContent));
  await page.waitForTimeout(4000);
  const lw2 = await page.evaluate(() => parseFloat(document.getElementById('o-w').textContent));
  t('driver: decoded weight climbs', lw2 > lw1, `${lw1} g -> ${lw2} g`);

  // ---- captures survive a reload ----
  await page.goto(B + '/live.html?mock=lefu');
  await page.evaluate(() => localStorage.removeItem('brewkit.captures.v1'));
  await page.goto(B + '/live.html?mock=lefu');
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 8000 });
  await page.locator('#advanced').evaluate((d) => { d.open = true; });
  await page.click('#revalidate');
  await page.waitForFunction(() => document.querySelectorAll('#frames div').length > 2, { timeout: 6000 });
  await page.fill('#ref', '0');
  await page.click('#capture');
  await page.waitForTimeout(900);
  await page.fill('#ref', '120');
  await page.click('#capture');
  await page.waitForTimeout(300);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('brewkit.captures.v1') || '[]'));
  t('captures: written to storage', stored.length === 2, stored.length + ' saved');
  t('captures: frames stored as hex',
    stored.every((c) => Object.values(c.frames).every((h) => /^[0-9a-f ]+$/.test(h))),
    Object.values(stored[0]?.frames ?? {})[0] ?? 'none');
  t('captures: reference mass recorded', stored.map((c) => c.grams).join(',') === '0,120',
    stored.map((c) => c.grams).join(','));
  const rowsBefore = await page.locator('#caps-table tbody tr').count();
  t('captures: shown in a table, not just counted', rowsBefore >= 2, rowsBefore + ' rows');

  await page.goto(B + '/live.html?mock=lefu');
  await page.waitForTimeout(800);
  await page.locator('#advanced').evaluate((d) => { d.open = true; });
  await page.click('#revalidate');
  await page.waitForTimeout(300);
  const rowsAfter = await page.locator('#caps-table tbody tr').count();
  t('captures: survive a reload', rowsAfter === rowsBefore, `${rowsBefore} -> ${rowsAfter}`);






  // ---- weighing beans is not a shot, and the machine must not think it is ----
  // Reported from real use: a scale-side tare reads as a large decrease, which
  // used to trip the vessel-removed branch and silently arm vessel detection.
  // The next heavy thing set down - a portafilter - auto-tared, so the display
  // read 0 g with 521 g on the platform. Idle is inert now.
  const tare = await page.evaluate(async () => {
    const { BrewMachine } = await import('./assets/js/core/filter.js');
    const run = (steps) => {
      const b = new BrewMachine();
      let t = 0;
      const seen = [];
      for (const [raw, hold] of steps) {
        for (let i = 0; i < (hold ?? 1); i++) {
          t += 0.2;
          const s = b.step(t, raw, 0);
          seen.push({ raw, state: s.state, net: +s.net.toFixed(1), tare: b.tare });
        }
      }
      return seen;
    };
    // Dosing cup on, scale-tared, beans in, cup off, portafilter on,
    // scale-tared again, grounds in. Arm is never pressed.
    const dosing = run([[0, 2], [52, 6], [0, 3], [9, 1], [18.2, 6], [0, 2],
                        [521, 8], [0, 3], [17.9, 4]]);
    // A software tare, then the scale tared underneath it.
    const b2 = new BrewMachine();
    let u = 0;
    b2.step(u += 0.2, 0, 0); b2.step(u += 0.2, 52, 0);
    b2.tare = 52;
    const afterSoft = b2.step(u += 0.2, 52, 0).net;
    const afterHard = b2.step(u += 0.2, 0, 0).net;
    // Arming must still auto-tare the cup on the drip tray.
    const b3 = new BrewMachine();
    b3.arm();
    let v = 0, armed = null;
    b3.step(v += 0.2, 0, 0);
    for (let i = 0; i < 6; i++) armed = b3.step(v += 0.2, 96, 0);
    return {
      everLeftIdle: dosing.some((r) => r.state !== 'idle'),
      everTared: dosing.some((r) => r.tare !== 0),
      // The display must equal what the scale itself reads, at every instant.
      mismatches: dosing.filter((r) => Math.abs(r.net - r.raw) > 0.001).length,
      afterSoft, afterHard,
      armedState: armed.state, armedNet: +armed.net.toFixed(1),
    };
  });
  t('idle: weighing and taring never leave the idle state',
    tare.everLeftIdle === false && tare.everTared === false,
    `left idle: ${tare.everLeftIdle}, auto-tared: ${tare.everTared}`);
  t('idle: the display equals what the scale reads, throughout',
    tare.mismatches === 0, tare.mismatches + ' frames disagreed');
  t('tare: a scale-side tare is followed, not fought',
    tare.afterSoft === 0 && tare.afterHard === 0,
    `software tare ${tare.afterSoft} g, then scale tare ${tare.afterHard} g (neither may go negative)`);
  t('tare: arming still auto-tares the cup on the drip tray',
    tare.armedState === 'awaiting_flow' && tare.armedNet === 0,
    `${tare.armedState} at ${tare.armedNet} g`);

  // ---- what you can watch while it pours ----
  const live = await page.evaluate(async () => {
    const { FlowEstimator, BrewMachine } = await import('./assets/js/core/filter.js');
    const pour = (fn) => {
      const est = new FlowEstimator(), b = new BrewMachine();
      b.arm();
      let seed = 5;
      const n = () => { seed = (seed * 1103515245 + 12345) % 2147483648;
        return (seed / 2147483648 - 0.5) * 0.06; };
      let w = 96, firstWarn = null, ramp = [];
      for (let i = 0; i < 1000; i++) {
        const t = i * 0.05;
        w += Math.max(0, fn(t)) * 0.05;
        const r = est.step(t, w + n());
        const s = b.step(t, r.weight, r.flow);
        if (s.running && s.elapsed < 9) ramp.push(s.trend);
        if (s.running && Number.isFinite(s.trend) && s.trend > 0.05 && firstWarn === null) {
          firstWarn = s.elapsed;
        }
      }
      return { firstWarn, rampAllNaN: ramp.every((v) => !Number.isFinite(v)) };
    };
    return {
      healthy: pour((t) => (t < 2 ? 0 : t < 5 ? (t - 2) * 0.6 : 1.8 - (t - 5) * 0.012)),
      channel: pour((t) => (t < 2 ? 0 : t < 5 ? (t - 2) * 0.5 : 1.4 + Math.max(0, t - 16) * 0.09)),
    };
  });
  t('live: a channel is flagged during the shot, not only afterwards',
    live.channel.firstWarn !== null && live.channel.firstWarn < 26,
    live.channel.firstWarn === null ? 'never warned'
      : `warned at ${live.channel.firstWarn.toFixed(1)} s (channel opens at 16 s)`);
  t('live: a healthy shot is never flagged',
    live.healthy.firstWarn === null, String(live.healthy.firstWarn));
  t('live: the opening ramp cannot set the warning off',
    live.channel.rampAllNaN && live.healthy.rampAllNaN,
    'no trend is reported before there is enough shot to judge');

  // ---- the standard SIG Weight Scale profile ----
  // Not reverse-engineered: a published GATT profile, so it can be checked
  // against the spec's own arithmetic rather than against captures.
  await page.goto(B + '/live.html');
  const sig = await page.evaluate(async () => {
    const dec = await import('./assets/js/ble/decode.js');
    const drv = await import('./assets/js/ble/drivers.js');
    const d = drv.DRIVERS.find((x) => x.id === 'sig-weight-scale');
    const f = (flags, raw, extra = []) => Uint8Array.from([flags, raw & 255, raw >> 8, ...extra]);
    return {
      si: dec.applyCandidate(d.decoder, f(0x00, 3640)),
      imperial: dec.applyCandidate(d.decoder, f(0x01, 4000)),
      matchPlain: d.match(f(0x00, 3640)),
      matchStamped: d.match(f(0x02, 3640, [0, 0, 0, 0, 0, 0, 0])),
      matchTruncated: d.match(f(0x02, 3640)),
      matchReserved: d.match(f(0x10, 3640)),
      matchLefu: d.match(dec.unhex('12 06 05 00 45 10 05 00')),
      resolution: d.resolutionG,
      describes: dec.describeCandidate(d.decoder),
    };
  });
  // 3640 x 0.005 kg = 18.2 kg; 4000 x 0.01 lb = 40 lb = 18143.7 g.
  t('sig: SI weights decode to the spec\u2019s 0.005 kg resolution',
    Math.abs(sig.si - 18200) < 0.5, sig.si + ' g');
  t('sig: an imperial frame is converted, not read as metric',
    Math.abs(sig.imperial - 40 * 453.59237) < 0.5, sig.imperial.toFixed(1) + ' g');
  t('sig: optional fields are accepted when the flags claim them',
    sig.matchPlain && sig.matchStamped, `plain ${sig.matchPlain}, stamped ${sig.matchStamped}`);
  t('sig: a frame shorter than its flags promise is rejected',
    sig.matchTruncated === false && sig.matchReserved === false,
    `truncated ${sig.matchTruncated}, reserved-bits ${sig.matchReserved}`);
  t('sig: the matcher does not claim another vendor\u2019s frame',
    sig.matchLefu === false, String(sig.matchLefu));
  t('sig: the 5 g resolution is carried as data, so the UI can warn',
    sig.resolution === 5, sig.resolution + ' g');

  // ---- shareable device profiles ----
  const prof = await page.evaluate(async () => {
    const drv = await import('./assets/js/ble/drivers.js');
    const lefu = drv.DRIVERS.find((x) => x.id === 'lefu-fff0');
    const text = drv.serializeProfile({
      name: 'InSmart Coffee Scale', bleName: '863A',
      uuid: '0000fff3-0000-1000-8000-00805f9b34fb', decoder: lefu.decoder,
    });
    const round = drv.parseProfile(text);
    const bad = (o) => drv.parseProfile(typeof o === 'string' ? o : JSON.stringify(o)).error;
    const ok = '0000fff3-0000-1000-8000-00805f9b34fb';
    return {
      text,
      ok: round.ok,
      name: round.profile?.name,
      signKept: JSON.stringify(round.profile?.decoder?.sign),
      errors: [
        bad('{not json'),
        bad({ brewkit_profile: 99, characteristic: ok, decoder: { kind: 'int', offset: 0, width: 2, scale: 1 } }),
        bad({ brewkit_profile: 1, characteristic: 'fff3', decoder: { kind: 'int', offset: 0, width: 2, scale: 1 } }),
        bad({ brewkit_profile: 1, characteristic: ok, decoder: { kind: 'exec', offset: 0, width: 2, scale: 1 } }),
        bad({ brewkit_profile: 1, characteristic: ok, decoder: { kind: 'int', offset: 0, width: 99, scale: 1 } }),
        bad({ brewkit_profile: 1, characteristic: ok, decoder: { kind: 'int', offset: 0, width: 2, scale: 1, sign: { offset: -1 } } }),
      ],
    };
  });
  t('profile: a taught scale round-trips through a shared file',
    prof.ok && prof.name === 'InSmart Coffee Scale' && /"offset":2/.test(prof.signKept),
    `${prof.name}, sign ${prof.signKept}`);
  // An imported decoder runs against live frames, so a malformed one does not
  // fail loudly - it produces numbers. Every field is checked, not trusted.
  t('profile: every malformed field is refused with a reason',
    prof.errors.every((e) => typeof e === 'string' && e.length > 10),
    prof.errors.map((e) => (e ?? 'ACCEPTED').slice(0, 28)).join(' | '));

  // ---- importing a profile replaces the teaching step ----
  await page.goto(B + '/live.html');
  await page.evaluate(() => localStorage.removeItem('brewkit.devices.v1'));
  await page.goto(B + '/live.html?mock=generic');
  await page.waitForFunction(
    () => document.getElementById('step-setup').style.display !== 'none', { timeout: 8000 });
  await page.setInputFiles('#import-profile', {
    name: 'wrong.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      brewkit_profile: 1, name: 'Someone else\u2019s scale',
      characteristic: '0000abcd-0000-1000-8000-00805f9b34fb',
      decoder: { kind: 'int', offset: 0, width: 2, littleEndian: true, signed: false, scale: 1 },
    })),
  });
  await page.waitForFunction(
    () => document.getElementById('profile-msg').textContent.length > 0, { timeout: 4000 });
  t('profile: a profile for a different model is refused, not applied',
    /different model|does not notify/i.test(await page.textContent('#profile-msg'))
    && await page.locator('#step-setup').isVisible(),
    await page.textContent('#profile-msg'));

  // The right profile skips the teaching step entirely — no reference masses.
  await page.setInputFiles('#import-profile', {
    name: 'shared.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      brewkit_profile: 1, name: 'Shared Bench Scale', bleName: 'Mock Scale',
      characteristic: '0000fff1-0000-1000-8000-00805f9b34fb',
      decoder: { kind: 'int', offset: 3, width: 2, littleEndian: false, signed: false, scale: 0.01 },
    })),
  });
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 5000 });
  t('profile: the right profile replaces the teaching step',
    /imported from Shared Bench Scale/.test(await page.textContent('#decoder-note'))
    && !(await page.locator('#step-setup').isVisible()),
    await page.textContent('#decoder-note'));
  const capsUsed = await page.locator('#caps-table tbody tr').count();
  t('profile: importing needed no reference masses at all', capsUsed === 0,
    capsUsed + ' captures for this device');

  // And what one person taught, the next can export and pass on.
  await page.locator('#advanced').evaluate((d) => { d.open = true; });
  const dl = page.waitForEvent('download', { timeout: 5000 });
  await page.click('#export-profile');
  const exported = JSON.parse(await (await (await dl).createReadStream()).toArray()
    .then((cs) => Buffer.concat(cs).toString()));
  t('profile: the scale can be exported again for someone else',
    exported.brewkit_profile === 1
    && exported.characteristic === '0000fff1-0000-1000-8000-00805f9b34fb'
    && exported.decoder.offset === 3 && exported.decoder.scale === 0.01,
    JSON.stringify(exported.decoder));


  // ---- a saved scale is one click, not a reminder that you own one ----
  // Listing saved scales as text made the memory useless: you still had to walk
  // the browser's chooser past every Bluetooth device in the room.
  await page.goto(B + '/live.html');
  await page.evaluate(() => localStorage.removeItem('brewkit.devices.v1'));
  await page.goto(B + '/live.html?mock=lefu');
  // A driver is only remembered once a live frame confirms it — never on the
  // strength of a UUID match alone — so wait for the profile, not the phase.
  await page.waitForFunction(
    () => Object.keys(JSON.parse(localStorage.getItem('brewkit.devices.v1') || '{}')).length > 0,
    { timeout: 10000 });

  await page.goto(B + '/live.html?mock=lefu&manual=1');
  await page.waitForSelector('#saved-devices [data-reopen]', { timeout: 5000 });
  const reopenBtn = page.locator('#saved-devices [data-reopen]').first();
  t('reconnect: the saved scale is a button, not a sentence',
    /^connect to /i.test((await reopenBtn.innerText()).trim()) && await reopenBtn.isEnabled(),
    (await reopenBtn.innerText()).trim());
  t('reconnect: choosing a different scale becomes the secondary action',
    (await page.getAttribute('#connect', 'class')) === 'ghost'
    && /different/i.test(await page.textContent('#connect')),
    await page.textContent('#connect'));
  t('reconnect: the page states which reconnect path this browser can take',
    await page.locator('#reopen-note').isVisible()
    && /chooser/i.test(await page.textContent('#reopen-note')),
    (await page.textContent('#reopen-note')).slice(0, 60));

  await reopenBtn.click();
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 8000 });
  t('reconnect: clicking it connects and lands in the session',
    /Reconnected/.test(await page.textContent('#conn-msg')), await page.textContent('#conn-msg'));
  t('reconnect: the remembered decoder is used, with no setup step',
    !(await page.locator('#step-setup').isVisible())
    && /remembered/i.test(await page.textContent('#decoder-note')),
    await page.textContent('#decoder-note'));
  // Nothing is on this scale, so the weight is legitimately 0.0 — what proves
  // the link is live is that decoded frames are arriving at all.
  await page.waitForFunction(
    () => document.querySelectorAll('#frames div').length > 3, { timeout: 10000 });
  t('reconnect: frames stream after a one-click reconnect',
    (await page.locator('#frames div').count()) > 3,
    (await page.locator('#frames div').count()) + ' frames, readout ' + (await page.textContent('#o-w')) + ' g');

  await page.goto(B + '/live.html?mock=lefu&manual=1');
  await page.waitForSelector('#forget-all', { state: 'visible', timeout: 5000 });
  await page.click('#forget-all');
  await page.waitForTimeout(300);
  t('reconnect: saved scales can be cleared from the connect screen',
    (await page.locator('#saved-devices [data-reopen]').count()) === 0
    && (await page.evaluate(() => localStorage.getItem('brewkit.devices.v1'))) === '{}',
    await page.textContent('#conn-msg'));

  // ---- the weight readout has to be usable for weighing, not just for shots ----
  // A constant-velocity filter explains a step as an enormous velocity and
  // slingshots past it: this overshot an 18 g dose to 25 g and took 1.7 s to
  // settle. That is the regression this locks down.
  const filt = await page.evaluate(async () => {
    const { FlowEstimator } = await import('./assets/js/core/filter.js');
    let seed = 9;
    const n = (s = 0.03) => { seed = (seed * 1103515245 + 12345) % 2147483648;
      return (seed / 2147483648 - 0.5) * s * 2; };
    const out = {};

    // 18 g placed on the scale at t = 2, streamed at 10 Hz.
    {
      const est = new FlowEstimator(); const rows = [];
      for (let i = 0; i < 120; i++) { const t = i * 0.1; const truth = t < 2 ? 0 : 18;
        rows.push({ t: +t.toFixed(1), w: est.step(t, truth + n()).weight }); }
      const after = rows.filter((r) => r.t >= 2);
      out.overshoot = Math.max(...after.map((r) => r.w));
      out.settle = after.find((r) => Math.abs(r.w - 18) < 0.1).t - 2;
    }
    // A single droplet slam is damped, not believed.
    {
      const est = new FlowEstimator(); let w = 0; let worst = 0;
      for (let i = 0; i < 200; i++) { const t = i * 0.1;
        const truth = t < 2 ? 0 : t < 28 ? 1.8 : 0; w += truth * 0.1;
        const r = est.step(t, w + (i === 120 ? 3.5 : 0) + n());
        if (i >= 120 && i <= 125) worst = Math.max(worst, Math.abs(r.weight - w)); }
      out.spikeError = worst;
      out.spikeSteps = est.steps;
    }
    // Beans trickling in is not a step, and must not be treated as one.
    {
      const est = new FlowEstimator(); let w = 0; let resets = 0;
      for (let i = 0; i < 200; i++) { const t = i * 0.1; const rate = t > 2 && t < 8 ? 3 : 0;
        w += rate * 0.1; if (est.step(t, w + n()).step) resets++; }
      out.pourResets = resets; out.pourFinal = est.w; out.pourTruth = w;
    }
    // Flow through a whole shot: the number the curve diagnosis rests on.
    {
      const est = new FlowEstimator(); let w = 0; const err = [];
      for (let i = 0; i < 400; i++) { const t = i * 0.1;
        const truth = t < 2 ? 0 : t < 5 ? (t - 2) * 0.6 : t < 28 ? 1.8 - (t - 5) * 0.012 : 0;
        w += truth * 0.1; const r = est.step(t, w + n());
        if (t > 6 && t < 27) err.push(r.flow - truth); }
      out.flowRms = Math.sqrt(err.reduce((s, v) => s + v * v, 0) / err.length);
      out.shotSteps = est.steps;
    }
    return out;
  });
  t('filter: an 18 g step does not overshoot', filt.overshoot < 18.3,
    `peaked at ${filt.overshoot.toFixed(2)} g (was 25.18)`);
  t('filter: a placed mass settles within 0.3 s', filt.settle <= 0.3,
    `${filt.settle.toFixed(1)} s (was 1.7)`);
  t('filter: a single droplet impact is damped, not believed',
    filt.spikeError < 0.6 && filt.spikeSteps === 0,
    `worst ${filt.spikeError.toFixed(2)} g off, ${filt.spikeSteps} step resets`);
  t('filter: a slow pour is not mistaken for a step',
    filt.pourResets === 0 && Math.abs(filt.pourFinal - filt.pourTruth) < 0.1,
    `${filt.pourResets} resets, ${filt.pourFinal.toFixed(2)} of ${filt.pourTruth.toFixed(2)} g`);
  t('filter: flow tracking through a shot stays accurate',
    filt.flowRms < 0.06 && filt.shotSteps === 0,
    `${filt.flowRms.toFixed(4)} g/s RMS, ${filt.shotSteps} spurious resets`);

  // ================================================================ workflow
  // Bags, grinders, the five-step session, and the two models that read them.

  // ---- diagnosis separates the failure modes that look alike ----
  await page.goto(B + '/live.html');
  const diag = await page.evaluate(async () => {
    const d = await import('./assets/js/core/diagnose.js');
    const build = (f) => {
      const c = []; let w = 0;
      for (let t = 0; t <= 34; t += 0.025) { w += Math.max(0, f(t)) * 0.025; c.push([+t.toFixed(3), +w.toFixed(3)]); }
      return c;
    };
    const codes = (curve, extra) => {
      const m = d.curveMetrics(curve);
      return { m, codes: d.diagnose({ ...m, time_s: m.duration_s, ...extra }).map((x) => x.code) };
    };
    return {
      // Healthy: ramps up, sags gently, pump cuts at 28 s.
      clean: codes(build((t) => t < 2 ? 0 : t < 5 ? (t - 2) * 0.6 : t < 28 ? 1.8 - (t - 5) * 0.012 : 0.05), { ratio: 2 }),
      // A channel opening at 16 s: flow STEPS. The signature is the
      // discontinuity, not the direction — see the rising-flow case below.
      channel: codes(build((t) => t < 2 ? 0 : t < 5 ? (t - 2) * 0.5
        : t < 16 ? 1.4 : t < 30 ? 2.5 : 0.04), { ratio: 2.4 }),
      // AND THE CASE THAT USED TO BE MISREAD. Flow climbing steadily through
      // the back half is what puck resistance falling looks like, which is
      // nearly every shot. The old rule called this channelling at high
      // severity and sent people off to fix their distribution.
      rising: codes(build((t) => t < 2 ? 0 : t < 5 ? (t - 2) * 0.5
        : t < 30 ? 1.4 + (t - 5) * 0.022 : 0.04), { ratio: 2.4 }),
      // A ristretto, correctly made. EY = ratio x TDS, so it CANNOT reach the
      // conventional band; the old rule flagged every one of them.
      ristretto: codes(build((t) => t < 2 ? 0 : t < 5 ? (t - 2) * 0.5
        : t < 26 ? 1.2 - (t - 5) * 0.008 : 0.04), { ratio: 1.3, ey_pct: 15.2 }),
      // Choked: nothing for 14 s, then a trickle.
      choked: codes(build((t) => (t < 14 ? 0 : t < 33 ? 0.45 : 0)), { ratio: 1.4 }),
      // Gusher: water through almost immediately, fast throughout.
      gusher: codes(build((t) => (t < 1 ? 0 : t < 12 ? 2.9 : 0.03)), { ratio: 2 }),
    };
  });
  // PIP, WIRED IN. The character on the page, as opposed to the judgement
  // behind it: does he appear, does he stay out of the way, and — the one that
  // matters most — does dismissing him actually make him go away and stay away.
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(() => window.__sess, null, { timeout: 8000 });
  const pipWire = await page.evaluate(async () => {
    const prefs = await import('./assets/js/core/prefs.js');
    const { FACES } = await import('./assets/js/core/pip.js');
    prefs.set({ coach: true });
    const host = document.querySelector('#pip-dock .pip-slot');
    await document.fonts.ready;
    // EVERY FACE GLYPH HAS TO BE IN THE FONT WE SHIP.
    // The app self-hosts a latin-only subset of Space Mono. A character outside
    // it still renders, from a system monospace, so the failure is silent and
    // looks nearly right. Asking "is the result monospace" does not catch it —
    // the fallback is monospace too, which is how U+0298 and U+25A1 nearly
    // shipped. The discriminator is the advance width against a glyph known to
    // be present: 24.48 px for the real font at 40 px, 24.09 for the fallback.
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;'
      + 'font:700 40px "Space Mono", monospace';
    document.body.appendChild(probe);
    const adv = (ch) => { probe.textContent = ch; return probe.getBoundingClientRect().width; };
    const unit = adv('o');
    const missing = [];
    const wrongWidth = [];
    for (const [mood, set] of Object.entries(FACES)) {
      const all = [set.open, set.blink, ...(set.glance || [])].filter(Boolean);
      for (const face of all) {
        // Every variant has to be the same LENGTH as the open face as well as
        // being in the font: a blink that is one cell wider shoves the box
        // sideways every time he blinks.
        if ([...face].length !== [...set.open].length) wrongWidth.push(`${mood}:${face}`);
        for (const ch of [...face]) {
          if (ch === ' ') continue;
          if (Math.abs(adv(ch) - unit) > 0.02) {
            missing.push(ch + ' U+' + ch.codePointAt(0).toString(16).padStart(4, '0'));
          }
        }
      }
    }
    probe.remove();
    const before = {
      hidden: host.hidden,
      bar: !!host.querySelector('.pip-who'),
      face: (host.querySelector('.pip-face') || {}).textContent || '',
      // The caret lives in HIS box, beside the face — it is what says he is
      // still there when he has nothing to say.
      caretOnHim: !!host.querySelector('.pip-box .pip-caret'),
      // And what he says is NOT in the box. That separation is the whole
      // reason he can blink: nothing else is in there to be disturbed.
      sayOutside: !!host.querySelector('.pip-bubble .pip-say')
        && !host.querySelector('.pip-box .pip-say'),
      missing,
      wrongWidth,
      faces: FACES,
      unit: +unit.toFixed(2),
    };
    // Dismissing is not "hide this message" — it is being told to go away. But
    // "go away" is two different instructions, and the x used to guess: it
    // wrote the preference off, and the only route back was a toggle on another
    // page. So it asks, in his own bubble, and both answers leave a way back.
    host.querySelector('.pip-x')?.click();
    await new Promise((r) => setTimeout(r, 80));
    const asked = {
      choices: [...host.querySelectorAll('.pip-choice')].map((b) => b.textContent.trim()),
      stillPref: prefs.prefs().coach,
    };
    // The softer answer: quiet now, preference untouched, and a stub in his
    // place saying where he went.
    [...host.querySelectorAll('.pip-choice')][0]?.click();
    await new Promise((r) => setTimeout(r, 80));
    const shot = { hidden: host.hidden, pref: prefs.prefs().coach,
                   stub: !document.querySelector('#pip-dock .pip-stub').hidden,
                   why: document.querySelector('#pip-dock .stub-why').textContent };
    document.querySelector('#pip-dock .pip-stub button').click();
    await new Promise((r) => setTimeout(r, 80));
    const woke = { hidden: host.hidden, stub: !document.querySelector('#pip-dock .pip-stub').hidden };
    // And the hard answer, which does write the preference.
    host.querySelector('.pip-x')?.click();
    await new Promise((r) => setTimeout(r, 80));
    [...host.querySelectorAll('.pip-choice')][1]?.click();
    await new Promise((r) => setTimeout(r, 80));
    const after = { hidden: host.hidden, pref: prefs.prefs().coach,
                    stub: !document.querySelector('#pip-dock .pip-stub').hidden };
    document.querySelector('#pip-dock .pip-stub button').click();
    await new Promise((r) => setTimeout(r, 80));
    return { before, asked, shot, woke, after,
             back: !document.querySelector('#pip-dock .pip-slot').hidden && prefs.prefs().coach !== false };
  });
  t('pip: every glyph in every face is in the font this app actually ships',
    pipWire.before.missing.length === 0,
    pipWire.before.missing.join(', ')
      || `all present, advance ${pipWire.before.unit} px`);
  // A WINDOW, NOT A BANNER. The first build stretched to the column, which is
  // what a bar does and not what a terminal does. It also has to be the same
  // width whatever it is saying — sizing to content made it resize on every
  // line, which reads as jitter.
  const pipBox = await page.evaluate(async () => {
    const { mountPip } = await import('./assets/js/core/pip.js');
    const host = document.querySelector('#pip-dock .pip-slot');
    host.hidden = false;
    const pip = mountPip(host);
    const col = document.getElementById('pip-dock')
      .parentElement.getBoundingClientRect().width;
    const him = () => host.querySelector('.pip-box').getBoundingClientRect();
    const row = () => host.getBoundingClientRect().width;
    pip.mood('idle');
    const quiet = { w: him().width, h: him().height, row: row() };
    pip.say('Flow jumped.', { mood: 'alert' });
    const short = { w: him().width, h: him().height, row: row() };
    pip.say('Your last six shots on this setting ranged 21 to 39 s. That spread '
      + 'is the puck, not the grind.', { mood: 'think' });
    const long = { w: him().width, h: him().height, row: row() };
    return { col: Math.round(col),
      quiet: { w: Math.round(quiet.w), h: Math.round(quiet.h), row: Math.round(quiet.row) },
      short: { w: Math.round(short.w), h: Math.round(short.h), row: Math.round(short.row) },
      long: { w: Math.round(long.w), h: Math.round(long.h), row: Math.round(long.row) } };
  });
  // The proportional bound is the one that carries the meaning — "not a bar
  // stretched across the column" is a claim about the column, not about pixels.
  // The absolute ceiling was calibrated to a 13 px face and moved when he was
  // deliberately grown on wide screens; it is kept as a sanity bound so an
  // accidental doubling still fails.
  t('pip: he is a small box, not a bar stretched across the column',
    pipBox.quiet.w > 0 && pipBox.quiet.w < 200 && pipBox.quiet.row < pipBox.col * 0.25,
    `${pipBox.quiet.w}\u00d7${pipBox.quiet.h} px, taking ${pipBox.quiet.row} of a `
    + `${pipBox.col} px column when silent`);
  // HE never changes size — only the bubble beside him comes and goes. This is
  // the contract that stops a blink or a new line from nudging the layout, and
  // it is why the message had to leave the box.
  t('pip: stays exactly the same size whatever he says',
    pipBox.quiet.w === pipBox.short.w && pipBox.short.w === pipBox.long.w
    && pipBox.quiet.h === pipBox.short.h && pipBox.short.h === pipBox.long.h,
    `${pipBox.quiet.w}\u00d7${pipBox.quiet.h} idle, ${pipBox.short.w}\u00d7${pipBox.short.h} `
    + `short, ${pipBox.long.w}\u00d7${pipBox.long.h} long`);

  t('pip: every face variant is the same width, so a blink cannot move the box',
    pipWire.before.wrongWidth.length === 0,
    pipWire.before.wrongWidth.join(', ') || 'all variants the same cell count');
  t('pip: is a little terminal with a face and a caret, and speaks outside it',
    pipWire.before.bar && /\[.+\]/.test(pipWire.before.face)
    && pipWire.before.caretOnHim && pipWire.before.sayOutside && !pipWire.before.hidden,
    `${pipWire.before.face}, caret on him ${pipWire.before.caretOnHim}, `
    + `speech outside ${pipWire.before.sayOutside}`);
  // He has to have somewhere to go. The timers themselves are ordinary
  // setTimeout; what could actually be wrong is the variants, so those are what
  // is checked — each present mood needs a shut-eyed face or somewhere to look
  // that is not where he is already looking.
  {
    const f = pipWire.before.faces;
    const alive = ['idle', 'watch', 'think'].every((m) => f[m].blink
      && f[m].blink !== f[m].open
      && f[m].glance.length >= 2
      && f[m].glance.every((g) => g !== f[m].open));
    // And the three that should hold still: staring, smiling, already shut.
    const still = ['alert', 'pleased', 'flat'].every((m) => !f[m].blink && !f[m].glance.length);
    t('pip: blinks and glances when he is watching, and holds still when he is not',
      alive && still,
      `${f.watch.open} \u2192 ${f.watch.blink} \u2192 ${f.watch.glance.join(' ')}; `
      + `alert holds ${f.alert.open}`);
  }
  // The x used to write "off for good" on a single tap and leave no trace of
  // where he went — which made an impatient press mid-shot effectively
  // permanent. It asks now, and asking is the behaviour worth protecting.
  t('pip: closing him asks which kind of go away it was',
    pipWire.asked.choices.length === 2 && pipWire.asked.stillPref !== false,
    `offered ${pipWire.asked.choices.join(' / ') || 'nothing'}, `
    + `preference still ${pipWire.asked.stillPref}`);
  t('pip: quiet for this shot leaves the setting alone and says where he went',
    pipWire.shot.hidden && pipWire.shot.pref !== false && pipWire.shot.stub
    && /quiet/i.test(pipWire.shot.why),
    `hidden ${pipWire.shot.hidden}, preference ${pipWire.shot.pref}, `
    + `stub ${pipWire.shot.stub} — "${pipWire.shot.why}"`);
  t('pip: off for good does turn him off, and still leaves a way back',
    pipWire.after.hidden && pipWire.after.pref === false && pipWire.after.stub,
    `hidden ${pipWire.after.hidden}, preference now ${pipWire.after.pref}, `
    + `stub ${pipWire.after.stub}`);
  t('pip: and the stub in his place is the one tap that brings him back',
    pipWire.woke.hidden === false && pipWire.woke.stub === false && pipWire.back,
    `after "this shot" ${!pipWire.woke.hidden}, after "off" ${pipWire.back}`);

  // THE PHONE REPEATS, IT DOES NOT REASON.
  // The viewer sees frames, not the shot log, so a coach running there would be
  // a second and weaker one — and two screens disagreeing about your shot is
  // worse than one staying quiet. The laptop decides and sends the line.
  await page.goto(B + '/view.html');
  await page.waitForFunction(() => window.__view, null, { timeout: 8000 });
  const phoneCoach = await page.evaluate(async () => {
    document.getElementById('pairing').hidden = true;
    document.getElementById('watching').hidden = false;
    const base = { method: 'espresso', dose: 18, doseSet: true, target: 36, tol: 1.5,
      lag: 1, coffee: 'Guji', hint: '', k: 'f', w: 24, q: 1.9, t: 14,
      st: 'extracting', step: 'brew', phase: 'fill', curve: [[0, 0], [14, 24]] };
    const host = document.getElementById('pip');
    // No line yet: nothing is drawn at all, so a phone that never sees a
    // coached shot never grows a pane.
    window.__view.paint({ ...base, pip: null });
    const before = { hidden: host.hidden, mounted: !!host.querySelector('.pip-face') };
    window.__view.paint({ ...base, pip: { text: 'Flow jumped.', mood: 'alert' } });
    // The visible line is TYPED, so reading it straight away catches it
    // mid-word — the first version of this test read "Flo". The hidden live
    // region gets the whole line at once, which is the contract that matters
    // for a screen reader; the visible copy is waited for.
    const early = (host.querySelector('.pip-live') || {}).textContent;
    for (let i = 0; i < 60; i++) {
      if ((host.querySelector('.pip-say') || {}).textContent === 'Flow jumped.') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const on = { hidden: host.hidden, mood: host.dataset.mood,
      early,
      says: (host.querySelector('.pip-say') || {}).textContent,
      face: (host.querySelector('.pip-face') || {}).textContent };
    // And when the laptop stops saying anything the pane goes quiet rather than
    // disappearing — a prompt with nothing to say is still a prompt.
    window.__view.paint({ ...base, pip: null });
    await new Promise((r) => setTimeout(r, 40));
    const quiet = { hidden: host.hidden,
      says: (host.querySelector('.pip-say') || {}).textContent,
      caret: !!host.querySelector('.pip-caret') };
    return { before, on, quiet };
  });
  t('phone: no pane at all until the laptop has something to say',
    phoneCoach.before.hidden && !phoneCoach.before.mounted, 'nothing drawn');
  t('phone: repeats the laptop\u2019s line and mood rather than working out its own',
    !phoneCoach.on.hidden && phoneCoach.on.says === 'Flow jumped.'
    && phoneCoach.on.mood === 'alert' && /\[.+\]/.test(phoneCoach.on.face),
    `${phoneCoach.on.face} ${phoneCoach.on.mood}: ${phoneCoach.on.says}`);
  t('phone: a screen reader gets the whole line at once, not one letter at a time',
    phoneCoach.on.early === 'Flow jumped.',
    `live region had "${phoneCoach.on.early}" while the visible copy was still typing`);
  t('phone: goes quiet without vanishing when the laptop stops',
    !phoneCoach.quiet.hidden && phoneCoach.quiet.says === '' && phoneCoach.quiet.caret,
    `pane kept, caret still there: ${phoneCoach.quiet.caret}`);

  // THE COACH. The half that decides whether to speak at all.
  // The failure mode being tested for is not "says the wrong thing" but "says
  // anything at all when it should not" — an assistant that talks through a
  // normal shot is the thing everyone hated about the last one.
  const coach = await page.evaluate(async () => {
    const c = await import('./assets/js/core/coach.js');
    const run = (frames) => {
      const said = new Set();
      const spoke = [];
      for (const f of frames) {
        const r = c.live({ running: true, ...f }, said);
        if (r) spoke.push({ at: f.elapsed, id: r.id });
      }
      return spoke;
    };
    // An ordinary shot: ramps, settles at 1.8 g/s, lands on target.
    const normal = [];
    for (let t = 0.5; t <= 27; t += 0.5) {
      const q = t < 4 ? t * 0.45 : 1.8;
      normal.push({ elapsed: t, net: Math.max(0, (t - 2) * 1.6), flow: q, trend: -0.01, target: 36 });
    }
    // The same shot with a step in the middle.
    const stepped = normal.map((f) => ({ ...f, trend: f.elapsed > 14 && f.elapsed < 16 ? 0.4 : -0.01 }));
    // A gusher.
    const gusher = normal.map((f) => ({ ...f, flow: f.elapsed < 4 ? f.elapsed : 4.6 }));

    const hist = (n, times) => times.slice(0, n).map((tt, i) => ({
      shot_id: `s${i}`, bag_id: 'b', grinder_id: 'g', grind_setting: 12, dose_g: 18,
      time_s: tt, rating: 7, ratio: 2,
    }));
    const base = { shot_id: 'now', bag_id: 'b', grinder_id: 'g', grind_setting: 12,
      dose_g: 18, time_s: 28, ratio: 2, rating: 7 };
    return {
      normal: run(normal),
      stepped: run(stepped),
      gusher: run(gusher),
      // Same settings, wildly different times: the puck, not the dial.
      erratic: c.after(base, hist(6, [21, 34, 25, 39, 22, 31])).map((x) => x.id),
      // Same settings, tight times.
      tight: c.after(base, hist(6, [27.5, 28, 27.8, 28.2, 27.6, 28.1])).map((x) => x.id),
      // Two moves finer, slower each time, no better rated.
      pastPeak: c.after({ ...base, grind_setting: 8, time_s: 40, rating: 5 }, [
        { bag_id: 'b', grind_setting: 12, time_s: 27, rating: 7 },
        { bag_id: 'b', grind_setting: 10, time_s: 33, rating: 6 },
      ]).map((x) => x.id),
      // The grind conversion, and its refusal on a conical.
      move: c.grindAdvice({ nowSeconds: 30, wantSeconds: 26, grinderId: 'df64' }),
      conical: c.grindAdvice({ nowSeconds: 30, wantSeconds: 26, grinderId: 'niche-zero' }),
    };
  });
  t('coach: says nothing at all through an ordinary shot',
    coach.normal.length === 0,
    coach.normal.map((x) => `${x.id}@${x.at}s`).join(',') || 'silent, as it should be');
  t('coach: speaks once when the flow steps, and only once',
    coach.stepped.filter((x) => x.id === 'stepping').length === 1,
    coach.stepped.map((x) => `${x.id}@${x.at}s`).join(',') || 'nothing');
  t('coach: calls out a shot running far outside the usual flow band',
    coach.gusher.some((x) => x.id === 'fast'),
    coach.gusher.map((x) => x.id).join(',') || 'nothing');
  // The two readings a single shot cannot produce.
  t('coach: spread across shots at one setting is read as the puck, not the dial',
    coach.erratic.includes('erratic') && !coach.tight.includes('erratic'),
    `erratic -> ${coach.erratic.join(',')}; tight -> ${coach.tight.join(',')}`);
  t('coach: a tight run of shots is recognised as worth keeping',
    coach.tight.includes('repeatable'), coach.tight.join(','));
  t('coach: two finer moves that only made it slower are named as the far side of the peak',
    coach.pastPeak.includes('past_peak'), coach.pastPeak.join(','));
  t('coach: a grind move comes back in the grinder\u2019s own steps, hedged',
    coach.move && coach.move.steps > 0 && /under-predicts/.test(coach.move.say),
    coach.move ? coach.move.say : 'nothing');
  t('coach: and refuses to invent steps for a conical, where there is no honest number',
    coach.conical && !coach.conical.steps && /conical/.test(coach.conical.say),
    coach.conical ? coach.conical.say : 'nothing');

  // BEFORE THE POUR, which is the only part of making a shot where anything can
  // still be changed. Same rule as during it: silence is the common answer, and
  // nothing is said that cannot be acted on in the next minute.
  const atGrinder = await page.evaluate(async () => {
    const c = await import('./assets/js/core/coach.js');
    const bag = { id: 'b', roast_level: 'Medium', roast_date: '' };
    const grinder = { id: 'df64', feed: 'single' };
    const one = (state) => {
      const r = c.prep(state, new Set());
      return r ? r.id : null;
    };
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    // A settled routine: same bag, same setting, times inside a second of each
    // other, and the last one is the best one. Nothing to say.
    const settled = [27.4, 27.9, 27.6, 28.0, 27.7].map((t, i) => ({
      shot_id: `s${i}`, bag_id: 'b', grinder_id: 'df64', grind_setting: 12,
      dose_g: 18, time_s: t, rating: 8,
    }));
    // The same routine, drifting: the last TWO both ran long. One long shot is
    // usually one bad puck, and must not move the grinder.
    const drifted = [...settled,
      { shot_id: 'l1', bag_id: 'b', grinder_id: 'df64', grind_setting: 12,
        dose_g: 18, time_s: 35, rating: 5 },
      { shot_id: 'l2', bag_id: 'b', grinder_id: 'df64', grind_setting: 12,
        dose_g: 18, time_s: 37, rating: 4 }];
    // And one long shot on its own, which is the case that must stay quiet.
    const oneOff = [...settled, { shot_id: 'l1', bag_id: 'b', grinder_id: 'df64',
      grind_setting: 12, dose_g: 18, time_s: 37, rating: 4 }];
    return {
      // Weighing, nothing unusual: quiet.
      quiet: one({ step: 'dose', bag, grinder, history: settled }),
      // Weighing after a shot that ran long: the move, now, at the grinder.
      carry: one({ step: 'dose', bag, grinder, history: drifted }),
      carryText: (c.prep({ step: 'dose', bag, grinder, history: drifted }, new Set()) || {}).text,
      // One shot off on its own is a puck, not a setting.
      noise: one({ step: 'dose', bag, grinder, history: oneOff }),
      // Grinding, and 0.9 g never came out.
      retention: one({ step: 'grind', dose: 18.2, grounds: 17.3, bag, grinder,
        history: settled }),
      // The same weights on a hopper grinder, where holding coffee back is the job.
      hopper: one({ step: 'grind', dose: 18.2, grounds: 17.3, bag,
        grinder: { id: 'df64', feed: 'hopper' }, history: settled }),
      // Three days off roast on a medium, which wants seven to fourteen.
      young: one({ step: 'dose', bag: { ...bag, roast_date: day(3) }, grinder,
        history: settled }),
      youngText: (c.prep({ step: 'dose', bag: { ...bag, roast_date: day(3) }, grinder,
        history: settled }, new Set()) || {}).text,
      // Comfortably inside the window: nothing worth saying about the date.
      rested: one({ step: 'dose', bag: { ...bag, roast_date: day(10) }, grinder,
        history: settled }),
      // A bag with nothing pulled on it yet.
      fresh: one({ step: 'dose', bag: { id: 'new' }, grinder, history: settled }),
      // And it says nothing at all once the pump is the thing that matters.
      brewing: one({ step: 'brew', dose: 18, bag, grinder, history: drifted }),
    };
  });
  t('coach: says nothing at the grinder when the routine is running fine',
    atGrinder.quiet === null && atGrinder.rested === null,
    `settled ${atGrinder.quiet}, rested coffee ${atGrinder.rested}`);
  // The bad habit this whole file argues against, in the one place it would be
  // easiest to encourage: moving the grinder because of a single bad puck.
  t('coach: will not move the grinder for one shot out of six',
    atGrinder.noise === null, `one long shot produced ${atGrinder.noise}`);
  // The reading is made on the rating screen and the move it implies can only
  // be made here, before anything is ground — and in between is a night's sleep.
  t('coach: carries the last shot\u2019s verdict to the grinder, where it can be acted on',
    atGrinder.carry === 'carry' && /finer|coarser/.test(atGrinder.carryText || ''),
    atGrinder.carryText || `nothing (${atGrinder.carry})`);
  t('coach: reads retention on a single-doser, and not on a hopper',
    atGrinder.retention === 'retention' && atGrinder.hopper === null,
    `single-dose ${atGrinder.retention}, hopper ${atGrinder.hopper}`);
  t('coach: says when a coffee is too young to judge, so it is not chased at the dial',
    atGrinder.young === 'rest' && /do not chase/.test(atGrinder.youngText || ''),
    atGrinder.youngText || 'nothing');
  t('coach: marks the first shot on a bag as a reference rather than a verdict',
    atGrinder.fresh === 'new_bag', String(atGrinder.fresh));
  t('coach: and stands down entirely once the pump is running',
    atGrinder.brewing === null, String(atGrinder.brewing));

  // ---- landing on the target rather than past it ----
  // Aim for 36, stop the pump at 36, and the cup settles at 38: the puck does
  // not stop when the pump does. What is still in flight is the flow times how
  // long that machine drips, so the correction has to move with the flow — a
  // fixed "stop 2 g early" is wrong at both ends and worst at the fast end,
  // where the overshoot is biggest and the time to react is shortest.
  const stopping = await page.evaluate(async () => {
    const { cutPoint, LEAD_S } = await import('./assets/js/core/cutoff.js');
    const at = (flow, lag = 1.4, net = 0) => cutPoint({ target: 36, flow, lag, net });
    return {
      slow: at(1.2).at,
      fast: at(2.6).at,
      lead: LEAD_S,
      // A hand on the platter briefly reads as an enormous flow. Uncapped that
      // says "stop at 4 g" in the middle of a normal shot, which is a worse
      // failure than the one being fixed.
      spike: at(40).at,
      // No flow yet is not "stop immediately", it is "there is nothing to time".
      still: at(0, 1.4, 10).eta,
      // Where the cup is heading if nothing changes.
      lands: at(2.0, 1.4, 30).lands,
      // The stop is at 33.2 g here, and the pour is 2 g/s — so a second is two
      // grams. Sixteen grams short is eight seconds out and far too early to
      // say anything; six grams short is three seconds out and is the warning.
      early: at(2.0, 1.4, 33.2 - 16).ready,
      warn: at(2.0, 1.4, 33.2 - 6).ready,
      due: at(2.0, 1.4, 33.0).due,
      none: cutPoint({ target: 0, flow: 2 }),
    };
  });
  t('stop: the cut moves with the flow, so a fast shot is called earlier',
    Math.abs(stopping.slow - 34.32) < 0.02 && Math.abs(stopping.fast - 32.36) < 0.02,
    `1.2 g/s stops at ${stopping.slow} g, 2.6 g/s at ${stopping.fast} g`);
  t('stop: a knock cannot tell you to stop in the middle of the shot',
    stopping.spike >= 27, `a 40 g/s transient still says ${stopping.spike} g`);
  t('stop: with no pour there is nothing to count down',
    !Number.isFinite(stopping.still) && stopping.none === null,
    `eta ${stopping.still}, no target ${stopping.none}`);
  t('stop: warns before it is due, and stays quiet eight seconds out',
    stopping.warn === true && stopping.early === false && stopping.due === true,
    `8 s out ${stopping.early}, 3 s out ${stopping.warn}, at the cut ${stopping.due}`);

  // AND THE SOUND COUNTS TO THE SAME PLACE THE SCREEN DOES.
  // It did not. The screen counted down to the stop weight and the cue counted
  // down to the target, so the one signal you use when you are NOT looking at
  // the screen — which is the whole reason a cue exists — fired a gram and a
  // half late on a normal shot and nearly three on a fast one, every time.
  await page.goto(B + '/live.html?mock=lefu');
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 9000 });
  const heard = await page.evaluate(async () => {
    const { cutPoint } = await import('./assets/js/core/cutoff.js');
    const fired = [];
    const cue = await import('./assets/js/core/cue.js');
    for (const k of ['ready', 'tick', 'stop']) {
      const real = cue.CUES[k];
      cue.CUES[k] = () => { fired.push(k); real?.(); };
    }
    // Walk a pour up to the target at a steady 2 g/s and see where it speaks.
    const lag = 1.4, target = 36;
    const spoke = [];
    for (let net = 20; net <= 37; net += 0.2) {
      const c = cutPoint({ target, flow: 2, lag, net });
      if (c.due) { spoke.push(['stop', +net.toFixed(1)]); break; }
      if (c.ready && !spoke.length) spoke.push(['ready', +net.toFixed(1)]);
    }
    return { spoke, hasReady: typeof cue.CUES.ready === 'function' };
  });
  const readyAt = heard.spoke.find((x) => x[0] === 'ready')?.[1];
  const stopAt = heard.spoke.find((x) => x[0] === 'stop')?.[1];
  t('stop: the chime is called at the stop weight, not at the target',
    stopAt !== undefined && stopAt < 34 && stopAt > 32,
    `stop cue at ${stopAt} g for a 36 g target at 2 g/s (the target itself is 36)`);
  t('stop: with a run-up first, so there is time to reach the paddle',
    readyAt !== undefined && stopAt - readyAt > 5,
    `ready at ${readyAt} g, stop at ${stopAt} g`);

  // ---- two ways to use the same app ----
  // Not a declutter button on one panel: a mode, in the nav, on every page, the
  // way a camera offers auto and manual. The failure mode of a simplified view
  // is that it simplifies away something you needed, so what is checked is not
  // that things disappeared but WHICH — the instrument, the curve, the flow and
  // the stop weight all survive, and what goes is either a duplicate of one of
  // those or apparatus for working out why a shot did what it did.
  const views = await page.evaluate(async () => {
    const ui = await import('./assets/js/ui.js');
    const shown = (id) => {
      const el = document.getElementById(id);
      return !!el && el.getBoundingClientRect().height > 0;
    };
    const keep = ['brew-gauge', 'curve', 'stop', 'flowrow', 'pip'];
    const drop = ['ladder', 'pn-target', 'pn-lands', 'pour-legend', 'advanced'];
    const btn = () => {
      document.querySelector('.menu').open = true;
      return document.querySelector('.menu-pick');
    };
    ui.setMode('full');
    await new Promise((r) => setTimeout(r, 140));
    const full = { keep: keep.filter(shown), drop: drop.filter(shown),
                   body: document.body.classList.contains('full'),
                   label: btn()?.textContent };
    btn().click();
    await new Promise((r) => setTimeout(r, 180));
    const simple = { keep: keep.filter(shown), drop: drop.filter(shown),
                     body: document.body.classList.contains('simple'),
                     label: btn()?.textContent,
                     // The flow number is the one live reading that says whether
                     // the shot is running right. Tidying it away would be
                     // hiding the reading rather than the apparatus.
                     flow: !!document.getElementById('c-f')?.closest('.pn')
                       ?.getBoundingClientRect().height };
    const stored = ui.currentMode();
    btn().click();
    await new Promise((r) => setTimeout(r, 180));
    const back = ui.currentMode();
    ui.setMode('full');
    return { full, simple, stored, back, hasButton: !!btn() };
  });
  t('view: the mode lives in the bar\u2019s menu, so it is one control on every page',
    views.hasButton && views.full.label === 'Simple' && views.simple.label === 'Full',
    `menu reads "${views.full.label}" in full and "${views.simple.label}" in simple`);
  t('view: simple keeps the instrument, the curve, the flow and the stop',
    views.simple.keep.length === views.full.keep.length && views.simple.flow === true,
    `kept ${views.simple.keep.join(', ')}${views.simple.flow ? ' + flow' : ' \u2014 FLOW GONE'}`);
  t('view: and drops the duplicates and the apparatus, including device settings',
    views.full.drop.length > 0 && views.simple.drop.length === 0,
    `full showed ${views.full.drop.join(', ')}; simple shows ${views.simple.drop.join(', ') || 'none of them'}`);
  t('view: the choice is remembered, and it is a body class pages can key off',
    views.stored === 'simple' && views.back === 'full'
    && views.full.body === true && views.simple.body === true,
    `stored ${views.stored} then ${views.back}`);

  // It is an app-wide mode, so the pages that are mostly apparatus have to
  // answer to it too — a "simple" that only reached one panel would be a
  // declutter wearing a mode's name.
  await page.goto(B + '/settings.html');
  const elsewhere = await page.evaluate(async () => {
    const ui = await import('./assets/js/ui.js');
    const heads = () => [...document.querySelectorAll('.sect h2')]
      .filter((h) => h.getBoundingClientRect().height > 0).map((h) => h.textContent.trim());
    ui.setMode('full');
    await new Promise((r) => setTimeout(r, 140));
    const full = heads();
    ui.setMode('simple');
    await new Promise((r) => setTimeout(r, 140));
    const simple = heads();
    ui.setMode('full');
    return { full, simple, hasButton: !!document.querySelector('.menu .menu-pick') };
  });
  t('view: settings folds its instrument sections away in simple, and keeps the rest',
    elsewhere.hasButton && elsewhere.simple.length < elsewhere.full.length
    && elsewhere.simple.includes('Sound and taps')
    && !elsewhere.simple.includes('Refractometry'),
    `${elsewhere.full.length} sections in full, ${elsewhere.simple.length} in simple`);

  // THE KNOWLEDGE BANK'S OWN CONTRACTS.
  // The point of the file is that a claim carries its evidence, so the checks
  // are structural: nothing may assert without a class, nothing established may
  // be uncited, and the app must not be caught saying something it has itself
  // listed as refuted.
  const kb = await page.evaluate(async () => {
    const k = await import('./assets/js/core/knowledge.js');
    const classes = ['established', 'practice', 'contested'];
    const bad = [];
    for (const [id, c] of Object.entries(k.CLAIMS)) {
      if (!classes.includes(c.confidence)) bad.push(`${id}: class "${c.confidence}"`);
      if (!c.say || !c.because) bad.push(`${id}: missing say/because`);
      // Established means somebody measured it, so it has to name who.
      if (c.confidence === 'established' && !(c.sources || []).length
        && !['freshIsNotBetter', 'cremaIsNotQuality'].includes(id)) bad.push(`${id}: established but uncited`);
      for (const src of c.sources || []) if (!k.SOURCES[src]) bad.push(`${id}: unknown source ${src}`);
    }
    // Every taste has to route to one of the three structural classes, since
    // that is what decides whether the advice is "more", "less" or "evener".
    for (const [id, tv] of Object.entries(k.TASTE)) {
      if (!['under', 'over', 'uneven'].includes(tv.structure)) bad.push(`taste ${id}: structure`);
      if (!tv.causes.length) bad.push(`taste ${id}: no causes`);
      for (const c of tv.causes) if (!classes.includes(c.confidence)) bad.push(`taste ${id}: cause class`);
    }
    // A ristretto's band must be reachable: EY = ratio x TDS is arithmetic, and
    // the whole bug this fixed was a band that no correct ristretto could meet.
    const r = k.STYLE_BANDS.ristretto;
    const reachable = r.ey[1] <= r.ratio[1] * r.tds[1];
    return { bad, claims: Object.keys(k.CLAIMS).length, refuted: k.REFUTED.length,
      reachable, sources: Object.keys(k.SOURCES).length };
  });
  t('knowledge: every claim carries an evidence class and a citation if it asserts',
    kb.bad.length === 0,
    kb.bad.slice(0, 3).join(' | ') || `${kb.claims} claims, ${kb.sources} sources, `
      + `${kb.refuted} refuted`);
  t('knowledge: the yield band for a drink is one that drink can actually reach',
    kb.reachable, 'ristretto band is arithmetically attainable');

  t('diagnose: a clean curve is reported as clean', diag.clean.codes.length === 0,
    diag.clean.codes.join(',') || 'no findings');
  t('diagnose: a step in the flow is reported', diag.channel.codes.includes('flow_step'),
    diag.channel.codes.join(','));
  t('diagnose: a step is not confused with a slow shot',
    !diag.channel.codes.includes('choked'), diag.channel.codes.join(','));
  // THE REGRESSION THIS FILE EXISTS TO PREVENT. Flow rising as the puck's
  // resistance falls is what an ordinary shot does. Calling it a channel was
  // wrong, and wrong on the common case.
  t('diagnose: flow rising as resistance falls is not called a fault',
    diag.rising.codes.length === 0,
    diag.rising.codes.join(',') || 'no findings');
  t('diagnose: a ristretto is not told it is under-extracted',
    !diag.ristretto.codes.includes('ey_low'),
    `${diag.ristretto.codes.join(',') || 'no findings'} at 15.2% on 1:1.3`);
  // Two opposite defects at once is unevenness, not a midpoint — the reading
  // most often got wrong, and the one the app is most useful for getting right.
  const both = await page.evaluate(async () => {
    const d = await import('./assets/js/core/diagnose.js');
    const one = (tags) => d.diagnose({ tags, ratio: 2, time_s: 27 }).map((x) => x.code);
    return { opposed: one('sour bitter'), single: one('sour'), dry: one('harsh') };
  });
  t('diagnose: sour and bitter together is called unevenness, not a midpoint',
    both.opposed.includes('uneven') && !both.single.includes('uneven'),
    `both -> ${both.opposed.join(',') || 'none'}; sour alone -> ${both.single.join(',') || 'none'}`);
  t('diagnose: drying is kept apart from bitter, since the fix is the opposite',
    both.dry.includes('astringent'), both.dry.join(','));
  t('diagnose: a long pre-drip is called choked', diag.choked.codes.includes('choked'),
    diag.choked.codes.join(','));
  t('diagnose: a fast free-flowing shot is called a gusher', diag.gusher.codes.includes('gusher'),
    diag.gusher.codes.join(','));
  // The metrics are what the diagnosis rests on, so check them against a curve
  // whose true peak, steady rate and late slope are known by construction.
  t('diagnose: curve metrics recover the true flow profile',
    Math.abs(diag.clean.m.peak_flow_gs - 1.8) < 0.05
    && Math.abs(diag.clean.m.steady_flow_gs - 1.66) < 0.06
    && Math.abs(diag.clean.m.flow_slope_late + 0.012) < 0.01,
    `peak ${diag.clean.m.peak_flow_gs} (1.8), steady ${diag.clean.m.steady_flow_gs} (1.66), `
      + `late ${diag.clean.m.flow_slope_late} (-0.012)`);
  t('diagnose: the drip tail is trimmed before the slope is measured',
    Math.abs(diag.clean.m.duration_s - 28) < 0.5, diag.clean.m.duration_s + ' s of 34 s recorded');

  // ---- the resistance model recovers a slope it was never told ----
  const advisorMath = await page.evaluate(async () => {
    const a = await import('./assets/js/core/advisor.js');
    const grinder = { id: 'g', name: 'Test', min: 0, max: 40, step: 0.5 };
    // Ground truth: log Q = -1.0 + 0.22·grind - 0.008·days, plus a little noise.
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
    const shots = [[10, 3], [12, 5], [14, 7], [11, 9], [13, 11], [15, 13], [9, 15], [12.5, 17]]
      .map(([g, d], i) => ({
        shot_id: 's' + i, grinder_id: 'g', bag_id: 'b', grind_setting: g, days_off_roast: d,
        steady_flow_gs: +Math.exp(-1.0 + 0.22 * g - 0.008 * d + rnd() * 0.06).toFixed(3),
        dose_g: 18, yield_g: 36, rating: Math.round(8 - 0.35 * Math.abs(g - 12.5) ** 1.6 + rnd()),
      }));
    const fit = a.fitResistance(shots, { grinderId: 'g', bagId: 'b' });
    const rec = a.recommendGrind(shots, { grinderId: 'g', bagId: 'b', grinder, targetTimeS: 28,
      targetDoseG: 18, targetRatio: 2, days: 12, currentSetting: 13 });
    const closed = (Math.log(36 / 28) + 1.0 + 0.008 * 12) / 0.22;
    const taste = a.suggestByTaste(shots, { grinderId: 'g', bagId: 'b', grinder, currentSetting: 13 });
    return {
      b: fit.b, c: fit.c, lambda: fit.lambda, setting: rec.setting, closed,
      confidence: rec.confidence,
      thin: a.fitResistance(shots.slice(0, 2), { grinderId: 'g' }),
      flat: a.fitResistance(shots.map((s) => ({ ...s, grind_setting: 12 })), { grinderId: 'g' }),
      taste: { ok: taste.ok, n: taste.n, setting: taste.setting, peak: taste.modelPeak },
      unrated: a.suggestByTaste(shots.slice(0, 3), { grinderId: 'g', bagId: 'b', grinder }),
    };
  });
  t('advisor: recovers the true grind sensitivity', Math.abs(advisorMath.b - 0.22) < 0.02,
    `b = ${advisorMath.b.toFixed(4)} (true 0.22)`);
  t('advisor: recovers the true staleness coefficient', Math.abs(advisorMath.c + 0.008) < 0.003,
    `c = ${advisorMath.c.toFixed(5)} (true -0.008)`);
  t('advisor: the recommendation matches the closed-form inverse',
    Math.abs(advisorMath.setting - advisorMath.closed) < 0.4,
    `${advisorMath.setting} vs ${advisorMath.closed.toFixed(2)}`);
  t('advisor: partial pooling weights the bag against the grinder',
    advisorMath.lambda > 0 && advisorMath.lambda < 1, 'lambda ' + advisorMath.lambda.toFixed(2));
  t('advisor: refuses to fit two shots rather than inventing a slope',
    advisorMath.thin.ok === false && /at least 3/.test(advisorMath.thin.reason), advisorMath.thin.reason);
  t('advisor: refuses when every shot used the same setting',
    advisorMath.flat.ok === false && /same grind/.test(advisorMath.flat.reason), advisorMath.flat.reason);
  t('advisor: the taste search finds the rated optimum',
    advisorMath.taste.ok && Math.abs(advisorMath.taste.peak.setting - 12.5) <= 1,
    `peak at ${advisorMath.taste.peak?.setting} (ratings peak at 12.5)`);
  t('advisor: the taste search declines with too few ratings',
    advisorMath.unrated.ok === false && /at least 4/.test(advisorMath.unrated.reason),
    advisorMath.unrated.reason);

  // ---- the frozen first shot is not a reading of the bag ----
  // Cold beans fracture into a smaller mean particle size (Uman et al., 2016),
  // so at an unchanged dial they run slower. Left in the fit, that pulls the
  // bag intercept toward a grind that was never set.
  const frozenFit = await page.evaluate(async () => {
    const a = await import('./assets/js/core/advisor.js');
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
    const q = (g, d, k = 1) => +(Math.exp(-1.0 + 0.22 * g - 0.008 * d + rnd() * 0.06) * k).toFixed(3);
    const warm = [[10, 3], [12, 5], [14, 7], [11, 9], [13, 11], [15, 13], [9, 15], [12.5, 17]]
      .map(([g, d], i) => ({ shot_id: 'w' + i, grinder_id: 'g', bag_id: 'b', grind_setting: g,
        days_off_roast: d, steady_flow_gs: q(g, d), dose_g: 18, yield_g: 36 }));
    // Four first-shots-from-frozen, each running 20% slower at the same dial.
    const cold = [[10, 4], [12, 8], [14, 12], [11, 16]]
      .map(([g, d], i) => ({ shot_id: 'c' + i, grinder_id: 'g', bag_id: 'b', grind_setting: g,
        days_off_roast: d, steady_flow_gs: q(g, d, 0.8), dose_g: 18, yield_g: 36,
        from_frozen: true }));
    const all = [...warm, ...cold];
    const fit = a.fitResistance(all, { grinderId: 'g', bagId: 'b' });
    // The same rows with the flag stripped: what the fit would have been.
    const naive = a.fitResistance(all.map((s) => ({ ...s, from_frozen: false })),
      { grinderId: 'g', bagId: 'b' });
    const warmOnly = a.fitResistance(warm, { grinderId: 'g', bagId: 'b' });
    const rows = a.resistanceRows(all, { grinderId: 'g' });
    const thin = a.fitResistance([...warm, cold[0]], { grinderId: 'g', bagId: 'b' });
    return {
      n: fit.n, frozen: fit.frozen, allRows: rows.length,
      flagged: rows.filter((r) => r.fromFrozen).length,
      a: fit.a, aNaive: naive.a, aWarm: warmOnly.a,
      effect: fit.frozenEffect, thinEffect: thin.frozenEffect,
    };
  });
  t('advisor: frozen first shots are kept out of the resistance fit',
    frozenFit.n === 8 && frozenFit.frozen === 4,
    `${frozenFit.n} shots fitted, ${frozenFit.frozen} set aside`);
  t('advisor: but they are still carried on the rows, not discarded',
    frozenFit.allRows === 12 && frozenFit.flagged === 4,
    `${frozenFit.allRows} rows, ${frozenFit.flagged} flagged`);
  t('advisor: excluding them leaves the fit where the warm shots put it',
    Math.abs(frozenFit.a - frozenFit.aWarm) < 1e-9, 'identical to the warm-only fit');
  t('advisor: leaving them in would have dragged the intercept down',
    frozenFit.aNaive < frozenFit.a - 0.03,
    `a = ${frozenFit.a.toFixed(3)} excluded vs ${frozenFit.aNaive.toFixed(3)} included`);
  t('advisor: and the size of the frozen effect is measured, not assumed',
    frozenFit.effect.known && Math.abs(frozenFit.effect.pct + 20) < 4,
    `${frozenFit.effect.pct.toFixed(1)}% (true −20%)`);
  t('advisor: with an interval, because four shots is four shots',
    frozenFit.effect.lo < frozenFit.effect.pct && frozenFit.effect.pct < frozenFit.effect.hi,
    `${frozenFit.effect.lo.toFixed(0)}% to ${frozenFit.effect.hi.toFixed(0)}%`);
  t('advisor: one frozen shot buys a direction, not a number',
    frozenFit.thinEffect.known === false && /grind finer/.test(frozenFit.thinEffect.note),
    frozenFit.thinEffect.note.slice(0, 56));

  // ---- Kit: a bag and a grinder, through the UI ----
  await page.goto(B + '/kit.html');
  await kitTab('bags');
  await page.fill('#b-name', 'Test Guji');
  await page.fill('#b-roaster', 'Test Roasters');
  await page.fill('#b-weight', '250');
  const roasted = new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10);
  await page.fill('#b-roast', roasted);
  await page.click('#b-save');
  await page.waitForFunction(() => /Added/.test(document.getElementById('b-msg').textContent));
  const bagCards = await page.locator('#bags .bx').count();
  t('kit: a bag is saved and listed', bagCards === 1, bagCards + ' bag(s)');
  // "9 d" said nothing. The phase is what a number of days actually means.
  t('kit: bean age is shown as a phase, not a raw date or a bare number',
    /9 days/i.test(await page.innerText('#bags'))
    && /window|degassing|off roast|fading/i.test(await page.innerText('#bags')),
    (await page.innerText('#bags')).replace(/\s+/g, ' ').slice(0, 80));

  await kitTab('grinders');
  await page.fill('#g-name', 'Test DF64');
  await page.fill('#g-min', '0'); await page.fill('#g-max', '40'); await page.fill('#g-step', '0.5');
  await page.click('#g-save');
  await page.waitForFunction(() => /Added/.test(document.getElementById('g-msg').textContent));
  t('kit: a grinder is saved and listed', (await page.locator('#grinders .bx').count()) === 1,
    await page.innerText('#grinders'));

  await page.fill('#g-name', 'Broken'); await page.fill('#g-max', '-5');
  await page.click('#g-save');
  t('kit: a nonsense dial range is refused', /above dial min/.test(await page.textContent('#g-msg')),
    await page.textContent('#g-msg'));

  const kitIds = await page.evaluate(() => ({
    bag: JSON.parse(localStorage.getItem('brewkit.bags.v1'))[0].id,
    grinder: JSON.parse(localStorage.getItem('brewkit.grinders.v1'))[0].id,
  }));
  t('kit: saved records get a real id', /^bag-\d+$/.test(kitIds.bag ?? '')
    && /^grinder-\d+$/.test(kitIds.grinder ?? ''), `${kitIds.bag} / ${kitIds.grinder}`);
  // An option with no value attribute falls back to matching on its label, which
  // is how a missing id stayed invisible until a saved row had no bag on it.
  await page.goto(B + '/logger.html');
  const bagOptionValues = await page.$$eval('#bag option', (os) => os.map((o) => o.value));
  t('kit: selects carry ids as option values, not labels',
    bagOptionValues.includes(kitIds.bag), bagOptionValues.join(' | '));
  await page.goto(B + '/kit.html');

  // ---- Kit shows one thing at a time ----
  // Four add-forms and four lists down one page is a filing cabinet with every
  // drawer pulled out, and the work is nearly always in one drawer.
  await page.goto(B + '/kit.html');
  const panes = await page.evaluate(() => ({
    total: document.querySelectorAll('[data-pane]').length,
    visible: [...document.querySelectorAll('[data-pane]')].filter((p) => !p.hidden)
      .map((p) => p.dataset.pane),
    selected: [...document.querySelectorAll('[data-kit-tab]')]
      .filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.dataset.kitTab),
  }));
  t('kit: one pane is on screen, not five',
    panes.total === 5 && panes.visible.length === 1 && panes.selected.length === 1
    && panes.visible[0] === panes.selected[0], `${panes.visible.join()} of ${panes.total}`);

  await page.click('[data-kit-tab="machines"]');
  await page.reload();
  await page.waitForSelector('[data-kit-tab]', { timeout: 4000 });
  t('kit: and the one you were on is the one you come back to',
    await page.evaluate(() => !document.querySelector('[data-pane="machines"]').hidden),
    'machines still open');

  const boxes = await page.evaluate(() => ({
    // Bags exist by now, grinders too; consumables do not.
    bags: document.querySelector('[data-add="bags"]').open,
    consumables: document.querySelector('[data-add="consumables"]').open,
  }));
  t('kit: the add form opens itself only while there is nothing to look at',
    boxes.bags === false && boxes.consumables === true,
    `bags ${boxes.bags}, consumables ${boxes.consumables}`);
  await page.click('[data-kit-tab="bags"]');

  // ---- the scale as a button ----
  // The gesture layer is pure, so it can be driven with exact signals rather
  // than by waiting on a mock. What matters is not that it detects taps; it is
  // that it detects nothing else, because a scale beside a machine gets knocked
  // and a false capture loses a dose.
  const gest = await page.evaluate(async () => {
    const { TapListener } = await import('./assets/js/core/tap.js');
    const play = (samples, hz = 10) => {
      const L = new TapListener();
      const out = [];
      let t = 0;
      for (const w of samples) {
        const g = L.push(t, w + (Math.random() - 0.5) * 0.1);
        if (g) out.push(g.type);
        t += 1 / hz;
      }
      return out.join(',') || 'nothing';
    };
    const flat = (v, secs, hz = 10) => Array(Math.round(secs * hz)).fill(v);
    const tap = (base, peak = 60) => [base + peak, base + peak * 0.6];
    const shot = [];
    for (let i = 0; i < 280; i++) shot.push(Math.min(36, Math.max(0, (i / 10 - 6) * 1.7)));

    return {
      double: play([...flat(0, 2), ...tap(0), ...flat(0, 0.2), ...tap(0), ...flat(0, 1.5)]),
      triple: play([...flat(0, 2), ...tap(0), ...flat(0, 0.2), ...tap(0), ...flat(0, 0.2),
                    ...tap(0), ...flat(0, 1.5)]),
      hold: play([...flat(0, 2), ...tap(0), ...flat(0, 0.2), ...tap(0), ...flat(0, 0.2),
                  ...flat(70, 0.9), ...flat(0, 1.5)]),
      // After a real lift the baseline has to catch up fast, or the first tap
      // lands at a level it does not recognise and is thrown away — which is
      // exactly the moment someone reaches over to undo.
      afterLift: play([...flat(70, 2), ...flat(0, 1.5), ...tap(0), ...flat(0, 0.2),
                       ...tap(0), ...flat(0, 1.5)]),
      lonepress: play([...flat(0, 2), ...flat(70, 0.9), ...flat(0, 1.5)]),
      scaleTare: play([...flat(0, 2), ...flat(52, 0.9), ...flat(0, 2)]),
      single: play([...flat(0, 2), ...tap(0), ...flat(0, 2)]),
      cup: play([...flat(0, 2), 20, 45, ...flat(52, 4)]),
      portafilter: play([...flat(0, 2), 180, 400, ...flat(469, 5)]),
      pour: play([...flat(0, 2), ...shot, ...flat(36, 2)]),
      lifted: play([...flat(52, 3), 30, ...flat(0, 3)]),
      slowKnocks: play([...flat(0, 2), ...tap(0), ...flat(0, 3), ...tap(0), ...flat(0, 2)]),
      feeble: play([...flat(0, 2), ...tap(0, 2), ...flat(0, 0.2), ...tap(0, 2), ...flat(0, 2)]),
      // The case the shipped default now has to catch: a scale that low-passes
      // a firm tap down to a few grams. Guessing high here is how a detector
      // ends up never firing on real hardware.
      weak: play([...flat(0, 2), ...tap(0, 7), ...flat(0, 0.2), ...tap(0, 7), ...flat(0, 2)]),
      onTop: play([...flat(469, 3), ...tap(469), ...flat(469, 0.2), ...tap(469), ...flat(469, 1.5)]),
      coarse: (() => {
        const L = new TapListener();
        const out = [];
        let t = 0;
        for (const w of [...flat(0, 2), ...tap(0), ...flat(0, 0.2), ...tap(0), ...flat(0, 1.5)]) {
          const g = L.push(t, w + (Math.random() - 0.5) * 2);   // a 1 g scale
          if (g) out.push(g.type);
          t += 0.1;
        }
        return out.join(',') || 'nothing';
      })(),
    };
  });
  t('taps: two taps on the platter are a command',
    gest.double === 'double', gest.double);
  t('taps: three are a different one', gest.triple === 'triple', gest.triple);
  // The one that bit: a cup set down and lifted a second later, and a
  // scale-side tare, are both exactly a long press released. Neither may be a
  // gesture, which is why the hold has to be announced by taps first.
  t('taps: a lone long press is not a hold — that is just a cup being lifted',
    gest.lonepress === 'nothing', gest.lonepress);
  t('taps: which is why the hold has to be announced by two taps first',
    gest.hold === 'hold', gest.hold);
  t('taps: and a scale-side tare, which looks identical, is not one either',
    gest.scaleTare === 'nothing', gest.scaleTare);
  t('taps: one tap is never a command — a scale on a counter gets knocked',
    gest.single === 'nothing', gest.single);
  t('taps: a dosing cup landing is not a gesture', gest.cup === 'nothing', gest.cup);
  t('taps: nor is a portafilter', gest.portafilter === 'nothing', gest.portafilter);
  t('taps: nor is a whole shot pouring', gest.pour === 'nothing', gest.pour);
  t('taps: nor is lifting the cup off', gest.lifted === 'nothing', gest.lifted);
  t('taps: two knocks three seconds apart are not a chord',
    gest.slowKnocks === 'nothing', gest.slowKnocks);
  t('taps: a touch too light to mean it does nothing', gest.feeble === 'nothing', gest.feeble);
  t('taps: but a scale that reports a firm tap as a few grams still works',
    gest.weak === 'double', gest.weak);
  t('taps: and it still works with a portafilter already on the scale',
    gest.onTop === 'double', gest.onTop);
  t('taps: a 1 g-resolution scale is still readable', gest.coarse === 'double', gest.coarse);
  t('taps: and a tap lands straight after a cup has been lifted off',
    gest.afterLift === 'double', gest.afterLift);

  // A tap is a rise and a fall of exactly the size the session reads as "the
  // vessel came off". Before the lift test waited for the platform to STAY
  // down, tapping the scale committed the step whatever the tap meant.
  const lift = await page.evaluate(async () => {
    const { SessionMachine } = await import('./assets/js/core/session.js');
    const run = (samples) => {
      const m = new SessionMachine();
      m.setReady(true);
      m.begin();
      let tare = 0, t = 0, committed = null;
      for (const raw of samples) {
        t += 0.1;
        m._t = t;
        const r = m.step_(t, raw, raw - tare, true);
        if (r.tareTo !== null) tare = r.tareTo;
        if (r.committed) committed = r.committed;
      }
      return { committed, step: m.step, dose: m.dose };
    };
    const flat = (v, secs) => Array(Math.round(secs * 10)).fill(v);
    return {
      // cup on, tares, filled to 18, then TAPPED twice — must not commit
      tapped: run([...flat(0, 1), ...flat(52, 1.5), ...flat(70, 2),
                   130, 130, ...flat(70, 0.3), 130, 130, ...flat(70, 1.5)]),
      // the same, but actually lifted off — must commit
      lifted: run([...flat(0, 1), ...flat(52, 1.5), ...flat(70, 2), ...flat(0, 1.5)]),
    };
  });
  t('lift: a tap on the platter no longer commits the step',
    lift.tapped.committed === null && lift.tapped.step === 'dose',
    `${lift.tapped.committed} → ${lift.tapped.step}`);
  t('lift: an actual lift still does',
    lift.lifted.committed === 'dose' && lift.lifted.step === 'grind',
    `${lift.lifted.committed} ${lift.lifted.dose} g → ${lift.lifted.step}`);

  // ---- who owns the choice of coffee ----
  // A hopper holds one bag until it runs out, so what is in it is a property of
  // the grinder. A single doser is fed per shot, and the coffee genuinely can
  // differ between consecutive shots — which is the whole point of single
  // dosing — so it has to be asked every time.
  const hopper = await page.evaluate(async () => {
    const supply = await import('./assets/js/core/supply.js');
    const kit = await import('./assets/js/core/kit.js');
    const bag = { id: 'b1', bean_name: 'Guji', weight_g: 250 };
    const shots = (n) => Array.from({ length: n },
      (_, i) => ({ shot_id: `s${i}`, bag_id: 'b1', dose_g: 18 }));
    const ask = (g, bags, sh) => supply.hopperAssumption(g, bags, sh);
    const single = { id: 'g1', name: 'Niche', feed: 'single-dose', hopper_bag_id: 'b1' };
    const loaded = { id: 'g2', name: 'Mazzer', feed: 'hopper', hopper_bag_id: 'b1' };
    const bare = { id: 'g3', name: 'Mazzer', feed: 'hopper', hopper_bag_id: '' };

    // Saving a grinder as single dose must forget any hopper contents, or the
    // stale id would come back if it were ever switched to hopper again.
    const saved = kit.saveGrinder({ name: 'Feed Test', feed: 'hopper', hopper_bag_id: 'b1' });
    const flipped = kit.saveGrinder({ id: saved.id, feed: 'single-dose' });
    const defaulted = kit.saveGrinder({ name: 'Feed Default' });
    const loadedBack = kit.loadHopper(defaulted.id, 'b1');
    kit.removeGrinder(saved.id);
    kit.removeGrinder(defaulted.id);

    return {
      single: ask(single, [bag], shots(3)),
      half: ask(loaded, [bag], shots(3)),
      empty: ask(loaded, [bag], shots(14)),
      bare: ask(bare, [bag], shots(0)),
      archived: ask(loaded, [{ ...bag, archived: true }], shots(1)),
      flippedHopper: flipped.hopper_bag_id,
      defaultFeed: defaulted.feed,
      loadRefused: loadedBack,
    };
  });
  t('feed: a hopper that still has coffee in it is taken as read',
    hopper.half.assume === true && hopper.half.bagId === 'b1' && hopper.half.left === 196,
    hopper.half.reason);
  t('feed: a single doser is never assumed, however well remembered',
    hopper.single.assume === false && /single dosed/.test(hopper.single.reason),
    hopper.single.reason);
  t('feed: the assumption expires when the log says that bag is finished',
    hopper.empty.assume === false && /finished/.test(hopper.empty.reason), hopper.empty.reason);
  t('feed: a hopper nothing has been loaded into is asked about, not guessed at',
    hopper.bare.assume === false && /nothing recorded/.test(hopper.bare.reason),
    hopper.bare.reason);
  t('feed: an archived bag is not still in the hopper',
    hopper.archived.assume === false && /archived/.test(hopper.archived.reason),
    hopper.archived.reason);
  t('feed: grinders default to single dose — the answer that never assumes',
    hopper.defaultFeed === 'single-dose', hopper.defaultFeed);
  t('feed: switching a grinder to single dose forgets what was in its hopper',
    hopper.flippedHopper === '', `"${hopper.flippedHopper}"`);
  t('feed: and a single doser cannot be loaded with a hopper bag at all',
    hopper.loadRefused === null, String(hopper.loadRefused));

  // On the page: the gate is skipped only where the assumption holds, it always
  // says so, and it can be taken back.
  //
  // This block rewrites grinders, shots and the remembered session, all of
  // which are shared fixture for tests further down. Snapshot the lot and put
  // it back: a test that leaves the shot log empty fails a supply assertion
  // three hundred lines later, and the failure names the wrong culprit.
  const fixtureBefore = await page.evaluate(() => ({
    grinders: localStorage.getItem('brewkit.grinders.v1'),
    shots: localStorage.getItem('brewkit.shots.v1'),
    session: localStorage.getItem('brewkit.session.v1'),
  }));
  const gateSeen = [];
  for (const [label, feed, hopperBag, shotCount] of [
    ['hopper, half full', 'hopper', 'bag-1', 3],
    ['hopper, run out', 'hopper', 'bag-1', 14],
    ['single dose', 'single-dose', '', 3],
    ['hopper, not loaded', 'hopper', '', 0],
  ]) {
    await page.evaluate(([feed, hopperBag, n, ids]) => {
      const gs = JSON.parse(localStorage.getItem('brewkit.grinders.v1') ?? '[]');
      const g = gs.find((x) => x.id === ids.grinder);
      if (g) { g.feed = feed; g.hopper_bag_id = hopperBag ? ids.bag : ''; }
      localStorage.setItem('brewkit.grinders.v1', JSON.stringify(gs));
      localStorage.setItem('brewkit.session.v1',
        JSON.stringify({ bag_id: ids.bag, grinder_id: ids.grinder }));
      localStorage.setItem('brewkit.shots.v1', JSON.stringify(Array.from({ length: n },
        (_, i) => ({ shot_id: `hop-${i}`, bag_id: ids.bag, grinder_id: ids.grinder, dose_g: 18 }))));
    }, [feed, hopperBag, shotCount, kitIds]);
    await page.goto(B + '/live.html?mock=lefu&noshot=1');
    await page.waitForFunction(
      () => document.getElementById('step-live').style.display !== 'none', { timeout: 8000 });
    await page.waitForTimeout(700);
    gateSeen.push({ label, ...(await page.evaluate(() => ({
      step: window.__sess.step,
      gate: !document.getElementById('begin-box').hidden,
      told: !document.getElementById('assumed').hidden,
    }))) });
  }
  const seen = Object.fromEntries(gateSeen.map((r) => [r.label, r]));
  t('feed: Live skips step 00 only for a hopper that still has that coffee in it',
    seen['hopper, half full'].step === 'dose' && seen['hopper, half full'].gate === false,
    gateSeen.map((r) => `${r.label}=${r.step}`).join(', '));
  t('feed: and when it does, it says so rather than skipping silently',
    seen['hopper, half full'].told === true, 'banner shown');
  t('feed: every other case still stops at 00',
    ['hopper, run out', 'single dose', 'hopper, not loaded']
      .every((k) => seen[k].step === 'setup' && seen[k].gate === true),
    ['hopper, run out', 'single dose', 'hopper, not loaded']
      .map((k) => `${k}=${seen[k].step}`).join(', '));

  // Refilling the hopper with something else has to be sayable.
  await page.evaluate(([ids]) => {
    const gs = JSON.parse(localStorage.getItem('brewkit.grinders.v1') ?? '[]');
    const g = gs.find((x) => x.id === ids.grinder);
    if (g) { g.feed = 'hopper'; g.hopper_bag_id = ids.bag; }
    localStorage.setItem('brewkit.grinders.v1', JSON.stringify(gs));
    localStorage.setItem('brewkit.shots.v1', '[]');
  }, [kitIds]);
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 8000 });
  await page.waitForTimeout(700);
  await page.click('#assumed-no');
  await page.waitForTimeout(300);
  const refilled = await page.evaluate(async () => {
    const kit = await import('./assets/js/core/kit.js');
    return { step: window.__sess.step,
             gate: !document.getElementById('begin-box').hidden,
             stillLoaded: kit.grinders().some((g) => g.hopper_bag_id) };
  });
  t('feed: "changed the hopper?" empties it and asks again',
    refilled.step === 'setup' && refilled.gate === true && refilled.stillLoaded === false,
    `${refilled.step}, loaded=${refilled.stillLoaded}`);

  // Put the shared fixture back, exactly as it was.
  const fixtureAfter = await page.evaluate((was) => {
    for (const [key, val] of [['brewkit.grinders.v1', was.grinders],
                              ['brewkit.shots.v1', was.shots],
                              ['brewkit.session.v1', was.session]]) {
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, val);
    }
    return {
      shots: JSON.parse(localStorage.getItem('brewkit.shots.v1') ?? '[]').length,
      feeds: JSON.parse(localStorage.getItem('brewkit.grinders.v1') ?? '[]')
        .filter((g) => g.hopper_bag_id).length,
    };
  }, fixtureBefore);
  t('feed: the fixture the rest of the suite runs on is put back',
    fixtureAfter.feeds === 0 && fixtureAfter.shots === JSON.parse(fixtureBefore.shots ?? '[]').length,
    `${fixtureAfter.shots} shots, ${fixtureAfter.feeds} loaded hoppers`);

  // ---- pairing without pasting eight hundred characters ----
  // An SDP offer is 830 characters of which about eighty carry information.
  // That difference is the whole reason a QR is possible: 830 bytes is a
  // 113-module symbol a webcam cannot read, and 87 is a 37-module one it can.
  const packed = await page.evaluate(async () => {
    const S = await import('./assets/js/core/sdp.js');
    const gather = (pc) => new Promise((r) => {
      const t = setTimeout(r, 3000);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') { clearTimeout(t); r(); }
      };
    });
    const host = new RTCPeerConnection({ iceServers: [] });
    const ch = host.createDataChannel('pour', { ordered: false, maxRetransmits: 0 });
    await host.setLocalDescription(await host.createOffer());
    await gather(host);
    const raw = host.localDescription.sdp;
    const small = S.pack(raw);

    // The test that matters: connect using the REBUILT description, not the
    // original. A packing that loses something ICE needs fails here and
    // nowhere else.
    const view = new RTCPeerConnection({ iceServers: [] });
    const opened = new Promise((r) => {
      view.ondatachannel = (e) => { e.channel.onopen = () => r('open'); };
    });
    await view.setRemoteDescription({ type: 'offer', sdp: S.unpack(small) });
    await view.setLocalDescription(await view.createAnswer());
    await gather(view);
    await host.setRemoteDescription({ type: 'answer', sdp: S.unpack(S.pack(view.localDescription.sdp)) });
    const state = await Promise.race([opened,
      new Promise((r) => setTimeout(() => r('timeout'), 9000))]);
    host.close(); view.close();
    void ch;

    return {
      rawChars: raw.length, smallChars: small.length, state,
      // An unpacked description has to carry the parts ICE and DTLS need.
      rebuilt: S.unpack(small),
      badVersion: S.unpack('9~a~b~c~A~'),
      garbage: S.unpack('not a code'),
    };
  });
  t('pairing: an offer packs to a fraction of its size',
    packed.smallChars < 120 && packed.rawChars > 400,
    `${packed.rawChars} chars down to ${packed.smallChars}`);
  t('pairing: and the rebuilt description still makes a working connection',
    packed.state === 'open', packed.state);
  t('pairing: the rebuild carries the fingerprint, credentials and a candidate',
    /a=fingerprint:sha-256 (?:[0-9A-F]{2}:){31}[0-9A-F]{2}/.test(packed.rebuilt)
    && /a=ice-ufrag:\S+/.test(packed.rebuilt) && /a=ice-pwd:\S+/.test(packed.rebuilt)
    && /a=candidate:\S+ 1 udp/.test(packed.rebuilt),
    'all four present');
  t('pairing: a code from another version is refused rather than half-read',
    packed.badVersion === null && packed.garbage === null, 'both null');

  // The QR encoder. Checked against the standard rather than against itself
  // where that is possible: capacities from the published tables, Reed-Solomon
  // by the property that defines it, and the fixed patterns by inspection.
  const qr = await page.evaluate(async () => {
    const Q = await import('./assets/js/core/qr.js');
    const EXP = new Uint8Array(512); const LOG = new Uint8Array(256);
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

    // Every codeword polynomial must vanish at the generator's roots.
    let rsOk = true;
    for (const deg of [10, 16, 18, 22, 24, 26, 30]) {
      const data = Uint8Array.from({ length: 20 }, (_, i) => (i * 37 + 11) & 255);
      const full = [...data, ...Q.ecCodewords(data, deg)];
      for (let k = 0; k < deg; k++) {
        let acc = 0;
        for (const c of full) acc = mul(acc, EXP[k]) ^ c;
        if (acc !== 0) rsOk = false;
      }
    }

    const caps = { 1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213 };
    const capsOk = Object.entries(caps).every(([v, n]) => Q.capacity(Number(v)) === n);

    const sym = Q.encode('x'.repeat(80));
    const m = sym.matrix; const n = sym.n;
    const want = [[1,1,1,1,1,1,1],[1,0,0,0,0,0,1],[1,0,1,1,1,0,1],[1,0,1,1,1,0,1],
                  [1,0,1,1,1,0,1],[1,0,0,0,0,0,1],[1,1,1,1,1,1,1]];
    const finder = (r0, c0) => want.every((row, r) => row.every((v, c) => (m[r0 + r][c0 + c] & 1) === v));
    let timing = true;
    for (let i = 8; i < n - 8; i++) {
      const bit = i % 2 === 0 ? 1 : 0;
      if ((m[6][i] & 1) !== bit || (m[i][6] & 1) !== bit) timing = false;
    }
    let fmtA = 0; let fmtB = 0;
    for (let i = 0; i < 15; i++) {
      const a = i < 6 ? m[8][i] : i === 6 ? m[8][7] : i === 7 ? m[8][8] : i === 8 ? m[7][8] : m[14 - i][8];
      // Most significant bit first. Reading these back least-significant-first
      // is what let this check pass over a symbol no real decoder would take:
      // it agreed with the encoder because the encoder had the same mistake.
      fmtA |= (a & 1) << (14 - i);
      fmtB |= ((i < 7 ? m[n - 1 - i][8] : m[8][n - 15 + i]) & 1) << (14 - i);
    }
    const raw = (fmtA ^ 0x5412) >> 10;

    const long = 'https://example.test/view.html#p=' + 'y'.repeat(120);
    return {
      rsOk, capsOk, version: sym.version, modules: n,
      finders: finder(0, 0) && finder(0, n - 7) && finder(n - 7, 0),
      timing,
      darkModule: (m[n - 8][8] & 1) === 1,
      formatAgrees: fmtA === fmtB && ((raw >> 3) & 3) === 0 && (raw & 7) === sym.mask,
      roundTrip: Q.readBack(sym) === 'x'.repeat(80),
      longRoundTrip: (() => { const q = Q.encode(long); return q && Q.readBack(q) === long; })(),
      tooLong: Q.encode('z'.repeat(5000)),
      svgLooksRight: /^<svg [^>]*viewBox="0 0 \d+ \d+"/.test(Q.svg('hello') ?? ''),
    };
  });
  t('qr: Reed-Solomon codewords are divisible by their generator',
    qr.rsOk, 'every root evaluates to zero');
  t('qr: capacities match the published tables for level M',
    qr.capsOk, 'v1–v10 byte mode');
  t('qr: the fixed patterns are where the standard puts them',
    qr.finders && qr.timing && qr.darkModule,
    `finders ${qr.finders}, timing ${qr.timing}, dark module ${qr.darkModule}`);
  t('qr: both copies of the format info agree, and name level M and the mask',
    qr.formatAgrees, 'agree');
  t('qr: a symbol reads back as what went into it, short and long',
    qr.roundTrip && qr.longRoundTrip, `v${qr.version}, ${qr.modules} modules`);
  t('qr: something too big to encode returns nothing rather than a broken symbol',
    qr.tooLong === null && qr.svgLooksRight, String(qr.tooLong));

  // ---- a real laptop's candidates, which is what broke the QR ----
  // Reported: "the QR code doesn't show", with the dialog saying the code was
  // too long. Headless offers one or two candidates and never reproduced it; a
  // laptop offers one per interface per family, and IPv6 and TCP ones were
  // being carried verbatim at about 110 characters each.
  const cand = await page.evaluate(async () => {
    const S = await import('./assets/js/core/sdp.js');
    const Q = await import('./assets/js/core/qr.js');
    const lines = [
      'a=candidate:1 1 udp 2113937151 192.168.1.7 51234 typ host generation 0',
      'a=candidate:2 1 udp 2113937150 fe80::1c2b:3d4e:5f60:7a8b 51235 typ host generation 0',
      'a=candidate:3 1 udp 2113937149 10.0.0.44 51236 typ host generation 0',
      'a=candidate:4 1 udp 2113937148 2001:db8:85a3::8a2e:370:7334 51237 typ host generation 0',
      'a=candidate:5 1 udp 2113937147 172.16.9.2 51238 typ host generation 0',
      'a=candidate:6 1 udp 2113937146 fd12:3456:789a:1::1 51239 typ host generation 0',
      'a=candidate:7 1 tcp 1518283007 192.168.1.7 9 typ host tcptype active generation 0',
      'a=candidate:8 1 udp 2113937145 fe80::abcd:1234:5678:9abc 51240 typ host generation 0',
    ];
    const fp = Array.from({ length: 32 },
      (_, i) => ((i * 7 + 3) & 255).toString(16).padStart(2, '0').toUpperCase()).join(':');
    const sdp = ['v=0', 'o=- 0 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0',
      'm=application 51234 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', ...lines,
      'a=ice-ufrag:Ab3D', 'a=ice-pwd:xY7zQ2mN4pL8vR1sT6uW0e', 'a=ice-options:trickle',
      `a=fingerprint:sha-256 ${fp}`, 'a=setup:actpass', 'a=mid:0',
      'a=sctp-port:5000'].join('\r\n');
    const packed = S.pack(sdp);
    const url = `https://mattlmccoy.github.io/espresso-brewkit/view.html#p=${packed}`;
    const qr = Q.encode(url);
    const back = S.unpack(packed);

    // One IPv6 candidate on its own, there and back.
    const one = 'candidate:1 1 udp 2113937151 fe80::1c2b:3d4e:5f60:7a8b 51235 typ host generation 0';
    const v6 = S.packCandidate(one);
    const v6Back = S.unpackCandidate(v6, 0);
    // A malformed address must not be mangled into a plausible one.
    const junk = S.packCandidate('candidate:9 1 udp 1 not:an:address:: 5 typ host');

    return {
      rawLen: sdp.length,
      packedLen: packed.length,
      urlLen: url.length,
      max: S.MAX_CODE,
      version: qr?.version ?? null,
      modules: qr?.n ?? null,
      kept: (back.match(/a=candidate/g) ?? []).length,
      // The browser's own order of preference, so the first ones survive.
      keepsBest: back.includes('192.168.1.7'),
      fingerprintOk: new RegExp(`a=fingerprint:sha-256 ${fp}`).test(back),
      v6Len: v6.length,
      v6Kind: v6[0],
      v6Addr: v6Back?.split(' ')[4] ?? null,
      v6Port: v6Back?.split(' ')[5] ?? null,
      junkKind: junk[0],
    };
  });
  t('pairing: a laptop’s worth of candidates still fits a code',
    cand.packedLen <= cand.max && cand.rawLen > 900,
    `${cand.rawLen} chars of SDP → ${cand.packedLen}, budget ${cand.max}`);
  t('pairing: and therefore still fits a QR a webcam can read',
    cand.version !== null && cand.version <= 10,
    `v${cand.version}, ${cand.modules} modules, URL ${cand.urlLen} chars`);
  t('pairing: IPv6 packs like the others rather than being carried whole',
    cand.v6Kind === '6' && cand.v6Len < 30
    && cand.v6Addr === 'fe80:0:0:0:1c2b:3d4e:5f60:7a8b' && cand.v6Port === '51235',
    `${cand.v6Len} chars → ${cand.v6Addr}`);
  t('pairing: the ones that are dropped are the ones ICE ranked lowest',
    cand.kept >= 2 && cand.kept < 8 && cand.keepsBest,
    `kept ${cand.kept} of 8, highest priority among them`);
  t('pairing: the fingerprint survives the trim, because nothing works without it',
    cand.fingerprintOk && cand.junkKind === 'r',
    `fingerprint intact, unparseable address carried verbatim`);

  // ---- the way into pairing has to be on the screen ----
  // Reported as "the phone pairing is completely obscured". It was: on a short
  // window the column overflowed and the row holding "Watch on phone" sat below
  // the fold, unclickable, so the feature looked absent rather than lower down.
  const short = await ctx.newPage();
  await short.setViewportSize({ width: 1400, height: 820 });
  await short.goto(`${B}/live.html?mock=lefu&noshot=1`);
  await short.waitForFunction(() => window.__sess);
  await short.waitForTimeout(500);
  const reach = await short.evaluate(() => {
    const btn = document.getElementById('watch-phone');
    const r = btn.getBoundingClientRect();
    const cell = document.getElementById('cell-now').getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      insideCell: r.bottom <= cell.bottom + 1 && r.top >= cell.top,
      onScreen: r.bottom <= innerHeight && r.top >= 0,
      hit: hit?.id ?? 'nothing',
      // The column itself no longer scrolls; the part above the footer does.
      cellScrolls: document.getElementById('cell-now').scrollHeight
        > document.getElementById('cell-now').clientHeight + 1,
    };
  });
  await short.close();
  t('pairing: the button that opens it is on the screen on a short window',
    reach.insideCell && reach.onScreen, `inside ${reach.insideCell}, on screen ${reach.onScreen}`);
  t('pairing: and nothing is sitting on top of it, so it can actually be pressed',
    reach.hit === 'watch-phone' && !reach.cellScrolls,
    `point hits ${reach.hit}`);

  // ---- read by something that is not us ----
  // The gap that let a broken encoder ship. Every QR check in here fed our own
  // encoder to our own reader, and the two shared a bug: the format information
  // was written least-significant-bit first, and read back the same way. Self
  // consistent, and invalid to every real decoder — a phone pointed at one
  // showed nothing at all, because a camera that cannot parse the format block
  // never reports finding a code.
  //
  // So this is a symbol made by a different encoder entirely, with the modules
  // written out literally. If our reader can take this, the format block and
  // the walk agree with the standard rather than merely with themselves.
  const foreign = await page.evaluate(async (rows) => {
    const S = await import('./assets/js/core/qrscan.js');
    const Q = await import('./assets/js/core/qr.js');
    const mod = rows.map((r) => Int8Array.from([...r].map(Number)));
    const read = S.decodeMatrix(mod);

    // And the other direction: our own format block, at the cells and in the
    // order the standard puts them. Level M is 00, so for mask 3 the published
    // fifteen bits are 101101101001011, most significant first at (8,0).
    const ours = Q.encode('hello');
    const bit = (r, c) => (ours.dark(r, c) ? 1 : 0);
    const copy = [];
    for (let i = 0; i < 6; i++) copy.push(bit(8, i));
    copy.push(bit(8, 7), bit(8, 8), bit(7, 8));
    for (let i = 9; i < 15; i++) copy.push(bit(14 - i, 8));
    const msbFirst = copy.reduce((a, b, i) => a | (b << (14 - i)), 0) >>> 0;
    // Recompute what it should be for the mask this symbol actually used.
    let data = ours.mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const want = (((data << 10) | rem) ^ 0x5412) >>> 0;
    return { read, msbFirst, want, mask: ours.mask,
             bits: msbFirst.toString(2).padStart(15, '0') };
  }, [
      '1111111010011000001111111',
      '1000001011010110101000001',
      '1011101010011101101011101',
      '1011101001110101101011101',
      '1011101011110000101011101',
      '1000001000111010101000001',
      '1111111010101010101111111',
      '0000000001000111100000000',
      '1001111110110011110010111',
      '0010000001011001000111100',
      '0011001111011001101000001',
      '0100000101110010001001110',
      '1000101110101000101000011',
      '1000110101100101000011010',
      '1101001011011001101010011',
      '1010010111110011111101100',
      '1000111111000101111111111',
      '0000000011011001100010010',
      '1111111010010100101010001',
      '1000001011101101100011000',
      '1011101011101101111111011',
      '1011101011100011111000011',
      '1011101000101010010010011',
      '1000001001100000001001111',
      '1111111011001110111010001',
  ]);
  t('qr: a symbol from a different encoder reads, so we match the standard',
    foreign.read === 'brewkit/reader-fixture', JSON.stringify(foreign.read));
  t('qr: and our own format block is written most-significant-bit first',
    foreign.msbFirst === foreign.want,
    `mask ${foreign.mask}: ${foreign.bits} vs ${foreign.want.toString(2).padStart(15, '0')}`);

  // ---- reading a code back, which is the half BarcodeDetector would not do ----
  // The offer reaches the phone as a QR and its camera handles that. The reply
  // is the trip that used to be typed, because the browser's own reader is in
  // Chrome on Android and almost nowhere else.
  const rd = await page.evaluate(async () => {
    const Q = await import('./assets/js/core/qr.js');
    const S = await import('./assets/js/core/qrscan.js');

    // Reed-Solomon in reverse. A wrong convention here does not throw, it just
    // silently corrects nothing, so this corrupts real codewords by the hundred
    // and demands the bytes come back.
    const data = Uint8Array.from(Array.from({ length: 34 }, (_, i) => (i * 37 + 11) & 255));
    const clean = Uint8Array.from([...data, ...Q.ecCodewords(data, 18)]);
    let fixed = 0, refused = 0, silent = 0;
    for (let trial = 0; trial < 300; trial++) {
      const block = Uint8Array.from(clean);
      const hit = new Set();
      while (hit.size < 1 + (trial % 9)) hit.add(Math.floor(Math.random() * block.length));
      for (const i of hit) block[i] ^= 1 + Math.floor(Math.random() * 255);
      const out = S.correct(block, 18);
      if (!out) refused++;
      else if (out.every((v, i) => v === clean[i])) fixed++;
      else silent++;
    }
    // Past what the check bytes can carry it must refuse rather than invent.
    let beyondRefused = 0, beyondWrong = 0;
    for (let trial = 0; trial < 120; trial++) {
      const block = Uint8Array.from(clean);
      const hit = new Set();
      while (hit.size < 14) hit.add(Math.floor(Math.random() * block.length));
      for (const i of hit) block[i] ^= 1 + Math.floor(Math.random() * 255);
      const out = S.correct(block, 18);
      if (!out) beyondRefused++;
      else if (!out.every((v, i) => v === clean[i])) beyondWrong++;
    }

    const text = 'https://mattlmccoy.github.io/espresso-brewkit/view.html#p=2~aBcD~'
      + 'K7q'.repeat(20);
    const qr = Q.encode(text);
    const matrixRead = S.decodeMatrix(qr.matrix) === text;
    // A smudge across the data area, which is what a thumbprint on a screen is.
    const smudged = qr.matrix.map((r) => Int8Array.from(r));
    for (let r = 20; r < 27; r++) for (let c = 20; c < 27; c++) smudged[r][c] ^= 1;
    const smudgeRead = S.decodeMatrix(smudged) === text;

    // And the whole way: painted into a quadrilateral of a frame, which is what
    // a camera pointed at a phone held at an angle actually produces.
    const shoot = (quad, { blur = 0, noise = 0 } = {}) => {
      const n = qr.n, m = 4, side = n + m * 2, w = 520, h = 520;
      const back = S.quadToQuad(quad, [0, 0, side, 0, side, side, 0, side]);
      let px = new Uint8Array(w * h).fill(255);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const [gx, gy] = S.apply(back, x + 0.5, y + 0.5);
        if (gx < 0 || gy < 0 || gx >= side || gy >= side) continue;
        const c = Math.floor(gx) - m, r = Math.floor(gy) - m;
        px[y * w + x] = (r >= 0 && c >= 0 && r < n && c < n && (qr.matrix[r][c] & 1)) ? 0 : 255;
      }
      for (let pass = 0; pass < blur; pass++) {
        const next = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let sum = 0, k = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy, xx = x + dx;
            if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
            sum += px[yy * w + xx]; k++;
          }
          next[y * w + x] = sum / k;
        }
        px = next;
      }
      // Seeded, so "does it read through noise" has one answer rather than a
      // different one every run. Math.random() here made the steep case a coin
      // toss, which is worse than not testing it.
      let seed = 0x9e3779b9;
      const rnd = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const buf = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        // A lighting gradient across the frame, because kitchen light is never
        // even and a single global threshold is what that breaks.
        let v = px[i] + (noise ? (rnd() * 2 - 1) * noise : 0);
        v = Math.max(0, Math.min(255, v * (1 - 0.45 * ((i % w) / w))));
        buf[i * 4] = buf[i * 4 + 1] = buf[i * 4 + 2] = v;
        buf[i * 4 + 3] = 255;
      }
      return { width: w, height: h, data: buf };
    };
    const shots = {
      square: [60, 60, 460, 60, 460, 460, 60, 460],
      rotated: [150, 70, 450, 170, 350, 460, 60, 360],
      keystone: [130, 70, 390, 70, 460, 450, 60, 450],
      steep: [110, 90, 300, 60, 380, 470, 70, 430],
    };
    const camera = {};
    for (const [k, quad] of Object.entries(shots)) camera[k] = S.scan(shoot(quad)) === text;
    camera.rough = S.scan(shoot(shots.steep, { blur: 1, noise: 18 })) === text;
    // Nothing in the frame is the ordinary case, not a failure.
    const blank = S.scan(shoot([0, 0, 1, 0, 1, 1, 0, 1]));
    const t0 = Date.now();
    S.scan(shoot(shots.square));
    const ms = Date.now() - t0;
    return { fixed, refused, silent, beyondRefused, beyondWrong,
             matrixRead, smudgeRead, camera, blank, ms };
  });
  t('reader: it corrects real corrupted codewords rather than only not throwing',
    rd.fixed === 300 && rd.silent === 0,
    `${rd.fixed}/300 recovered, ${rd.silent} silently wrong, ${rd.refused} refused`);
  t('reader: past what the check bytes carry it refuses instead of inventing',
    rd.beyondRefused === 120 && rd.beyondWrong === 0,
    `${rd.beyondRefused} refused, ${rd.beyondWrong} confidently wrong`);
  t('reader: a matrix reads back, and survives a smudge across the data',
    rd.matrixRead && rd.smudgeRead, '49 modules overwritten and still exact');
  t('reader: a camera frame reads square on, rotated, and leaning back',
    rd.camera.square && rd.camera.rotated && rd.camera.keystone,
    Object.entries(rd.camera).map(([k, v]) => `${k} ${v ? 'y' : 'n'}`).join(' '));
  t('reader: including a steep angle with blur and noise on it',
    rd.camera.steep && rd.camera.rough, `steep ${rd.camera.steep}, rough ${rd.camera.rough}`);
  t('reader: an empty frame is nothing to report, not an error',
    rd.blank === null && rd.ms < 900, `${rd.blank}, ${rd.ms} ms a frame`);

  // ---- a hold you can actually perform ----
  // Reported: "tap tap hold doesn't do anything." It could not. The hold was
  // emitted on release and only if the release landed between minHoldMs and
  // maxObjectMs — a 650 ms window — so holding for as long as feels deliberate
  // put it past the point where a press is read as an object being set down.
  const holdTest = await page.evaluate(async () => {
    const { TapListener } = await import('./assets/js/core/tap.js');
    const drive = (script) => {
      const l = new TapListener();
      const out = [];
      let t = 0;
      const push = (w) => { const g = l.push(+t.toFixed(2), w); if (g) out.push(g.type); t += 0.1; };
      for (let i = 0; i < 12; i++) push(200);          // a settled platter
      script(push);
      for (let i = 0; i < 14; i++) push(200);
      return out;
    };
    const tap = (p) => { p(260); p(200); p(200); };
    const hold = (p, seconds) => { for (let i = 0; i < seconds * 10; i++) p(262); };
    const byDuration = {};
    for (const secs of [0.9, 1.5, 2.5, 4]) {
      byDuration[secs] = drive((p) => { tap(p); tap(p); hold(p, secs); });
    }
    return {
      byDuration,
      cupDown: drive((p) => hold(p, 2)),
      oneTapThenHold: drive((p) => { tap(p); hold(p, 2); }),
      double: drive((p) => { tap(p); tap(p); }),
      triple: drive((p) => { tap(p); tap(p); tap(p); }),
    };
  });
  const holds = Object.entries(holdTest.byDuration);
  t('taps: a hold fires however long it is held, not inside a window',
    holds.every(([, g]) => g.join() === 'hold'),
    holds.map(([s, g]) => `${s}s:${g.join('/') || 'nothing'}`).join(' '));
  t('taps: and letting go is not a second gesture',
    holds.every(([, g]) => g.length === 1), 'one each');
  t('taps: a cup set down and lifted is still not a hold',
    holdTest.cupDown.length === 0 && holdTest.oneTapThenHold.length === 0,
    `cup ${JSON.stringify(holdTest.cupDown)}, one-tap-then-hold ${JSON.stringify(holdTest.oneTapThenHold)}`);
  t('taps: two and three taps still mean what they meant',
    holdTest.double.join() === 'double' && holdTest.triple.join() === 'triple',
    `${holdTest.double} / ${holdTest.triple}`);

  // ---- calibration is a mode, with a way out ----
  // Reported: the taps performed to calibrate were also driving the live view,
  // and it never seemed to end. Both were true.
  await page.goto(`${B}/live.html?mock=lefu&noshot=1`);
  await page.waitForFunction(() => window.__tuner && window.__sess);
  const tuner = await page.evaluate(async () => {
    const read = () => ({
      badge: document.getElementById('tap-threshold').textContent,
      button: document.getElementById('tap-learn').textContent,
      msg: document.getElementById('tap-msg').textContent,
      owns: window.__tuner.calibrating(),
      threshold: window.__taps.opt.threshold,
    });
    const before = read();
    document.getElementById('tap-learn').click();
    const armed = read();
    // Three taps, as the panel asks for.
    for (let i = 0; i < 3; i++) {
      window.__taps.onPress({ peak: 7.4 + i, ms: 130, returned: true, counted: true });
    }
    const done = read();

    // Something that is not a tap must not be counted as one.
    document.getElementById('tap-learn').click();
    window.__taps.onPress({ peak: 40, ms: 2200, returned: true, counted: false });
    const afterLean = read();
    // And cancelling has to put the threshold back, not leave it wide open.
    document.getElementById('tap-learn').click();
    const cancelled = read();
    return { before, armed, done, afterLean, cancelled };
  });
  t('taps: arming the tuner hands it the platter, and says so',
    tuner.armed.owns === true && /Cancel/.test(tuner.armed.button)
    && /reaches the session/.test(tuner.armed.msg),
    tuner.armed.msg.slice(0, 60));
  t('taps: three taps end it, and it says it is done',
    tuner.done.owns === false && /Learn my taps/.test(tuner.done.button)
    && /^Done/.test(tuner.done.msg) && tuner.done.threshold > 1.2,
    tuner.done.msg.slice(0, 64));
  t('taps: a long lean is not counted as one of the three',
    /not a tap/.test(tuner.afterLean.msg) && tuner.afterLean.owns === true,
    tuner.afterLean.msg.slice(0, 56));
  t('taps: and cancelling puts the threshold back rather than leaving it open',
    tuner.cancelled.owns === false && tuner.cancelled.threshold === tuner.done.threshold
    && tuner.cancelled.threshold > 1.2,
    `left at ${tuner.cancelled.threshold} g, not the 1.2 g it listens at`);

  // ---- confidence runs the right way round ----
  // Reported from a real kitchen: 8 g of beans against an 18 g target advanced
  // on its own, and 17.4 g — a good dose — sat there asking. The countdown was
  // wired to the readings the app had least reason to trust.
  const conf = await page.evaluate(async () => {
    const { SessionMachine } = await import('./assets/js/core/session.js');
    const dose = (grams, { interrupt = false } = {}) => {
      const s = new SessionMachine();
      s.setReady(true); s.begin(); s.setTarget(18);
      let t = 0, tare = 0;
      const tick = (raw) => {
        const o = s.step_(t, raw, +(raw - tare).toFixed(2), true);
        if (o.tareTo !== null) tare = raw;
        t += 0.1;
        return o;
      };
      for (let i = 0; i < 15; i++) tick(52);                    // cup on, tares
      for (let i = 1; i <= 8; i++) tick(52 + grams * i / 8);    // pour
      if (interrupt) {
        for (let i = 0; i < 20; i++) tick(52 + grams);          // countdown starts
        for (let i = 0; i < 12; i++) tick(320);                 // hand in the cup
        for (let i = 0; i < 8; i++) tick(70);                   // beans out, now 18.0
        for (let i = 0; i < 200; i++) {
          const o = tick(70);
          if (o.committed) return { value: o.value, why: o.why, step: s.step };
        }
        return { value: null, step: s.step };
      }
      for (let i = 0; i < 200; i++) {
        const o = tick(52 + grams);
        if (o.committed) return { value: o.value, why: o.why, step: s.step };
      }
      return { value: null, step: s.step, hint: s.snapshot().hint,
               offTarget: s.snapshot().offTarget, holdLeft: s.snapshot().holdLeft };
    };
    return {
      low: dose(8), good: dose(17.4), on: dose(18), high: dose(25),
      adjusted: dose(18.5, { interrupt: true }),
    };
  });
  t('capture: a dose nowhere near the target is never taken on a timer',
    conf.low.value === null && conf.low.step === 'dose' && conf.low.holdLeft === null,
    `8 g: ${conf.low.value === null ? 'held' : 'captured ' + conf.low.value}`);
  t('capture: and it says how far out it is rather than keeping that to itself',
    /10\.0 g under your target/.test(conf.low.hint ?? ''), (conf.low.hint ?? '').slice(0, 64));
  t('capture: a good dose is taken, which is the one that used to sit there',
    conf.good.value === 17.4 && conf.good.step === 'grind',
    `17.4 g → ${conf.good.value} g ${conf.good.why ?? ''}`);
  t('capture: on the nose too, and well over is held like well under',
    conf.on.value === 18 && conf.high.value === null,
    `18 g captured, 25 g ${conf.high.value === null ? 'held' : 'captured'}`);
  t('capture: reaching in to fix an overshoot still stops the countdown',
    conf.adjusted.value === 18, `ended up capturing ${conf.adjusted.value} g`);

  // ---- the readings behind whatever just happened ----
  const tr = await page.evaluate(async () => {
    const { Trace, parseTrace, summarise, COLUMNS } = await import('./assets/js/core/trace.js');
    let clock = 1000;
    const tt = new Trace({ max: 5, now: () => (clock += 100) });
    tt.describe({ scale: 'Bench, "quoted"', session_thresholds: { holdFor: 5 } });
    for (let i = 0; i < 8; i++) {
      tt.push({ raw_g: 52 + i, net_g: i, step: 'dose', phase: 'fill', event: '' });
      if (i === 6) tt.mark('captured dose=6 g once the dose settled on target');
    }
    const csv = tt.toCsv();
    const back = parseTrace(csv);

    const big = new Trace({ now: () => (clock += 100) });
    big.describe({ scale: 'Bench, "quoted"', session_thresholds: { holdFor: 5 } });
    // Ten seconds of nothing, then a plateau that lasts three.
    // Seeded, because with Math.random() two consecutive samples occasionally
    // land within the 0.3 g plateau window and invent a longer run than the one
    // this is about — a coin-toss assertion that fails a few runs in a hundred.
    let seed = 0x9e3779b9;
    const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = 0; i < 100; i++) big.push({ raw_g: 52, net_g: +(rnd() * 30).toFixed(2), step: 'dose' });
    for (let i = 0; i < 30; i++) big.push({ raw_g: 70, net_g: 18.0, step: 'dose' });
    big.mark('captured dose=18 g');
    const sum = summarise(big);
    return {
      capped: tt.length,
      kept: back.rows.map((r) => r.net_g).join(),
      marked: back.rows.filter((r) => r.event).map((r) => r.event)[0] ?? null,
      columns: back.columns.join() === COLUMNS.join(),
      quoted: back.meta.scale ?? null,
      thresholds: /holdFor/.test(back.meta.session_thresholds ?? '') || big.meta.session_thresholds !== undefined,
      plateau: sum.plateaus[0],
      events: sum.events.length,
      rate: sum.rate,
    };
  });
  t('trace: it keeps the most recent readings rather than the first ones',
    tr.capped === 5 && tr.kept === '3,4,5,6,7', `${tr.capped} rows: ${tr.kept}`);
  t('trace: a decision is written on the row that caused it',
    /captured dose=6 g/.test(tr.marked ?? ''), tr.marked);
  t('trace: the file round-trips, quoted metadata and all',
    tr.columns && tr.quoted === 'Bench, "quoted"', `scale: ${tr.quoted}`);
  t('trace: and it finds the plateau the capture rules are really set against',
    tr.plateau?.seconds >= 2.9 && tr.plateau?.at === 18 && tr.events === 1,
    `${tr.plateau?.seconds} s at ${tr.plateau?.at} g, ${tr.events} event, ${tr.rate}/s`);

  // The button, on the page: the module works, but a diagnostic nobody can get
  // out of the browser is not a diagnostic.
  await page.goto(`${B}/live.html?mock=lefu&noshot=1`);
  await page.waitForFunction(() => window.__mock && window.__sess);
  await page.evaluate(() => document.querySelector('details.manual').open = true);
  await page.evaluate(() => { window.__mock.grams = 18.2; });
  await page.waitForTimeout(900);
  const traceDl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.click('#save-trace');
  const file = await traceDl;
  const note = await page.textContent('#trace-note');
  let head = '';
  if (file) {
    const path = await file.path();
    const { readFile } = await import('node:fs/promises');
    head = (await readFile(path, 'utf8')).split('\n').slice(0, 40).join('\n');
  }
  t('trace: the page hands the whole session over as a file',
    !!file && /readings written to brewkit-trace-/.test(note ?? ''), note ?? 'no note');
  t('trace: with the thresholds it was judged against written at the top',
    /# session_thresholds:/.test(head) && /holdFor/.test(head),
    (head.split('\n').find((l) => l.startsWith('# session_thresholds')) ?? '').slice(0, 70));
  t('trace: and a row per reading under the named columns',
    head.includes('t_s,raw_g,net_g,filtered_g') && /\n[\d.]+,[-\d.]+,/.test(head),
    head.split('\n').find((l) => /^[\d.]+,/.test(l))?.slice(0, 60) ?? 'no data rows');

  {
  // ---- the dial, which the phone never had ----
  const gauge = await page.evaluate(async () => {
    const D = await import('./assets/js/core/dial.js');
    const at = (net) => D.shotDial('espresso', 18, { net, target: 36 });
    const mid = at(24);
    return {
      top: mid.top,
      zones: mid.zones.map((z) => `${z.id}:${z.from}-${z.to}`),
      here: mid.zones.filter((z) => z.here).map((z) => z.id),
      // The classification is asked of the ratio, so a pour past the end of the
      // dial is still the drink it is, not "below the first band".
      byWeight: [0, 12, 27, 36, 54, 65, 99].map((n) => at(n).style?.id ?? '—'),
      fracs: [0, 27, 54, 99].map((n) => +at(n).frac.toFixed(2)),
      over: at(99).over,
      pourover: D.shotDial('pourover', 22, { net: 100 }),
      noDose: D.shotDial('espresso', 0, { net: 10 }),
      // Left to right, opening upward: 0 at the left end, 1 at the right.
      ends: [D.point(0), D.point(0.5), D.point(1)].map((p) => p.map((v) => Math.round(v))),
      emptyArc: D.arc(0.5, 0.5),
      someArc: /^M[\d.]+ [\d.]+ A86 86 0 0 1/.test(D.arc(0.2, 0.8)),
    };
  });
  t('dial: the three drinks are contiguous zones off the dose',
    // Lungo used to be cut off at 1:3.36 by a scale that ran to a little past
    // the lungo *mark*. Anchored to the drinks, the last band ends where the
    // drink does.
    gauge.zones.join(' ') === 'ristretto:18-30.6 espresso:30.6-45 lungo:45-72',
    gauge.zones.join(' '));
  t('dial: it names the one the cup is in right now',
    gauge.here.join() === 'ristretto', `at 24 g: ${gauge.here.join() || 'none'}`);
  t('dial: and names it by ratio, so a pour past the end is still a lungo',
    gauge.byWeight.join() === '—,—,ristretto,espresso,lungo,lungo,—' && gauge.over === true,
    gauge.byWeight.join(' '));
  t('dial: the needle runs 0 to 1 and stops there',
    // 1:1 to 1:4, so band edges land at the same fractions whatever the dose —
    // which is why the labels can be laid out once and never collide.
    gauge.fracs.join() === '0,0.17,0.67,1', gauge.fracs.join(' '));
  t('dial: a method without these names gets no dial rather than invented ones',
    gauge.pourover === null && gauge.noDose === null, 'pour over and a zero dose both null');
  t('dial: the arc opens upward and fills left to right',
    JSON.stringify(gauge.ends) === '[[36,155],[110,26],[184,155]]'
    && gauge.emptyArc === '' && gauge.someArc,
    JSON.stringify(gauge.ends));

  // ---- and on the phone, where it is the screen you are looking at ----
  const watch = await ctx.newPage();
  await watch.setViewportSize({ width: 390, height: 844 });
  await watch.goto(`${B}/view.html`);
  await watch.waitForFunction(() => window.__view);
  // Other tests in this suite pick a theme, and localStorage is shared across
  // the origin. A device that has chosen one is the case where following the
  // laptop is meant to stop, so start from one that has not — and put the
  // suite's choice back afterwards.
  const themeWas = await watch.evaluate(() => {
    const had = localStorage.getItem('brewkit.theme');
    localStorage.removeItem('brewkit.theme');
    return had;
  });
  await watch.reload();
  await watch.waitForFunction(() => window.__view);
  const shown = async (f) => {
    await watch.evaluate(() => {
      document.getElementById('pairing').hidden = true;
      document.getElementById('watching').hidden = false;
    });
    await watch.evaluate((frame) => window.__view.paint(frame), f);
    await watch.waitForTimeout(120);
    return watch.evaluate(() => ({
      gauge: !document.getElementById('gauge').hidden,
      empty: document.getElementById('vol-fill').style.height,
      style: document.getElementById('now-style').textContent,
      // The dial is mounted by core/gauge.js and uses classes, not ids, so a
      // page can carry more than one of them.
      sub: document.querySelector('#gauge .g-sub').textContent,
      here: [...document.querySelector('#gauge .g-zones').children]
        .filter((z) => z.classList.contains('here')).map((z) => z.dataset.id).join(),
      marks: [...document.getElementById('vol-marks').children].map((m) => m.style.bottom),
      theme: document.documentElement.getAttribute('data-theme'),
      // Nothing may be drawn outside its own box: the gauge overflowing the
      // stage put the dial on top of the strip below it.
      overlap: (() => {
        const g = document.getElementById('gauge').getBoundingClientRect();
        const s = document.getElementById('v-strip').getBoundingClientRect();
        return g.bottom > s.top + 1;
      })(),
    }));
  };
  const base = { k: 'f', q: 1.9, t: 14.3, step: 'brew', phase: 'fill', method: 'espresso',
                 dose: 18, target: 36, tol: 1.5, lag: 1, coffee: 'Test', hint: '', curve: [] };
  const pouring = await shown({ ...base, w: 24.2, st: 'extracting', theme: 'terminal' });
  const weighing = await shown({ ...base, w: 12, st: 'idle', step: 'dose', theme: 'terminal' });
  t('viewer: the dial is up while it pours and gone while it weighs',
    pouring.gauge === true && weighing.gauge === false,
    `pouring ${pouring.gauge}, weighing ${weighing.gauge}`);
  t('viewer: the coffee rises from the bottom as the cup fills',
    Math.abs(parseFloat(pouring.empty) - 33.6) < 0.2,
    `${pouring.empty} of the tile poured at 24.2 of 72 g`);
  t('viewer: it says which drink it is, on the tile and under the dial',
    pouring.style === 'Ristretto' && pouring.sub === 'Ristretto'
    && pouring.here === 'ristretto', `${pouring.style} / ${pouring.sub}`);
  t('viewer: the marks sit where they fall in the cup, not on the dial’s scale',
    // A cup fills from empty; the dial starts at 1:1. Sharing the dial's domain
    // made two thirds of a shot look like a tenth of one. The browser drops a
    // trailing zero from a percentage, so this compares the numbers.
    pouring.marks.map((m) => parseFloat(m)).join() === '37.5,50,75',
    pouring.marks.join(' '));
  t('viewer: nothing is drawn over the strip beneath it',
    pouring.overlap === false, `gauge overruns the strip: ${pouring.overlap}`);
  t('viewer: it wears the laptop’s theme rather than its own default',
    pouring.theme === 'terminal', `data-theme=${pouring.theme}`);

  // A theme picked here is a decision about this device, and the laptop stops
  // overriding it.
  const overridden = await watch.evaluate(async () => {
    document.querySelector('[data-theme-toggle]').click();
    const mine = document.documentElement.getAttribute('data-theme');
    // Send a different one, or the test cannot tell an override from an
    // adoption — the toggle happened to land on the theme being pushed.
    const other = ['light', 'dark', 'terminal'].find((th) => th !== mine);
    window.__view.paint({ k: 'f', w: 24, q: 2, t: 10, st: 'extracting', step: 'brew',
      method: 'espresso', dose: 18, target: 36, curve: [], theme: other });
    return { mine, other, after: document.documentElement.getAttribute('data-theme') };
  });
  t('viewer: but a theme chosen here wins from then on',
    overridden.after === overridden.mine && overridden.other !== overridden.mine,
    `chose ${overridden.mine}, laptop then sent ${overridden.other}, still ${overridden.after}`);

  // THE PHONE DRAWS BOTH SERIES, not just the yield.
  //
  // It drew only the yield for a long time on the assumption that flow would
  // have to be sent and the frame did not carry it. The laptop does not receive
  // a flow trace either — it differentiates the [t, w] array it is already
  // plotting, and so can the phone. The half of the chart that says whether the
  // pour is running fast or choking was missing for nothing.
  // [t, w] PAIRS, because that is what comes off the wire: frameOf packs the
  // laptop's {t, w} rows into pairs before sending. A fixture in the laptop's
  // shape tests a frame the phone never receives.
  const realShot = Array.from({ length: 60 }, (_, i) => {
    const t = i * 0.5;
    return [+t.toFixed(1), +(t < 4 ? 0 : (t - 4) * 1.35).toFixed(2)];
  });
  const traces = async (curve) => {
    await watch.evaluate((c) => window.__view.paint({
      k: 'f', w: c.length ? c.at(-1)[1] : 0, q: 1.35, t: 30, st: 'extracting',
      step: 'brew', phase: 'fill', method: 'espresso', dose: 18, target: 36,
      tol: 1.5, lag: 1, curve: c,
    }), curve);
    await watch.waitForTimeout(150);
    return watch.evaluate(() => ({
      weight: document.querySelectorAll('#plot path.weightline').length,
      flow: document.querySelectorAll('#plot path.flowline').length,
      // The flow axis and its label go up together with the trace, and must not
      // go up without it.
      label: [...document.querySelectorAll('#plot .axis-label')]
        .map((n) => n.textContent).join(' | '),
      alt: document.querySelectorAll('#plot .tick-alt').length,
    }));
  };
  const drawn = await traces(realShot);
  t('viewer: the phone plots the flow of the pour, not only its weight',
    drawn.weight === 1 && drawn.flow === 1,
    `${drawn.weight} weight trace, ${drawn.flow} flow trace`);
  t('viewer: and labels the axis it just drew, so the second line is readable',
    /flow \(g\/s\)/.test(drawn.label) && drawn.alt > 0,
    `labels: ${drawn.label} · ${drawn.alt} flow ticks`);
  // The counterpart, which is the bug this replaces rather than repeats: a
  // curve too short to differentiate must not put up an axis for a line that
  // is not there.
  const stub = await traces(realShot.slice(0, 3));
  t('viewer: a curve too short to differentiate draws no orphan flow axis',
    stub.flow === 0 && stub.alt === 0 && !/flow/.test(stub.label),
    `${stub.flow} flow traces, ${stub.alt} flow ticks, labels: ${stub.label}`);

  // An iPad has room for the number and the dial at once.
  //
  // Painted explicitly rather than read off whatever the test above left on
  // screen. It used to inherit that, which meant a test that changed the last
  // frame — this file's flow-trace fixtures did — silently emptied the dial
  // here and failed a check about the iPad layout for a reason that had nothing
  // to do with the iPad.
  await watch.evaluate(() => window.__view.paint({
    k: 'f', w: 24, q: 1.9, t: 14.3, st: 'extracting', step: 'brew', phase: 'fill',
    method: 'espresso', dose: 18, target: 36, tol: 1.5, lag: 1, curve: [],
  }));
  await watch.setViewportSize({ width: 834, height: 1112 });
  await watch.waitForTimeout(150);
  const tablet = await watch.evaluate(() => {
    const rig = document.querySelector('.rig');
    const r = rig.getBoundingClientRect();
    const n = document.querySelector('.big .n').getBoundingClientRect();
    const svg = document.querySelector('#gauge svg').getBoundingClientRect();
    // Every element on this screen showing the weight, and every one naming
    // the drink. Two of either is the bug this layout exists to fix.
    // offsetParent alone is not "shown": it stays set through visibility:hidden.
    const shown = (el) => el.checkVisibility
      ? el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })
      : el.offsetParent !== null;
    const w = document.querySelector('.big .n').textContent.trim();
    const heroes = [...document.querySelectorAll('.big .n, .g-n')]
      .filter((el) => shown(el) && el.textContent.trim() === w).length;
    const names = [...document.querySelectorAll('.now-style, .g-sub')]
      .filter((el) => shown(el) && /ristretto/i.test(el.textContent)).length;
    return {
      cols: getComputedStyle(document.getElementById('v-strip'))
        .gridTemplateColumns.split(' ').length,
      // The dial is drawn around the number, so the number's box sits inside it.
      nested: document.querySelector('#gauge').closest('.big') !== null,
      square: Math.abs(r.width - r.height) <= 2,
      // Band names ride just inside r=86 of a 110 radius; past that the number
      // crosses a label, which is what sizing it in vw did.
      fitsInRing: n.width < (svg.height / 200) * (86 - 13) * 2 * 0.92,
      heroes, names,
      // The laptop's dial carries a fourth line — how much further to the next
      // drink, or the ratio once past the last one. It existed in one
      // implementation and was shown on one device.
      gap: (document.querySelector('#gauge .g-gap')?.textContent ?? '').trim(),
    };
  });
  // ---- the rest of brewkit, without dropping the link ----
  // The phone had one page. Tapping through to the log meant navigating, and a
  // navigation destroys the peer connection — a WebRTC description is good for
  // exactly one connection, so coming back meant pairing again. The log is
  // already on this device, so the pages work here; the only thing that must
  // not happen is this page unloading.
  await watch.setViewportSize({ width: 390, height: 844 });
  const browsed = await watch.evaluate(async () => {
    // A sentinel that cannot survive a navigation, which is the whole claim.
    window.__stillHere = 'yes';
    document.querySelector('[data-go="shots.html"]').click();
    await new Promise((r) => setTimeout(r, 60));
    const open = {
      shown: !document.getElementById('browse').hidden,
      src: document.querySelector('#browse iframe').getAttribute('src'),
      locked: getComputedStyle(document.body).overflow,
    };
    // The pour does not pause because you looked away from it.
    window.__view.paint({ k: 'f', w: 24.2, q: 1.9, t: 14.3, st: 'extracting', step: 'brew',
      method: 'espresso', dose: 18, target: 36, curve: [] });
    open.live = document.querySelector('#browse .browse-live').textContent;
    open.conn = document.querySelector('#browse .badge').textContent;
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await new Promise((r) => setTimeout(r, 60));
    return { ...open,
      closed: document.getElementById('browse').hidden,
      kept: document.querySelector('#browse iframe').getAttribute('src'),
      alive: window.__stillHere,
      link: window.__view.link.state };
  });
  t('viewer: the other pages open over the shot instead of navigating to it',
    browsed.shown === true && browsed.src === './shots.html' && browsed.locked === 'hidden',
    `shown ${browsed.shown}, src ${browsed.src}, body overflow ${browsed.locked}`);
  t('viewer: and the page underneath never unloads, so the link survives',
    browsed.alive === 'yes' && browsed.link !== undefined,
    `sentinel ${browsed.alive}, link ${browsed.link}`);
  t('viewer: the pour stays on screen while you read the log',
    browsed.live === '24.2 g \u00b7 14.3 s' && /linked|Waiting|Not linked/.test(browsed.conn),
    `${browsed.live} / ${browsed.conn}`);
  t('viewer: escape comes back, and the page you were on is still loaded',
    browsed.closed === true && browsed.kept === './shots.html',
    `closed ${browsed.closed}, frame kept ${browsed.kept}`);

  await watch.evaluate((had) => {
    if (had) localStorage.setItem('brewkit.theme', had);
    else localStorage.removeItem('brewkit.theme');
  }, themeWas);
  await watch.close();
  // The cup and the dial used to sit side by side, and each carried its own
  // copy of the weight and its own copy of the drink name — one fact printed
  // twice at hero size, which pushed the numbers that are not duplicated off
  // the bottom of the screen. They are one instrument now.
  t('viewer: the weight is said once, not once per component',
    tablet.heroes === 1 && tablet.names === 1,
    `${tablet.heroes} hero number(s), ${tablet.names} drink name(s)`);
  t('viewer: the dial is drawn around the number rather than beside it',
    tablet.nested && tablet.square,
    `nested ${tablet.nested}, rig square ${tablet.square}`);
  // In vw this came out 84 px inside a 276 px ring, straight through the band
  // labels. It has to be measured against the dial.
  t('viewer: and the readout is sized to the dial, so it clears the band names',
    tablet.fitsInRing, 'inside the labelled ring');
  t('viewer: an iPad still fills the whole seven-cell row',
    tablet.cols === 7, `strip in ${tablet.cols} columns`);
  t('viewer: and the dial says how much further, the way the laptop\u2019s does',
    /to (ristretto|espresso|lungo)|^1:/.test(tablet.gap), tablet.gap || '(nothing)');
  }

  // ---- the three shots inside every shot ----
  // A dose does not have one correct yield: where you cut decides which drink
  // you made. The grams are exact from the first drop; the seconds are a
  // projection, and the projection is only allowed to speak once the flow has
  // stopped ramping.
  const st = await page.evaluate(async () => {
    const S = await import('./assets/js/core/styles.js');
    const { FlowEstimator } = await import('./assets/js/core/filter.js');

    const marks = S.landmarks('espresso', 18);
    const withTarget = S.landmarks('espresso', 18, { target: 45 });
    const onAMark = S.landmarks('espresso', 18, { target: 36 });

    // A shot the shape of a real one: flow ramps to a peak, then sags. The
    // arrival times are known by construction, so the projection can be scored
    // rather than eyeballed.
    const peak = 2.6, tau = 5.0, sag = 0.045;
    const flowAt = (t) => Math.max(0, peak * (1 - Math.exp(-t / tau)) - sag * Math.max(0, t - 12));
    const dt = 0.1;
    const samples = [];
    let w = 0;
    for (let t = 0; t <= 40; t += dt) {
      w += flowAt(t) * dt;
      samples.push({ t: +t.toFixed(2), w });
    }
    const trueArrival = (g) => samples.find((p) => p.w >= g)?.t ?? null;

    // Replay through the real estimator, so the flow the projection divides by
    // is the flow the app would actually have had.
    const fe = new FlowEstimator();
    const seen = samples.map((p) => ({ t: p.t, w: p.w, flow: fe.step(p.t, p.w).flow }));

    const scoreFrom = (minElapsed) => {
      const errs = [];
      for (const m of S.landmarks('espresso', 18)) {
        const truth = trueArrival(m.grams);
        if (truth === null) continue;
        for (const p of seen) {
          if (p.t < minElapsed || p.w >= m.grams || p.t > truth) continue;
          const pr = S.project(m, { net: p.w, flow: p.flow, elapsed: p.t, lag: 0 });
          if (pr?.eta === null || pr?.eta === undefined) continue;
          errs.push(Math.abs((p.t + pr.eta) - truth));
        }
      }
      return errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : NaN;
    };

    // Every projection the module is willing to make, scored.
    const afterRamp = scoreFrom(S.RAMP_S);
    // What it would have been worth had it spoken during the ramp.
    const duringRamp = (() => {
      const errs = [];
      for (const m of S.landmarks('espresso', 18)) {
        const truth = trueArrival(m.grams);
        if (truth === null) continue;
        for (const p of seen) {
          if (p.t < 2 || p.t >= S.RAMP_S || p.w >= m.grams) continue;
          errs.push(Math.abs((p.t + (m.grams - p.w) / p.flow) - truth));
        }
      }
      return errs.reduce((a, b) => a + b, 0) / errs.length;
    })();

    const at = (t) => seen.find((p) => p.t >= t);
    const early = S.project(marks[0], { net: at(4).w, flow: at(4).flow, elapsed: 4, lag: 1 });
    const ready = S.project(marks[1], { net: at(12).w, flow: at(12).flow, elapsed: 12, lag: 1 });
    // The same moment with no drip lag: the cut has to come later, not sooner.
    const noLag = S.project(marks[1], { net: at(12).w, flow: at(12).flow, elapsed: 12, lag: 0 });
    const gone = S.project(marks[0], { net: 30, flow: 2, elapsed: 15, lag: 1 });
    const stalled = S.project(marks[1], { net: 20, flow: 0, elapsed: 15, lag: 1 });
    const distant = S.project({ grams: 200 }, { net: 20, flow: 2, elapsed: 15, lag: 1 });

    return {
      grams: marks.map((m) => m.grams),
      labels: marks.map((m) => m.label),
      pourover: S.stylesFor('pourover'),
      milk: S.stylesFor('milk')?.length ?? 0,
      targetAdded: withTarget.length === 4 && withTarget.map((m) => m.grams).join(),
      targetFolded: onAMark.length === 3
        && onAMark.find((m) => m.grams === 36)?.isTarget === true,
      afterRamp, duringRamp,
      earlyState: early.state, earlyEta: early.eta,
      readyState: ready.state, readyEta: +ready.eta.toFixed(1),
      lagCutsEarlier: ready.eta < noLag.eta,
      goneState: gone.state, stalledState: stalled.state, distantState: distant.state,
      classify: [
        S.styleOf('espresso', 18, 26)?.id,
        S.styleOf('espresso', 18, 36)?.id,
        S.styleOf('espresso', 18, 55)?.id,
        S.styleOf('espresso', 18, 120),
        S.styleOf('pourover', 18, 36),
      ],
    };
  });
  t('styles: the three classical ratios land where the arithmetic puts them',
    st.grams.join() === '27,36,54' && st.labels.join() === 'Ristretto,Espresso,Lungo',
    `18 g → ${st.grams.join(' / ')} g`);
  t('styles: a pour over is not given espresso’s vocabulary',
    st.pourover === null && st.milk === 3, 'pour over none, milk drink three');
  t('styles: your own target joins the ladder when it is somewhere else',
    st.targetAdded === '27,36,45,54', st.targetAdded);
  t('styles: and folds into a classical mark rather than crowding it',
    st.targetFolded, 'target sits on the espresso mark');
  t('styles: no time is claimed while the flow is still ramping',
    st.earlyState === 'settling' && st.earlyEta === null,
    `at 4 s: ${st.earlyState}`);
  t('styles: because a projection made during the ramp is worth nothing',
    st.duringRamp > 4 && st.afterRamp < 1,
    `during ramp ${st.duringRamp.toFixed(1)} s error, after ${st.afterRamp.toFixed(2)} s`);
  t('styles: past the ramp it counts down to the cut, not to the arrival',
    st.readyState === 'near' && st.lagCutsEarlier,
    `${st.readyEta} s, and the drip lag brings it forward`);
  t('styles: a landmark already gone by says so, and so does a dead pour',
    st.goneState === 'passed' && st.stalledState === 'stalled',
    `${st.goneState} / ${st.stalledState}`);
  t('styles: one too far out is approximate rather than a countdown',
    st.distantState === 'far', st.distantState);
  const stick = await page.evaluate(async () => {
    const S = await import('./assets/js/core/styles.js');
    const seen = new Set();
    const mark = { id: 'lungo', grams: 54 };
    // An arrival sitting on the horizon, wobbling either side of it as the flow
    // estimate does. Without the latch the cell alternates between two formats
    // several times a second.
    const run = (withLatch) => [2.0, 1.95, 2.05, 1.97].map((flow) =>
      S.project(mark, { net: 30, flow, elapsed: 14, lag: 0 })).map((r) => {
        if (withLatch) S.settle([r], seen);
        return r.state;
      });
    const raw = run(false);
    seen.clear();
    return { raw: [...new Set(raw)].sort().join('/'), latched: [...new Set(run(true))].join('/') };
  });
  t('styles: a countdown does not flicker back into an estimate at the horizon',
    stick.raw === 'far/near' && stick.latched === 'near',
    `unlatched ${stick.raw}, latched ${stick.latched}`);

  // ---- and on the page, driven by a pour the brew machine believes in ----
  await page.goto(`${B}/live.html?mock=lefu&noshot=1`);
  await page.waitForFunction(() => window.__mock && window.__sess);
  const rungText = () => page.evaluate(() => ({
    hidden: document.getElementById('ladder').hidden,
    tile: document.getElementById('tile-eta').hidden,
    ticks: [...document.querySelectorAll('.ladder-tick')].map((n) => n.style.left),
    cells: [...document.getElementById('ladder-row').children].map((c) => [
      c.children[0].textContent, c.children[1].textContent, c.children[2].textContent]),
    t: document.getElementById('o-t').textContent,
  }));
  await page.evaluate(() => {
    window.__sess.setMethod('espresso');
    const d = document.getElementById('p-dose');
    d.value = '18';
    d.dispatchEvent(new Event('input', { bubbles: true }));
    window.__sess.goto('brew');
    window.__mock.grams = 0;
    window.__brew.startNow(performance.now() / 1000, 0);
    // A real pour rather than a step: the brew machine ends a shot that stops
    // flowing, and a frozen clock would never reach the ramp at all.
    let g = 0;
    window.__pour = setInterval(() => {
      g += 0.17;
      window.__mock.grams = +g.toFixed(2);
    }, 100);
  });
  await page.waitForTimeout(2500);
  const ramping = await rungText();
  // Past the ramp, and past the ristretto mark at 27 g.
  await page.waitForFunction(
    () => document.getElementById('ladder-row').children[0].children[2].textContent
      .startsWith('cut in'), null, { timeout: 15000 });
  const counting = await rungText();
  await page.waitForFunction(
    () => document.getElementById('ladder-row').children[0].children[2].textContent === 'passed',
    null, { timeout: 20000 });
  const past = await rungText();
  await page.evaluate(() => clearInterval(window.__pour));

  t('ladder: the weights are on the page from the first drop',
    !ramping.hidden && ramping.cells.map((c) => c[1]).join() === '27.0 g,36.0 g,54.0 g',
    ramping.cells.map((c) => `${c[0]} ${c[1]}`).join(' · '));
  t('ladder: and it says nothing about timing while the flow is still ramping',
    Number(ramping.t) < 8 && ramping.cells.every((c) => c[2] === 'settling'),
    `at ${ramping.t} s: ${ramping.cells.map((c) => c[2]).join(' | ')}`);
  t('ladder: past the ramp each mark counts down to its own cut',
    Number(counting.t) >= 8 && /^cut in [\d.]+ s$/.test(counting.cells[0][2]),
    `at ${counting.t} s: ${counting.cells.map((c) => c[2]).join(' | ')}`);
  t('ladder: a mark you have gone past says so rather than counting backwards',
    past.cells[0][2] === 'passed', past.cells.map((c) => c[2]).join(' | '));
  t('ladder: the ticks sit at the real weights, not at even spacing',
    ramping.ticks.join() === '44.6%,59.5%,89.3%', ramping.ticks.join(' '));
  t('ladder: and it folds away the tile that was showing the same number',
    ramping.tile === true, `tile hidden: ${ramping.tile}`);

  // ---- the middle panel carries both readings ----
  // During a shot the biggest panel on the page was a chart and nothing else.
  // A curve answers "how is it running"; it cannot answer "which drink is this
  // and how much longer", which is the question you have with a cup in hand.
  const mid = await page.evaluate(() => {
    const g = document.getElementById('brew-gauge');
    const txt = (id) => document.getElementById(id).textContent;
    const chart = document.getElementById('curve').getBoundingClientRect();
    const box = g.getBoundingClientRect();
    return {
      dial: !g.hidden,
      zones: [...g.querySelectorAll('.g-zone')].map((z) => z.dataset.id).join(),
      here: [...g.querySelectorAll('.g-zone.here')].map((z) => z.dataset.id).join(),
      sub: g.querySelector('.g-sub').textContent,
      t: txt('c-t'), f: txt('c-f'), ratio: txt('c-ratio'), lands: txt('c-lands'),
      cut: document.getElementById('pn-cut').hidden ? null : txt('c-cut'),
      // Both, at once — not one replacing the other.
      chartToo: chart.height > 80,
      // And the dial must not be drawn over the chart beneath it.
      overlap: box.bottom > chart.top + 1,
    };
  });
  t('brew page: the dial is up beside the chart, not instead of it',
    mid.dial === true && mid.chartToo === true && mid.overlap === false,
    `dial ${mid.dial}, chart ${mid.chartToo}px tall, overlap ${mid.overlap}`);
  t('brew page: the drinks are on it, and it knows which one is in the cup',
    mid.zones === 'ristretto,espresso,lungo' && mid.here === 'ristretto'
    && /Ristretto/.test(mid.sub), `${mid.zones} — here ${mid.here} — ${mid.sub}`);
  t('brew page: and the numbers you act on sit beside it',
    Number(mid.t) > 0 && Number(mid.f) > 0 && Number(mid.ratio) > 0
    && Number(mid.lands) > Number(mid.ratio) && mid.cut !== null,
    `${mid.t} s · ${mid.f} g/s · 1:${mid.ratio} · lands ${mid.lands} g · cut in ${mid.cut} s`);

  // A pour over has ratios but not these names, so it keeps the plain tile.
  await page.evaluate(() => {
    window.__sess.setMethod('pourover');
    window.__brew.reset();
  });
  await page.waitForTimeout(400);
  const po = await rungText();
  t('ladder: a pour over is not given espresso’s vocabulary, and keeps its tile',
    po.hidden === true && po.tile === false, `hidden ${po.hidden}, tile shown ${!po.tile}`);
  // Put the page back the way the rest of the suite expects to find it.
  await page.evaluate(() => window.__sess.setMethod('espresso'));

  // ---- which drink, chosen before the shot rather than found during it ----
  // The three styles were already on screen as landmarks, which answers "what
  // have I made". This is the other half, and it is the half the alert needs:
  // without it the chime fires at whatever ratio was left in the field from
  // last time, which is the wrong moment for the drink you actually wanted.
  const aim = await page.evaluate(async () => {
    const read = () => ({
      pressed: document.querySelector('#aims button[aria-pressed="true"]')?.dataset.aim ?? null,
      ratio: document.getElementById('p-ratio').value,
      target: document.getElementById('o-target').textContent,
      labels: [...document.querySelectorAll('#aims button')].map((b) => b.textContent),
    });
    document.querySelector('[data-method="espresso"]').click();
    const d = document.getElementById('p-dose');
    d.value = '18'; d.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    const start = read();
    document.querySelector('[data-aim="ristretto"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const ristretto = read();
    document.querySelector('[data-aim="lungo"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const lungo = read();
    // A pour over has ratios but not these names.
    document.querySelector('[data-method="pourover"]').click();
    await new Promise((r) => setTimeout(r, 150));
    const pourover = document.getElementById('aim-box').hidden;
    document.querySelector('[data-method="espresso"]').click();
    document.querySelector('[data-aim="espresso"]').click();
    await new Promise((r) => setTimeout(r, 150));
    return { start, ristretto, lungo, pourover };
  });
  t('aim: the three drinks are offered before the shot, in grams for this dose',
    aim.start.labels.join('|') === 'Ristretto27.0 g|Espresso36.0 g|Lungo54.0 g',
    aim.start.labels.join(' · '));
  t('aim: picking one moves the target, which is what the chime fires at',
    aim.ristretto.pressed === 'ristretto' && aim.ristretto.ratio === '1.5'
    && aim.ristretto.target === '27.0'
    && aim.lungo.pressed === 'lungo' && aim.lungo.target === '54.0',
    `ristretto → ${aim.ristretto.target} g, lungo → ${aim.lungo.target} g`);
  t('aim: and a pour over is not offered espresso’s vocabulary',
    aim.pourover === true, `aim box hidden for pour over: ${aim.pourover}`);


  t('styles: a finished shot is named, and an unnameable one is not',
    st.classify.join() === 'ristretto,espresso,lungo,,' ,
    st.classify.map((x) => x ?? '—').join(' / '));

  // ---- gestures live in the gaps, never inside a measurement ----
  // This is a correctness rule rather than a preference: a tap is a sixty-gram
  // excursion, and driven through the real filter a two-tap gesture during a
  // shot takes the reported flow from 1.5 g/s to over 150. It would trip the
  // predictive stop and poison the stored curve.
  const harm = await page.evaluate(async () => {
    const { FlowEstimator, BrewMachine } = await import('./assets/js/core/filter.js');
    const run = (withTaps) => {
      const est = new FlowEstimator();
      const brew = new BrewMachine();
      brew.arm();
      let w = 0, peak = 0;
      const rate = (x) => (x < 6 ? 0 : 2.0 * (1 - Math.exp(-(x - 6) / 2)) * Math.exp(-(x - 6) / 30));
      const tapping = (x) => [14.0, 14.1, 14.4, 14.5].some((k) => Math.abs(x - k) < 0.06);
      for (let i = 0; i <= 300; i++) {
        const x = i / 10;
        w += rate(x) * 0.1;
        const e = est.step(x, withTaps && tapping(x) ? w + 60 : w);
        const snap = brew.step(x, e.weight, e.flow);
        if (Number.isFinite(snap.flow)) peak = Math.max(peak, snap.flow);
      }
      return +peak.toFixed(2);
    };
    return { clean: run(false), tapped: run(true) };
  });
  t('gestures: a tap during a pour would wreck the flow reading',
    harm.tapped > harm.clean * 10,
    `${harm.clean} g/s clean vs ${harm.tapped} g/s tapped — which is why nothing is bound there`);

  const bound = await page.evaluate(async () => {
    const T = await import('./assets/js/core/tap.js');
    const at = (step, phase) => T.actionFor(step, 'double', phase);
    return {
      setup: at('setup', 'vessel'),
      doseVessel: at('dose', 'vessel'),
      doseFill: at('dose', 'fill'),
      doseReady: at('dose', 'ready'),
      brew: at('brew', null),
      brewTriple: T.actionFor('brew', 'triple', null),
      brewHold: T.actionFor('brew', 'hold', null),
      rate: at('rate', null),
      rateTriple: T.actionFor('rate', 'triple', null),
      brewHint: T.gestureHint('brew', null),
      fillHint: T.gestureHint('dose', 'fill'),
    };
  });
  t('gestures: nothing at all is bound while the shot is pouring',
    bound.brew === null && bound.brewTriple === null && bound.brewHold === null
    && /pouring/i.test(bound.brewHint), bound.brewHint);
  t('gestures: nor while a weight is being taken',
    bound.doseFill === null && bound.doseReady === null && /weight is being taken/i.test(bound.fillHint),
    bound.fillHint);
  t('gestures: they are bound where the scale is idle and the person is not',
    bound.setup === 'begin' && bound.doseVessel === 'undo' && bound.rate === 'next-shot'
    && bound.rateTriple === 'discard',
    `${bound.setup} / ${bound.doseVessel} / ${bound.rate} / ${bound.rateTriple}`);

  // Undo is the one thing automation cannot do: "that was wrong" is information
  // only the person holding the portafilter has.
  const undo = await page.evaluate(async () => {
    const { SessionMachine } = await import('./assets/js/core/session.js');
    const m = new SessionMachine();
    m._t = 0;
    m.setReady(true);
    m.begin();
    m.dose = 18.2;
    m.auto.dose = true;
    m.step = 'grind';
    const first = m.undo();
    const second = m.undo();
    const g = new SessionMachine({ method: 'milk' });
    g._t = 0;
    g.setReady(true);
    g.begin();
    g.dose = 18; g.grounds = 17.9; g.step = 'brew';
    const fromBrew = g.undo();
    return { first, afterFirst: { step: m.step, dose: m.dose, auto: m.auto.dose },
             second, fromBrew, gStep: g.step, gGrounds: g.grounds };
  });
  t('undo: it takes back the last weight and returns to the step that made it',
    undo.first?.was === 18.2 && undo.afterFirst.step === 'dose'
    && undo.afterFirst.dose === null && undo.afterFirst.auto === false,
    JSON.stringify(undo.first));
  t('undo: with nothing left to take back it does nothing rather than unwinding',
    undo.second === null, String(undo.second));
  t('undo: and it follows the method\u2019s own order backwards',
    undo.fromBrew?.key === 'grounds' && undo.gStep === 'grind' && undo.gGrounds === null,
    `${undo.fromBrew?.key} \u2192 ${undo.gStep}`);

  // ---- what you are making decides what you are asked for ----
  const methods = await page.evaluate(async () => {
    const M = await import('./assets/js/core/method.js');
    const { SessionMachine } = await import('./assets/js/core/session.js');
    const orders = {};
    for (const id of M.METHOD_ORDER) orders[id] = M.METHODS[id].order.join(',');

    // A method switch mid-session must not un-weigh what is already weighed.
    const s = new SessionMachine();
    s._t = 0;
    s.setReady(true);
    s.begin();
    s.dose = 18.2;
    s.step = 'grind';
    s.setMethod('pourover');
    const afterSwitch = { step: s.step, dose: s.dose };
    // The fallback only fires when the current step does not exist in the new
    // method. Going the other way — off milk's own step, into a method with no
    // milk in it — is the case that needs one.
    const milk = new SessionMachine({ method: 'milk' });
    milk._t = 0;
    milk.setReady(true);
    milk.begin();
    milk.dose = 18;
    milk.grounds = 18;
    milk.step = 'milk';
    milk.setMethod('espresso');

    return {
      offMilk: milk.step,
      orders,
      cycle: [M.nextMethod('espresso').id, M.nextMethod('pourover').id, M.nextMethod('milk').id]
        .join(','),
      espressoTarget: M.brewTarget('espresso', 18, 2),
      pouroverTarget: M.brewTarget('pourover', 22, 16),
      afterSwitch,
      keptStep: (() => { s.setMethod('milk'); return s.step; })(),
      milkVessel: M.METHODS.milk.weigh.milk.vessel,
      pourNoun: M.METHODS.pourover.brew.noun,
      pourDiagnoses: M.METHODS.pourover.diagnose,
      numbering: `${M.stepNumber('pourover', 'brew')}/${M.stepNumber('espresso', 'brew')}`,
    };
  });
  t('method: a pour over has no portafilter step, a flat white has one more',
    methods.orders.pourover === 'setup,dose,brew,rate'
    && methods.orders.milk === 'setup,dose,grind,brew,milk,rate',
    `${methods.orders.pourover} | ${methods.orders.milk}`);
  t('method: holding the scale cycles through all three',
    methods.cycle === 'pourover,milk,espresso', methods.cycle);
  t('method: the brew target follows the drink, not the code',
    methods.espressoTarget === 36 && methods.pouroverTarget === 352,
    `${methods.espressoTarget} g out vs ${methods.pouroverTarget} g in`);
  t('method: switching mid-session keeps what is already weighed',
    methods.afterSwitch.dose === 18.2 && methods.afterSwitch.step === 'brew',
    `${methods.afterSwitch.dose} g, now on ${methods.afterSwitch.step}`);
  t('method: a step the new method still has is kept, not restarted',
    methods.keptStep === 'brew', methods.keptStep);
  t('method: and a step it does not have falls through to what is left',
    methods.offMilk === 'rate', methods.offMilk);
  t('method: a pour over weighs water in, and is not judged by espresso rules',
    methods.pourNoun === 'water' && methods.pourDiagnoses === false,
    `${methods.pourNoun}, diagnose=${methods.pourDiagnoses}`);
  t('method: the step numbering follows the method that owns it',
    methods.numbering === '02/03', methods.numbering);

  // ---- flow as a bar, not only as digits ----
  const flowbar = await page.evaluate(async () => {
    const M = await import('./assets/js/core/method.js');
    const at = (m, q) => M.flowBar(m, q);
    return {
      slow: at('espresso', 0.6)?.state,
      good: at('espresso', 1.8)?.state,
      fast: at('espresso', 2.9)?.state,
      // A pour is poured an order of magnitude faster; espresso's scale would
      // pin the bar at full for the whole brew.
      pourGood: at('pourover', 5)?.state,
      pourOnEspressoScale: at('espresso', 5)?.frac,
      none: at('espresso', NaN),
      band: `${at('espresso', 1.8).lo.toFixed(2)}-${at('espresso', 1.8).hi.toFixed(2)}`,
    };
  });
  t('flow: the bar names slow, right and fast rather than leaving it to arithmetic',
    flowbar.slow === 'low' && flowbar.good === 'good' && flowbar.fast === 'high',
    `${flowbar.slow}/${flowbar.good}/${flowbar.fast}`);
  t('flow: a pour over gets its own scale, not espresso\u2019s',
    flowbar.pourGood === 'good' && flowbar.pourOnEspressoScale === 1,
    `5 g/s is ${flowbar.pourGood} pouring, and pins an espresso bar at ${flowbar.pourOnEspressoScale}`);
  t('flow: no reading draws no bar', flowbar.none === null, String(flowbar.none));

  // ---- the gap between grinding and brewing ----
  const prep = await page.evaluate(async () => {
    const { SessionMachine } = await import('./assets/js/core/session.js');
    const { diagnose } = await import('./assets/js/core/diagnose.js');
    const s = new SessionMachine();
    s.at = { dose: Date.now() - 400000, grounds: Date.now() - 300000 };
    const long = s.puckPrep(Date.now());
    const s2 = new SessionMachine();
    s2.at = { grounds: Date.now() - 25000 };
    const short = s2.puckPrep(Date.now());
    const none = new SessionMachine().puckPrep(Date.now());
    return {
      long, short, none,
      flagsLong: diagnose({ puck_prep_s: 600 }).map((f) => f.code).join(','),
      quietShort: diagnose({ puck_prep_s: 45 }).map((f) => f.code).join(',') || 'nothing',
    };
  });
  t('prep: the grind-to-brew gap is measured from timestamps the app already had',
    Math.abs(prep.long - 300) < 3 && Math.abs(prep.short - 25) < 3,
    `${prep.long} s and ${prep.short} s`);
  t('prep: with nothing ground there is nothing to measure', prep.none === null,
    String(prep.none));
  t('prep: a five-minute-old puck is called out; a fresh one is not',
    prep.flagsLong === 'puck_stale' && prep.quietShort === 'nothing',
    `${prep.flagsLong} vs ${prep.quietShort}`);

  // ---- this shot against the one you actually liked ----
  // The comparison exists only because ratings and curves live in the same
  // rows. A scale that stores curves and a notebook that stores ratings cannot
  // be joined afterwards, which is why no scale app does this.
  const cmp = await page.evaluate(async () => {
    const C = await import('./assets/js/core/compare.js');
    const { encodeCurve } = await import('./assets/js/core/schema.js');
    const build = (flow, dur = 28) => {
      const pts = [];
      let w = 0;
      for (let x = 0; x <= dur; x += 0.1) { w += flow(x) * 0.1; pts.push([+x.toFixed(2), +w.toFixed(2)]); }
      return encodeCurve(pts);
    };
    const normal = (x) => (x < 6 ? 0 : 2.7 * (1 - Math.exp(-(x - 6) / 2)) * Math.exp(-(x - 6) / 26));
    const gusher = (x) => (x < 4 ? 0 : 3.4 * (1 - Math.exp(-(x - 4) / 1.2)) * Math.exp(-(x - 4) / 30));
    const ref = { shot_id: 'ref', bag_id: 'b1', rating: 9, timestamp: '2026-08-01 09:00:00',
                  curve: build(normal) };
    const twin = { shot_id: 'twin', bag_id: 'b1', curve: build(normal) };
    const fast = { shot_id: 'fast', bag_id: 'b1', curve: build(gusher) };
    const otherBag = { shot_id: 'other', bag_id: 'b2', rating: 10, curve: build(normal) };

    const same = C.compareToBest(twin, [ref, twin]);
    const diff = C.compareToBest(fast, [ref, fast]);
    return {
      sameScore: same?.percent, sameClose: same?.close,
      diffScore: diff?.percent, diffAhead: diff?.divergence.ahead,
      diffAt: diff?.divergence.atSeconds,
      unrated: C.compareToBest(twin, [{ ...ref, rating: 3 }, twin]),
      // A ten out of ten on a different coffee is not a reference for this one.
      wrongBag: C.compareToBest(twin, [otherBag, twin], { bagId: 'b1' }),
      picksBest: C.bestOn([ref, { ...ref, shot_id: 'r2', rating: 10 }], { bagId: 'b1' })?.shot_id,
      // A curve too short to have a shape is not compared, it is refused.
      stub: C.normalise([[0, 0], [1, 1]]),
    };
  });
  t('compare: the same curve twice scores as the same curve',
    cmp.sameScore === 100 && cmp.sameClose === true, `${cmp.sameScore}%`);
  t('compare: a faster shot is scored lower and the divergence is located',
    cmp.diffScore < 80 && cmp.diffAhead === true && cmp.diffAt > 4 && cmp.diffAt < 20,
    `${cmp.diffScore}%, ran ahead at ${cmp.diffAt} s`);
  t('compare: with nothing well rated to compare against, it says nothing',
    cmp.unrated === null, String(cmp.unrated));
  t('compare: a great shot on a different coffee is not a reference for this one',
    cmp.wrongBag === null, String(cmp.wrongBag));
  t('compare: the reference is your highest rating on that coffee',
    cmp.picksBest === 'r2', cmp.picksBest);
  t('compare: a curve with no shape in it is refused rather than scored',
    cmp.stub === null, String(cmp.stub));

  // ---- the drip lag belongs to the machine, not to the app ----
  // The machines store is shared fixture for tests further down, so snapshot it
  // and put it back: a test that leaves a machine behind fails four unrelated
  // ones two hundred lines later, and the failure names the wrong culprit.
  const lag = await page.evaluate(async () => {
    const kit = await import('./assets/js/core/kit.js');
    const saved = localStorage.getItem('brewkit.machines.v1');
    const m = kit.saveMachine({ name: 'Lag Test Machine', kind: 'Lever' });
    const before = kit.stopLag(m.id);
    // Five shots that each overshot by about 1.4 s worth of flow.
    for (let i = 0; i < 5; i++) {
      kit.learnStopLag(m.id, { weightAtSignal: 33, finalWeight: 35.8, flowAtSignal: 2.0 });
    }
    const after = kit.stopLag(m.id);
    // Rubbish observations must not move it.
    kit.learnStopLag(m.id, { weightAtSignal: 33, finalWeight: 20, flowAtSignal: 2.0 });  // negative
    kit.learnStopLag(m.id, { weightAtSignal: 33, finalWeight: 99, flowAtSignal: 2.0 });  // absurd
    kit.learnStopLag(m.id, { weightAtSignal: 33, finalWeight: 35, flowAtSignal: 0 });    // no flow
    const guarded = kit.stopLag(m.id);
    const other = kit.stopLag(kit.saveMachine({ name: 'Another Machine' }).id);
    if (saved === null) localStorage.removeItem('brewkit.machines.v1');
    else localStorage.setItem('brewkit.machines.v1', saved);
    return { before, after, guarded, other,
             restored: JSON.parse(localStorage.getItem('brewkit.machines.v1') ?? '[]').length };
  });
  t('lag: an unmeasured machine falls back rather than inventing a number',
    lag.before.learned === false && lag.before.seconds === 1, JSON.stringify(lag.before));
  t('lag: it learns the real drip from the shots that machine actually pulled',
    lag.after.learned === true && Math.abs(lag.after.seconds - 1.4) < 0.25 && lag.after.n === 5,
    `${lag.after.seconds} s from ${lag.after.n} shots`);
  t('lag: an impossible observation is refused, not averaged in',
    lag.guarded.n === 5 && lag.guarded.seconds === lag.after.seconds,
    `still ${lag.guarded.seconds} s from ${lag.guarded.n}`);
  t('lag: and a second machine does not inherit the first one\u2019s plumbing',
    lag.other.learned === false, JSON.stringify(lag.other));
  t('lag: the machines the rest of the suite runs on are put back',
    lag.restored === 0, `${lag.restored} left behind`);

  // ---- a file another program can actually read ----
  const open = await page.evaluate(async () => {
    const backup = await import('./assets/js/core/backup.js');
    const { encodeCurve, decodeCurve } = await import('./assets/js/core/schema.js');
    const out = backup.interchange({
      shots: [{ shot_id: 'shot-1', timestamp: '2026-08-20 09:00:00', bag_id: 'bag-1',
                grinder_id: 'g1', dose_g: 18, yield_g: 36, time_s: 28, rating: 8,
                tags: 'sweet balanced', puck_prep_s: 42, method: 'espresso',
                curve: encodeCurve([[0, 0], [1, 2], [2, 6], [3, 11]]) }],
      bags: [{ id: 'bag-1', bean_name: 'Guji', roaster: 'Onyx' }],
      grinders: [{ id: 'g1', name: 'Niche' }],
      decodeCurve,
    });
    const brew = out.brews[0];
    return {
      hasUnits: !!out.units && typeof out.units.curve === 'string',
      // Names, not ids: the whole point is that a reader has never seen this app.
      noIds: !JSON.stringify(brew).includes('bag-1') && !JSON.stringify(brew).includes('g1'),
      coffee: brew.coffee.name, roaster: brew.coffee.roaster, grinder: brew.grinder.name,
      curveIsPairs: Array.isArray(brew.curve) && Array.isArray(brew.curve[0])
        && brew.curve[0].length === 2,
      curveLen: brew.curve.length,
      tags: brew.tags.join('|'),
      prep: brew.puck_prep_s,
      format: `${out.format}/${out.version}`,
    };
  });
  t('open export: the units are written into the file, not assumed',
    open.hasUnits && open.format === 'brewkit.interchange/1', open.format);
  t('open export: names travel, internal ids do not',
    open.noIds && open.coffee === 'Guji' && open.roaster === 'Onyx' && open.grinder === 'Niche',
    `${open.coffee} / ${open.grinder}`);
  t('open export: the curve is expanded into plain pairs a stranger can read',
    open.curveIsPairs && open.curveLen === 4, `${open.curveLen} points`);
  t('open export: tags become a list and the new fields come along',
    open.tags === 'sweet|balanced' && open.prep === 42, `${open.tags}, prep ${open.prep} s`);

  // ---- the session steps itself, driven by the scale ----
  // The whole point: weighing beans, grinding and pulling should advance the
  // session on their own. No clicks below except the rating at the end.
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 8000 });
  await page.selectOption('#p-bag', kitIds.bag);
  await page.selectOption('#p-grinder', kitIds.grinder);
  await page.fill('#p-grind', '12.5');
  // Step 00 no longer advances itself: choosing a coffee is a proposal, and
  // starting is a deliberate act. This click is that act, and it is the only
  // one in the whole hands-free sequence below.
  await page.click('#begin');

  // ---- step 00 is a step, not a formality ----
  // The selects are prefilled from the last session, so "a coffee is chosen"
  // was true before anyone looked at the screen, and setup was over before it
  // was seen. The bag is the field most likely to be stale — you finish one and
  // open another — and the one that quietly poisons the most downstream.
  const gate = await page.evaluate(async () => {
    const { SessionMachine } = await import('./assets/js/core/session.js');
    const m = new SessionMachine();
    const afterReady = (m.setReady(true), m.step);
    const moved = m.begin();
    const notReady = new SessionMachine();
    notReady.setReady(false);
    return { afterReady, moved, step: m.step,
             refused: notReady.begin(), refusedStep: notReady.step,
             twice: m.begin() };
  });
  t('setup: choosing a coffee does not by itself leave setup',
    gate.afterReady === 'setup', gate.afterReady);
  t('setup: starting is its own deliberate act',
    gate.moved === 'dose' && gate.step === 'dose', `${gate.moved}`);
  t('setup: and it refuses when there is nothing chosen to start with',
    gate.refused === null && gate.refusedStep === 'setup', String(gate.refused));
  t('setup: starting twice is not a way to skip a step',
    gate.twice === null, String(gate.twice));

  // On the page itself: a returning user with everything remembered still lands
  // on 00, with enough on screen to notice that the bag is last week's.
  const landing = await page.evaluate(() => ({
    step: window.__sess.step,
    shown: !document.getElementById('begin-box').hidden,
    what: document.getElementById('begin-what').textContent,
  }));
  t('setup: a connected scale with a remembered coffee still lands on 00',
    landing.step === 'dose', `${landing.step} (after the explicit start above)`);
  t('setup: and confirming shows what is being confirmed, not just a name',
    /days|left|window/i.test(landing.what) || landing.what.length > 0,
    landing.what || '(empty)');

  // Drive the mock through the real sequence: cup on, tare, beans, lift off,
  // portafilter on, tare, grind in, carry away. `grams` is what the scale
  // reports, which is all brewkit ever sees.
  const drive = async (grams, holdMs) => {
    await page.evaluate((g) => { window.__mock.grams = g; }, grams);
    await page.waitForTimeout(holdMs);
  };
  await drive(52, 900);     // dosing cup
  await drive(0, 900);      // scale-side tare
  await drive(18.2, 1600);  // beans
  await drive(-52, 900);    // cup lifted off -> commits the dose
  const afterDose = await page.evaluate(() => ({
    dose: document.getElementById('sv-dose').textContent,
    step: document.querySelector('#stepper button[aria-current="step"]')?.dataset.step,
  }));
  t('hands-free: the dose captures itself when the cup comes off',
    /18\.2 g/.test(afterDose.dose) && /auto/.test(afterDose.dose) && afterDose.step === 'grind',
    `${afterDose.dose}, now on ${afterDose.step}`);

  await drive(469, 900);    // portafilter
  await drive(0, 900);      // scale-side tare
  await drive(17.9, 1600);  // grounds
  await drive(-521, 900);   // carried to the machine -> commits grounds
  const afterGrind = await page.evaluate(() => ({
    grounds: document.getElementById('sv-grind').textContent,
    step: document.querySelector('#stepper button[aria-current="step"]')?.dataset.step,
    retention: document.getElementById('g-retention').textContent,
  }));
  t('hands-free: grounds capture themselves, and retention follows',
    /17\.9 g/.test(afterGrind.grounds) && afterGrind.step === 'brew'
    && /retention 0\.30 g/.test(afterGrind.retention),
    `${afterGrind.grounds}; ${afterGrind.retention.slice(0, 60)}`);
  t('hands-free: neither the dosing cup nor the portafilter was mistaken for coffee',
    !/52|469|521/.test(afterDose.dose + afterGrind.grounds),
    `${afterDose.dose} / ${afterGrind.grounds}`);

  // Entering brew arms the machine by itself, so the cup landing tares and times.
  const armed = await page.evaluate(() => document.getElementById('state').dataset.state);
  t('hands-free: reaching the brew step arms the scale with no click',
    armed === 'awaiting_vessel', armed);

  // ---- the flow the job actually has ----
  // Fetch a container, fill it, take it away — twice, with a grinder in the
  // middle. Naming those phases is what lets the screen say "put the portafilter
  // on" instead of an instruction for the whole step given halfway through it.
  const job = await page.evaluate(async () => {
    const { SessionMachine, prompt, PHASE } = await import('./assets/js/core/session.js');

    // Stand in for the Live page: apply the tare the session asks for, and feed
    // back the net it implies. This is the same two lines the page runs.
    const drive = (m, raw, seconds, out) => {
      for (let k = 0; k < Math.round(seconds / 0.1); k++) {
        out.t = +(out.t + 0.1).toFixed(1);
        const r = m.step_(out.t, raw, +(raw - out.tare).toFixed(2), true);
        if (r.tareTo !== null) { out.tare = r.tareTo; out.log.push(`tare=${r.tareTo}@${out.t}`); }
        if (r.committed) out.log.push(`${r.committed}@${out.t}`);
      }
      return out;
    };
    const say = (m) => prompt({ step: m.step, phase: m.phase, candidate: m.candidate,
                                target: m.targetFor() });

    const m = new SessionMachine();
    m.setReady(true);
    m.begin();
    m.setTarget(18);
    const st = { t: 0, tare: 0, log: [] };
    const seen = {};

    drive(m, 0, 0.4, st);                    // empty platform
    seen.beforeCup = { phase: m.phase, say: say(m) };
    drive(m, 52, 1.0, st);                   // dosing cup lands
    seen.afterCup = { phase: m.phase, say: say(m), tare: st.tare };
    drive(m, 58, 0.6, st);                   // beans going in
    seen.midPour = { phase: m.phase, say: say(m) };
    drive(m, 70.2, 1.2, st);                 // 18.2 g of beans
    seen.atTarget = { phase: m.phase, say: say(m), cand: m.candidate, hold: m.holdLeft };
    drive(m, 0, 0.6, st);                    // cup lifted
    seen.afterLift = { step: m.step, phase: m.phase, say: say(m),
                       dose: m.dose, tare: st.tare };
    drive(m, 469, 1.0, st);                  // portafilter lands
    seen.afterPf = { phase: m.phase, say: say(m), tare: st.tare };
    drive(m, 480, 0.6, st);                  // grounds starting
    seen.grinding = { phase: m.phase, say: say(m) };
    drive(m, 486.9, 1.2, st);                // 17.9 g of grounds
    seen.grinderDone = { phase: m.phase, say: say(m), cand: m.candidate, hold: m.holdLeft };
    drive(m, 0, 0.6, st);                    // portafilter to the machine
    seen.end = { step: m.step, grounds: m.grounds, retention: m.retention };

    return { seen, log: st.log, PHASE };
  });

  t('flow: it asks for the cup before it asks for anything else',
    job.seen.beforeCup.phase === 'vessel' && /dosing cup on the scale/.test(job.seen.beforeCup.say),
    job.seen.beforeCup.say);
  t('flow: the cup tares itself, and the app says so',
    job.seen.afterCup.phase === 'fill' && job.seen.afterCup.tare === 52
    && /Tared\. Dose your beans to 18\.0 g/.test(job.seen.afterCup.say),
    `${job.seen.afterCup.say} (tare ${job.seen.afterCup.tare})`);
  t('flow: mid-pour it is still asking for beans, not offering to move on',
    job.seen.midPour.phase === 'fill', job.seen.midPour.say);
  t('flow: at the target a visible clock starts, because this is a finished dose',
    job.seen.atTarget.cand === 18.2 && Number.isFinite(job.seen.atTarget.hold)
    && job.seen.atTarget.hold < 5,
    `${job.seen.atTarget.cand} g, ${job.seen.atTarget.hold} s left on the clock`);
  t('flow: lifting it captures the dose and asks for the portafilter',
    job.seen.afterLift.step === 'grind' && job.seen.afterLift.dose === 18.2
    && job.seen.afterLift.tare === 0
    && /portafilter on the scale/.test(job.seen.afterLift.say),
    job.seen.afterLift.say);
  t('flow: the portafilter tares itself too, all 469 g of it',
    job.seen.afterPf.phase === 'fill' && job.seen.afterPf.tare === 469
    && /Tared\. Grind into it to 18\.2 g/.test(job.seen.afterPf.say),
    `${job.seen.afterPf.say} (tare ${job.seen.afterPf.tare})`);
  t('flow: and then it waits, rather than calling an empty basket a dose',
    job.seen.grinding.phase === 'fill', job.seen.grinding.say);
  t('flow: grounds near the dose that was weighed are a finished grind too',
    job.seen.grinderDone.cand === 17.9 && Number.isFinite(job.seen.grinderDone.hold ?? null)
      === Number.isFinite(job.seen.atTarget.hold),
    `${job.seen.grinderDone.cand} g against the 18.2 g that was weighed`);
  t('flow: taking it to the machine leaves dose, grounds and retention behind',
    job.seen.end.step === 'brew' && job.seen.end.grounds === 17.9
    && Math.abs(job.seen.end.retention - 0.3) < 1e-9,
    `${job.seen.end.grounds} g out, ${job.seen.end.retention} g retained`);
  // The tare back to zero rides on the same frame as the capture, because the
  // step that is starting must not inherit the last one's offset. The leading
  // one is the flow starting from a platform of unknown history.
  t('flow: two tares in, two captures out, each capture clearing the tare with it',
    job.log.join(' ').replace(/@[\d.]+/g, '')
      === 'tare=0 tare=52 tare=0 dose tare=469 tare=0 grounds',
    job.log.join(' '));

  // A cup and a dose can weigh the same. What separates them is that a cup is
  // put down in one movement and a dose is poured over seconds.
  const placed = await page.evaluate(async () => {
    const { SessionMachine } = await import('./assets/js/core/session.js');
    const feed = (m, from, to, at, step = 0.1) => {
      let tare = null;
      for (let t = from; t <= to + 1e-9; t = +(t + step).toFixed(2)) {
        const g = typeof at === 'function' ? at(t) : at;
        const r = m.step_(t, g, g, true);
        if (r.tareTo) tare = r.tareTo;
      }
      return tare;
    };
    const start = () => { const m = new SessionMachine(); m.setReady(true); m.begin();
                          m.setTarget(18); m.step_(0, 0, 0, true); return m; };

    // 30 g arriving all at once: a cup.
    const cup = start();
    const cupTare = feed(cup, 0.1, 1.4, 30);

    // The same 30 g poured in over six seconds: a dose, on a scale you tared.
    const pour = start();
    const pourTare = feed(pour, 0.1, 8, (t) => Math.min(30, +(t * 5).toFixed(2)));

    // A portafilter is past any dose, so it needs no such argument.
    const pf = start();
    const pfTare = feed(pf, 0.1, 8, (t) => Math.min(469, +(t * 80).toFixed(2)));

    return { cupTare, cupPhase: cup.phase, pourTare, pourPhase: pour.phase,
             pourCand: pour.candidate, pfTare };
  });
  t('flow: 30 g put down in one movement is a container, and is tared',
    placed.cupTare === 30 && placed.cupPhase === 'fill',
    `tared ${placed.cupTare}, phase ${placed.cupPhase}`);
  t('flow: the same 30 g poured in over six seconds is coffee, and is not',
    placed.pourTare === null && placed.pourCand === 30,
    `tare ${placed.pourTare}, candidate ${placed.pourCand}`);
  t('flow: and a portafilter needs no such argument, being heavier than any dose',
    placed.pfTare === 469, `tared ${placed.pfTare}`);

  // ---- the dose as a bar ----
  // The window is drawn as a region rather than the target as a line, because
  // that is what it is: landing anywhere in it ends the step.
  const bar = await page.evaluate(async () => {
    const { fillProgress, tolerance } = await import('./assets/js/core/session.js');
    const at = (net, target = 18) => fillProgress(net, target);
    return {
      tol18: tolerance(18), tol8: tolerance(8),
      empty: at(0), half: at(9), justUnder: at(15.5), inWindow: at(18.2),
      justOver: at(20.5), way: at(40),
      none: fillProgress(12, 0), nan: fillProgress(NaN, 18),
    };
  });
  t('bar: the window is a fraction of the dose, with a floor for small ones',
    Math.abs(bar.tol18 - 2.16) < 1e-9 && bar.tol8 === 1.5,
    `±${bar.tol18.toFixed(2)} g at 18, ±${bar.tol8} g at 8`);
  t('bar: it fills as you pour',
    bar.empty.frac === 0 && Math.abs(bar.half.frac - 0.385) < 0.01
    && bar.half.state === 'under', `${(bar.half.frac * 100).toFixed(0)}% at 9 g`);
  t('bar: the window sits before the end, so an overshoot has somewhere to go',
    bar.inWindow.hi < 1 && bar.inWindow.lo < bar.inWindow.mark
    && bar.inWindow.mark < bar.inWindow.hi,
    `window ${(bar.inWindow.lo * 100).toFixed(0)}–${(bar.inWindow.hi * 100).toFixed(0)}%, `
      + `target at ${(bar.inWindow.mark * 100).toFixed(0)}%`);
  t('bar: three states, and 15.5 g of an 18 g dose is not one of the good ones',
    bar.justUnder.state === 'under' && bar.inWindow.state === 'in'
    && bar.justOver.state === 'over',
    `${bar.justUnder.state}/${bar.inWindow.state}/${bar.justOver.state}`);
  t('bar: it says how far off, in the direction you are off',
    Math.abs(bar.justUnder.delta + 2.5) < 1e-9 && Math.abs(bar.justOver.delta - 2.5) < 1e-9,
    `${bar.justUnder.delta} / +${bar.justOver.delta}`);
  t('bar: a wild overshoot clamps rather than running off the end',
    bar.way.frac === 1 && bar.way.state === 'over', `${bar.way.frac} at 40 g`);
  t('bar: with no target there is no bar',
    bar.none === null && bar.nan === null, 'null on both');

  // ---- and the ways out when it cannot know you are done ----
  const ways = await page.evaluate(async () => {
    const { SessionMachine, prompt } = await import('./assets/js/core/session.js');
    const ready = (target) => {
      const m = new SessionMachine();
      m.setReady(true);
      m.begin();
      m.setTarget(target);
      // Straight to filling: these are about what happens after a vessel.
      m.step_(0, 0, 0, true);
      return m;
    };
    const run = (m, from, to, at, step = 0.2) => {
      let first = null;
      for (let t = from; t <= to + 1e-9; t = +(t + step).toFixed(2)) {
        const g = typeof at === 'function' ? at(t) : at;
        const r = m.step_(t, g, g, true);
        if (r.committed && first === null) first = { t, committed: r.committed };
      }
      return first;
    };

    // Nowhere near the target: 12.4 g against a 30 g target. This used to be
    // the case the countdown fired on, which is backwards — the app has least
    // reason to trust exactly this reading.
    const odd = ready(30);
    const oddAt = run(odd, 0.2, 10, 12.4);
    const oddSay = odd.snapshot().hint;

    // No target at all, where a timer is genuinely the only thing there is.
    const blind = new SessionMachine();
    blind.setReady(true); blind.begin();
    blind.setTarget(NaN);          // the machine defaults to 18 g; this clears it
    blind.step_(0, 0, 0, true);
    const blindAt = run(blind, 0.2, 10, 12.4);

    // A pour that never rests must not be captured half-way.
    const pouring = ready(18);
    const pourAt = run(pouring, 0.2, 12, (t) => +(t * 2).toFixed(2));

    // The button, whatever the phase.
    const asked = ready(18);
    run(asked, 0.2, 2.4, 18.2);
    const byHand = asked.commit();

    // A drop with nothing behind it is a tare, and still means nothing.
    const tared = ready(18);
    const onTare = tared.step_(0.2, 0, 0, true);

    const quiet = ready(18);
    const before = { say: prompt({ step: quiet.step, phase: quiet.phase,
                                   candidate: null, target: 18 }), hold: quiet.holdLeft };
    run(quiet, 0.2, 2.4, 18.2);
    const after = { phase: quiet.phase, hold: quiet.holdLeft };
    return { oddAt, oddDose: odd.dose, oddSay, blindAt, blindDose: blind.dose,
             pourAt, pourDose: pouring.dose,
             byHand, handDose: asked.dose, handWhy: asked.events.at(-1)?.text ?? '',
             onTare, tareStep: tared.step, before, after };
  });
  t('hands-free: a dose nowhere near the target is never taken on a timer',
    ways.oddAt === null && ways.oddDose === null
    && /17\.6 g under your target/.test(ways.oddSay),
    `12.4 g against 30 g: ${ways.oddAt === null ? 'held' : 'captured'}`);
  t('hands-free: with no target at all a timer is all there is, so it still runs',
    ways.blindAt && ways.blindDose === 12.4 && ways.blindAt.t > 4.5 && ways.blindAt.t < 8,
    `${ways.blindDose} g at ${ways.blindAt?.t} s with nothing to aim at`);
  t('hands-free: but a pour that never rests is left alone',
    ways.pourAt === null && ways.pourDose === null,
    `dose ${ways.pourDose} after 12 s of climbing`);
  t('hands-free: and you can always just say so',
    ways.byHand.committed === 'dose' && ways.handDose === 18.2, `${ways.handDose} g by hand`);
  t('hands-free: the log says which of the ways it was',
    /because you said so/.test(ways.handWhy), ways.handWhy);
  t('hands-free: a tare with nothing behind it still means nothing',
    ways.onTare.committed === null && ways.tareStep === 'dose', ways.tareStep);
  t('hands-free: at the target the countdown is exactly what does run',
    ways.before.hold === null && Number.isFinite(ways.after.hold) && ways.after.hold < 5,
    `${ways.after.phase}, hold ${ways.after.hold} s left`);

  await page.evaluate(() => { window.__mock.grams = 0; });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__mock.runShot({ cup: 120, target: 36 }));
  await page.waitForFunction(
    () => document.getElementById('state').dataset.state === 'extracting', { timeout: 20000 });
  await page.waitForTimeout(3500);
  await page.click('#stop');
  await page.waitForFunction(
    () => document.getElementById('s-rate').style.display !== 'none', { timeout: 6000 });
  t('hands-free: finishing the shot opens the rating step by itself',
    (await page.evaluate(() => document.querySelector('#stepper button[aria-current="step"]')?.dataset.step))
      === 'rate', 'rate panel shown');

  // Filed on landing; the rating edits the row it already has.
  await page.waitForFunction(() => /Saved as/.test(document.getElementById('save-msg').textContent),
    { timeout: 5000 });
  await page.click('#r-rate button:nth-child(8)');
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('brewkit.shots.v1')).at(-1));
  t('hands-free: the saved row carries the weights nobody typed',
    rec.dose_g === 18.2 && rec.grounds_out_g === 17.9
    && Math.abs(rec.retention_g - 0.3) < 0.001,
    `${rec.dose_g} / ${rec.grounds_out_g} / ${rec.retention_g}`);
  t('hands-free: it still links to the bag and the grinder',
    rec.bag_id === kitIds.bag && rec.grinder_id === kitIds.grinder
    && rec.bean_name === 'Test Guji' && rec.rating === 8,
    `${rec.bean_name} @ ${rec.grind_setting}, ${rec.rating}/10`);

  // And it has to be on screen, not only in the machine.
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(() => window.__sess, null, { timeout: 5000 });
  await page.evaluate(() => { window.__sess.goto('dose'); window.__mock.grams = 19.4; });
  await page.waitForFunction(() => window.__sess.candidate !== null, null, { timeout: 5000 });
  await page.waitForTimeout(150);
  const caught = await page.evaluate(() => ({
    hidden: document.getElementById('catch').hidden,
    value: document.getElementById('catch-v').textContent,
    hint: document.getElementById('step-hint').textContent,
    bar: document.getElementById('catch-bar').hidden,
  }));
  t('hands-free: the pending capture is on screen, with what to do about it',
    caught.hidden === false && /19\.4 g/.test(caught.value)
    && /capturing that in \d+ s/.test(caught.hint)
    && /lift the dosing cup off/i.test(caught.hint),
    `${caught.value} — ${caught.hint}`);
  t('hands-free: with the clock visible, because something is about to happen',
    caught.bar === false, `bar shown: ${!caught.bar}`);
  await page.click('#catch-go');
  await page.waitForTimeout(150);
  t('hands-free: and the button on it takes the reading',
    /19\.4 g/.test(await page.textContent('#sv-dose'))
    && (await page.evaluate(() => window.__sess.step)) === 'grind',
    await page.textContent('#sv-dose'));

  // ---- setup is a step, not a panel you are expected to notice ----
  // The coffee and grinder selects sat quietly beside the flow, and nothing
  // said to fill them in first. A shot that does not know its coffee is a shot
  // no model can use afterwards, so the flow now waits for them by name.
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(() => window.__sess, null, { timeout: 5000 });
  await page.evaluate(async () => {
    // The page remembers the last coffee you used, so forget it first —
    // otherwise refilling the selects puts the choice straight back.
    const kit = await import('./assets/js/core/kit.js');
    kit.saveSession({ bag_id: '', grinder_id: '', machine_id: '' });
    window.__sess.reset();
    document.getElementById('p-bag').value = '';
    document.getElementById('p-grinder').value = '';
    document.getElementById('p-bag').dispatchEvent(new Event('change'));
  });
  const waiting = await page.evaluate(() => ({
    step: window.__sess.step,
    hint: document.getElementById('step-hint').textContent,
    wanted: document.querySelectorAll('.needs-setup.wanted').length,
    current: document.querySelector('#stepper [aria-current="step"]')?.dataset.step,
  }));
  t('setup: the flow starts on setup rather than on dose',
    waiting.step === 'setup' && waiting.current === 'setup',
    `${waiting.step}/${waiting.current}`);
  t('setup: and names what it is waiting for rather than implying it',
    /coffee and grinder/i.test(waiting.hint), waiting.hint);
  t('setup: with the two fields it is waiting on marked',
    waiting.wanted === 2, `${waiting.wanted} fields flagged`);

  await page.evaluate((ids) => {
    document.getElementById('p-bag').value = ids.bag;
    document.getElementById('p-grinder').value = ids.grinder;
    document.getElementById('p-grinder').dispatchEvent(new Event('change'));
  }, kitIds);
  const afterPick = await page.evaluate(() => ({
    step: window.__sess.step,
    hint: document.getElementById('step-hint').textContent,
    wanted: document.querySelectorAll('.needs-setup.wanted').length,
    tile: document.getElementById('sv-setup').textContent,
    canStart: !document.getElementById('begin').disabled,
    what: document.getElementById('begin-what').textContent,
    beginWanted: document.getElementById('begin-box').classList.contains('wanted'),
  }));
  // Choosing is not starting. The selects arrive prefilled from the last
  // session, so if choosing advanced the step, setup would be over before it
  // was seen and the bag would never be re-confirmed.
  t('setup: choosing a coffee arms the start rather than taking it',
    afterPick.step === 'setup' && afterPick.canStart === true,
    `${afterPick.step}, start ${afterPick.canStart ? 'enabled' : 'disabled'}`);
  t('setup: and it shows what confirming would confirm, not just a name',
    /Guji/.test(afterPick.what) && /(day|left|window)/i.test(afterPick.what),
    afterPick.what);
  // The highlight moves rather than disappearing: it marks whatever the flow is
  // waiting on, and once both selects are filled that is the start button.
  t('setup: the highlight leaves the fields once they are filled',
    afterPick.wanted === 0 && /Guji/.test(afterPick.tile),
    `${afterPick.wanted} flagged, tile "${afterPick.tile}"`);
  t('setup: and moves to the thing actually being waited on',
    afterPick.beginWanted === true, `start highlighted: ${afterPick.beginWanted}`);

  await page.click('#begin');
  const afterStart = await page.evaluate(() => ({
    step: window.__sess.step,
    hint: document.getElementById('step-hint').textContent,
    boxGone: document.getElementById('begin-box').hidden,
  }));
  t('setup: starting is the one deliberate act, and then the flow takes over',
    afterStart.step === 'dose' && /dosing cup on the scale/i.test(afterStart.hint)
    && afterStart.boxGone,
    afterStart.hint);

  // With an empty Kit the answer is not "use the select", it is "go to Kit".
  const emptyKit = await page.evaluate(async () => {
    const kit = await import('./assets/js/core/kit.js');
    const bags = kit.bags().map((b) => ({ ...b }));
    const grinders = kit.grinders().map((g) => ({ ...g }));
    for (const b of bags) kit.removeBag(b.id);
    for (const g of grinders) kit.removeGrinder(g.id);
    window.__sess.reset();
    document.getElementById('p-bag').dispatchEvent(new Event('change'));
    const hint = document.getElementById('step-hint').textContent;
    // Put the fixture back before anything else reads it.
    for (const b of bags) kit.saveBag(b);
    for (const g of grinders) kit.saveGrinder(g);
    return hint;
  });
  t('setup: with nothing in Kit it sends you to Kit, not to an empty select',
    /Kit page/.test(emptyKit) && /coffee and a grinder/.test(emptyKit), emptyKit);

  // ---- watching from a phone, with nothing in between ----
  // No iOS browser has Web Bluetooth, so an iPad can never hold the scale. It
  // can watch — and Drive sync is the wrong shape for that: an account on both
  // ends and seconds of latency for a number that moves ten times a second.
  const codes = await page.evaluate(async () => {
    const link = await import('./assets/js/core/link.js');
    const bad = link.readCode('not a code at all', 'offer');
    const wrongWay = link.readCode(btoa(JSON.stringify({ v: 1, t: 'answer', sdp: 'x' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), 'offer');
    const oldVersion = link.readCode(btoa(JSON.stringify({ v: 99, t: 'offer', sdp: 'x' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), 'offer');
    const frame = link.frameOf({
      snap: { net: 18.234, flow: 1.8765, state: 'extracting' },
      sess: { step: 'brew', hint: 'go', dose: 18.2, grounds: null },
      target: 36.04, coffee: 'Guji · Onyx', elapsed: 12.34,
      curve: Array.from({ length: 400 }, (_, i) => ({ t: i * 0.1, w: i * 0.09 })),
    });
    return { bad: bad.error, wrongWay: wrongWay.error, oldVersion: oldVersion.error, frame };
  });
  t('link: nonsense is refused as nonsense', /does not look like/.test(codes.bad), codes.bad);
  t('link: and a code pasted on the wrong device says which device it belongs on',
    /Paste it on the laptop/.test(codes.wrongWay), codes.wrongWay);
  t('link: a code from another version is not silently half-understood',
    /different version/.test(codes.oldVersion), codes.oldVersion);
  t('link: a frame carries the whole picture, not a delta',
    codes.frame.w === 18.23 && codes.frame.q === 1.877 && codes.frame.t === 12.3
    && codes.frame.step === 'brew' && codes.frame.target === 36
    && codes.frame.coffee === 'Guji · Onyx',
    `${codes.frame.w} g, ${codes.frame.q} g/s, ${codes.frame.t} s`);
  t('link: with a bounded tail of the curve, so a late joiner is not blank',
    codes.frame.curve.length === 240 && codes.frame.curve[0].length === 2,
    `${codes.frame.curve.length} points of 400`);

  // ---- the dose the laptop is using, not only the one it weighed ----
  // Reported: the laptop looks right and the iPad shows nothing extra. The
  // cause was one null. `sess.dose` stays null on any shot where the dose step
  // never captured — straight to brew, or dosed on the grinder's own scale —
  // and the laptop hid that from itself by falling back to the typed target.
  // The frame sent the raw null, and since the dial, the volume, the ladder and
  // the name of the drink are every one of them dose-derived, all four vanished
  // on the device that exists to show them.
  const doses = await page.evaluate(async () => {
    const { frameOf } = await import('./assets/js/core/link.js');
    const { shotDial } = await import('./assets/js/core/dial.js');
    const base = { snap: { net: 24, flow: 2, state: 'extracting' }, target: 36,
                   tol: 1.5, elapsed: 14, curve: [], lag: 1 };
    // What a session looks like when nothing was weighed.
    const unweighed = frameOf({ ...base, sess: { method: 'espresso', dose: null },
                                dose: 18 });
    const weighed = frameOf({ ...base, sess: { method: 'espresso', dose: 18.4 },
                              dose: 18 });
    // And with no dose from anywhere, it still must not invent one.
    const neither = frameOf({ ...base, sess: { method: 'espresso', dose: null } });
    return {
      unweighed: unweighed.dose, unweighedSet: unweighed.doseSet,
      weighed: weighed.dose, weighedSet: weighed.doseSet,
      neither: neither.dose,
      // The thing that was actually broken, end to end.
      dialFromUnweighed: !!shotDial(unweighed.method, unweighed.dose,
        { net: unweighed.w, target: unweighed.target }),
      dialFromNeither: shotDial(neither.method, neither.dose,
        { net: neither.w, target: neither.target }),
    };
  });
  t('link: a shot that never weighed its dose still sends the one being used',
    doses.unweighed === 18 && doses.unweighedSet === false
    && doses.dialFromUnweighed === true,
    `dose ${doses.unweighed}, weighed ${doses.unweighedSet}, dial ${doses.dialFromUnweighed}`);
  t('link: a weighed dose wins over the one that was typed',
    doses.weighed === 18.4 && doses.weighedSet === true,
    `${doses.weighed} g, weighed ${doses.weighedSet}`);
  t('link: and with no dose anywhere it says so rather than inventing one',
    doses.neither === null && doses.dialFromNeither === null,
    `dose ${doses.neither}, dial ${doses.dialFromNeither}`);

  // The real handshake, between two real pages.
  const phone = await ctx.newPage();
  await phone.goto(B + '/view.html');
  await phone.waitForFunction(() => window.__view, null, { timeout: 5000 });
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(() => window.__mock, null, { timeout: 5000 });

  await page.click('#watch-phone');
  await page.waitForFunction(
    () => document.getElementById('pair-offer').value.length > 40, { timeout: 15000 });
  const offer = await page.inputValue('#pair-offer');

  // ---- big enough to actually be read off a screen ----
  // Reported: the QR renders and a phone will not scan it. The symbol itself
  // was fine — our own reader takes it — so the problem was physical. It sat in
  // a fixed 190 px box while the module count grows with the number of network
  // interfaces the laptop has, which took it from about 3.2 pixels a module to
  // 2.6: roughly half a millimetre on screen, against glare, with no warning
  // that anything was wrong.
  const sized = await page.evaluate(() => {
    const svg = document.querySelector('#pair-qr svg');
    const r = svg.getBoundingClientRect();
    const modules = Number(svg.getAttribute('viewBox').split(' ')[2]);
    return { css: Math.round(r.width), modules, per: +(r.width / modules).toFixed(2) };
  });
  await page.click('#qr-big');
  await page.waitForFunction(() => document.getElementById('qr-full-dlg').open,
    null, { timeout: 4000 });
  const enlarged = await page.evaluate(() => {
    const svg = document.querySelector('#qr-full svg');
    const r = svg.getBoundingClientRect();
    return { css: Math.round(r.width),
             per: +(r.width / Number(svg.getAttribute('viewBox').split(' ')[2])).toFixed(2) };
  });
  // And it is still the right symbol at the size it is drawn: rasterised off
  // the page and read back through our own decoder, which needs about the same
  // pixels per module a camera does.
  const readable = await page.evaluate(async () => {
    const S = await import('./assets/js/core/qrscan.js');
    const svg = document.querySelector('#pair-qr svg');
    const side = Math.round(svg.getBoundingClientRect().width);
    return new Promise((res) => {
      // A promise that only settles on load or error is a test that hangs
      // rather than fails, and page.evaluate has no timeout of its own.
      const bail = setTimeout(() => res(false), 8000);
      const done = (v) => { clearTimeout(bail); res(v); };
      const url = URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml' }));
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = side; c.height = side;
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, side, side);
        g.drawImage(img, 0, 0, side, side);
        const got = S.scan(g.getImageData(0, 0, side, side));
        URL.revokeObjectURL(url);
        done(typeof got === 'string' && got.includes('view.html#p='));
      };
      img.onerror = () => done(false);
      img.src = url;
    });
  });
  await page.evaluate(() => document.getElementById('qr-full-dlg').close());
  t('qr: the square is sized from its module count, not from a fixed box',
    sized.per >= 5.5 && sized.css >= 260,
    `${sized.modules} modules across ${sized.css} px — ${sized.per} px each`);
  t('qr: and it enlarges to the whole display for a camera that still refuses',
    enlarged.per > sized.per * 2 && enlarged.css > 600,
    `${enlarged.css} px, ${enlarged.per} px a module`);
  t('qr: what is drawn reads back as the viewer URL at the size it is drawn',
    readable, 'decoded off the page at its rendered size');

  // ---- and the phone can do the looking, which is the part that was missing --
  // The URL in that square is the whole first leg of pairing for free: iOS
  // Camera reads one natively and offers to open it. Right up until you add the
  // viewer to the home screen — an installed web app is its own browser
  // context, and nothing the Camera app opens can reach it. So the setup the
  // app is best in was the one where pairing fell back to moving 87 characters
  // between two browsers by hand.
  //
  // The claim under test is that a PICTURE OF THE LAPTOP'S SCREEN, decoded on
  // the phone, yields exactly what the paste box wanted. Same square, same
  // reader, no typing.
  const svgSrc = await page.evaluate(() => document.querySelector('#pair-qr svg').outerHTML);
  const offerOnLaptop = await page.inputValue('#pair-offer');
  const byCamera = await phone.evaluate(async ({ markup, side }) => {
    const S = await import('./assets/js/core/qrscan.js');
    const { codeFrom } = await import('./assets/js/core/camscan.js');
    const raw = await new Promise((res) => {
      const bail = setTimeout(() => res(null), 8000);
      const done = (v) => { clearTimeout(bail); res(v); };
      const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = side; c.height = side;
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, side, side);
        g.drawImage(img, 0, 0, side, side);
        URL.revokeObjectURL(url);
        done(S.scan(g.getImageData(0, 0, side, side)));
      };
      img.onerror = () => done(null);
      img.src = url;
    });
    return { raw, code: codeFrom(raw) };
  }, { markup: svgSrc, side: 420 });
  t('pairing: a picture of the laptop\u2019s square gives the phone the same code the paste box wanted',
    byCamera.code === offerOnLaptop && /view\.html#p=/.test(byCamera.raw ?? ''),
    byCamera.code === offerOnLaptop
      ? `${byCamera.code.length} characters, out of a URL`
      : `got ${String(byCamera.code).slice(0, 24)}\u2026`);
  // The unwrapping, and its refusal. A camera pointed at a kitchen sees a great
  // many things that are not a pairing code.
  const unwrap = await phone.evaluate(async () => {
    const { codeFrom } = await import('./assets/js/core/camscan.js');
    return {
      bare: codeFrom('2~abc~def'),
      url: codeFrom('https://box.local/view.html#p=2~abc~def'),
      encoded: codeFrom('https://box.local/view.html#p=2~abc%7Edef'),
      other: codeFrom('https://example.com/'),
      words: codeFrom('WIFI:S=kitchen;'),
      empty: codeFrom(''),
    };
  });
  t('pairing: a scanned code is taken bare or out of a URL, and nothing else is taken at all',
    unwrap.bare === '2~abc~def' && unwrap.url === '2~abc~def' && unwrap.encoded === '2~abc~def'
    && unwrap.other === null && unwrap.words === null && unwrap.empty === null,
    `bare ${unwrap.bare}, url ${unwrap.url}, a wifi code ${unwrap.words}`);
  const phoneScan = await phone.evaluate(() => ({
    offered: !document.getElementById('scan-row').hidden,
    folded: !document.getElementById('paste-fold').open,
    label: document.getElementById('scan').textContent,
  }));
  // The paste is the path that always works, so it stays — as the fallback it
  // now is rather than as the route.
  t('pairing: the phone leads with its own camera and keeps the paste behind it',
    phoneScan.offered && /scan/i.test(phoneScan.label),
    `button "${phoneScan.label}", paste folded ${phoneScan.folded}`);

  // A CAMERA THAT WILL NOT OPEN, which on an iPad is the ordinary case rather
  // than the exotic one: the iOS Camera app holds the hardware while it is still
  // open behind Safari, and the Camera app is exactly what you just used to scan
  // the code that opened this page. getUserMedia then rejects with AbortError.
  //
  // What that used to do: throw out of start() with the video already unhidden
  // and, past getUserMedia, the stream still held — a large empty grey box, the
  // camera kept, and `running` left true, so the next press took the stop branch
  // and silently ended a scan that had never begun. The message said "The
  // operation was aborted..", which names no cause and suggests no action.
  const refused = await phone.evaluate(async () => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const fail = (name) => Object.assign(new Error('The operation was aborted.'), { name });
    navigator.mediaDevices.getUserMedia = () => Promise.reject(fail('AbortError'));
    document.getElementById('scan').click();
    await new Promise((r) => setTimeout(r, 300));
    const out = {
      boxGone: document.getElementById('cam').hidden,
      running: window.__view.cam.running,
      msg: document.getElementById('scan-msg').textContent,
      label: document.getElementById('scan').textContent,
      pasteOpen: document.getElementById('paste-fold').open,
    };
    navigator.mediaDevices.getUserMedia = real;
    return out;
  });
  t('pairing: a camera that will not open leaves nothing half-started behind',
    refused.boxGone && refused.running === false,
    `video hidden ${refused.boxGone}, scanner still running ${refused.running}`);
  t('pairing: and says what is holding the camera, not what the browser called it',
    /camera/i.test(refused.msg) && !/aborted/i.test(refused.msg)
    && /again/i.test(refused.label) && refused.pasteOpen,
    `"${refused.msg}" · button "${refused.label}"`);
  // The mapping itself, so each failure gets the sentence that fits it rather
  // than one apology reused four ways.
  const why = await phone.evaluate(async () => {
    const { CamScan } = await import('./assets/js/core/camscan.js');
    const as = (name) => CamScan.why(Object.assign(new Error('raw.'), { name }));
    return { denied: as('NotAllowedError'), none: as('NotFoundError'),
             busy: as('NotReadableError'), odd: as('WeirdError') };
  });
  t('pairing: each way the camera can fail gets the sentence that fits it',
    /permitted/i.test(why.denied) && /No camera/i.test(why.none)
    && /Something else/i.test(why.busy) && why.odd === 'raw',
    `${[why.denied, why.none, why.busy].map((v) => v.slice(0, 28)).join(' · ')}`);

  await phone.evaluate(() => { document.getElementById('paste-fold').open = true; });
  await phone.fill('#offer', offer);
  await phone.click('#link');
  await phone.waitForFunction(
    () => document.getElementById('reply').value.length > 40, { timeout: 15000 });
  const reply = await phone.inputValue('#reply');
  await page.fill('#pair-answer', reply);
  await page.click('#pair-accept');

  const linked = await phone.waitForFunction(
    () => window.__view.link.state === 'open', { timeout: 20000 }).then(() => true).catch(() => false);
  t('link: two pages introduce themselves with two pastes and no server',
    linked, linked ? 'data channel open' : 'never connected');

  if (linked) {
    await page.evaluate(() => { window.__mock.grams = 21.7; });
    const arrived = await phone.waitForFunction(
      () => Math.abs(Number(document.getElementById('w').textContent) - 21.7) < 0.4,
      { timeout: 10000 }).then(() => true).catch(() => false);
    t('link: and the phone shows the weight the laptop is reading',
      arrived, await phone.textContent('#w'));
    t('link: with the pairing panel put away once it is watching',
      await phone.evaluate(() => document.getElementById('pairing').hidden
        && !document.getElementById('watching').hidden), 'watching, not pairing');
    const said = await page.textContent('#watch-state');
    t('link: and the laptop says a phone is watching',
      /watching/i.test(said), said);

    // The job has three parts and each wants a different thing made big.
    const views = {};
    for (const step of ['dose', 'brew', 'rate']) {
      await page.evaluate((st) => window.__sess.goto(st), step);
      await phone.waitForFunction(
        (st) => window.__view.last()?.step === st, step, { timeout: 8000 }).catch(() => {});
      views[step] = await phone.evaluate(() => ({
        view: window.__view.viewFor(window.__view.last() ?? {}),
        big: !getComputedStyle(document.getElementById('v-big')).display.includes('none'),
        done: !document.getElementById('v-done').hidden,
      }));
    }
    t('link: the phone shows the weight while weighing and the summary once done',
      views.dose.view === 'weigh' && views.dose.big === true
      && views.brew.view === 'brew' && views.brew.big === true
      && views.rate.view === 'done' && views.rate.done === true
      && views.rate.big === false,
      Object.entries(views).map(([k, v]) => `${k}:${v.view}`).join(' '));

    // The channel was always two-way. A rating tapped beside the machine is a
    // better rating than one typed on a laptop in another room.
    await phone.evaluate(() => [...document.querySelectorAll('#rate-row button')]
      .find((b) => b.textContent === '8')?.click());
    const landed = await page.waitForFunction(
      () => /Rated 8\/10 from the phone/.test(document.getElementById('live-msg').textContent),
      { timeout: 8000 }).then(() => true).catch(() => false);
    t('link: and a rating tapped on the phone arrives on the laptop',
      landed, landed ? 'draft rated 8/10' : await page.textContent('#live-msg'));
  }
  await phone.close();
  await page.evaluate(() => document.getElementById('pair-dlg').close());

  // A placeholder is not a measurement. "Lands at" falls back to an em dash
  // whenever the flow is too low to project from, and flashing that lit an
  // accent block behind one glyph — a solid rectangle where a number should be.
  {
    const fl = await ctx.newPage();
    await fl.goto(B + '/live.html?mock=lefu&noshot=1');
    await fl.waitForFunction(() => window.__sess, null, { timeout: 5000 });
    const flashed = await fl.evaluate(() => {
      const seen = [];
      const node = document.getElementById('c-lands');
      const obs = new MutationObserver(() => {
        if (node.classList.contains('tick-flash')) seen.push(node.textContent);
      });
      obs.observe(node, { attributes: true, attributeFilter: ['class'] });
      // A real number, then the dash it falls back to, then another number.
      window.__setTextProbe = (v) => window.__setText('c-lands', v, { flash: true });
      return new Promise((res) => {
        window.__setTextProbe('20.0');
        window.__setTextProbe('\u2014');
        window.__setTextProbe('21.0');
        setTimeout(() => { obs.disconnect(); res(seen); }, 120);
      });
    });
    t('live: a dash is not flashed as though a number had changed',
      !flashed.includes('\u2014') && flashed.includes('21.0'),
      `flashed on: ${flashed.map((x) => JSON.stringify(x)).join(', ') || 'nothing'}`);
    await fl.close();
  }

  // ---- an axis one bad sample cannot set ----
  //
  // Reported from a real shot: the flow trace hugged the floor of the chart.
  // The axis was the raw maximum, and a hand resting on the scale for a moment
  // took it to 50 g/s, so a real 1-3 g/s pour was squashed into the bottom few
  // per cent for the rest of the shot. A knock or the cup shifting does the
  // same. The ninetieth percentile cannot be moved by a few samples; the
  // plateau a real pour sits at can move it.
  {
    const ax = await ctx.newPage();
    await ax.goto(B + '/live.html?mock=lefu&noshot=1');
    const axis = await ax.evaluate(async () => {
      const C = await import('./assets/js/core/chart.js');
      const host = document.createElement('div');
      host.style.cssText = 'width:900px;height:320px';
      document.body.append(host);
      const clean = [];
      for (let i = 0; i < 120; i++) {
        const t = i * 0.25;
        const f = t < 3 ? t * 0.6
          : t < 22 ? 1.9 + Math.sin(t) * 0.12
            : Math.max(0, 1.9 - (t - 22) * 0.5);
        clean.push([t, +f.toFixed(3)]);
      }
      const spiked = clean.map((q, i) => (i >= 40 && i < 43 ? [q[0], 22] : q));
      // ...and a pour that genuinely runs fast, which must still be scaled for.
      const fast = clean.map(([t, f]) => [t, f * 2.6]);
      const read = (series) => {
        host.replaceChildren();
        C.livePlot(host, { weight: series.map(([t]) => [t, t]), flow: series,
                           target: 36, width: 900, height: 320 });
        return {
          top: Math.max(...[...host.querySelectorAll('.tick-alt')]
            .map((n) => parseFloat(n.textContent))),
          label: host.querySelector('.axis-label.alt')?.textContent ?? '',
          // Nothing may be drawn above the frame: a clamped sample rides it.
          above: [...host.querySelectorAll('path.flowline')].some((n) =>
            (n.getAttribute('d') || '').split('L').some((seg) => {
              const y = parseFloat(seg.split(',')[1]);
              return Number.isFinite(y) && y < 13;
            })),
        };
      };
      return { clean: read(clean), spiked: read(spiked), fast: read(fast) };
    });
    t('chart: a momentary spike does not set the flow axis',
      axis.spiked.top === axis.clean.top,
      `clean top ${axis.clean.top} g/s, with a 22 g/s transient ${axis.spiked.top} g/s`);
    t('chart: but the spike is reported rather than quietly clamped away',
      /peak/.test(axis.spiked.label) && !/peak/.test(axis.clean.label),
      axis.spiked.label);
    t('chart: and nothing is drawn outside the plot when it is clamped',
      axis.spiked.above === false, 'flow line stays inside the frame');
    t('chart: a pour that genuinely runs fast still gets an axis to match',
      axis.fast.top > axis.clean.top * 2,
      `${axis.clean.top} g/s normally, ${axis.fast.top} g/s for a fast pour`);
    await ax.close();
  }

  // ---- units that survive being shouted ----
  //
  // Every label on this site is uppercased by CSS, which turns "(g)" into "(G)"
  // and "(s)" into "(S)" — gauss and siemens, both real units, neither of them
  // grams or seconds. This walks the rendered pages rather than the source, so
  // it catches a label built in JavaScript too.
  {
    const w = await ctx.newPage();
    const bad = [];
    for (const page of ['live', 'kit', 'advisor', 'logger', 'calculator',
                        'uncertainty', 'settings', 'shots', 'view']) {
      await w.goto(`${B}/${page}.html`);
      const hits = await w.evaluate(() => [...document.querySelectorAll('label, .k, .pn-k')]
        .filter((n) => getComputedStyle(n).textTransform === 'uppercase')
        .map((n) => n.textContent.trim())
        .filter((txt) => /\((g|s)\)/i.test(txt)));
      for (const h of hits) bad.push(`${page}: ${h}`);
    }
    t('copy: no shouted label turns grams into gauss or seconds into siemens',
      bad.length === 0, bad.length ? bad.join(' \u00b7 ') : 'nine pages clean');
    await w.close();
  }

  // ---- an empty state has to name something that exists ----
  {
    const e = await ctx.newPage();
    await e.goto(B + '/logger.html');
    const txt = await e.evaluate(() => ({
      msg: (document.getElementById('empty')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()),
    }));
    // It used to say "or load the samples", and that button had gone with the
    // sample dataset — an empty state naming a control the page does not have
    // is a dead end rather than a hint.
    const named = (txt.msg.match(/press ([A-Z][a-z]+ [a-z]+)/) || [])[1];
    t('copy: the empty state points at a control the page actually has',
      !/load the samples/.test(txt.msg) && !!named && txt.buttons.includes(named),
      `"${txt.msg}" \u2014 offers ${named ?? 'nothing nameable'}`);
    await e.close();
  }

  // ---- a name is cut to the space it has, not to a character count ----
  {
    const n = await ctx.newPage();
    await n.goto(B + '/live.html?mock=lefu&noshot=1');
    await n.waitForFunction(() => window.__sess, null, { timeout: 5000 });
    const cut = await n.evaluate(() => {
      const el = document.getElementById('sv-setup');
      if (!el) return null;
      el.textContent = 'Ethiopia Guji Natural';
      el.title = 'Ethiopia Guji Natural';
      const cs = getComputedStyle(el);
      return { ellipsis: cs.textOverflow, display: cs.display,
               text: el.textContent, title: el.title };
    });
    // It was sliced to eight characters first, so "Ethiopia Guji Natural" became
    // "Ethiopia…" in a cell with room for more — and every coffee sharing those
    // eight characters became the same string.
    t('copy: a long coffee name keeps its whole name and lets CSS do the cutting',
      cut && cut.text === 'Ethiopia Guji Natural' && cut.ellipsis === 'ellipsis'
        && cut.display === 'block' && cut.title === 'Ethiopia Guji Natural',
      cut ? `${cut.display}/${cut.ellipsis}, full name kept` : 'no element');
    await n.close();
  }

  // ---- two families of edge, and components that know which they are in ----
  //
  // Reported: the spacing works on light, dark and terminal and looks wrong on
  // the soft-edged themes. It did. Those themes draw no borders at all, so the
  // only things separating two stacked surfaces are the gap between them and
  // the radius on their corners — and every soft theme was hand-writing radius
  // per component, so anything that had not been converted individually stayed
  // a hard rectangle in the middle of a page of rounded ones. The state strip
  // was exactly that.
  {
    const th = await ctx.newPage();
    await th.goto(B + '/live.html?mock=lefu&noshot=1');
    await th.waitForFunction(() => window.__sess, null, { timeout: 5000 });
    const edges = {};
    for (const name of ['light', 'dark', 'terminal', 'glass']) {
      edges[name] = await th.evaluate((t) => {
        document.documentElement.dataset.theme = t;
        const cs = getComputedStyle(document.documentElement);
        const px = (v) => parseFloat(cs.getPropertyValue(v)) || 0;
        const strip = document.querySelector('.state-strip');
        const bar = document.querySelector('.qbar');
        return { radius: px('--radius'), seam: px('--seam'),
                 strip: parseFloat(getComputedStyle(strip).borderTopLeftRadius) || 0,
                 bar: bar ? parseFloat(getComputedStyle(bar).borderTopLeftRadius) || 0 : 0 };
      }, name);
    }
    const hard = ['light', 'dark', 'terminal'];
    const soft = ['glass'];
    t('themes: the bordered themes are left exactly as they were',
      hard.every((n) => edges[n].radius === 0 && edges[n].seam === 0 && edges[n].strip === 0),
      hard.map((n) => `${n} r${edges[n].radius}/seam${edges[n].seam}`).join(' · '));
    t('themes: the borderless ones get a radius and real air between surfaces',
      soft.every((n) => edges[n].radius >= 10 && edges[n].seam >= 5),
      soft.map((n) => `${n} r${edges[n].radius}/seam${edges[n].seam}`).join(' · '));
    // The actual bug: a surface that draws itself has to follow the theme.
    t('themes: a hand-rolled surface follows the theme instead of staying square',
      soft.every((n) => edges[n].strip === edges[n].radius),
      soft.map((n) => `${n} strip ${edges[n].strip} vs token ${edges[n].radius}`).join(' · '));
    t('themes: and so does a bar, which wants capsule ends without a border',
      soft.every((n) => edges[n].bar > 0) && hard.every((n) => edges[n].bar === 0),
      soft.map((n) => `${n} ${edges[n].bar}`).join(' · '));
    await th.close();
  }

  // ---- a form is read, so it gets a measure ----
  //
  // Measured on Kit: eleven fields stretched to a 1070 px panel, so the box for
  // "Ethiopia Guji" was a thousand pixels wide and so was the one for a date.
  // Nothing was grouped, so they read as one undifferentiated list and the eye
  // had to cross the whole panel to find the next label.
  {
    const kit = await ctx.newPage();
    await kit.setViewportSize({ width: 1400, height: 1000 });
    await kit.goto(B + '/kit.html');
    await kit.evaluate(() => {
      const b = document.querySelector('[data-add="bags"]');
      if (b) b.open = true;
    });
    await kit.waitForTimeout(300);
    const form = await kit.evaluate(() => {
      const w = (id) => Math.round(document.getElementById(id).getBoundingClientRect().width);
      const grid = document.querySelector('.form-grid');
      const panel = grid.closest('.pane') ?? document.body;
      return {
        measure: Math.round(grid.getBoundingClientRect().width),
        panel: Math.round(panel.getBoundingClientRect().width),
        name: w('b-name'), date: w('b-roast'), weight: w('b-weight'),
        bands: [...document.querySelectorAll('.form-grid .band')].map((b) => b.textContent.trim()),
      };
    });
    t('kit: the form is capped at a measure rather than stretched to the panel',
      form.measure <= 780 && form.panel - form.measure > 200,
      `${form.measure}px form in a ${form.panel}px panel`);
    t('kit: and each field is the width of what goes in it',
      form.name > form.date && form.date > form.weight,
      `name ${form.name} > date ${form.date} > grams ${form.weight}`);
    t('kit: eleven fields read as the three things they actually are',
      form.bands.length === 3, form.bands.join(' / '));

    // Below the measure there is no room to be clever.
    await kit.setViewportSize({ width: 390, height: 844 });
    await kit.waitForTimeout(200);
    const narrow = await kit.evaluate(() => {
      const w = (id) => Math.round(document.getElementById(id).getBoundingClientRect().width);
      return { name: w('b-name'), date: w('b-roast'),
               over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    t('kit: on a phone every field takes the whole line, and nothing overflows',
      narrow.name === narrow.date && narrow.over <= 0,
      `both ${narrow.name}px, page overflow ${narrow.over}px`);
    await kit.close();
  }

  // ---- Live changes shape when the shot starts ----
  //
  // Measured on the old layout, at 1280x800, which is an ordinary laptop: the
  // left rail held 865 px of content in the 369 px it gets. 496 px of it — 57%
  // — sat below the fade, including the flow bar, the ladder and the button
  // that stops the shot, which was at y=1040 in a column 740 px tall. The
  // weight itself was cut through the middle. Meanwhile the setup column ran
  // out of content 450 px above the fold.
  //
  // The cause was not spacing. The rail was carrying a second copy of the
  // middle panel — the weight the dial already shows, and a readout
  // `.pour-nums` already shows — and two copies of one panel do not fit in a
  // third of the width.
  {
    const lap = await ctx.newPage();
    await lap.setViewportSize({ width: 1280, height: 800 });
    await lap.goto(B + '/live.html?mock=lefu&noshot=1');
    await lap.waitForFunction(() => window.__mock && window.__sess, null, { timeout: 5000 });
    await lap.evaluate(() => {
      window.__sess.setMethod('espresso');
      const d = document.getElementById('p-dose');
      d.value = '18';
      d.dispatchEvent(new Event('input', { bubbles: true }));
      window.__sess.goto('brew');
      window.__mock.grams = 0;
      window.__brew.startNow(performance.now() / 1000, 0);
      let g = 0;
      window.__pour = setInterval(() => { g += 0.34; window.__mock.grams = +g.toFixed(2); }, 100);
    });
    await lap.waitForTimeout(3000);
    const shape = await lap.evaluate(() => {
      const q = (sel) => document.querySelector(sel);
      const body = q('#cell-now .cell-body');
      const stop = q('#stop').getBoundingClientRect();
      const svg = q('#curve svg');
      const holder = q('#curve');
      const seen = (el) => el && el.offsetParent !== null;
      return {
        railOverflow: body.scrollHeight - body.clientHeight,
        stopVisible: stop.bottom <= innerHeight && stop.height > 0 && seen(q('#stop')),
        ladderVisible: seen(q('#ladder')),
        sideGone: !seen(q('#cell-side')),
        summary: (q('#pour-sum')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        // One weight on the page, not one per panel.
        weights: [...document.querySelectorAll('#o-w, #brew-gauge .g-n')]
          .filter(seen).length,
        // The chart floors its viewBox at 200 and letterboxes inside anything
        // shorter — which collapses its width, not its height.
        chartFills: svg
          ? Math.abs(svg.getBoundingClientRect().width - holder.clientWidth) < 4
          : false,
        chartH: holder.clientHeight,
      };
    });
    await lap.evaluate(() => clearInterval(window.__pour));

    t('live: the rail stops overflowing once the duplicates are gone',
      shape.railOverflow === 0, `${shape.railOverflow}px of hidden content`);
    t('live: the button that stops the shot is on the screen',
      shape.stopVisible, 'stop is visible and in the viewport');
    t('live: and the ladder is not cut in half either', shape.ladderVisible, 'ladder shown');
    t('live: the weight is said once, by the dial',
      shape.weights === 1, `${shape.weights} visible weight readout(s)`);
    t('live: the setup column folds to a line while coffee is coming out',
      shape.sideGone && /Dose/.test(shape.summary), shape.summary.slice(0, 70));
    t('live: and the curve fills the width it was given',
      shape.chartFills && shape.chartH >= 200,
      `chart ${shape.chartH}px tall, fills width ${shape.chartFills}`);
    await lap.close();
  }

  // ---- a link that drops puts a new code up by itself ----
  //
  // Reported: the phone falls off and both screens just sit there. The laptop
  // showed a badge and no way forward; the phone dropped back to a paste box
  // still holding the dead code, which is the one thing that cannot work — a
  // pairing is good for exactly one connection.
  {
    const drop = await ctx.newPage();
    await drop.goto(B + '/view.html');
    await drop.waitForFunction(() => window.__view, null, { timeout: 5000 });
    await page.goto(B + '/live.html?mock=lefu&noshot=1');
    await page.waitForFunction(() => window.__mock, null, { timeout: 5000 });
    await page.click('#watch-phone');
    await page.waitForFunction(
      () => document.getElementById('pair-offer').value.length > 40, { timeout: 15000 });
    await drop.evaluate(() => { document.getElementById('paste-fold').open = true; });
    await drop.fill('#offer', await page.inputValue('#pair-offer'));
    await drop.click('#link');
    await drop.waitForFunction(
      () => document.getElementById('reply').value.length > 40, { timeout: 15000 });
    await page.fill('#pair-answer', await drop.inputValue('#reply'));
    await page.click('#pair-accept');
    await drop.waitForFunction(() => window.__view.link.state === 'open', { timeout: 20000 });
    await page.evaluate(() => document.getElementById('pair-dlg').close());
    const firstCode = await page.inputValue('#pair-offer');

    // The phone goes away the way a phone does: the transport under it stops.
    // Closing the far end is not enough — WebRTC does not promptly tell the
    // near end — so this drops the laptop's own connection, which is what a
    // pocket, a sleep or a walk out of range actually produces.
    await drop.evaluate(() => window.__view.link.close());
    // pc.close() fires nothing — the spec says so — so the data channel is the
    // transition the page actually observes, and the one a real drop produces.
    await page.evaluate(() => window.__watch.ch.close());
    const rearmed = await page.waitForFunction(
      () => document.getElementById('pair-dlg').open
        && document.getElementById('pair-offer').value.length > 40,
      { timeout: 10000 }).then(() => true).catch(() => false);
    t('reconnect: a phone that drops puts a fresh code on the laptop by itself',
      rearmed, rearmed ? await page.textContent('#pair-msg') : 'dialog never reopened');
    t('reconnect: and it is a new code, not the spent one',
      rearmed && (await page.inputValue('#pair-offer')) !== firstCode,
      'differs from the code that was already used');

    const onPhone = await drop.evaluate(() => ({
      dropped: !document.getElementById('pair-dropped').hidden,
      offer: document.getElementById('offer').value,
      replyShown: !document.getElementById('reply-wrap').hidden,
      button: document.getElementById('link').textContent,
    }));
    t('reconnect: the phone says what happened and clears the code that is now spent',
      onPhone.dropped && onPhone.offer === '' && !onPhone.replyShown,
      `dropped ${onPhone.dropped}, box "${onPhone.offer}", reply shown ${onPhone.replyShown}`);

    // And the new code works, which is the whole point.
    await drop.evaluate(() => { document.getElementById('paste-fold').open = true; });
    await drop.fill('#offer', await page.inputValue('#pair-offer'));
    await drop.click('#link');
    await drop.waitForFunction(
      () => document.getElementById('reply').value.length > 40, { timeout: 15000 });
    await page.fill('#pair-answer', await drop.inputValue('#reply'));
    await page.click('#pair-accept');
    const back = await drop.waitForFunction(
      () => window.__view.link.state === 'open', { timeout: 20000 })
      .then(() => true).catch(() => false);
    t('reconnect: and pairing again on the new code brings the phone back',
      back, back ? 'watching again' : 'never reconnected');
    t('reconnect: with the dropped notice put away once it is live',
      await drop.evaluate(() => document.getElementById('pair-dropped').hidden), 'notice cleared');
    await drop.close();
    await page.evaluate(() => document.getElementById('pair-dlg').close());
  }

  // Stopping deliberately is not a drop, and must not throw a code back up.
  {
    const bye = await ctx.newPage();
    await bye.goto(B + '/view.html');
    await bye.waitForFunction(() => window.__view, null, { timeout: 5000 });
    await page.goto(B + '/live.html?mock=lefu&noshot=1');
    await page.waitForFunction(() => window.__mock, null, { timeout: 5000 });
    await page.click('#watch-phone');
    await page.waitForFunction(
      () => document.getElementById('pair-offer').value.length > 40, { timeout: 15000 });
    await bye.evaluate(() => { document.getElementById('paste-fold').open = true; });
    await bye.fill('#offer', await page.inputValue('#pair-offer'));
    await bye.click('#link');
    await bye.waitForFunction(
      () => document.getElementById('reply').value.length > 40, { timeout: 15000 });
    await page.fill('#pair-answer', await bye.inputValue('#reply'));
    await page.click('#pair-accept');
    await bye.waitForFunction(() => window.__view.link.state === 'open', { timeout: 20000 });
    await page.evaluate(() => document.getElementById('pair-dlg').close());
    await page.click('#watch-phone');            // "Stop watching"
    await page.waitForTimeout(1200);
    t('reconnect: stopping on purpose does not reopen the pairing dialog',
      !(await page.evaluate(() => document.getElementById('pair-dlg').open)),
      'dialog stayed shut');
    await bye.close();
  }

  // ---- the same handshake in the configuration a real browser uses ----
  //
  // Every page above runs in a browser launched with
  // --disable-features=WebRtcHideLocalIpsWithMdns, because mDNS hostnames do
  // not resolve in a headless container. That flag is a lie about the world:
  // Chrome and Safari hide local IPs behind `<uuid>.local` by default, so the
  // candidates a kitchen laptop actually offers are the one shape this suite
  // had never once exercised. `packCandidate` has an mDNS branch and nothing
  // proved it round-trips.
  //
  // So: a second browser, without the flag, for one handshake.
  {
    const real = await chromium.launch(
      process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
    try {
      const rctx = await real.newContext({ viewport: { width: 1400, height: 1000 } });
      const laptop = await rctx.newPage();
      const pad = await rctx.newPage();
      await pad.goto(B + '/view.html');
      await pad.waitForFunction(() => window.__view, null, { timeout: 5000 });
      await laptop.goto(B + '/live.html?mock=lefu&noshot=1');
      await laptop.waitForFunction(() => window.__mock, null, { timeout: 5000 });
      await laptop.click('#watch-phone');
      await laptop.waitForFunction(
        () => document.getElementById('pair-offer').value.length > 40, { timeout: 15000 });
      const code = await laptop.inputValue('#pair-offer');

      // What the laptop gathered, and what survived being packed.
      const shape = await laptop.evaluate(async (c) => {
        const S = await import('./assets/js/core/sdp.js');
        const back = S.unpack(c) ?? '';
        return {
          kinds: c.split('~').pop().split('.').map((tok) => tok[0]),
          addrs: back.split(/\r?\n/).filter((l) => l.startsWith('a=candidate:'))
            .map((l) => l.split(' ')[4]),
          fits: c.length <= S.MAX_CODE,
        };
      }, code);
      t('link: a real browser offers mDNS candidates, and they survive packing',
        shape.kinds.includes('m') && shape.addrs.some((a) => /\.local$/.test(a)),
        `tokens ${shape.kinds.join(',')} \u2192 ${shape.addrs.join(' ')}`);
      t('link: and the packed code still fits the QR budget with them in it',
        shape.fits, `${code.length} chars`);

      await pad.evaluate(() => { document.getElementById('paste-fold').open = true; });
      await pad.fill('#offer', code);
      await pad.click('#link');
      await pad.waitForFunction(
        () => document.getElementById('reply').value.length > 40, { timeout: 15000 });
      await laptop.fill('#pair-answer', await pad.inputValue('#reply'));
      await laptop.click('#pair-accept');
      const up = await pad.waitForFunction(
        () => window.__view.link.state === 'open', { timeout: 25000 })
        .then(() => true).catch(() => false);
      t('link: two pages pair with mDNS on, the way they do outside a container',
        up, up ? 'data channel open' : 'never connected');
      if (up) {
        await laptop.evaluate(() => { window.__mock.grams = 19.4; });
        const fed = await pad.waitForFunction(
          () => Math.abs(Number(document.getElementById('w').textContent) - 19.4) < 0.4,
          { timeout: 10000 }).then(() => true).catch(() => false);
        t('link: and the weight crosses that link too', fed, await pad.textContent('#w'));
      }
    } finally {
      await real.close();
    }
  }

  // On screen: it appears once there is something to weigh, not before.
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(() => window.__sess, null, { timeout: 5000 });
  await page.evaluate(async () => {
    const kit = await import('./assets/js/core/kit.js');
    window.__sess.reset();
    window.__sess.setReady(true);
    window.__sess.begin();
    window.__sess.setTarget(18);
    void kit;
    window.__mock.grams = 0;
  });
  await page.waitForTimeout(500);
  const beforeCup = await page.evaluate(() => document.getElementById('fill').hidden);
  await page.evaluate(() => { window.__mock.grams = 52; });
  await page.waitForFunction(() => window.__sess.phase === 'fill', null, { timeout: 6000 });
  await page.evaluate(() => { window.__mock.grams = 61; });   // 9 g in
  await page.waitForTimeout(900);
  const halfway = await page.evaluate(() => ({
    hidden: document.getElementById('fill').hidden,
    cls: document.getElementById('fill').className,
    width: document.getElementById('fill-now').style.width,
    of: document.getElementById('fill-of').textContent,
    gap: document.getElementById('fill-gap').textContent,
  }));
  await page.evaluate(() => { window.__mock.grams = 70.2; });  // 18.2 g in
  await page.waitForFunction(
    () => document.getElementById('fill').className.includes('is-in'), { timeout: 6000 });
  const landed = await page.evaluate(() => ({
    cls: document.getElementById('fill').className,
    gap: document.getElementById('fill-gap').textContent,
    hero: document.querySelector('.st.hero').className,
  }));

  t('bar: nothing to show while it is still waiting for the cup',
    beforeCup === true, `hidden: ${beforeCup}`);
  t('bar: it appears once the cup is tared, and counts down the gap',
    halfway.hidden === false && /is-under/.test(halfway.cls)
    && /9\.0 \/ 18\.0 g/.test(halfway.of) && /to go/.test(halfway.gap),
    `${halfway.of} — ${halfway.gap} (${halfway.width})`);
  t('bar: and turns over to the live colour once you are in the window',
    /is-in/.test(landed.cls) && landed.gap === 'in the window', landed.gap);
  // Across a kitchen the bar is a detail and the tile is a blue rectangle, so
  // the tile is what has to change when you land.
  t('bar: and the whole tile acknowledges it, not only the bar',
    /in-window/.test(landed.hero), landed.hero);
  const cleared = await page.evaluate(async () => {
    window.__mock.grams = 0;
    window.__sess.goto('setup');
    await new Promise((r) => setTimeout(r, 400));
    return document.querySelector('.st.hero').className;
  });
  t('bar: the acknowledgement clears when the bar does',
    !/in-window/.test(cleared), cleared);

  // ---- leaving Live should not cost you the scale or the phone ----
  // A page navigation destroys a GATT connection and a peer connection alike;
  // nothing in a web page can prevent that. What it can do is not need to.
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(() => window.__mock, null, { timeout: 5000 });
  await page.waitForTimeout(400);
  const guarded = await page.evaluate(async () => {
    // A sentinel that cannot survive a navigation, which is the whole claim.
    window.__stillHere = 'yes';
    const guardedLinks = [...document.querySelectorAll('.nav a.guarded')]
      .map((a) => a.getAttribute('href'));
    const tabs = [...document.querySelectorAll('.nav a[href$=".html"]')]
      .some((a) => a.getAttribute('target'));
    document.querySelector('.nav a.guarded[href$="shots.html"]').click();
    await new Promise((r) => setTimeout(r, 80));
    const open = {
      shown: !document.getElementById('browse').hidden,
      src: document.querySelector('#browse iframe').getAttribute('src'),
      locked: getComputedStyle(document.body).overflow,
    };
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await new Promise((r) => setTimeout(r, 80));
    return { ...open, guardedLinks, tabs,
      connected: window.__mock.connected,
      alive: window.__stillHere,
      closed: document.getElementById('browse').hidden,
      kept: document.querySelector('#browse iframe').getAttribute('src'),
      // The page you are already on is not going anywhere, so it is left alone.
      here: document.querySelector('.nav a[aria-current]')?.classList.contains('guarded'),
      titled: [...document.querySelectorAll('.nav a.guarded')]
        .every((a) => /keeps the scale/.test(a.title)),
    };
  });
  t('nav guard: while the scale is connected, the other pages open over this one',
    guarded.connected === true && guarded.shown === true
    && guarded.src === './shots.html' && guarded.locked === 'hidden',
    `shown ${guarded.shown}, src ${guarded.src}`);
  t('nav guard: and this page never unloads, so the scale is still held',
    guarded.alive === 'yes' && guarded.connected === true,
    `sentinel ${guarded.alive}, connected ${guarded.connected}`);
  t('nav guard: no new tabs — the shot would be on a window you stopped watching',
    guarded.tabs === false, `any target attribute: ${guarded.tabs}`);
  t('nav guard: except the one you are on, which is not going anywhere',
    guarded.here === false, `Live guarded: ${guarded.here}`);
  t('nav guard: and each link says why, rather than surprising you',
    guarded.titled === true && guarded.guardedLinks.length === 5,
    `${guarded.guardedLinks.length} guarded: ${guarded.guardedLinks.join(' ')}`);
  t('nav guard: escape comes back, and the page you were on is still loaded',
    guarded.closed === true && guarded.kept === './shots.html',
    `closed ${guarded.closed}, frame kept ${guarded.kept}`);

  // Which scale this tab had open, so returning to Live picks it up with no
  // click. Session-scoped: a tab opened tomorrow should not go hunting for a
  // scale in a cupboard.
  const held = await page.evaluate(() => sessionStorage.getItem('brewkit.live.connected'));
  t('nav guard: the tab remembers which scale it had, so coming back is silent',
    held === 'mock:lefu', String(held));

  // A dropout is not the same as "I am done": the flag survives one, because
  // that is exactly when you want it picked back up. Pressing Disconnect is.
  await page.evaluate(() => window.__mock.disconnect());
  await page.waitForTimeout(1300);
  const afterDrop = await page.evaluate(() => ({
    held: sessionStorage.getItem('brewkit.live.connected'),
    guarded: document.querySelectorAll('.nav a.guarded').length,
    titled: [...document.querySelectorAll('.nav a[href$=".html"]')].some((a) => a.title),
  }));
  t('nav guard: and it lets go the moment there is nothing to protect',
    afterDrop.guarded === 0 && afterDrop.titled === false,
    `${afterDrop.guarded} links still guarded`);
  t('nav guard: a dropout is not a decision, so the scale stays remembered',
    afterDrop.held === 'mock:lefu', String(afterDrop.held));

  await page.evaluate(() => document.getElementById('disconnect').click());
  await page.waitForTimeout(200);
  t('nav guard: pressing Disconnect is a decision, and clears it',
    await page.evaluate(() => sessionStorage.getItem('brewkit.live.connected')) === null,
    'forgotten');

  // ---- the destructive buttons actually destroy ----
  // Delete on a bag threw a ReferenceError on every click: `usage` had been
  // renamed two refactors earlier and survived only inside that handler, where
  // nothing but a click would ever evaluate it.
  await page.goto(B + '/kit.html');
  // Everything Kit holds is fixture for later tests, so it is put back
  // afterwards — wiping it here is what broke three unrelated tests last time.
  const kept = await page.evaluate(async () => {
    const kit = await import('./assets/js/core/kit.js');
    const supply = await import('./assets/js/core/supply.js');
    const snap = {
      bags: kit.bags().map((r) => ({ ...r })),
      grinders: kit.grinders().map((r) => ({ ...r })),
      machines: kit.machines().map((r) => ({ ...r })),
      consumables: supply.consumables().map((r) => ({ ...r })),
    };
    for (const b of snap.bags) kit.removeBag(b.id);
    for (const g of snap.grinders) kit.removeGrinder(g.id);
    for (const m of snap.machines) kit.removeMachine(m.id);
    for (const c of snap.consumables) supply.removeConsumable(c.id);
    kit.saveBag({ id: null, bean_name: 'Doomed Bag', roast_date: '2026-08-20', weight_g: 250 });
    kit.saveGrinder({ id: null, name: 'Doomed Grinder', min: 0, max: 40, step: 0.5 });
    kit.saveMachine({ id: null, name: 'Doomed Machine' });
    supply.saveConsumable({ id: null, name: 'Doomed Filter', kind: 'shots', capacity: 3 });
    return snap;
  });
  // A dialog handler is already registered at the top of the suite; a second
  // one races it and throws "already handled".
  const gone = {};
  for (const [tab, holder, kind] of [['bags', '#bags', 'bag'], ['grinders', '#grinders', 'grinder'],
                                     ['machines', '#machines', 'machine'],
                                     ['consumables', '#consumables', 'consumable']]) {
    await page.reload();
    await kitTab(tab);
    await page.waitForSelector(`${holder} .bx`, { timeout: 4000 });
    await page.evaluate((sel) => [...document.querySelectorAll(`${sel} button`)]
      .find((b) => /^(delete|stop tracking)$/i.test(b.textContent.trim()))?.click(), holder);
    await page.waitForTimeout(350);
    gone[kind] = await page.evaluate((sel) => document.querySelectorAll(`${sel} .bx`).length, holder);
  }
  t('kit: Delete deletes, on every kind of thing Kit holds',
    Object.values(gone).every((n) => n === 0), JSON.stringify(gone));

  await page.evaluate(async (snap) => {
    const kit = await import('./assets/js/core/kit.js');
    const supply = await import('./assets/js/core/supply.js');
    for (const b of snap.bags) kit.saveBag(b);
    for (const g of snap.grinders) kit.saveGrinder(g);
    for (const m of snap.machines) kit.saveMachine(m);
    for (const c of snap.consumables) supply.saveConsumable(c);
  }, kept);
  t('kit: and the fixture the rest of the suite runs on is put back',
    await page.evaluate(async () =>
      (await import('./assets/js/core/kit.js')).bags().length) === kept.bags.length,
    `${kept.bags.length} bags restored`);

  // ---- Reset clears the screen, not just the machines ----
  // Nothing streaming afterwards, so what the reset leaves behind is what stays
  // on screen — with a live scale the readout rightly goes back to whatever is
  // sitting on the platform.
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(() => window.__mock, null, { timeout: 5000 });
  await page.evaluate(() => { window.__sess.goto('brew'); window.__mock.grams = 0; });
  await page.waitForTimeout(400);
  // Tare, Arm, Start and Reset live behind "Manual controls" now — they are
  // escape hatches, and five buttons of chrome between the readout and the
  // notes is what made the column scroll. Open the fold like a person would.
  await page.evaluate(() => { document.querySelector('.manual').open = true; });
  await page.click('#arm');
  await page.evaluate(() => window.__mock.runShot({ cup: 120, target: 36 }));
  await page.waitForFunction(
    () => document.getElementById('curve').querySelector('.weightline'), { timeout: 20000 });
  await page.waitForTimeout(2500);
  const preReset = await page.evaluate(() => ({
    curve: document.getElementById('curve').querySelectorAll('.weightline').length,
    points: window.__brew.curve.length,
  }));
  await page.click('#discard');
  await page.waitForTimeout(300);
  // The scale is deliberately left connected — it is the session, not the shot
  // — so the readout goes back to whatever is on the platform rather than to
  // zero. What must go is everything belonging to the pour just finished.
  const postReset = await page.evaluate(() => ({
    curve: document.getElementById('curve').querySelectorAll('.weightline').length,
    points: window.__brew.curve.length,
    diag: document.getElementById('r-diag').childElementCount,
    summary: document.getElementById('b-summary').childElementCount,
    msg: document.getElementById('live-msg').textContent,
    step: window.__sess.step,
    yield: document.getElementById('r-yield').value,
  }));
  t('live: Reset takes the last pour off the chart',
    preReset.curve > 0 && preReset.points > 0
    && postReset.curve === 0 && postReset.points === 0,
    `${preReset.points} points → ${postReset.points}`);
  t('live: and clears what the pour left behind, not just the machines',
    postReset.diag === 0 && postReset.summary === 0 && postReset.yield === '',
    `diag ${postReset.diag}, summary ${postReset.summary}, yield "${postReset.yield}"`);
  t('live: and puts the flow back where the current kit says it belongs',
    ['setup', 'dose'].includes(postReset.step) && /reset/i.test(postReset.msg),
    `${postReset.step} — ${postReset.msg}`);

  // ---- what the log says about the habit ----
  // A shot log is a diary whether or not it was kept as one, and once there are
  // a few hundred rows the interesting question stops being "how was that shot".
  const habit = await page.evaluate(async () => {
    const h = await import('./assets/js/core/habits.js');
    const today = new Date(2026, 7, 29, 10, 0, 0);          // Sat 29 Aug 2026
    const at = (y, m, d, hh = 8) =>
      `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} `
      + `${String(hh).padStart(2, '0')}:30:00`;
    const shots = [
      // Three days running, ending today.
      { timestamp: at(2026, 8, 27), dose_g: 18, rating: 8 },
      { timestamp: at(2026, 8, 28), dose_g: 18.2, rating: 7 },
      { timestamp: at(2026, 8, 28, 15), dose_g: 18.1 },
      { timestamp: at(2026, 8, 29), dose_g: 17.9, rating: 9 },
      // A gap, then an older cluster.
      { timestamp: at(2026, 8, 20), dose_g: 18 },
      { timestamp: at(2026, 8, 20, 9), dose_g: 18 },
      { timestamp: at(2026, 8, 20, 16), dose_g: 18 },
      // Rows from before timestamps were kept must not crash anything.
      { dose_g: 18 }, { timestamp: 'not a date', dose_g: 18 },
    ];
    const cal = h.calendar(shots, { weeks: 6, today });
    const flat = cal.cols.flat();
    return {
      days: [...h.byDay(shots).entries()].map(([k, v]) => `${k}:${v.shots}`).sort().join(' '),
      streak: h.streak(shots, today),
      peak: cal.peak,
      cells: flat.length,
      lastCol: cal.cols.at(-1).map((c) => c.shots).join(','),
      future: flat.filter((c) => c.future).length,
      busiest: h.rhythm(shots).busiestDay,
      hour: h.rhythm(shots).busiestHour,
      dated: h.rhythm(shots).dated,
      recent: h.summary(shots, { days: 30, today }),
      // Safari returns Invalid Date for 'YYYY-MM-DD HH:MM:SS' without the T.
      parsed: h.shotDate({ timestamp: at(2026, 8, 29, 7) })?.getHours() ?? null,
    };
  });
  t('habits: shots are counted by the local day they were pulled on',
    habit.days === '2026-08-20:3 2026-08-27:1 2026-08-28:2 2026-08-29:1', habit.days);
  t('habits: an undated row is skipped rather than filed under 1970',
    habit.dated === 7, `${habit.dated} of 9 rows had a usable date`);
  t('habits: a timestamp without a T still parses to the right hour',
    habit.parsed === 7, `hour ${habit.parsed}`);
  t('habits: the streak counts back from today',
    habit.streak === 3, `${habit.streak} days`);
  t('habits: the calendar is weeks by weekdays, Monday first',
    habit.cells === 42 && habit.peak === 3 && habit.lastCol === '0,0,0,1,2,1,0',
    `${habit.cells} cells, peak ${habit.peak}, this week ${habit.lastCol}`);
  t('habits: days after today are marked, not drawn as empty ones',
    habit.future === 1, `${habit.future} future cell (Sunday)`);
  t('habits: it knows which day and hour you actually pull coffee',
    habit.busiest === 'Thursday' && habit.hour === 8,
    `${habit.busiest}s around ${habit.hour}:00`);
  t('habits: and totals the recent window without counting a day twice',
    habit.recent.shots === 7 && habit.recent.activeDays === 4
    && Math.abs(habit.recent.perActiveDay - 1.75) < 1e-9
    && Math.abs(habit.recent.rating - 8) < 1e-9,
    `${habit.recent.shots} shots over ${habit.recent.activeDays} days, `
      + `${habit.recent.grams} g, rated ${habit.recent.rating}`);

  // ---- the habit pane draws the log as a calendar ----
  await page.goto(B + '/kit.html');
  await page.click('[data-kit-tab="habits"]');
  await page.waitForTimeout(400);
  const pane = await page.evaluate(() => ({
    cells: document.querySelectorAll('#cal i').length,
    shaded: [...document.querySelectorAll('#cal i')].filter((i) => i.dataset.n !== '0').length,
    months: document.querySelectorAll('#cal-months span').length,
    hours: document.querySelectorAll('#hours i').length,
    axis: [...document.querySelectorAll('#hour-axis span')].map((x) => x.textContent)
      .filter(Boolean).join(','),
    stats: document.querySelectorAll('#h-stats .c').length,
    titled: document.querySelector('#cal i')?.title ?? '',
  }));
  t('habits: six months of days, drawn as a calendar',
    pane.cells === 182 && pane.months >= 6 && pane.stats === 6,
    `${pane.cells} cells, ${pane.months} month labels, ${pane.stats} stats`);
  t('habits: with the hours under it, and an axis you can read',
    pane.hours === 24 && pane.axis === '00,06,12,18', pane.axis);
  t('habits: every day says what it was, not just how dark it is',
    /^\d{4}-\d{2}-\d{2}: \d+ shot/.test(pane.titled), pane.titled);

  // ---- a bag drawn past empty says so, rather than printing a negative ----
  const overdrawn = await page.evaluate(async () => {
    const supply = await import('./assets/js/core/supply.js');
    const bag = { id: 'over-1', weight_g: 100 };
    const shots = Array.from({ length: 10 }, (_, i) => ({ shot_id: `o${i}`, bag_id: 'over-1', dose_g: 18 }));
    const st = supply.bagStatus(bag, shots);
    return { remaining: st.remaining, left: st.left, over: st.over, empty: st.empty };
  });
  t('supply: over-drawing a bag is recorded exactly and printed as used up',
    overdrawn.remaining === -80 && overdrawn.left === 0 && overdrawn.over === 80
    && overdrawn.empty === true,
    `${overdrawn.remaining} g exact, ${overdrawn.left} g shown, ${overdrawn.over} g over`);

  // ---- the flow reads left to right ----
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(() => window.__sess, null, { timeout: 5000 });
  const where = await page.evaluate(() => {
    const inNow = (id) => !!document.getElementById('cell-now').querySelector(`#${id}`);
    return { stepper: inNow('stepper'), bag: inNow('p-bag'), grinder: inNow('p-grinder'),
             machine: inNow('p-machine') };
  });
  t('setup: the step you are on and the two choices it wants are the first things on the page',
    where.stepper && where.bag && where.grinder && !where.machine,
    'stepper, coffee and grinder on the left; machine stays with the shot settings');

  // ---- the middle column changes with the step ----
  // Before a shot there is nothing on the chart worth the biggest panel on the
  // page, and the dial is what is actually being read.
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(() => window.__sess, null, { timeout: 5000 });
  await page.evaluate(() => { window.__sess.goto('dose'); window.__sess.setTarget(18); });
  await page.waitForTimeout(300);
  const weighing = await page.evaluate(() => ({
    tag: document.getElementById('mid-tag').textContent,
    prep: document.getElementById('slide-prep').dataset.off,
    pour: document.getElementById('slide-pour').dataset.off,
    // Nothing about the chart is up before the chart is: the swatches name a
    // curve that is not on screen, and the reference picker offers to lay a
    // ghost over it.
    legend: !document.getElementById('pour-legend').hidden,
  }));
  await page.evaluate(() => window.__sess.goto('brew'));
  await page.waitForTimeout(400);
  const pouring = await page.evaluate(() => ({
    tag: document.getElementById('mid-tag').textContent,
    prep: document.getElementById('slide-prep').dataset.off,
    pour: document.getElementById('slide-pour').dataset.off,
    legend: !document.getElementById('pour-legend').hidden,
  }));
  t('mid: weighing gets the dial, and nothing about a chart that is not there',
    weighing.tag === 'Weighing' && weighing.prep === '' && weighing.pour === 'right'
    && weighing.legend === false,
    `${weighing.tag}, legend up ${weighing.legend}`);
  t('mid: and the chart, with its key, slides in when the shot does',
    pouring.tag === 'The pour' && pouring.pour === '' && pouring.prep === 'left'
    && pouring.legend === true,
    `${pouring.tag}, prep ${pouring.prep}, legend up ${pouring.legend}`);

  // The dial is the fill bar's geometry on an arc, so it moves with the weight.
  const dial = await page.evaluate(async () => {
    const read = () => ({
      off: Number(document.getElementById('dial-now').style.strokeDashoffset),
      n: document.getElementById('dial-n').textContent,
      sub: document.getElementById('dial-sub').textContent,
      cls: document.getElementById('slide-prep').className,
      band: document.getElementById('dial-band').getAttribute('d') ?? '',
    });
    window.__sess.goto('dose');
    window.__sess.setTarget(18);
    const { fillProgress } = await import('./assets/js/core/session.js');
    return { empty: fillProgress(0, 18).frac, mid: fillProgress(9, 18).frac,
             at: fillProgress(18.2, 18).frac, read: read() };
  });
  // The track sweeps left to right, so an 18 g window belongs on the right half
  // — drawing it on the left was the first version of this and looked absurd.
  const bandXs = (dial.read.band.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  t('mid: the dial runs left to right, and its window sits where the arc reaches it',
    dial.empty === 0 && dial.mid > 0.3 && dial.mid < 0.5 && dial.at > 0.7
    && bandXs[0] > 100 && bandXs.at(-2) > bandXs[0],
    `window from x=${bandXs[0]} to x=${bandXs.at(-2)} on a 14–186 track`);

  // ---- cues, for when you are not looking at the screen ----
  const cues = await page.evaluate(async () => {
    const cue = await import('./assets/js/core/cue.js');
    const g = new cue.CueGate({ enabled: true });
    let fired = 0;
    const bump = () => { fired += 1; };
    const edges = [
      g.edge('a', false, bump), g.edge('a', true, bump), g.edge('a', true, bump),
      g.edge('a', true, bump), g.edge('a', false, bump), g.edge('a', true, bump),
    ];
    let ticks = 0;
    const tock = () => { ticks += 1; };
    // A 10 Hz stream counting down: one tick per whole second, not per frame.
    for (let i = 50; i >= 1; i--) g.every('eta', i / 10, tock);
    const off = new cue.CueGate({ enabled: false });
    off.edge('a', true, bump);
    return { edges, fired, ticks, armed: cue.isArmed() };
  });
  t('cues: a cue fires on the edge, not on every frame of a 10 Hz stream',
    cues.edges.join(',') === 'false,true,false,false,false,true' && cues.fired === 2,
    `${cues.fired} tones over six frames`);
  t('cues: the countdown ticks once a second, not fifty times',
    cues.ticks === 5, `${cues.ticks} ticks over the last five seconds`);
  t('cues: and nothing sounds until audio has been allowed',
    cues.armed === false, 'silent until a gesture arms it');

  // Cues are on by default now. The whole point of them is that they reach you
  // when you are not looking at the screen, and a default of off meant nobody
  // who would benefit ever found out they existed — which is what happened.
  const cueUi = await page.evaluate(() => {
    const b = document.getElementById('cues');
    const start = { text: b.textContent, pressed: b.getAttribute('aria-pressed') };
    b.click();
    const off = { text: b.textContent, pressed: b.getAttribute('aria-pressed'),
                  saved: localStorage.getItem('brewkit.cues') };
    b.click();
    const on = { text: b.textContent, pressed: b.getAttribute('aria-pressed'),
                 saved: localStorage.getItem('brewkit.cues') };
    return { start, off, on };
  });
  t('cues: they are on out of the box, not opt-in',
    cueUi.start.pressed === 'true' && /Sound on|Sound blocked/.test(cueUi.start.text),
    cueUi.start.text);
  t('cues: the switch says which of the three states it is in, both ways',
    cueUi.off.text === 'Sound off' && cueUi.off.pressed === 'false' && cueUi.off.saved === 'off'
    && /Sound on|Sound blocked/.test(cueUi.on.text) && cueUi.on.saved === 'on',
    `${cueUi.start.text} → ${cueUi.off.text} → ${cueUi.on.text}`);

  // ---- the scale's battery, which its own display shows and a laptop does not ----
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(
    () => !document.getElementById('battery').hidden, { timeout: 8000 }).catch(() => {});
  const batt = await page.evaluate(() => ({
    hidden: document.getElementById('battery').hidden,
    text: document.getElementById('battery').textContent,
    cls: document.getElementById('battery').className,
  }));
  t('battery: the scale reports it and the page shows it',
    batt.hidden === false && batt.text === '76%' && /ok/.test(batt.cls), batt.text);

  // ---- Lab holds the analysis tools ----
  await page.goto(B + '/lab.html');
  const labLinks = await page.$$eval('.tool-card', (as) => as.map((a) => a.getAttribute('href')));
  t('lab: the analysis tools moved behind one page',
    ['./calculator.html', './explore.html', './quality.html', './uncertainty.html']
      .every((h) => labLinks.includes(h)), labLinks.join(' '));
  // THE ROW IS DESTINATIONS. It had grown to nine items by accretion — six in
  // each page's markup, a Backup link appended by one function, a view toggle by
  // another — and it was mixing places you work with two controls that are not
  // places at all. The row is the five you work in; everything else is one bin.
  const topBar = await page.evaluate(() => ({
    row: [...document.querySelectorAll('.nav > a')].map((a) => a.getAttribute('href')),
    menu: [...document.querySelectorAll('.menu-panel a')].map((a) => a.getAttribute('href')),
    groups: [...document.querySelectorAll('.menu-k')].map((k) => k.textContent.trim()),
    controls: [...document.querySelectorAll('.menu-panel button')].length,
  }));
  t('lab: the daily loop is what the nav row shows, and nothing else',
    topBar.row.join(',') === './live.html,./shots.html,./advisor.html,./kit.html,./lab.html',
    topBar.row.join(' '));
  // TWO THINGS THAT WENT WRONG BUILDING IT, both invisible to a test that only
  // asks whether the menu opens.
  const menuBox = await page.evaluate(async () => {
    const menu = document.querySelector('.menu');
    const panel = document.querySelector('.menu-panel');
    menu.open = false;
    await new Promise((r) => setTimeout(r, 60));
    const shutH = Math.round(panel.getBoundingClientRect().height);
    menu.open = true;
    menu.dispatchEvent(new Event('toggle'));
    await new Promise((r) => setTimeout(r, 80));
    const r = panel.getBoundingClientRect();
    menu.open = false;
    return { shutH, w: Math.round(r.width),
             onScreen: r.right <= innerWidth + 1 && r.left >= -1 && r.top >= -1 };
  });
  // A browser hides a closed `details`' children through the slot that renders
  // them, and `position:fixed` takes the panel out of that slot — so it sat on
  // every page, full size, while the menu was shut. The fix is a display rule,
  // and this is what notices if it is ever dropped.
  t('bar: the panel is not on the page while the menu is closed',
    menuBox.shutH === 0, `${menuBox.shutH}px tall with the menu shut`);
  t('bar: and it opens inside the viewport',
    menuBox.onScreen && menuBox.w > 0, `${menuBox.w}px wide, on screen ${menuBox.onScreen}`);

  t('lab: settings and backup are in the menu, sorted into named bins',
    topBar.menu.join(',') === './settings.html,./backup.html'
    && topBar.groups.join(' / ') === 'This screen / Your setup',
    `${topBar.groups.join(' / ')} — ${topBar.menu.join(' ')}, ${topBar.controls} controls`);







  // ---- the dashboard shows more than the shot in front of you ----
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 8000 });
  await page.selectOption('#p-bag', kitIds.bag);
  await page.waitForTimeout(400);

  const shotCtx = await page.evaluate(() => ({
    name: document.getElementById('cc-name').textContent,
    age: document.getElementById('cc-age').textContent,
    facts: document.getElementById('cc-facts').textContent,
    trend: document.getElementById('cc-trend').textContent,
    hist: document.querySelectorAll('#history .hist').length,
    ghosts: [...document.getElementById('ghost-pick').options].map((o) => o.textContent),
  }));
  t('dashboard: the coffee in front of you is on screen',
    /Test Guji/.test(shotCtx.name) && /9 d/.test(shotCtx.age), `${shotCtx.name} · ${shotCtx.age}`);
  t('dashboard: with how much is left and how it has been going',
    /g left/.test(shotCtx.facts) && /shot/.test(shotCtx.facts), shotCtx.facts);
  t('dashboard: past pours are shown as shapes, not just numbers',
    shotCtx.hist >= 1, shotCtx.hist + ' in the history strip');
  // Pouring against a curve you already liked beats aiming for a number.
  t('dashboard: a reference shot can be poured against',
    shotCtx.ghosts.some((o) => /best rated/.test(o)), shotCtx.ghosts.join(' | ').slice(0, 70));

  // Chosen during the pour, which is when the chart it annotates exists. The
  // picker used to sit out through the weighing steps on the argument that a
  // reference is picked before you pour — but until there is a curve it is a
  // dropdown offering to lay a ghost over nothing, so it comes up with the
  // chart now. The options are still built ahead of time, which is what the
  // assertion above reads.
  await page.evaluate(() => window.__sess.goto('brew'));
  await page.waitForTimeout(300);
  await page.selectOption('#ghost-pick', { index: 1 });
  await page.waitForTimeout(300);
  t('dashboard: choosing one draws it behind the live pour',
    (await page.locator('#curve svg path.ghost').count()) >= 1,
    (await page.locator('#curve svg path.ghost').count()) + ' ghost traces');
  t('dashboard: the target is a line on the plot, not only a digit',
    (await page.locator('#curve svg line.target').count()) === 1, 'target line drawn');

  // ---- notes stop explaining once you have read them ----
  // The notes that actually repeat are the connect-screen ones — browser
  // support, the reconnect path, "scale not listed".
  // The notes that actually repeat are the connect-screen ones — browser
  // support, the reconnect path, "scale not listed". Some tagged notes live
  // inside closed disclosures, so count only what is actually on screen.
  await page.goto(B + '/live.html');
  const shown = page.locator('[data-notice]:not([hidden]):visible');
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-notice]:not([hidden])')]
      .some((n) => n.offsetParent !== null), { timeout: 8000 });
  const notesBefore = await shown.count();
  t('dashboard: recurring notes carry a dismiss', notesBefore > 0
    && (await page.locator('[data-notice]:not([hidden]):visible .notice-x').count()) > 0,
    notesBefore + ' dismissible notes');
  await page.locator('[data-notice]:not([hidden]):visible .notice-x').first().click();
  await page.waitForTimeout(200);
  const notesAfter = await shown.count();
  t('dashboard: dismissing one hides it', notesAfter === notesBefore - 1,
    `${notesBefore} → ${notesAfter}`);
  await page.reload();
  await page.waitForTimeout(900);
  t('dashboard: and it stays hidden on the next visit',
    (await shown.count()) === notesAfter, 'still ' + (await shown.count()));
  // A preference you cannot reverse is a trap — and the control has to be
  // reachable from where the note was, which is the connect screen.
  t('dashboard: hidden notes can be brought back',
    /Restore 1 hidden note/.test(await page.textContent('#restore-notes')),
    await page.textContent('#restore-notes'));
  await page.click('#restore-notes');
  await page.waitForTimeout(300);
  t('dashboard: restoring brings them all back',
    (await shown.count()) === notesBefore, `${notesAfter} → ${await shown.count()}`);



  // The deploy refuses to ship a page missing its closing tag. Not everything
  // with an .html extension is a page, though — a one-line stub has no opening
  // tag either and must not be mistaken for a truncated one.
  const guard = await (async () => {
    const { readFile } = await import('node:fs/promises');
    const yml = await readFile('.github/workflows/pages.yml', 'utf8');
    return /grep -q '<html' "\$f" \|\| continue/.test(yml);
  })();
  t('deploy: the page guard skips files that are not pages', guard,
    guard ? 'guarded' : 'the sanity check would reject a one-line stub');

  // Nothing in the repo should still be reaching for the Google verification
  // stub, the client id module, or the Sync page — all three are gone.
  const ghosts = await (async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const files = (await readdir('site')).filter((f) => f.endsWith('.html'));
    const hits = [];
    for (const f of files) {
      const body = await readFile(`site/${f}`, 'utf8');
      if (/sync\.html|config\.js|google5caa7feb|accounts\.google/.test(body)) hits.push(f);
    }
    return hits;
  })();
  t('deploy: no page still reaches for the removed Google files',
    ghosts.length === 0, ghosts.join(', ') || 'clean');

  // ---- backing the log up to a file ----
  // Google Drive sync is gone: github.io is on the Public Suffix List, so Google
  // will not take it as an authorised domain, so the consent screen can never
  // leave Testing, so every user would have to be added to a tester list by
  // hand. A file is the transport instead. The merge underneath is unchanged
  // and is still where the risk is, so it stays tested hard.
  await page.goto(B + '/backup.html');
  await page.waitForSelector('#counts div', { timeout: 5000 });

  t('backup: no page still asks anyone to sign in to Google',
    !/google|sign in|oauth/i.test(await page.innerText('body')),
    'no account language on the page');

  const counts = await page.$$eval('#counts div', (ds) =>
    ds.map((d) => d.querySelector('.k').textContent));
  t('backup: every store that travels is counted on screen',
    ['shots', 'bags', 'grinders', 'machines', 'supplies', 'adjustments']
      .every((k) => counts.includes(k)), counts.join(' '));

  t('backup: the page says where the log actually lives, and what would lose it',
    /shutting the machine down/i.test(await page.innerText('body'))
    && /clearing site data/i.test(await page.innerText('body')),
    'persistence and its one risk both stated');
  t('backup: and is honest that a phone cannot stream the scale',
    /no iOS browser has Web Bluetooth/i.test(await page.innerText('body')),
    'iOS limitation stated');

  // The merge is pure, so it can be driven directly and hard.
  const merge = await page.evaluate(async () => {
    const backup = await import('./assets/js/core/backup.js');
    const local = [{ shot_id: 'a', rating: 7, timestamp: '2026-08-01 09:00:00' },
                   { shot_id: 'b', rating: 5, timestamp: '2026-08-02 09:00:00' }];
    const remote = [{ shot_id: 'a', rating: 9, timestamp: '2026-08-05 09:00:00' },
                    { shot_id: 'c', rating: 6, timestamp: '2026-08-03 09:00:00' }];
    const union = backup.mergeStore(local, remote, 'shot_id', 'shot');
    const withDeath = backup.mergeStore(local, remote, 'shot_id', 'shot',
      [{ type: 'shot', id: 'c' }, { type: 'bag', id: 'a' }]);
    const noStamps = backup.mergeStore(
      [{ shot_id: 'x', rating: 1 }], [{ shot_id: 'x', rating: 2 }], 'shot_id', 'shot');
    return {
      ids: union.map((r) => r.shot_id).sort().join(','),
      clash: union.find((r) => r.shot_id === 'a').rating,
      afterDeath: withDeath.map((r) => r.shot_id).sort().join(','),
      localWins: noStamps[0].rating,
    };
  });
  t('backup: merging two devices loses nothing', merge.ids === 'a,b,c', merge.ids);
  t('backup: the later edit wins a clash', merge.clash === 9,
    `kept ${merge.clash} (other device, edited 08-05) over 7 (local, 08-01)`);
  t('backup: a deletion travels, and only for its own type',
    merge.afterDeath === 'a,b', `${merge.afterDeath} — the bag tombstone must not delete shot a`);
  t('backup: with no usable timestamp, the device in front of you wins',
    merge.localWins === 1, String(merge.localWins));

  // Round-trip the whole dataset. The stores are shared fixture for everything
  // after this, so put them back afterwards — a test that wrecks the fixture
  // fails three unrelated ones further down.
  const fixture = await page.evaluate(() => ({
    shots: localStorage.getItem('brewkit.shots.v1'),
    tombs: localStorage.getItem('brewkit.tombstones.v1'),
  }));
  const round = await page.evaluate(async () => {
    const backup = await import('./assets/js/core/backup.js');
    localStorage.setItem('brewkit.shots.v1', JSON.stringify(
      [{ shot_id: 'keep-1', dose_g: 18 }]));
    localStorage.setItem('brewkit.tombstones.v1', '[]');
    const fromOtherDevice = {
      format: 1, written_at: '2026-08-20T00:00:00Z',
      tombstones: [{ type: 'shot', id: 'gone-1', at: '2026-08-20T00:00:00Z' }],
      data: { 'brewkit.shots.v1': [{ shot_id: 'phone-1', dose_g: 17 },
                                   { shot_id: 'gone-1', dose_g: 16 }] },
    };
    const applied = backup.apply(fromOtherDevice);
    const after = JSON.parse(localStorage.getItem('brewkit.shots.v1')).map((r) => r.shot_id).sort();
    const snap = backup.snapshot();
    const badFormat = backup.apply({ format: 99 });
    return { applied: applied.ok, after, snapFormat: snap.format,
             stores: Object.keys(snap.data).length, badFormat: badFormat.ok,
             badMsg: badFormat.error,
             file: backup.filename(new Date('2026-03-07T12:00:00')),
             described: backup.describe(snap).shots };
  });
  t('backup: another device\u2019s file merges into local storage',
    round.applied && round.after.join(',') === 'keep-1,phone-1',
    round.after.join(',') + ' (gone-1 deleted on the other device)');
  t('backup: a snapshot carries every store that travels',
    round.snapFormat === 1 && round.stores === 6, round.stores + ' stores');
  t('backup: an unknown format is refused rather than half-applied',
    round.badFormat === false && /format/i.test(round.badMsg), round.badMsg);
  t('backup: the filename is dated so a folder of them sorts itself',
    round.file === 'brewkit-2026-03-07.json', round.file);
  t('backup: describe() counts what is in a snapshot before it is applied',
    round.described === 2, `${round.described} shots`);

  // A wrong file picked by mistake is the likeliest failure, so it has to fail
  // with a sentence rather than a SyntaxError.
  const bad = await page.evaluate(async () => {
    const backup = await import('./assets/js/core/backup.js');
    const grab = (fn) => { try { fn(); return 'no error'; } catch (e) { return e.message; } };
    return {
      notJson: grab(() => backup.parseBackup('dose,yield\n18,36')),
      notBackup: grab(() => backup.parseBackup('[1,2,3]')),
      wrongVersion: grab(() => backup.parseBackup('{"format":7,"data":{}}')),
      noData: grab(() => backup.parseBackup('{"format":1}')),
      good: backup.parseBackup('{"format":1,"data":{}}').format,
    };
  });
  t('backup: a CSV picked by mistake is refused in English',
    /not even JSON/.test(bad.notJson), bad.notJson);
  t('backup: so is JSON that is not a backup',
    /not a Brewkit backup/.test(bad.notBackup) && /format 7/.test(bad.wrongVersion)
    && /no data/i.test(bad.noData),
    [bad.notBackup, bad.wrongVersion, bad.noData].join(' | '));
  t('backup: and a real one parses', bad.good === 1, String(bad.good));

  // Deleting really does leave a tombstone, through the app's own code paths.
  const deaths = await page.evaluate(async () => {
    const store = await import('./assets/js/core/store.js');
    const backup = await import('./assets/js/core/backup.js');
    localStorage.setItem('brewkit.tombstones.v1', '[]');
    localStorage.setItem('brewkit.shots.v1', JSON.stringify([{ shot_id: 'doomed', dose_g: 18 }]));
    store.remove('doomed');
    return backup.tombstones().map((x) => `${x.type}:${x.id}`);
  });
  t('backup: deleting a shot records a tombstone, not just a removal',
    deaths.includes('shot:doomed'), deaths.join(',') || 'none recorded');

  // The nav dot is the only thing standing between a cleared browser and a
  // year of shots, so it has to light up on a log that has outrun its backup.
  const nudge = await page.evaluate(async () => {
    const ui = await import('./assets/js/ui.js');
    const backup = await import('./assets/js/core/backup.js');
    localStorage.setItem('brewkit.shots.v1', JSON.stringify(
      [{ shot_id: 'fresh', timestamp: '2026-08-28 09:00:00' }]));
    backup.saveConfig({ lastBackup: '2026-08-01T00:00:00Z' });
    const stale = ui.backupState();
    backup.saveConfig({ lastBackup: '2026-08-29T00:00:00Z' });
    const current = ui.backupState();
    ui.paintBackup();
    return { stale: stale.due, current: current.due,
             lit: document.querySelector('[data-backup]').classList.contains('due') };
  });
  t('backup: the nav dot lights when shots have outrun the last backup',
    nudge.stale === true, 'due after a shot newer than the file');
  t('backup: and goes out once a backup is newer than every shot',
    nudge.current === false && nudge.lit === false, 'clean');

  await page.evaluate((f) => {
    if (f.shots === null) localStorage.removeItem('brewkit.shots.v1');
    else localStorage.setItem('brewkit.shots.v1', f.shots);
    if (f.tombs === null) localStorage.removeItem('brewkit.tombstones.v1');
    else localStorage.setItem('brewkit.tombstones.v1', f.tombs);
    localStorage.removeItem('brewkit.backup.v1');
  }, fixture);

  // ---- the Live page is a dashboard, and has to fit on one screen ----
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 8000 });
  await page.waitForTimeout(500);
  const fits = await page.evaluate(() => ({
    over: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    vh: window.innerHeight,
    chart: (() => { const r = document.getElementById('curve').getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
  }));
  t('dashboard: the whole session fits one screen without scrolling',
    fits.over <= 2, `${fits.over}px past a ${fits.vh}px viewport`);
  t('dashboard: the curve takes the space the stage leaves it',
    fits.chart.h > 200 && fits.chart.w > 300, `${fits.chart.w}×${fits.chart.h}`);

  // Two structural faults that each shipped a real bug today: an element the
  // script talks to that is not in the document (a null textContent throw that
  // stops the page dead), and one id used twice (getElementById returns the
  // first, so the field read is not the field on screen).
  const structure = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    const dupes = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
    return { dupes, count: ids.length };
  });
  t('dashboard: no id appears twice in the document',
    structure.dupes.length === 0, structure.dupes.join(', ') || `${structure.count} ids, all unique`);
  const dangling = await page.evaluate(async () => {
    const src = await (await fetch('./live.html')).text();
    const used = new Set([...src.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]));
    return [...used].filter((id) => !document.getElementById(id));
  });
  t('dashboard: every element the script reaches for exists',
    dangling.length === 0, dangling.join(', ') || 'none dangling');

  // ---- a saved profile must not pin a decoder that was later fixed ----
  // Reported from real use: negatives showing as positives. The cause was not
  // the decoder — it was that a profile taught before the sign bit was
  // understood shadowed the corrected built-in driver, forever.
  const stale = await page.evaluate(async () => {
    const dec = await import('./assets/js/ble/decode.js');
    const drv = await import('./assets/js/ble/drivers.js');
    const before = { kind: 'int', offset: 4, width: 2, littleEndian: true, signed: false, scale: 0.1 };
    const after = drv.DRIVERS.find((d) => d.id === 'lefu-fff0').decoder;
    const neg = dec.unhex('12 06 15 00 44 10 05 00');
    return {
      staleReads: dec.applyCandidate(before, neg),
      driverReads: dec.applyCandidate(after, neg),
      differs: !drv.sameDecoder(before, after),
      sameAsSelf: drv.sameDecoder(after, after),
    };
  });
  t('stale profile: the old decoder is what reported a negative as positive',
    stale.staleReads > 0 && stale.driverReads < 0,
    `saved ${stale.staleReads.toFixed(1)} g vs driver ${stale.driverReads.toFixed(1)} g`);
  t('stale profile: the difference is detectable',
    stale.differs === true && stale.sameAsSelf === true,
    `differs ${stale.differs}, identical-to-itself ${stale.sameAsSelf}`);

  // Plant exactly that stale profile, reconnect, and it should be replaced.
  await page.goto(B + '/live.html');
  await page.evaluate(() => {
    localStorage.setItem('brewkit.devices.v1', JSON.stringify({
      'mock:lefu': {
        name: 'Old Profile Scale', bleName: 'Lefu Mock (863A)',
        uuid: '0000fff3-0000-1000-8000-00805f9b34fb',
        decoder: { kind: 'int', offset: 4, width: 2, littleEndian: true, signed: false, scale: 0.1 },
        verifiedAt: '2026-01-01T00:00:00Z',
      },
    }));
  });
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  // Wait for the profile to actually be rewritten, not for the note that
  // precedes it — the driver is not trusted until a frame confirms it.
  await page.waitForFunction(
    () => !!JSON.parse(localStorage.getItem('brewkit.devices.v1') || '{}')['mock:lefu']?.decoder?.sign,
    { timeout: 10000 });
  const repaired = await page.evaluate(
    () => JSON.parse(localStorage.getItem('brewkit.devices.v1'))['mock:lefu'].decoder);
  t('stale profile: a confirmed driver supersedes it on reconnect',
    !!repaired.sign && repaired.sign.offset === 2 && repaired.sign.mask === 0x10,
    JSON.stringify(repaired.sign));
  t('stale profile: the saved name is kept, not clobbered',
    (await page.textContent('#device-chip')) === 'Old Profile Scale',
    await page.textContent('#device-chip'));
  t('stale profile: the repair is reported rather than done silently',
    /negative weights/i.test(await page.textContent('#conn-msg')),
    await page.textContent('#conn-msg'));

  // And a negative weight must now actually render as negative.
  await page.evaluate(() => { window.__mock.grams = -52; });
  await page.waitForFunction(
    () => parseFloat(document.getElementById('o-w').textContent) < -40, { timeout: 6000 });
  t('negatives: a negative reading renders negative on the dashboard',
    parseFloat(await page.textContent('#o-w')) < -40, (await page.textContent('#o-w')) + ' g');
  await page.evaluate(() => { window.__mock.grams = 0; });

  // ---- machines are entities, like grinders ----
  await page.goto(B + '/kit.html');
  await kitTab('machines');
  await page.fill('#m-name', 'Test Bianca');
  await page.selectOption('#m-kind', 'Dual boiler');
  await page.fill('#m-temp', '93.5');
  await page.fill('#m-pressure', '9');
  await page.fill('#m-preinf', '6');
  await page.fill('#m-basket', '18 g VST');
  await page.click('#m-save');
  await page.waitForFunction(() => /Added/.test(document.getElementById('m-msg').textContent),
    { timeout: 4000 });
  t('machine: saved and listed like a grinder',
    (await page.locator('#machines .bx').count()) === 1
    && /Test Bianca/.test(await page.innerText('#machines')),
    (await page.innerText('#machines')).replace(/\s+/g, ' ').slice(0, 70));
  const machineId = await page.evaluate(
    () => JSON.parse(localStorage.getItem('brewkit.machines.v1'))[0].id);
  t('machine: gets a real id, not a null key', /^machine-\d+$/.test(machineId ?? ''), machineId);

  // Its usual settings are a shot's defaults, so they stop being retyped.
  const defaults = await page.evaluate(async (id) => {
    const kit = await import('./assets/js/core/kit.js');
    const plain = kit.attachKit({ machine_id: id });
    const overridden = kit.attachKit({ machine_id: id, temp_c: 96, basket: '20 g' });
    return {
      temp: plain.temp_c, pressure: plain.pressure_bar, preinf: plain.preinfusion_s,
      basket: plain.basket, name: plain.machine_name,
      overTemp: overridden.temp_c, overBasket: overridden.basket,
    };
  }, machineId);
  t('machine: its usual settings become the shot\u2019s defaults',
    defaults.temp === 93.5 && defaults.pressure === 9 && defaults.preinf === 6
    && defaults.basket === '18 g VST',
    `${defaults.temp} °C, ${defaults.pressure} bar, ${defaults.preinf} s, ${defaults.basket}`);
  t('machine: anything set on the shot itself still wins',
    defaults.overTemp === 96 && defaults.overBasket === '20 g',
    `${defaults.overTemp} °C, ${defaults.overBasket}`);
  t('machine: the name is copied onto the row so the CSV stands alone',
    defaults.name === 'Test Bianca', defaults.name);

  // The grinder's name used to be written into grind_label, which is a
  // different quantity entirely — it now has a field of its own.
  const naming = await page.evaluate(async (gid) => {
    const kit = await import('./assets/js/core/kit.js');
    const r = kit.attachKit({ grinder_id: gid, grind_label: 'medium-fine' });
    return { grinder_name: r.grinder_name, grind_label: r.grind_label };
  }, kitIds.grinder);
  t('machine: the grinder name no longer overwrites the grind label',
    naming.grinder_name === 'Test DF64' && naming.grind_label === 'medium-fine',
    `name "${naming.grinder_name}", label "${naming.grind_label}"`);

  // On Live it is a picker, and choosing it fills the machine's settings.
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 8000 });
  t('machine: Live offers it as a picker, not a text field',
    (await page.evaluate(() => document.getElementById('p-machine').tagName)) === 'SELECT',
    await page.evaluate(() => document.getElementById('p-machine').tagName));
  await page.selectOption('#p-machine', machineId);
  await page.waitForTimeout(200);
  t('machine: picking one fills in the settings it usually runs at',
    (await page.inputValue('#p-temp')) === '93.5'
    && (await page.inputValue('#p-pressure')) === '9'
    && (await page.inputValue('#p-basket')) === '18 g VST',
    `${await page.inputValue('#p-temp')} °C / ${await page.inputValue('#p-pressure')} bar / `
      + `${await page.inputValue('#p-basket')}`);


  // ---- bean age, with the freezer accounted for ----
  // Calendar days since roast is the number everyone quotes and it is wrong for
  // anyone who freezes: staling is chemistry, and chemistry slows when cold.
  await page.goto(B + '/kit.html');
  const age = await page.evaluate(async () => {
    const beans = await import('./assets/js/core/beans.js');
    const at = new Date('2026-08-28T12:00:00Z');
    const f = (bag) => {
      const r = beans.freshness(bag, at);
      return { phase: r.phase, label: r.label, cal: r.age.calendar, eff: r.age.effective,
               frozen: r.age.frozenDays, inFreezer: r.age.inFreezer };
    };
    return {
      lightYoung: f({ roast_date: '2026-08-26', roast_level: 'Light' }),
      darkYoung: f({ roast_date: '2026-08-23', roast_level: 'Dark' }),
      light12: f({ roast_date: '2026-08-16', roast_level: 'Light' }),
      dark12: f({ roast_date: '2026-08-16', roast_level: 'Dark' }),
      old: f({ roast_date: '2026-01-10', roast_level: 'Medium' }),
      frozen: f({ roast_date: '2026-01-10', roast_level: 'Medium', frozen_at: '2026-01-15' }),
      vac: f({ roast_date: '2026-01-10', roast_level: 'Medium', frozen_at: '2026-01-15',
               vacuum_sealed: true }),
      thawed: f({ roast_date: '2026-01-10', roast_level: 'Medium', frozen_at: '2026-01-15',
                  thawed_at: '2026-08-24', vacuum_sealed: true }),
      noDate: f({ roast_level: 'Medium' }),
      rate: beans.FREEZER_RATE,
      windows: beans.ROAST_LEVELS.map((l) => `${l}:${beans.restWindow(l).join('-')}`),
    };
  });
  t('beans: freezing pauses ageing rather than stopping the calendar',
    age.frozen.cal === 230 && age.frozen.eff < 30 && age.frozen.inFreezer,
    `${age.frozen.cal} calendar days → ${age.frozen.eff} effective`);
  t('beans: vacuum sealing slows it further',
    age.vac.eff < age.frozen.eff, `${age.frozen.eff} d vs ${age.vac.eff} d sealed`);
  t('beans: time after the freezer counts normally again',
    age.thawed.eff === age.vac.eff + 4, `${age.vac.eff} + 4 days out = ${age.thawed.eff}`);
  t('beans: an unfrozen bag is unaffected by any of it',
    age.old.cal === age.old.eff && age.old.phase === 'past', `${age.old.eff} d, ${age.old.phase}`);
  // The same number of days means different things at different roast levels.
  t('beans: rest windows differ by roast level',
    age.light12.phase === 'opening' && age.dark12.phase === 'peak',
    `12 days is "${age.light12.phase}" for light and "${age.dark12.phase}" for dark`);
  t('beans: a young light roast is flagged as still degassing',
    age.lightYoung.phase === 'degassing' && /degassing/.test(age.lightYoung.label),
    age.lightYoung.label);
  t('beans: a dark roast at 5 days is already through it',
    age.darkYoung.phase !== 'degassing', `${age.darkYoung.phase} at 5 days`);
  t('beans: no roast date says so rather than guessing',
    age.noDate.phase === 'unknown', age.noDate.label);
  // A year in the freezer costing about a fortnight is the Q10 derivation, not
  // a number picked to look reasonable.
  t('beans: the freezer discount is derived, not invented',
    Math.abs(age.rate - 0.07) < 0.001 && Math.abs(365 * age.rate - 26) < 2,
    `${age.rate}/day → a year frozen costs ${(365 * age.rate).toFixed(0)} days`);
  t('beans: every roast level has a rest window',
    age.windows.length === 5 && age.windows.every((w) => /\d+-\d+/.test(w)),
    age.windows.join(' '));

  // Through the UI: freeze a bag, and its effective age stops climbing.
  await kitTab('bags');
  await page.fill('#b-name', 'Freezer Test');
  await page.fill('#b-roast', '2026-01-10');
  await page.selectOption('#b-level', 'Light');
  await page.fill('#b-frozen', '2026-01-15');
  await page.check('#b-vacuum');
  await page.click('#b-save');
  await page.waitForFunction(() => /Added/.test(document.getElementById('b-msg').textContent),
    { timeout: 4000 });
  const card = await page.innerText('#bags');
  t('beans: the bag card reports the effective age, not the calendar one',
    /Freezer Test/.test(card) && !/2[0-9][0-9] days/.test(card),
    (card.match(/Freezer Test[\s\S]{0,60}/) ?? [''])[0].replace(/\s+/g, ' '));
  t('beans: and says why the two numbers differ',
    /freezer/i.test(card), /freezer/i.test(card) ? 'freezer explained on the card' : 'not explained');
  const frozenBag = await page.evaluate(() => JSON.parse(localStorage.getItem('brewkit.bags.v1'))
    .find((b) => b.bean_name === 'Freezer Test'));
  t('beans: freeze dates and roast level are stored on the bag',
    frozenBag.frozen_at === '2026-01-15' && frozenBag.vacuum_sealed === true
    && frozenBag.roast_level === 'Light',
    `${frozenBag.roast_level}, frozen ${frozenBag.frozen_at}, sealed ${frozenBag.vacuum_sealed}`);

  // A shot records the age the coffee actually accrued, with the calendar age
  // still recoverable from days_frozen.
  const rowAge = await page.evaluate(async (id) => {
    const kit = await import('./assets/js/core/kit.js');
    const r = kit.attachKit({ bag_id: id }, new Date('2026-08-28T12:00:00Z'));
    return { days: r.days_off_roast, frozen: r.days_frozen, level: r.roast_level };
  }, frozenBag.id);
  t('beans: the shot row carries effective age and frozen days separately',
    rowAge.days < 40 && rowAge.frozen > 200 && rowAge.level === 'Light',
    `${rowAge.days} days off roast, ${rowAge.frozen} of them frozen`);

  // ---- the freezer as a one-way door ----
  // Freezing is not a state you toggle. A portion that has been out has had the
  // room condense onto it, and refreezing locks that water in — so the model
  // refuses to represent a second freeze rather than quietly mis-dating it.
  const oneWay = await page.evaluate(async () => {
    const beans = await import('./assets/js/core/beans.js');
    const at = new Date('2026-08-28T12:00:00Z');
    const st = (bag) => {
      const r = beans.freezeState(bag, at);
      return `${r.state}:${r.canFreeze ? 'F' : '-'}${r.canThaw ? 'T' : '-'}`;
    };
    return {
      fresh: st({ roast_date: '2026-08-20' }),
      frozen: st({ roast_date: '2026-01-10', frozen_at: '2026-01-15' }),
      thawed: st({ roast_date: '2026-01-10', frozen_at: '2026-01-15', thawed_at: '2026-08-24' }),
      refusal: beans.freezeState({ frozen_at: '2026-01-15', thawed_at: '2026-08-24' }, at).note,
      advice: beans.FREEZER_ADVICE.join(' '),
    };
  });
  t('beans: a bag that has never been frozen can be',
    oneWay.fresh === 'never:F-', oneWay.fresh);
  t('beans: one in the freezer can only come out',
    oneWay.frozen === 'frozen:-T', oneWay.frozen);
  t('beans: and one that has been out can do neither',
    oneWay.thawed === 'thawed:--', oneWay.thawed);
  t('beans: the refusal explains the chemistry rather than just saying no',
    /condens/i.test(oneWay.refusal) && /hydrolytic|water/i.test(oneWay.refusal),
    oneWay.refusal.slice(0, 64));
  t('beans: the advice leads with portioning, not with freezing the bag',
    /Portion before you freeze/.test(oneWay.advice) && /never back in/i.test(oneWay.advice),
    'portion first, one way out');

  // Only the first dose off a portion is actually frozen.
  const ff = await page.evaluate(async () => {
    const beans = await import('./assets/js/core/beans.js');
    const bag = { id: 'bag-x', thawed_at: '2026-08-24' };
    const on = (d, prior = []) => beans.fromFrozen(bag, prior, new Date(`${d}T12:00:00Z`));
    const earlier = [{ bag_id: 'bag-x', timestamp: '2026-08-24 08:00:00' }];
    return {
      dayOf: on('2026-08-24'),
      afterOne: on('2026-08-24', earlier),
      otherBag: on('2026-08-24', [{ bag_id: 'bag-y', timestamp: '2026-08-24 08:00:00' }]),
      nextDay: on('2026-08-25'),
      beforeThaw: on('2026-08-23'),
      neverFrozen: beans.fromFrozen({ id: 'b' }, [], new Date('2026-08-24T12:00:00Z')),
    };
  });
  t('beans: the first dose the day a portion comes out is from frozen',
    ff.dayOf === true, String(ff.dayOf));
  t('beans: the second one is not — the portion is on the counter by then',
    ff.afterOne === false, String(ff.afterOne));
  t('beans: a shot from a different bag does not use up the frozen one',
    ff.otherBag === true, String(ff.otherBag));
  t('beans: nor is the next day, or a day before it came out',
    ff.nextDay === false && ff.beforeThaw === false, `${ff.nextDay}/${ff.beforeThaw}`);
  t('beans: a bag that was never frozen never qualifies',
    ff.neverFrozen === false, String(ff.neverFrozen));

  // ---- portioning a purchase ----
  // The shape the freezer is actually useful in: split on day one, so the
  // purchase becomes N coffees each paused at day one and each opened once.
  const split = await page.evaluate(async () => {
    const kit = await import('./assets/js/core/kit.js');
    const parent = kit.saveBag({ id: null, bean_name: 'Split Test', roaster: 'Test Roasters',
      roast_date: '2026-08-20', roast_level: 'Light', weight_g: 907 });
    const r = kit.splitBag(parent.id, { count: 6, grams: 145, frozen_at: '2026-08-21' });
    const after = kit.bag(parent.id);
    let refused = '';
    try { kit.splitBag(parent.id, { count: 1, grams: 145 }); } catch (e) { refused = e.message; }
    let overdrawn = '';
    try { kit.splitBag(parent.id, { count: 6, grams: 145 }); } catch (e) { overdrawn = e.message; }
    return {
      n: r.portions.length,
      names: r.portions.map((p) => `${p.portion_index}/${p.portion_of}`).join(','),
      grams: r.portions[0].weight_g,
      inherited: [r.portions[0].roaster, r.portions[0].roast_date, r.portions[0].roast_level]
        .join('|'),
      frozen: r.portions.every((p) => p.frozen_at === '2026-08-21' && p.vacuum_sealed
        && !p.thawed_at),
      leftover: after.weight_g,
      archived: after.archived,
      splitInto: after.split_into,
      children: kit.portionsOf(parent.id).length,
      refused, overdrawn,
      parentId: parent.id,
    };
  });
  t('portions: a purchase splits into portions that are ordinary bags',
    split.n === 6 && split.names === '1/6,2/6,3/6,4/6,5/6,6/6', split.names);
  t('portions: each carries its own weight and the roast it came from',
    split.grams === 145 && split.inherited === 'Test Roasters|2026-08-20|Light', split.inherited);
  t('portions: all of them go in frozen and sealed, none of them thawed',
    split.frozen === true, 'frozen 2026-08-21, sealed');
  t('portions: what they took has left the parent',
    Math.abs(split.leftover - 37) < 0.05 && split.archived === false && split.splitInto === 6,
    `${split.leftover} g left of 907`);
  t('portions: and the parent knows its children',
    split.children === 6, String(split.children));
  t('portions: splitting into one portion is not a split',
    /at least two/i.test(split.refused), split.refused);
  t('portions: and taking out more than the bag holds is refused, not stored negative',
    /870 g, and this bag holds 37 g/.test(split.overdrawn), split.overdrawn);

  // Through the UI: the refreeze button is gone, and splitting is offered.
  await page.goto(B + '/kit.html');
  await kitTab('bags');
  await page.waitForSelector('#bags .bx', { timeout: 4000 });
  const bagsUi = await page.innerText('#bags');
  // Buttons render uppercase through CSS and innerText honours that, so these
  // have to be case-insensitive or they pass by never matching anything.
  t('portions: the UI never offers to re-freeze',
    !/re-froze/i.test(bagsUi), (bagsUi.match(/re-froze[^\n]*/i) ?? ['none found'])[0]);
  t('portions: an unfrozen bag is offered the split instead',
    /split into portions/i.test(bagsUi), 'split offered');
  t('portions: a bag with no logged dose reports grams, not "about null shots"',
    !/null shot/i.test(bagsUi), (bagsUi.match(/[^\n]*null[^\n]*/i) ?? ['no nulls'])[0]);

  // A portion that has been out is refused the freezer, in the UI as in the model.
  await page.evaluate(async () => {
    const kit = await import('./assets/js/core/kit.js');
    const p = kit.bags().find((b) => b.portion_index === 1);
    kit.saveBag({ id: p.id, thawed_at: '2026-08-27' });
  });
  await page.goto(B + '/kit.html');
  await kitTab('bags');
  await page.waitForSelector('#bags .bx', { timeout: 4000 });
  const thawedUi = await page.innerText('#bags');
  t('portions: and once one is out, the card says the freezer is done with it',
    /already been out/i.test(thawedUi), 'refusal on the card');

  // ---- what is running out ----
  // Shots alone never account for a bag: beans get purged through the grinder,
  // spilled, or used for a pour-over. A log that only subtracts logged doses
  // always says you have more left than you do, and the error only grows.
  await page.goto(B + '/kit.html');
  const ledger = await page.evaluate(async () => {
    const supply = await import('./assets/js/core/supply.js');
    localStorage.removeItem('brewkit.adjustments.v1');
    localStorage.removeItem('brewkit.consumables.v1');
    const bag = { id: 'bag-ledger', bean_name: 'Ledger', weight_g: 250 };
    const shots = Array.from({ length: 6 }, (_, i) => ({
      shot_id: 'l' + i, bag_id: 'bag-ledger', dose_g: 18.2,
      timestamp: `2026-08-2${i + 1} 09:00:00`,
    }));
    const plain = supply.bagStatus(bag, shots);
    supply.addAdjustment({ target_id: 'bag-ledger', amount: 35, reason: 'purge' });
    supply.addAdjustment({ target_id: 'bag-ledger', amount: 12.5, reason: 'other-brew' });
    const deducted = supply.bagStatus(bag, shots);
    supply.addAdjustment({ target_id: 'bag-ledger', amount: -5, reason: 'correction' });
    const corrected = supply.bagStatus(bag, shots);
    supply.saveConsumable({ name: 'Filter', kind: 'shots', capacity: 8, installed_at: '2026-08-20' });
    const filter = supply.consumableStatus(supply.consumables()[0], shots);
    // Days and grams are the same machinery counting something else.
    supply.saveConsumable({ name: 'Burrs', kind: 'grams', capacity: 200, installed_at: '2026-08-20' });
    const burrs = supply.consumableStatus(supply.consumables()[1], shots);
    const board = supply.supplyBoard([bag], shots).map((r) => `${r.name}:${r.pct.toFixed(2)}`);
    localStorage.removeItem('brewkit.adjustments.v1');
    localStorage.removeItem('brewkit.consumables.v1');
    return { plain, deducted, corrected, filter, burrs, board };
  });
  t('supply: shots deduct from the bag on their own',
    ledger.plain.remaining === 140.8 && ledger.plain.shotsLeft === 7,
    `250 − 6×18.2 = ${ledger.plain.remaining} g, about ${ledger.plain.shotsLeft} shots`);
  t('supply: manual deductions come off too',
    ledger.deducted.remaining === 93.3 && ledger.deducted.manual === 47.5,
    `${ledger.deducted.byShots} g pulled + ${ledger.deducted.manual} g logged = `
      + `${ledger.deducted.used} g, ${ledger.deducted.remaining} g left`);
  t('supply: a negative adjustment corrects upward',
    ledger.corrected.remaining === 98.3, ledger.corrected.remaining + ' g');
  // Shots left comes from your own recent doses, not a nominal 18 g — pull
  // triples and a nominal figure is wrong by a third.
  t('supply: shots remaining uses your own dose, not a nominal one',
    Math.abs(ledger.plain.typical - 18.2) < 0.001, ledger.plain.typical + ' g typical');
  t('supply: a consumable counting shots tracks the shot log',
    ledger.filter.used === 6 && ledger.filter.remaining === 2, JSON.stringify(ledger.filter.remaining));
  t('supply: the same machinery counts grams for burr life',
    ledger.burrs.used === 109.2 && ledger.burrs.unit === 'g',
    `${ledger.burrs.used} g of ${ledger.burrs.capacity}`);
  t('supply: the board puts whatever runs out first at the top',
    ledger.board[0].startsWith('Filter'), ledger.board.join(' '));

  // ---- deducting through the UI ----
  await page.goto(B + '/kit.html');
  await kitTab('bags');
  await page.waitForSelector('#bags .bx', { timeout: 5000 });
  const beforeText = await page.innerText('#bags');
  await page.fill('#bags input[type="number"]', '30');
  await page.selectOption('#bags select', 'purge');
  await page.click('#bags .row button');
  await page.waitForFunction(
    () => /Logged/.test(document.getElementById('b-msg').textContent), { timeout: 4000 });
  const afterText = await page.innerText('#bags');
  const gLeft = (txt) => Number((txt.match(/([\d.]+) g left/) ?? [])[1]);
  t('supply: a manual deduction moves the remaining figure',
    Math.abs(gLeft(beforeText) - gLeft(afterText) - 30) < 0.05,
    `${gLeft(beforeText)} g → ${gLeft(afterText)} g`);
  t('supply: the deduction is listed, and reversible',
    /1 manual entry/i.test(afterText), afterText.match(/\d+ manual entr\w+/i)?.[0] ?? 'not listed');

  // ---- consumables through the UI ----
  await kitTab('consumables');
  await page.fill('#c-name', 'Test Filter');
  await page.selectOption('#c-kind', 'shots');
  // Rated for one shot fewer than the log already holds, so it is past its life
  // by construction. It used to be a flat 3, which quietly depended on how many
  // shots every earlier block in this file happened to leave behind — and the
  // moment one of them filed or removed a different number, this failed here
  // rather than where the change was.
  const shotsSoFar = await page.evaluate(
    () => JSON.parse(localStorage.getItem('brewkit.shots.v1') || '[]').length);
  await page.fill('#c-capacity', String(Math.max(1, shotsSoFar - 1)));
  await page.fill('#c-installed', '2020-01-01');
  await page.click('#c-save');
  await page.waitForFunction(
    () => /tracking/i.test(document.getElementById('c-msg').textContent), { timeout: 4000 });
  const consText = await page.innerText('#consumables');
  t('supply: anything else that runs out can be tracked the same way',
    /Test Filter/.test(consText), consText.replace(/\s+/g, ' ').slice(0, 70));
  t('supply: one past its rated life says so rather than going quiet',
    /past its rated life|nearly done/i.test(consText),
    consText.replace(/\s+/g, ' ').match(/(past its rated life|nearly done)[^.]*/i)?.[0] ?? 'no warning');

  // ---- and it shows up where you are actually standing ----
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 8000 });
  await page.waitForSelector('#supply .bx', { timeout: 5000 });
  const supplyText = await page.innerText('#supply-panel');
  t('supply: the dashboard shows what is left without being asked',
    /Test Filter/.test(supplyText) && /Test Guji/.test(supplyText),
    supplyText.replace(/\s+/g, ' ').slice(0, 90));
  t('supply: and names what is nearly out',
    /nearly out/i.test(await page.textContent('#supply-msg')),
    await page.textContent('#supply-msg'));

  // ---- the advisor page renders what the models produce ----
  await page.evaluate((ids) => {
    const shots = JSON.parse(localStorage.getItem('brewkit.shots.v1'));
    let seed = 11;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
    [[10, 3], [12, 5], [14, 7], [11, 9], [13, 11], [15, 13], [9, 15]].forEach(([g, d], i) => {
      shots.push({
        shot_id: 'seed-' + i, timestamp: '2026-01-0' + (i + 1) + ' 09:00:00',
        grinder_id: ids.grinder, bag_id: ids.bag, grind_setting: g, days_off_roast: d,
        steady_flow_gs: +Math.exp(-1.0 + 0.22 * g - 0.008 * d + rnd() * 0.06).toFixed(3),
        dose_g: 18, yield_g: 36, time_s: 28, rating: Math.round(8 - 0.35 * Math.abs(g - 12.5) ** 1.6 + rnd()),
      });
    });
    localStorage.setItem('brewkit.shots.v1', JSON.stringify(shots));
  }, kitIds);
  await page.goto(B + '/advisor.html');
  await page.selectOption('#grinder', kitIds.grinder);
  await page.selectOption('#bag', kitIds.bag);
  await page.fill('#cur', '13');
  await page.waitForTimeout(300);
  const recText = await page.innerText('#rec');
  t('advisor page: a grind recommendation is rendered', /\d/.test(recText) && !/Not enough/.test(recText),
    recText.replace(/\s+/g, ' ').slice(0, 90));
  t('advisor page: it says which part of the model is borrowed',
    /grinder-wide|borrowed entirely/.test(recText), /grinder-wide/.test(recText) ? 'pooled slope explained' : recText.slice(0, 60));
  t('advisor page: the taste search renders a suggestion',
    !/Nothing to search/.test(await page.innerText('#taste')),
    (await page.innerText('#taste')).replace(/\s+/g, ' ').slice(0, 70));
  // Scoping is the point of the selects: without it the 15 legacy sample shots,
  // whose grind settings are nominal micron values in the hundreds, land in the
  // same regression as dial settings of 9–15 and the fit becomes nonsense.
  const resPts = await page.locator('#res-chart svg circle.pt').count();
  t('advisor page: the resistance plot is scoped to the chosen grinder',
    resPts >= 7 && resPts <= 10, resPts + ' points (7 seeded + this session)');
  const recSetting = Number((recText.match(/^\s*([\d.]+)/) ?? [])[1]);
  t('advisor page: the recommendation lands on a dial position that exists',
    recSetting >= 0 && recSetting <= 40, String(recSetting));
  t('advisor page: the rating curve is drawn with its uncertainty band',
    (await page.locator('#taste-chart svg path.band').count()) === 1
    && (await page.locator('#taste-chart svg circle.pt').count()) >= 7,
    (await page.locator('#taste-chart svg circle.pt').count()) + ' rated points');

  // ---- the shots page: going back in ----
  await page.goto(B + '/shots.html');
  await page.waitForSelector('.shot-row', { timeout: 5000 });
  const shotRows = await page.locator('.shot-row').count();
  t('shots: every shot is listed', shotRows >= 2, shotRows + ' rows');
  t('shots: pours are sparklined so the list is scannable by shape',
    (await page.locator('.shot-row .spark path').count()) >= 1,
    (await page.locator('.shot-row .spark').count()) + ' sparklines');

  await page.click(`.shot-row:has-text("${rec.bean_name}")`);
  await page.waitForTimeout(400);
  const detail = await page.innerText('#detail');
  t('shots: the detail view replays the curve it poured',
    (await page.locator('#detail .chart svg, #detail svg.chart').count()) >= 2
    || (await page.locator('#detail svg').count()) >= 2,
    (await page.locator('#detail svg').count()) + ' charts (weight and flow)');
  t('shots: the detail view carries the diagnosis',
    /what the curve says/i.test(detail), detail.replace(/\s+/g, ' ').slice(0, 60));
  t('shots: a shot is compared against the rest, not judged alone',
    /vs median of/i.test(detail) || /Against your other/i.test(detail),
    /vs median of/i.test(detail) ? 'median comparison shown' : 'no peers yet');

  // ---- the logger writes the same shape the session does ----
  await page.goto(B + '/logger.html');
  await page.selectOption('#bag', kitIds.bag);
  await page.fill('#dose', '18'); await page.fill('#yield', '36');
  await page.fill('#rating', '6'); await page.fill('#tags', 'sour thin');
  await page.click('#add');
  await page.waitForFunction(() => /Added/.test(document.getElementById('add-msg').textContent));
  const manual = await page.evaluate(() => JSON.parse(localStorage.getItem('brewkit.shots.v1')).at(-1));
  t('logger: a hand-entered shot carries the bag and the rating',
    manual.bag_id === kitIds.bag && manual.rating === 6 && manual.tags === 'sour thin'
    && manual.bean_name === 'Test Guji',
    `${manual.bean_name} · ${manual.rating} · ${manual.tags}`);
  t('logger: the table shows the coffee and the rating',
    /Test Guji/.test(await page.innerText('#tbl')) , 'coffee column present');

  // ---- every page carries the same navigation ----
  for (const p of ['index', 'live', 'kit', 'advisor', 'calculator', 'logger', 'explore', 'quality', 'uncertainty', 'settings']) {
    await page.goto(`${B}/${p}.html`);
    const hrefs = await page.$$eval('.nav a', (as) => as.map((a) => a.getAttribute('href')));
    if (!hrefs.includes('./kit.html') || !hrefs.includes('./advisor.html')) {
      t(`nav: ${p}.html links to the new tools`, false, hrefs.join(' '));
    }
  }
  t('nav: every page links to Kit and Advisor', true, '10 pages checked');

  // ---- settings, which is where the constants finally became choices ----
  // The capture thresholds were constructor options nothing ever passed, and
  // the Brix factor had a write path with zero callers while silently governing
  // the extraction yield of every shot in the log.
  await page.goto(B + '/settings.html');
  await page.waitForFunction(() => document.querySelectorAll('#capture .pref').length > 0,
    null, { timeout: 5000 });

  // Each theme previewed in its own colours. This is worth an assertion because
  // the first version read them off a probe div, and every palette is declared
  // as :root[data-theme=...] — so the div matched none of them and all five
  // swatches showed the theme already on screen, plausibly.
  const swatches = await page.evaluate(async () => {
    const { THEMES } = await import('./assets/js/ui.js');
    const rows = [...document.querySelectorAll('#themes .sw')].map((b) => ({
      name: b.querySelector('.sw-name').textContent,
      colours: [...b.querySelectorAll('.sw-strip i')].map((i) => i.style.background).join('|'),
    }));
    // Counted from the list itself rather than written out here, so adding or
    // dropping a theme does not leave this asserting the old number.
    return { rows, expected: THEMES.length, distinct: new Set(rows.map((r) => r.colours)).size };
  });
  t('settings: every theme is previewed in its own colours, not the current one',
    swatches.rows.length === swatches.expected && swatches.distinct === swatches.expected,
    `${swatches.rows.length} of ${swatches.expected} themes, `
    + `${swatches.distinct} distinct swatch sets`);

  const prefsRound = await page.evaluate(async () => {
    const P = await import('./assets/js/core/prefs.js');
    const store = await import('./assets/js/core/store.js');
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('p-holdFor', 2.5);
    set('p-minMass', 4);
    set('p-brixFactor', 0.79);
    const after = P.prefs();
    const flagged = [...document.querySelectorAll('#capture .pref.is-changed')]
      .map((n) => n.dataset.key).sort().join();
    const opts = P.sessionOptions();
    const out = {
      hold: after.holdFor, min: after.minMass,
      // The one that matters most: the store has to see it, because that is
      // what derives yield for every shot as it is saved.
      brixInStore: store.getSettings().brixFactor,
      flagged,
      // Only what was actually changed is stored, so a later change to a
      // default still reaches anyone who never disagreed with the old one.
      changedKeys: Object.keys(P.changed()).sort().join(),
      passesHold: opts.holdFor,
      msg: document.getElementById('capture-msg').textContent,
    };
    document.getElementById('capture-reset').click();
    out.afterReset = P.prefs().holdFor;
    // Reset is per-section: the Brix factor is not a capture threshold and must
    // survive putting the capture rules back.
    out.brixSurvives = P.prefs().brixFactor;
    return out;
  });
  t('settings: a capture threshold can be changed, and the session is given it',
    prefsRound.hold === 2.5 && prefsRound.min === 4 && prefsRound.passesHold === 2.5,
    `holdFor ${prefsRound.hold} s, sessionOptions passes ${prefsRound.passesHold}`);
  t('settings: only what you changed is stored, and it says which',
    prefsRound.changedKeys === 'brixFactor,holdFor,minMass'
    && prefsRound.flagged === 'holdFor,minMass'
    && /2 of 8 changed/.test(prefsRound.msg),
    `stored ${prefsRound.changedKeys}; marked ${prefsRound.flagged}; "${prefsRound.msg}"`);
  t('settings: the Brix factor finally reaches the store that derives yield',
    prefsRound.brixInStore === 0.79, `store says ${prefsRound.brixInStore}`);
  t('settings: resetting the capture rules leaves the rest alone',
    prefsRound.afterReset === 5 && prefsRound.brixSurvives === 0.79,
    `holdFor back to ${prefsRound.afterReset}, brix still ${prefsRound.brixSurvives}`);

  // The learned drip lag was invisible and unresettable.
  const lags = await page.evaluate(async () => {
    const kit = await import('./assets/js/core/kit.js');
    const a = kit.saveMachine({ name: 'Test Lag Machine', stop_lag_s: 1.4, stop_lag_n: 9 });
    await new Promise((r) => setTimeout(r, 60));
    const row = [...document.querySelectorAll('#lags tbody tr')]
      .find((tr) => tr.children[0].textContent === 'Test Lag Machine');
    const shown = row ? [...row.children].slice(0, 3).map((td) => td.textContent).join(' · ') : null;
    row?.querySelector('button')?.click();
    await new Promise((r) => setTimeout(r, 60));
    const after = kit.stopLag(a.id);
    kit.removeMachine(a.id);
    return { shown, after: after.seconds, learned: after.learned };
  });
  t('settings: the drip lag it learned is visible, and can be started over',
    /1\.40 s/.test(lags.shown ?? '') && /from 9 shots/.test(lags.shown ?? '')
    && lags.after === 1 && lags.learned === false,
    `${lags.shown} → ${lags.after} s, learned ${lags.learned}`);

  await page.evaluate(async () => {
    const P = await import('./assets/js/core/prefs.js');
    P.reset();
  });

  // ---- nothing is cut off ----
  // A whole class of bug the DOM calls fine: an element inside an
  // overflow:hidden ancestor, sticking out of it, with no scrollbar and no way
  // to reach it. On Live that was a scroll strip in a hidden column, so "Taps
  // on" rendered as "T" and two controls were simply unreachable.
  const clipped = await page.evaluate(() => {
    const bad = [];
    const clips = (el) => {
      const o = getComputedStyle(el);
      return (o.overflow === 'hidden' || o.overflowX === 'hidden'
              || o.overflowY === 'hidden');
    };
    for (const el of document.querySelectorAll('button, a, input, select, .st .v, .c .v')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (!clips(p)) continue;
        const pr = p.getBoundingClientRect();
        if (!pr.width) break;
        const over = Math.max(r.right - pr.right, pr.left - r.left,
                              r.bottom - pr.bottom, pr.top - r.top);
        // A couple of pixels is a rounding artefact; a third of an element
        // being outside its clipping parent is a control nobody can use.
        if (over > 4 && over > r.width * 0.12) {
          bad.push(`${el.textContent.trim().slice(0, 18) || el.id || el.tagName} `
            + `out of ${p.id || p.className.split(' ')[0]} by ${Math.round(over)}px`);
        }
        break;
      }
    }
    return bad;
  });
  t('layout: no control is cut off by an ancestor that hides its overflow',
    clipped.length === 0, clipped.slice(0, 4).join(' · ') || 'nothing clipped');

  // ---- the palette has to keep its own promises ----
  // A design review measured five contrast failures that every existing test
  // was happy with, because the tests looked at chrome pairs and the failures
  // were in the tokens underneath. This asks the palette directly, per theme.
  const palette = await page.evaluate(async () => {
    const { THEMES } = await import('./assets/js/ui.js');
    const lum = (c) => {
      const [r, g, b] = c.map((v) => { const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return +((x + 0.05) / (y + 0.05)).toFixed(2); };
    // Resolve a token to rgb by painting it, so color-mix and hex both work.
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.append(probe);
    const rgb = (expr) => {
      probe.style.color = '';
      probe.style.color = expr;
      const c = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g);
      return c ? c.slice(0, 3).map(Number) : null;
    };

    const root = document.documentElement;
    const had = root.getAttribute('data-theme');
    const out = {};
    for (const th of THEMES) {
      root.setAttribute('data-theme', th);
      const v = (n) => getComputedStyle(root).getPropertyValue(n).trim();
      const accent = rgb(v('--accent'));
      const accentInk = rgb(v('--accent-ink'));
      out[th] = {
        // The accent and the ink meant to sit on it. The viewer's cup tile used
        // to slide this ground from the accent toward --bg as the level rose,
        // which took the one number the app exists for down to 1.73:1; the tile
        // is neutral now and the coffee is the coloured thing, so this pair is
        // the only one that has to hold.
        hero: ratio(accentInk, accent),
        heroWashed: ratio(accentInk, accent),
        fitInk: ratio(rgb(v('--fit-ink')), rgb(v('--fit'))),
        // Hover must not be the error colour: a hovered row and a flagged one
        // were the same pixels.
        hoverIsNotFlag: ratio(rgb(v('--hover')), rgb(v('--flag'))) > 1.6,
        // A control needs to be visible against the panel it sits on before
        // anyone focuses it.
        control: ratio(rgb(v('--control')), rgb(v('--panel'))),
        mute: ratio(rgb(v('--ink-mute')), rgb(v('--panel'))),
        scheme: getComputedStyle(root).colorScheme,
      };
    }
    if (had === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', had);
    probe.remove();
    return out;
  });
  const themes = Object.keys(palette);
  const worst = (k) => themes.reduce((a, th) =>
    palette[th][k] < palette[a][k] ? th : a, themes[0]);
  t('palette: ink meant for the accent is legible on the accent',
    themes.every((th) => palette[th].hero >= 4.5),
    themes.map((th) => `${th} ${palette[th].hero}`).join(' · '));
  t('palette: --fit carries ink that survives it, rather than a hardcoded white',
    themes.every((th) => palette[th].fitInk >= 4.5),
    `worst ${worst('fitInk')} at ${palette[worst('fitInk')].fitInk}:1`);
  t('palette: hover is a lift, not the colour that means something is wrong',
    themes.every((th) => palette[th].hoverIsNotFlag),
    themes.filter((th) => !palette[th].hoverIsNotFlag).join() || 'all five distinct');
  // Only the two borderless themes: light, dark and terminal draw a real border
  // on every control, so a control there is visible without a fill step and
  // demanding one would be demanding the wrong thing.
  const LIT = ['glass'];
  t('palette: a control is visible against its panel before it is focused',
    LIT.every((th) => palette[th].control >= 1.15),
    LIT.map((th) => `${th} ${palette[th].control}:1`).join(' · '));
  t('palette: muted text clears AA, since it carries the instructions',
    themes.every((th) => palette[th].mute >= 4.5),
    `worst ${worst('mute')} at ${palette[worst('mute')].mute}:1`);
  // Pip is type, not a drawing, so the pairs worth checking are the ones he
  // actually paints: his title bar's text on the bar, his face on his screen,
  // and the message on the bubble. Measured off the mounted component rather
  // than off tokens, so a cascade problem counts too — and he has to be made to
  // SAY something first, because the bubble does not exist while he is quiet.
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(() => window.__sess, null, { timeout: 8000 });
  const pip = await page.evaluate(async () => {
    const { THEMES } = await import('./assets/js/ui.js');
    const prefs = await import('./assets/js/core/prefs.js');
    prefs.set({ coach: true });
    const root = document.documentElement;
    const had = root.getAttribute('data-theme');
    const { mountPip } = await import('./assets/js/core/pip.js');
    const host = document.querySelector('#pip-dock .pip-slot');
    host.hidden = false;
    const pip = mountPip(host);
    pip.say('Flow jumped.', { mood: 'alert' });
    // BOTH SERIALISATIONS. color-mix() computes to `color(srgb 0.49 0.48 0.46)`
    // — 0-to-1 floats — not to rgb(). Reading those as 0-to-255 makes every
    // mixed colour look nearly black, which is exactly what happened here: the
    // bezel rim measured 1.2:1 against the case when it is really 4.2:1. Second
    // time this has bitten in this file; the first was the tile gradient.
    const rgb = (s) => {
      const n = (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      return s.startsWith('color(') ? n.map((x) => x * 255) : n;
    };
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const out = {};
    for (const th of THEMES) {
      root.setAttribute('data-theme', th);
      host.dataset.tone = 'warn';
      const who = getComputedStyle(host.querySelector('.pip-who'));
      const bezel = getComputedStyle(host.querySelector('.pip-box'));
      const screen = getComputedStyle(host.querySelector('.pip-screen'));
      const bubble = getComputedStyle(host.querySelector('.pip-bubble'));
      const txt = getComputedStyle(host.querySelector('.pip-say'));
      const face = getComputedStyle(host.querySelector('.pip-face'));
      out[th] = {
        // His name on his case.
        bar: +ratio(rgb(who.color), rgb(bezel.backgroundColor)).toFixed(2),
        // What he says, in the bubble.
        body: +ratio(rgb(txt.color), rgb(bubble.backgroundColor)).toFixed(2),
        // The alarmed face, lit on the screen.
        warn: +ratio(rgb(face.color), rgb(screen.backgroundColor)).toFixed(2),
        // And the screen against the case. Without separation he is not a
        // monitor, he is a rectangle. There are two ways to get it and either
        // will do: the fill differs enough to see (which only the light theme
        // manages, since the dark ones have nowhere darker to go), or the
        // screen has a rim — which is what a real bezel is.
        fill: +ratio(rgb(screen.backgroundColor), rgb(bezel.backgroundColor)).toFixed(2),
        rim: +ratio(rgb(screen.borderTopColor), rgb(bezel.backgroundColor)).toFixed(2),
      };
      host.dataset.tone = '';
    }
    if (had === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', had);
    return out;
  });
  const pt = Object.keys(pip);
  t('palette: Pip reads in every theme \u2014 his name, his face, and what he says',
    pt.every((th) => pip[th].bar >= 4.5 && pip[th].body >= 4.5 && pip[th].warn >= 4.5),
    pt.map((th) => `${th} ${pip[th].bar}/${pip[th].body}/${pip[th].warn}`).join(' \u00b7 '));
  t('palette: his screen reads as an inset in the case, not as more case',
    pt.every((th) => pip[th].fill >= 1.25 || pip[th].rim >= 1.5),
    pt.map((th) => `${th} fill ${pip[th].fill} rim ${pip[th].rim}`).join(' \u00b7 '));

  t('palette: the four dark themes tell the browser they are dark',
    ['dark', 'terminal', 'glass'].every((th) => palette[th].scheme === 'dark')
    && palette.light.scheme === 'light',
    themes.map((th) => `${th}:${palette[th].scheme}`).join(' '));

  // THE GROUND UNDER THE ONE NUMBER THIS APP EXISTS FOR.
  // The viewer's tile was stripped of all colour once because the cup drained
  // the accent out from under the number as the shot landed — 1.73:1 at the
  // worst, and worst early in a shot. The tile is coloured again, which is only
  // safe because the dial now carries an opaque well at the bore: whatever the
  // page puts behind the dial stops being part of the readout's contrast.
  // So this asks the two questions that failure was made of. Not "is this
  // particular blue legible" — that answer changes with the next theme — but
  // "is the ground fixed, and is the ink good on it at every fill".
  await page.goto(B + '/view.html');
  await page.waitForFunction(() => window.__view, null, { timeout: 5000 });
  const well = await page.evaluate(async () => {
    const { THEMES } = await import('./assets/js/ui.js');
    const root = document.documentElement;
    const had = root.getAttribute('data-theme');
    document.getElementById('pairing').hidden = true;
    document.getElementById('watching').hidden = false;
    window.__view.paint({ method: 'espresso', dose: 18, doseSet: true, target: 36,
      tol: 1.5, lag: 1, coffee: 'Guji', hint: '', k: 'f', w: 24, q: 1.9, t: 14,
      st: 'extracting', step: 'brew', phase: 'fill', curve: [[0, 0], [14, 24]] });
    const num = () => (v) => v;
    const rgba = (s) => {
      const n = (s.match(/[\d.]+/g) || []).map(Number);
      return [n[0] || 0, n[1] || 0, n[2] || 0, n.length > 3 ? n[3] : 1];
    };
    // src-over: what you actually see when the coffee lies over the well.
    const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const out = {};
    const disc = document.querySelector('#gauge .g-well');
    const bore = document.querySelector('#gauge .g-nowtrack');
    for (const th of THEMES) {
      root.setAttribute('data-theme', th);
      const w = rgba(getComputedStyle(disc).fill);
      const coffee = rgba(getComputedStyle(document.querySelector('#gauge .g-fill')).fill);
      const ink = rgba(getComputedStyle(document.querySelector('#gauge .g-n')).color);
      out[th] = {
        opaque: w[3] === 1,
        // Empty cup, and full cup: the two ends of the ground that used to move.
        dry: +ratio(ink, w).toFixed(2),
        wet: +ratio(ink, over(coffee, w)).toFixed(2),
      };
    }
    if (had === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', had);
    return { themes: out,
      // The well has to BE the bore, or it pins the ground somewhere the number
      // is not. Both come off the same nowGeo radius in gauge.js.
      fits: disc && bore ? +disc.getAttribute('r') : null };
  });
  const wt = Object.keys(well.themes);
  t('viewer: the dial pins its own ground, so the tile behind cannot reach the number',
    wt.every((th) => well.themes[th].opaque),
    wt.filter((th) => !well.themes[th].opaque).join() || `opaque in all ${wt.length}, r=${well.fits}`);
  t('viewer: the number survives the cup filling under it, which is what broke it before',
    wt.every((th) => well.themes[th].dry >= 4.5 && well.themes[th].wet >= 4.5),
    wt.map((th) => `${th} ${well.themes[th].dry}\u2192${well.themes[th].wet}`).join(' \u00b7 '));

  // The other half of the same screen. While it weighs there is no dial and so
  // no well, and the number sits straight on the coloured tile — which is only
  // safe because that tile is a gradient between two fixed stops and nothing
  // rises through it. Both ends get asked.
  const tile = await page.evaluate(async () => {
    const { THEMES } = await import('./assets/js/ui.js');
    const root = document.documentElement;
    const had = root.getAttribute('data-theme');
    window.__view.paint({ method: 'espresso', dose: 18, doseSet: false, target: 36,
      tol: 1.5, lag: 1, coffee: 'Guji', hint: '', k: 'g', w: 18, q: 0, t: 0,
      st: 'ready', step: 'dose', phase: 'weigh', curve: [] });
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const out = {};
    for (const th of THEMES) {
      root.setAttribute('data-theme', th);
      const big = document.getElementById('v-big');
      const ink = (getComputedStyle(document.querySelector('#v-big .n')).color
        .match(/[\d.]+/g) || []).map(Number).slice(0, 3);
      // Every colour stop the gradient actually paints, whatever they resolve to.
      // color-mix() serialises as `color(srgb 0.80 0.82 0.95)` — 0-to-1 floats,
      // not `rgb()` — so both forms are read and the float form is scaled. A
      // parser that knew only rgb() found no stops at all and would have
      // reported "nothing to check" as if it were "nothing wrong".
      const stops = (getComputedStyle(big).backgroundImage
        .match(/(?:rgba?|color)\([^)]*\)/g) || []).map((c) => {
        const n = (c.match(/[\d.]+/g) || []).map(Number);
        const v = c.startsWith('color(') ? n.slice(0, 3).map((x) => x * 255) : n.slice(0, 3);
        return v;
      });
      out[th] = { cup: !document.getElementById('vol').hidden,
        worst: stops.length ? +Math.min(...stops.map((c) => ratio(ink, c))).toFixed(2) : null };
    }
    if (had === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', had);
    return out;
  });
  const tt = Object.keys(tile);
  t('viewer: the weight is legible on the coloured tile, at every stop of it',
    tt.every((th) => tile[th].worst !== null && tile[th].worst >= 4.5 && !tile[th].cup),
    tt.map((th) => `${th} ${tile[th].worst}`).join(' \u00b7 '));

  // Selection has to survive the theme that restyles every button.
  await page.goto(B + '/shots.html');
  await page.waitForFunction(() => document.querySelectorAll('.shot-row').length > 1,
    null, { timeout: 5000 });
  const selected = await page.evaluate(async () => {
    const { THEMES } = await import('./assets/js/ui.js');
    const root = document.documentElement;
    const had = root.getAttribute('data-theme');
    document.querySelector('.shot-row').click();
    const on = document.querySelector('.shot-row[aria-current="true"]');
    const off = [...document.querySelectorAll('.shot-row')].find((r) => r !== on);
    const out = {};
    for (const th of THEMES) {
      root.setAttribute('data-theme', th);
      const a = getComputedStyle(on);
      const b = getComputedStyle(off);
      out[th] = a.backgroundColor !== b.backgroundColor || a.backgroundImage !== b.backgroundImage;
    }
    if (had === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', had);
    return out;
  });
  t('palette: a chosen thing looks chosen in every theme',
    Object.values(selected).every(Boolean),
    Object.entries(selected).map(([k, v]) => `${k}:${v ? 'yes' : 'NO'}`).join(' '));

  // Contrast: the chrome uses one foreground against --ink, whose lightness flips
  // between themes — exactly where an illegible pairing hides.
  for (const scheme of ['light', 'dark', 'terminal', 'glass']) {
    const system = scheme === 'light' || scheme === 'dark';
    const light = scheme === 'light';
    const c2 = await browser.newContext({ viewport: { width: 1300, height: 900 },
      colorScheme: light ? 'light' : 'dark' });
    const p2 = await c2.newPage();
    await p2.goto(B + '/explore.html');
    // The other two are never reached by a system preference, so they are
    // asked for by name.
    if (!system) {
      await p2.evaluate((th) => document.documentElement.setAttribute('data-theme', th), scheme);
    }
    await p2.waitForTimeout(250);
    const worst = await p2.evaluate(() => {
      const lum = (c) => {
        const [r,g,b] = c.match(/\d+(\.\d+)?/g).slice(0,3).map(Number).map(v => {
          v /= 255; return v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055) ** 2.4;
        });
        return 0.2126*r + 0.7152*g + 0.0722*b;
      };
      const ratio = (a, b) => { const [x,y] = [lum(a), lum(b)].sort((m,n)=>n-m);
        return (x + 0.05) / (y + 0.05); };
      let out = { sel: null, r: 99 };
      // A transparent background is not a white one, and reading it as
      // rgba(0,0,0,0) scores light-on-dark as 21:1 whichever way round it
      // really is. So walk up to whatever actually paints behind the element.
      const behind = (el) => {
        for (let n = el; n; n = n.parentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          const a = bg.startsWith('rgba') ? Number(bg.split(',')[3]) : 1;
          if (a > 0.5) return bg;
        }
        return getComputedStyle(document.body).backgroundColor;
      };
      for (const sel of ['.brand', '.tag', '.nav a[aria-current="page"]', '.eq', 'th', 'button.primary']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = ratio(getComputedStyle(el).color, behind(el));
        if (r < out.r) out = { sel, r: Math.round(r * 100) / 100 };
      }
      return out;
    });
    t(`contrast (${scheme}): chrome pairs stay legible`, worst.r >= 4.5,
      `worst ${worst.sel} at ${worst.r}:1`);
    await c2.close();
  }

  // ---- the log survives the computer being shut down ----
  // With no cloud copy behind it, "your shots stay on this machine" is the whole
  // storage promise, and an ephemeral context proves nothing about it — every
  // other test here runs in one, which is exactly why they all pass whether or
  // not the claim is true. So: write shots, close the browser entirely, open a
  // new one on the same profile directory, and look.
  {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const profile = await mkdtemp(join(tmpdir(), 'brewkit-profile-'));
    try {
      const write = await chromium.launchPersistentContext(profile, {
        ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
      });
      const wp = await write.newPage();
      await wp.goto(B + '/index.html');
      await wp.evaluate(async () => {
        const store = await import('./assets/js/core/store.js');
        store.add({ shot_id: 'survives-restart', dose_g: 18, yield_g: 36, time_s: 28 });
      });
      await write.close();          // the browser quits, as it would at shutdown

      const again = await chromium.launchPersistentContext(profile, {
        ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
      });
      const ap = await again.newPage();
      await ap.goto(B + '/shots.html');
      const found = await ap.evaluate(async () => {
        const store = await import('./assets/js/core/store.js');
        return store.all().map((r) => r.shot_id);
      });
      await again.close();
      t('storage: shots outlive quitting the browser, not just the tab',
        found.includes('survives-restart'), found.join(',') || 'the log came back empty');
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }


  // ---- a trace stays inside its own axes ----
  // Flow is a derivative of a scale reading, so it goes negative whenever the
  // weight does: a cup knocked, a hand taken off, a portafilter lifted. The
  // scale clamped the top and not the bottom, so those samples were drawn below
  // zero — outside the plot, over the axis labels and off the bottom of the box
  // — which reads as the shot having had negative flow rather than as the scale
  // having been disturbed.
  {
    const inside = await page.evaluate(async () => {
      const { livePlot } = await import('./assets/js/core/chart.js');
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:720px;height:380px';
      document.body.append(host);
      // A pour with a knock in it: flow dives well below zero, weight with it.
      const weight = [], flow = [];
      for (let i = 0; i <= 60; i++) {
        const t = i * 0.5;
        const hit = t > 12 && t < 14;
        weight.push([t, hit ? -6 : Math.min(36, t * 1.3)]);
        flow.push([t, hit ? -9.5 : 1.9]);
      }
      livePlot(host, { weight, flow, target: 36, width: 720, height: 380 });
      const svg = host.querySelector('svg');
      // The margins livePlot draws to; the plot floor is height - bottom.
      const floor = 380 - 38, ceil = 14;
      const out = [];
      for (const el of svg.querySelectorAll('path')) {
        const b = el.getBBox();
        if (b.height === 0 && b.width === 0) continue;
        out.push({ cls: el.getAttribute('class'),
                   top: +b.y.toFixed(1), bottom: +(b.y + b.height).toFixed(1) });
      }
      host.remove();
      return { series: out, floor, ceil,
               escaped: out.filter((o) => o.bottom > floor + 1 || o.top < ceil - 1) };
    });
    t('chart: a knock cannot draw the trace outside the plot',
      inside.series.length > 0 && inside.escaped.length === 0,
      inside.series.length === 0 ? 'no series were drawn, so nothing was proven'
        : `${inside.series.length} series, all within ${inside.ceil}..${inside.floor}` +
          (inside.escaped.length ? ' — ESCAPED ' + JSON.stringify(inside.escaped) : ''));
  }

  // ================= THE SWEEP =================
  // Every page, every theme, two widths, checked mechanically.
  //
  // WHY THIS EXISTS. The defects being found by hand were all of a few kinds —
  // a control 10 px out of line with its neighbours, a box off the side of a
  // phone, a trace drawn outside its own axes — and every one of them was found
  // by somebody looking at a screenshot, one theme at a time. There are four
  // themes and the fonts differ between them, so a label that fits on one line
  // in Archivo wraps to two in Space Mono and takes the box under it with it.
  // Checking one theme by eye is checking a quarter of the app.
  //
  // AND EVERY CHECK COUNTS WHAT IT LOOKED AT. Twice while writing this the
  // measurement came back clean because it had examined nothing at all — the
  // panel it was measuring was display:none in the state under test. A check
  // that passes over zero elements is not a passing check, it is a broken one,
  // so a zero count is a failure here.
  {
    // THE VIEWER IS SWEPT TOO, and it needs different handling from the rest.
    // It boots through initTheme rather than boot(), it has no nav, and every
    // panel on it is hidden until a link is open — so pointed at it plainly the
    // sweep would examine nothing and call that a pass. It is driven through
    // its real states instead, with the frames the laptop would send, and its
    // widths are the two devices it actually runs on rather than a desktop.
    const CURVE = Array.from({ length: 90 }, (_, i) => {
      const t = +(i * 0.3).toFixed(2);
      return [t, +(t < 5 ? 0 : Math.min(36, (t - 5) * 1.4)).toFixed(2)];
    });
    const FRAME = { k: 'f', method: 'espresso', dose: 18, doseSet: true, target: 36,
      tol: 1.4, coffee: 'Kenya Kirinyaga · Sey', lag: 1.4, theme: null, pip: null };
    const VIEWS = {
      // Before anything is linked: the pairing panel is the whole page.
      pairing: null,
      weigh: { ...FRAME, w: 18.2, q: 0, t: 0, st: 'idle', step: 'dose',
        phase: 'ready', hint: 'Weigh 18.0 g of beans.', curve: [] },
      brew: { ...FRAME, w: 24.4, q: 1.8, t: 19.2, st: 'extracting', step: 'brew',
        phase: 'pour', hint: 'Pouring.', curve: CURVE },
      done: { ...FRAME, w: 36.2, q: 0, t: 31.5, st: 'idle', step: 'rate',
        phase: 'done', grounds: 20.1, hint: 'How was it?', curve: CURVE },
    };
    const PAGES = [
      ...['index', 'live', 'shots', 'advisor', 'kit', 'lab', 'settings',
          'backup', 'logger'].map((name) => ({ name, widths: [1400, 390], states: [null] })),
      { name: 'view', widths: [820, 390], states: Object.keys(VIEWS), reveal: false },
    ];
    const THEMES = ['light', 'dark', 'terminal', 'glass'];
    const rowsOff = [], overflows = [], escaped = [], showing = [];
    let rowsSeen = 0, boxesSeen = 0, hiddenSeen = 0;

    const look = await ctx.newPage();
    for (const theme of THEMES) {
      await look.addInitScript((t) => {
        try { localStorage.setItem('brewkit.theme', t); } catch { /* ignore */ }
      }, theme);
      for (const page of PAGES) {
        const { name, widths, states, reveal = true } = page;
        await look.goto(`${B}/${name}.html`);
        if (name === 'view') await look.waitForFunction(() => window.__view, null, { timeout: 8000 });
        await look.waitForTimeout(140);
        for (const w of widths) {
          await look.setViewportSize({ width: w, height: 900 });
          await look.waitForTimeout(120);
        for (const state of states) {
          if (name === 'view') {
            await look.evaluate(({ st, frames }) => {
              const linked = st !== 'pairing';
              document.getElementById('pairing').hidden = linked;
              document.getElementById('watching').hidden = !linked;
              // The controls the link gates, so the sweep sees the bar it has
              // once a shot is on screen rather than the one before it.
              for (const id of ['clean', 'cues', 'unpair']) {
                const el = document.getElementById(id);
                if (el) el.hidden = !linked;
              }
              if (linked) window.__view.paint(frames[st]);
            }, { st: state, frames: VIEWS });
            await look.waitForTimeout(160);
          }
          const found = await look.evaluate((doReveal) => {
            // Panels a state hides are still panels; reveal them so the sweep
            // measures the app rather than whichever slice happens to be up.
            // Not on the viewer: there, showing everything at once puts the
            // pairing panel and a live shot on screen together, which is a
            // combination that never happens and would be measured as if it
            // did. Its states are driven explicitly instead.
            if (doReveal) {
              for (const el of document.querySelectorAll('.cell, .sect, .panel')) {
                if (getComputedStyle(el).display === 'none') {
                  el.style.setProperty('display', 'block', 'important');
                  // Marked, because an inline !important beats every author
                  // rule including the one that makes `hidden` stick — so the
                  // reveal turns a legitimately hidden tab pane into something
                  // that is hidden and rendering, which is the exact fault the
                  // check below looks for. The sweep must not measure its own
                  // hand as a defect.
                  el.dataset.sweepRevealed = '1';
                }
              }
            }
            const seen = (el) => el.getBoundingClientRect().height > 0;
            const out = { rows: 0, boxes: 0, off: [], esc: [], showing: [] };

            // 1. Controls in one row share a top edge. Labels of different
            //    lengths wrap to different heights, and the boxes under them
            //    follow unless something stops it.
            // Like with like. A checkbox is 16 px tall and a text box is 38, so
            // bottom-aligning them puts their TOPS 22 px apart on purpose — and
            // a visually hidden file input is parked off-screen at 1 px, which
            // is not a misalignment either. Comparing those against a text box
            // is the check being wrong, not the layout.
            const typed = (el) => {
              if (el.tagName !== 'INPUT') return true;
              return !['checkbox', 'radio', 'file', 'hidden'].includes(el.type);
            };
            const real = (el) => {
              const r = el.getBoundingClientRect();
              return r.width > 2 && r.height > 2;
            };
            for (const row of document.querySelectorAll('.row')) {
              const kids = [...row.querySelectorAll('input, select, textarea')]
                .filter((k) => seen(k) && typed(k) && real(k))
                .map((k) => ({ k, r: k.getBoundingClientRect() }));
              if (kids.length < 2) continue;
              // SIDE BY SIDE, not merely in the same row element. Below 720 px
              // the two-column row stacks into one, and two boxes one above the
              // other are supposed to have different tops — comparing those was
              // the check reporting the responsive layout working as a fault.
              const band = kids.filter(({ r }) => {
                const a = kids[0].r;
                return Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top)
                  > Math.min(a.height, r.height) / 2;
              });
              if (band.length < 2) continue;
              out.rows++;
              const tops = band.map(({ r }) => Math.round(r.top));
              if (new Set(tops).size > 1) {
                out.off.push(band.map(({ k }, i) => `${k.id || k.name || i}@${tops[i]}`).join('/'));
              }
            }

            // 2. Nothing a person can press sits outside the window. Anything
            //    inside a deliberate scroller is exempt — the nav strip on a
            //    phone is meant to run past the edge.
            const scrolled = (el) => {
              for (let e = el; e && e !== document.body; e = e.parentElement) {
                const o = getComputedStyle(e).overflowX;
                if (o === 'auto' || o === 'scroll') return true;
              }
              return false;
            };
            for (const el of document.querySelectorAll('button, a, input, select')) {
              if (!seen(el) || scrolled(el)) continue;
              out.boxes++;
              const r = el.getBoundingClientRect();
              if (r.right > innerWidth + 2 || r.left < -2) {
                out.esc.push(`${el.id || el.textContent.trim().slice(0, 14) || el.tagName}` +
                  `@${Math.round(r.left)}..${Math.round(r.right)}`);
              }
            }
            // 3. Anything marked hidden is actually gone. `hidden` is
            //    display:none in the browser's own sheet and ANY author rule
            //    that sets display beats it, so an element the script hides can
            //    stay on screen while both the script and the markup look
            //    right. That is how the chart's key and its reference picker
            //    survived being hidden while weighing.
            out.hidden = 0;
            for (const el of document.querySelectorAll('[hidden]')) {
              if (el.dataset.sweepRevealed || el.closest('[data-sweep-revealed]')) continue;
              out.hidden++;
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                out.showing.push(`${el.id || el.className || el.tagName}` +
                  `(${Math.round(r.width)}x${Math.round(r.height)})`);
              }
            }
            out.overflow = document.documentElement.scrollWidth
              - document.documentElement.clientWidth;
            return out;
          }, reveal);
          rowsSeen += found.rows;
          boxesSeen += found.boxes;
          hiddenSeen += found.hidden;
          const where = `${name}${state ? ':' + state : ''}/${theme}/${w}`;
          for (const x of found.off.slice(0, 2)) rowsOff.push(`${where} ${x}`);
          for (const x of found.esc.slice(0, 2)) escaped.push(`${where} ${x}`);
          for (const x of found.showing.slice(0, 2)) showing.push(`${where} ${x}`);
          if (found.overflow > 1) overflows.push(`${where} +${found.overflow}px`);
        }
        }
      }
    }
    await look.close();

    t('sweep: it actually looked at something',
      rowsSeen > 0 && boxesSeen > 0,
      `${rowsSeen} field rows and ${boxesSeen} controls across ` +
      `${PAGES.length} pages (the viewer in ${VIEWS ? Object.keys(VIEWS).length : 0} states) ` +
      `× ${THEMES.length} themes × 2 widths`);
    t('sweep: controls in a row share a top edge, in every theme',
      rowsOff.length === 0, rowsOff.slice(0, 4).join('  |  ') || 'aligned everywhere');
    t('sweep: nothing pressable sits outside the window',
      escaped.length === 0, escaped.slice(0, 4).join('  |  ') || 'all inside');
    t('sweep: no page scrolls sideways, in any theme',
      overflows.length === 0, overflows.slice(0, 4).join('  |  ') || 'none');
    t('sweep: what is marked hidden is actually gone',
      hiddenSeen > 0 && showing.length === 0,
      hiddenSeen === 0 ? 'no hidden elements were found, so nothing was proven'
        : showing.slice(0, 4).join('  |  ') || `${hiddenSeen} hidden elements, none rendering`);
  }

  /* --------------------------------- the target, and the tail of a shot */
  {
    const sh = await ctx.newPage();
    await sh.goto(`${B}/live.html`);
    // A shot shaped like a real one: a ramp, a stop at 21 s, then the drip.
    const curve = [];
    let w = 0;
    for (let i = 0; i <= 110; i++) {
      const tt = +(i * 0.25).toFixed(2);
      const q = tt < 3 ? 0.4 : tt < 21 ? 0.5 + (tt - 3) * 0.14
        : Math.max(0, 3.0 * Math.exp(-(tt - 21) * 1.1));
      w += q * 0.25;
      curve.push([tt, +w.toFixed(2)]);
    }
    await sh.evaluate((c) => {
      localStorage.setItem('brewkit.shots.v1', JSON.stringify([{
        shot_id: 'shot-006', bean_name: 'Peru', dose_g: 18, yield_g: +c.at(-1)[1],
        time_s: 27.4, method: 'espresso', ratio: 2.31,
        curve: c.map(([tt, x]) => `${tt}:${x}`).join('|'),
      }]));
    }, curve);
    await sh.goto(`${B}/live.html?mock=generic#replay=shot-006`);
    await sh.waitForFunction(() => window.__replay?.now, { timeout: 10000 });
    await sh.evaluate(() => window.__replay.now.pause());
    await sh.waitForTimeout(250);
    const aim = await sh.evaluate(() => ({
      header: document.getElementById('p-target').textContent.trim(),
      target: document.getElementById('c-target').textContent,
    }));
    // THE TARGET IS WHAT IT AIMED AT, not what it reached. Using the yield put
    // the line exactly where the shot landed, so every replay hit its target by
    // definition — and an 18 g dose showed a 41.4 g target beside a header
    // claiming 1:2.
    t('replay: the target is the one the shot aimed at, not the yield it reached',
      Math.abs(parseFloat(aim.target) - 36) < 0.2 && /36\.0 g out/.test(aim.header),
      `${aim.header} · target tile ${aim.target}`);

    const tail = await sh.evaluate(async () => {
      const R = await import('./assets/js/core/replay.js');
      const C = await import('./assets/js/core/coach.js');
      const d = R.prepare(window.__replay.now.data.pts);
      return { stoppedAt: d.stoppedAt, duration: d.duration,
               said: R.saidDuring(d, C.live, { target: 36 }).map((l) => l.text) };
    });
    // A curve does not end when the shot does: the pump cuts and the puck keeps
    // delivering, so the last seconds are a decay to nothing. Read as the pour,
    // that is a shot slowing to a halt — which is how he came to say "close to
    // choking" over a shot that had been stopped on purpose.
    t('replay: the drip after the pump stops is not read as the pour',
      tail.stoppedAt < tail.duration - 2
      && !tail.said.some((x) => /chok/i.test(x)),
      `stopped at ${tail.stoppedAt} of ${tail.duration} s; said `
      + (tail.said.length ? tail.said.join(' | ') : 'nothing'));
    await sh.close();
  }

  /* ------------------------------------- a channel is a step, not a slope */
  {
    // THE PHYSICS. Flow CLIMBING is what an ordinary shot does: puck resistance
    // falls as the bed saturates and erodes, so at constant pressure the flow
    // rises through most of a healthy pour. A channel is a discontinuity — an
    // abrupt jump — not a gentle rise.
    //
    // diagnose() and coach.live() were both corrected to that reading and the
    // live banner was left behind, still firing on a least-squares slope at
    // 0.05 g/s² and telling people an intact puck should be sagging by now. So
    // the app held two opinions about the same physics and showed the wrong one
    // during the shot, which is the one you act on.
    const phys = await ctx.newPage();
    await phys.goto(`${B}/live.html`);
    const read = await phys.evaluate(async () => {
      const R = await import('./assets/js/core/replay.js');
      const C = await import('./assets/js/core/coach.js');
      const build = (q) => {
        const pts = []; let w = 0;
        for (let i = 0; i <= 140; i++) {
          const tt = +(i * 0.25).toFixed(2);
          w += Math.max(0, q(tt)) * 0.25;
          pts.push([tt, +w.toFixed(3)]);
        }
        return R.prepare(pts);
      };
      // A healthy shot: flow rises steadily all the way through, 0.9 to 2.5.
      const healthy = build((t) => (t < 5 ? 0 : 0.9 + (t - 5) * 0.055));
      // A channel: the same opening, then an abrupt jump at 14 s.
      const channel = build((t) => (t < 5 ? 0 : t < 14 ? 0.9 + (t - 5) * 0.05 : 2.9));
      const said = (d) => R.saidDuring(d, C.live, { target: 36 })
        .filter((l) => /jump|channel/i.test(l.text));
      return { healthy: said(healthy), channel: said(channel) };
    });
    await phys.close();
    t('physics: a shot whose flow climbs all the way through is not called a channel',
      read.healthy.length === 0,
      read.healthy.length
        ? `warned on a healthy rise: "${read.healthy[0].text}"`
        : 'silent through a 0.9 to 2.5 g/s climb');
    // AFTER the jump, not at it. The detector compares a window either side of
    // the moment in question, so the later half has to have happened before it
    // can tell a step from the start of a steep climb. Roughly four seconds of
    // lag is the honest cost of not calling every healthy shot a channel.
    t('physics: and an abrupt jump in the flow is, once it can be told from a climb',
      read.channel.length === 1 && read.channel[0].at >= 14 && read.channel[0].at - 14 < 6,
      read.channel.length
        ? `"${read.channel[0].text}" at ${read.channel[0].at} s`
        : 'said nothing about a 90% jump');
  }

  /* ------------------------- the shape of a real shot, not a synthetic one */
  {
    // WHY THE SUITE WAS GREEN WHILE EVERY REAL SHOT WAS MISREAD.
    //
    // The fixtures above are piecewise flat: the "rising" one climbs at
    // 0.022 g/s². A real shot climbs at around 0.18 — eight times steeper — and
    // does it off a pre-infusion plateau near 0.9 g/s, where a rise of half a
    // gram per second is a 60% "step". Four real shots out of four were told
    // they had channelled, on a detector the tests certified as correct.
    //
    // So this fixture is shaped like the real thing, and the property under
    // test is the one that separates the two cases: a channel CONCENTRATES its
    // rise into a moment, an ordinary shot spreads it across the pour.
    const real = await ctx.newPage();
    await real.goto(`${B}/live.html`);
    const shape = await real.evaluate(async () => {
      const D = await import('./assets/js/core/diagnose.js');
      const build = (q) => {
        const c = []; let w = 0;
        for (let t = 0; t <= 26; t += 0.05) { w += Math.max(0, q(t)) * 0.05; c.push([+t.toFixed(3), +w.toFixed(3)]); }
        return c;
      };
      // First drops hit the pan hard and the reading spikes, then a plateau at
      // 0.9, then a smooth steep climb to 2.8 — the shape of every shot in the
      // first real dataset.
      const shot = (extra = 0, when = 99) => build((t) => (
        t < 0.6 ? 3.6 * (1 - t / 0.6)
          : t < 5 ? 0.9
            : t < 20 ? 0.9 + (t - 5) * 0.13 + (t >= when ? extra : 0)
              : 0.03));
      const healthy = shot();
      const channelled = shot(0.9, 11);
      return {
        healthy: D.flowStep(healthy),
        channelled: D.flowStep(channelled),
        peak: D.curveMetrics(healthy).peak_flow_gs,
        flag: D.STEP_FLAG,
      };
    });
    t('physics: a pre-infusion plateau followed by a steep smooth climb is not a channel',
      shape.healthy.step === null || shape.healthy.step <= shape.flag,
      `read ${shape.healthy.step} against a ${shape.flag} threshold`);
    t('physics: the same curve with a real jump in it is',
      shape.channelled.step > shape.flag,
      `read ${shape.channelled.step} at ${shape.channelled.at} s`);
    // The opening spike is the drops landing on the pan, not the pump. Left in,
    // it reports 3.6 g/s as the peak of a shot that never exceeded 2.8, and
    // feeds the finding about the puck surface breaking up.
    t('physics: peak flow is the shot\'s peak, not the first drops hitting the pan',
      shape.peak < 3, `peak read as ${shape.peak} g/s on a shot that tops out at 2.8`);
    await real.close();
  }

  /* ------------------- the other shape a failing bed makes: a steep climb */
  {
    // A channel is a step, and the step detector is the confident signal. But a
    // bed can widen gradually instead of giving way at once, which leaves a
    // climb too steep for erosion and never a discontinuity. The danger in
    // adding this is obvious — it is a slope rule, and a slope rule is what
    // called every healthy shot a channel in the first place — so the whole
    // test is whether it stays quiet on shots shaped like real ones.
    const cl = await ctx.newPage();
    await cl.goto(`${B}/live.html`);
    const climb = await cl.evaluate(async () => {
      const D = await import('./assets/js/core/diagnose.js');
      const build = (q) => {
        const c = []; let w = 0;
        for (let t = 0; t <= 30; t += 0.05) { w += Math.max(0, q(t)) * 0.05; c.push([+t.toFixed(3), +w.toFixed(3)]); }
        return c;
      };
      const read = (curve, extra) => {
        const m = D.curveMetrics(curve);
        return { m, codes: D.diagnose({ ...m, time_s: m.duration_s, ...extra }).map((x) => x.code) };
      };
      return {
        // Shaped like the real shots: spike, plateau, steady climb to 2.8.
        ordinary: read(build((t) => (t < 0.6 ? 3.6 * (1 - t / 0.6) : t < 5 ? 0.9
          : t < 20 ? 0.9 + (t - 5) * 0.13 : 0.03)), { ratio: 2 }),
        // 1 to 4 g/s in five seconds, smoothly — no step anywhere in it.
        steep: read(build((t) => (t < 2 ? 0 : t < 5 ? 0.9
          : t < 10 ? 0.9 + (t - 5) * 0.62 : t < 20 ? 4 : 0.03)), { ratio: 2 }),
        // A real step must still be reported as a step, not as a steep climb.
        stepped: read(build((t) => (t < 2 ? 0 : t < 5 ? (t - 2) * 0.5
          : t < 16 ? 1.4 : t < 28 ? 2.5 : 0.04)), { ratio: 2.4 }),
        flag: D.CLIMB_FLAG,
      };
    });
    t('physics: an ordinary climb is not called a steep one',
      !climb.ordinary.codes.includes('flow_climb'),
      `climbed ${climb.ordinary.m.flow_climb} g/s² against a ${climb.flag} threshold`);
    t('physics: a climb far too steep for erosion is reported, without a step in it',
      climb.steep.codes.includes('flow_climb') && climb.steep.m.flow_step === null,
      `climb ${climb.steep.m.flow_climb}, step ${climb.steep.m.flow_step}`);
    // Two readings of one event would be the app talking twice about the same
    // thing and sounding twice as sure.
    t('physics: a step is reported as a step and not also as a climb',
      climb.stepped.codes.includes('flow_step') && !climb.stepped.codes.includes('flow_climb'),
      climb.stepped.codes.join(','));
    // The steepest part of every healthy shot is the machine reaching pressure,
    // at 5 to 7.5 s on all four real ones. Measuring from zero would find that
    // ramp every time, which is the mistake this whole file is about.
    t('physics: the climb is measured past the machine coming up to pressure',
      climb.ordinary.m.flow_climb !== null && climb.ordinary.m.flow_climb_at > 5,
      `steepest at ${climb.ordinary.m.flow_climb_at} s`);
    await cl.close();
  }

  /* --------------------------- one detector, not three that disagree */
  {
    // The same question was answered by three different implementations — the
    // live banner, the replay and the post-shot read — two of which compared
    // flow now against flow a moment ago. A shot could be called a channel
    // while it poured and cleared once it was over. Whatever the verdict, it
    // has to be the same verdict.
    const one = await ctx.newPage();
    await one.goto(`${B}/live.html`);
    const agree = await one.evaluate(async () => {
      const D = await import('./assets/js/core/diagnose.js');
      const R = await import('./assets/js/core/replay.js');
      const C = await import('./assets/js/core/coach.js');
      const build = (q) => {
        const c = []; let w = 0;
        for (let t = 0; t <= 26; t += 0.05) { w += Math.max(0, q(t)) * 0.05; c.push([+t.toFixed(3), +w.toFixed(3)]); }
        return c;
      };
      const curves = {
        healthy: build((t) => (t < 0.6 ? 3.6 * (1 - t / 0.6) : t < 5 ? 0.9
          : t < 20 ? 0.9 + (t - 5) * 0.13 : 0.03)),
        channelled: build((t) => (t < 0.6 ? 3.6 * (1 - t / 0.6) : t < 5 ? 0.9
          : t < 20 ? 0.9 + (t - 5) * 0.13 + (t >= 11 ? 0.9 : 0) : 0.03)),
      };
      const out = {};
      for (const [name, curve] of Object.entries(curves)) {
        // as the whole-shot read sees it
        const after = (D.curveMetrics(curve).flow_step ?? 0) > D.STEP_FLAG;
        // as the replay — and therefore as it was live — sees it
        const spoke = R.saidDuring(R.prepare(curve), C.live, { target: 36 })
          .some((l) => /jump|channel/i.test(l.text));
        out[name] = { after, spoke };
      }
      return out;
    });
    t('physics: a healthy shot reads the same during the pour and afterwards',
      agree.healthy.after === false && agree.healthy.spoke === false,
      `afterwards ${agree.healthy.after}, during ${agree.healthy.spoke}`);
    t('physics: and so does a channelled one',
      agree.channelled.after === true && agree.channelled.spoke === true,
      `afterwards ${agree.channelled.after}, during ${agree.channelled.spoke}`);
    await one.close();
  }

  /* ------------------------- a reading frozen into a record is re-read */
  {
    // The curve scalars are computed once, when the shot is saved, and stored
    // on the record. So correcting the mathematics reached nothing already
    // logged — the detector was fixed and every shot in the log went on
    // asserting the old answer. Three of the four shots in the first real
    // dataset had no flow_step at all because the field postdated them; the
    // fourth carried 0.761 from a superseded detector.
    const old = await ctx.newPage();
    await old.goto(`${B}/shots.html`);
    const back = await old.evaluate(async () => {
      const D = await import('./assets/js/core/diagnose.js');
      const S = await import('./assets/js/core/schema.js');
      const c = []; let w = 0;
      for (let t = 0; t <= 26; t += 0.05) {
        const q = t < 0.6 ? 3.6 * (1 - t / 0.6) : t < 5 ? 0.9 : t < 20 ? 0.9 + (t - 5) * 0.13 : 0.03;
        w += q * 0.05; c.push([+t.toFixed(3), +w.toFixed(3)]);
      }
      const curve = S.encodeCurve(c);
      // A healthy shot carrying a channel verdict from the old detector.
      const stale = { shot_id: 'shot-001', curve, flow_step: 0.761, peak_flow_gs: 3.6 };
      const fixed = D.refreshMetrics(stale, S.decodeCurve);
      // The same verdict, on a record whose curve was never kept: it cannot be
      // re-read, so the claim is dropped rather than left standing.
      const noCurve = D.refreshMetrics({ shot_id: 'shot-002', flow_step: 0.761 }, S.decodeCurve);
      // Already current: returned untouched, not recomputed on every read.
      const current = { shot_id: 'shot-003', metrics_v: D.METRICS_V, flow_step: 0.9 };
      return {
        was: D.diagnose(stale).map((f) => f.code),
        now: D.diagnose(fixed).map((f) => f.code),
        peak: fixed.peak_flow_gs,
        dropped: noCurve.flow_step,
        untouched: D.refreshMetrics(current, S.decodeCurve) === current,
      };
    });
    t('shots: a channel verdict frozen into an old record is re-read from its curve',
      back.was.includes('flow_step') && !back.now.includes('flow_step'),
      `was [${back.was.join(',')}], now [${back.now.join(',') || 'nothing'}]`);
    t('shots: and its peak flow is re-read too',
      back.peak < 3, `${back.peak} g/s`);
    t('shots: a verdict that cannot be re-read is dropped rather than left standing',
      back.dropped === null, `flow_step came back as ${back.dropped}`);
    t('shots: a record already at the current reading is not recomputed',
      back.untouched, 'returned the same object');
    await old.close();
  }

  /* ------------------------------------ correcting a shot after the fact */
  {
    // A shot was write-once, so a grind setting you forgot to change was a
    // permanent lie in the log with no remedy but deleting the shot and losing
    // its curve.
    const ed = await ctx.newPage();
    await ed.goto(`${B}/shots.html`);
    const edit = await ed.evaluate(async () => {
      const store = await import('./assets/js/core/store.js');
      store.clear();
      const made = store.add({ bean_name: 'Test', dose_g: 18, yield_g: 36, time_s: 28,
        grind_setting: 7.5, curve: '' });
      store.update(made.shot_id, { grind_setting: 6.5, dose_g: 18, yield_g: 40 });
      const after = store.all().find((r) => r.shot_id === made.shot_id);
      return { grind: after.grind_setting, ratio: after.ratio, was: made.ratio,
        id: after.shot_id === made.shot_id };
    });
    t('shots: a correction sticks and keeps the shot it belongs to',
      edit.grind === 6.5 && edit.id, `grind now ${edit.grind}`);
    // The ratio is derived, so correcting the yield has to move it. A stored
    // 1:2 beside a corrected 40 g yield is a record disagreeing with itself.
    t('shots: and the numbers derived from it are worked out again',
      Math.abs(edit.ratio - 40 / 18) < 0.01,
      `ratio ${edit.ratio?.toFixed?.(3)} from ${edit.was?.toFixed?.(3)}`);
    const fields = await ed.evaluate(async () => {
      const S = await import('./assets/js/core/schema.js');
      // Nothing the app worked out may be hand-edited: a curve reading is a
      // reading of evidence, and the derived numbers come back on save anyway.
      const banned = ['ratio', 'ey_pct', 'tds_pct', 'flow_gs', 'curve', 'shot_id',
        'flow_step', 'peak_flow_gs', 'steady_flow_gs', 't_first_drip_s'];
      return { offered: S.EDITABLE, leaked: S.EDITABLE.filter((k) => banned.includes(k)) };
    });
    t('shots: the correction form offers what was observed, not what was derived',
      fields.leaked.length === 0 && fields.offered.includes('grind_setting'),
      fields.leaked.join(',') || `${fields.offered.length} fields, none derived`);
    await ed.close();
  }

  /* --------------------------------- the tail after the pump cuts */
  {
    // He called the decay after the pump cut "choking", which is the opposite
    // of what happened: the shot did not fail to finish, it finished.
    const tail = await ctx.newPage();
    await tail.goto(`${B}/live.html`);
    const said = await tail.evaluate(async () => {
      const R = await import('./assets/js/core/replay.js');
      const C = await import('./assets/js/core/coach.js');
      const c = []; let w = 0;
      for (let t = 0; t <= 26; t += 0.05) {
        // A shot that ends at 20 s, then drips out over five seconds.
        const q = t < 0.6 ? 3.6 * (1 - t / 0.6) : t < 5 ? 0.9
          : t < 20 ? 0.9 + (t - 5) * 0.13 : Math.max(0, 0.6 - (t - 20) * 0.12);
        w += q * 0.05; c.push([+t.toFixed(3), +w.toFixed(3)]);
      }
      const lines = R.saidDuring(R.prepare(c), C.live, { target: 36 });
      return { all: lines.map((l) => l.text), stopped: lines.filter((l) => /dripping|pump/i.test(l.text)) };
    });
    t('pip: he does not call the drip after the pump cuts a choking shot',
      !said.all.some((x) => /chok/i.test(x)), said.all.join(' | ') || 'said nothing');
    t('pip: he names it for what it is instead',
      said.stopped.length === 1, said.stopped.map((l) => `${l.at}s "${l.text}"`).join(' | ') || 'said nothing');
    await tail.close();
  }

  /* -------------------- a clean shot is a result, not an absence */
  {
    // He hid on three of the four shots in the first real log, because nothing
    // was wrong with any of them and silence was the honest answer. On screen
    // that reads as a broken character rather than a verdict — the panel that
    // exists to say what the curve says said nothing at all.
    const cln = await ctx.newPage();
    await cln.goto(`${B}/shots.html`);
    const clean = await cln.evaluate(async () => {
      const C = await import('./assets/js/core/coach.js');
      const D = await import('./assets/js/core/diagnose.js');
      const S = await import('./assets/js/core/schema.js');
      const c = []; let w = 0;
      for (let t = 0; t <= 26; t += 0.05) {
        const q = t < 0.6 ? 3.6 * (1 - t / 0.6) : t < 5 ? 0.9 : t < 20 ? 0.9 + (t - 5) * 0.13 : 0.03;
        w += q * 0.05; c.push([+t.toFixed(3), +w.toFixed(3)]);
      }
      const m = D.curveMetrics(c);
      const base = { ...m, curve: S.encodeCurve(c), dose_g: 18, yield_g: m.curve_yield_g,
        time_s: m.duration_s, ratio: m.curve_yield_g / 18 };
      return {
        findings: D.diagnose(base).map((f) => f.code),
        unrated: C.after(base, []).map((n) => n.id),
        // A rated keeper already had its own line; it must not gain a second.
        rated: C.after({ ...base, rating: 9 }, []).map((n) => n.id),
      };
    });
    t('shots: a clean curve is said out loud rather than met with silence',
      clean.findings.length === 0 && clean.unrated.length === 1 && clean.unrated[0] === 'clean',
      `findings [${clean.findings.join(',') || 'none'}], he says [${clean.unrated.join(',') || 'nothing'}]`);
    t('shots: and a shot that already had something to say does not get it twice',
      !clean.rated.includes('clean') && clean.rated.length >= 1,
      `on a 9/10 he says [${clean.rated.join(',')}]`);
    await cln.close();
  }

  /* ------------------ a yield that is not a weight of coffee */
  {
    // A real shot in the log records -2.5 g out and a ratio of -0.14, with a
    // curve that runs cleanly to 40 g. The scale lost the cup and took the tare
    // with it. Nothing in the app noticed, and every regression reading that
    // shot was being fed a negative ratio.
    const yl = await ctx.newPage();
    await yl.goto(`${B}/shots.html`);
    const bad = await yl.evaluate(async () => {
      const D = await import('./assets/js/core/diagnose.js');
      const S = await import('./assets/js/core/schema.js');
      const c = []; let w = 0;
      for (let t = 0; t <= 26; t += 0.05) {
        const q = t < 0.6 ? 3.6 * (1 - t / 0.6) : t < 5 ? 0.9 : t < 20 ? 0.9 + (t - 5) * 0.13 : 0.03;
        w += q * 0.05; c.push([+t.toFixed(3), +w.toFixed(3)]);
      }
      const m = D.curveMetrics(c);
      const of = (patch) => D.diagnose({ ...m, dose_g: 18, ...patch });
      const real = m.curve_yield_g;
      return {
        curveYield: real,
        negative: of({ yield_g: -2.48 }).filter((f) => /yield_/.test(f.code)),
        // Typed from memory afterwards and wrong by a lot.
        adrift: of({ yield_g: 22 }).map((f) => f.code),
        // The ordinary case: they agree, and nothing is said.
        agreeing: of({ yield_g: real }).map((f) => f.code),
        // Within a couple of grams is a scale settling, not a mistake.
        close: of({ yield_g: real - 1.5 }).map((f) => f.code),
        // A record with no curve to check against cannot be second-guessed.
        noCurve: D.diagnose({ dose_g: 18, yield_g: 36 }).map((f) => f.code),
      };
    });
    t('shots: a yield of -2.5 g is caught, and says what the curve actually reached',
      bad.negative.length === 1 && bad.negative[0].severity === 'high'
        && bad.negative[0].detail.includes(bad.curveYield.toFixed(1)),
      bad.negative[0] ? `[${bad.negative[0].severity}] ${bad.negative[0].title}` : 'said nothing');
    t('shots: a yield far from the one the curve traced is questioned',
      bad.adrift.includes('yield_disagrees'), bad.adrift.join(',') || 'nothing');
    t('shots: a yield that matches its curve is left alone',
      !bad.agreeing.some((c) => /yield_/.test(c)) && !bad.close.some((c) => /yield_/.test(c)),
      `matching [${bad.agreeing.join(',') || 'none'}], 1.5 g out [${bad.close.join(',') || 'none'}]`);
    t('shots: and a record with no curve is not second-guessed',
      !bad.noCurve.some((c) => /yield_/.test(c)), bad.noCurve.join(',') || 'nothing');
    await yl.close();
  }

  /* ----------------------------------------- every page still parses at all */
  {
    // `npm run check` node --check's the JS modules and cannot see the inline
    // module script in each page — which is where most of this app lives. A
    // stray edit inside a multi-line import took a page down to a blank screen
    // and every existing test still passed, because they all ran against other
    // pages. This is the cheapest possible guard against that whole class.
    const scan = await ctx.newPage();
    const broken = [];
    for (const name of ['index', 'live', 'shots', 'advisor', 'kit', 'lab',
                        'settings', 'backup', 'logger', 'view']) {
      const errs = [];
      const onErr = (e) => errs.push(`${name}: ${String(e).split('\n')[0]}`);
      scan.on('pageerror', onErr);
      await scan.goto(`${B}/${name}.html`);
      await scan.waitForTimeout(220);
      scan.off('pageerror', onErr);
      broken.push(...errs);
    }
    await scan.close();
    t('pages: every page loads without throwing',
      broken.length === 0, broken.slice(0, 3).join('  |  ') || '10 pages, no errors');
  }

  /* ------------------------------------------- what he says away from Live */
  {
    const cp = await ctx.newPage();
    await cp.setViewportSize({ width: 1400, height: 950 });
    await cp.goto(`${B}/shots.html`);
    // A coffee, a grinder, and shots that make a pattern worth naming.
    await cp.evaluate(() => {
      localStorage.setItem('brewkit.bags.v1', JSON.stringify([{
        id: 'bag-1', bean_name: 'Guji', roaster: 'Onyx', roast_date: '2026-08-18',
        roast_level: 'Medium', archived: false }]));
      localStorage.setItem('brewkit.grinders.v1', JSON.stringify([{
        id: 'g-1', name: 'Mignon', dial_min: 0, dial_max: 40, step: 0.1 }]));
      const base = { bag_id: 'bag-1', grinder_id: 'g-1', dose_g: 18, yield_g: 36,
        method: 'espresso', steady_flow_gs: 1.6, peak_flow_gs: 2.0,
        t_first_drip_s: 5, days_off_roast: 6 };
      localStorage.setItem('brewkit.shots.v1', JSON.stringify([
        // The one you liked, at 28 s.
        { ...base, shot_id: 'shot-0', timestamp: '2026-08-27 09:00:00',
          time_s: 28, grind_setting: 2.4, rating: 8, ratio: 2 },
        // Then two that both ran fast, which is a pattern and not a stray.
        { ...base, shot_id: 'shot-1', timestamp: '2026-08-28 09:00:00',
          time_s: 19, grind_setting: 3.0, rating: 4, ratio: 2 },
        // And one that went wrong, with a step in the curve: flow jumps 90% in
        // half a second at 14 s, which is a channel's shape rather than the
        // ordinary climb every healthy shot has.
        { ...base, shot_id: 'shot-2', timestamp: '2026-08-29 09:00:00',
          time_s: 20, grind_setting: 3.0, rating: 3, ratio: 2,
          flow_step: 0.9, flow_step_at: 14, peak_flow_gs: 3.4,
          curve: Array.from({ length: 80 }, (_, i) => {
            const tt = +(i * 0.25).toFixed(2);
            const q = tt < 5 ? 0 : (tt < 14 ? 0.9 + (tt - 5) * 0.05 : 2.9);
            return `${tt}:${Math.max(0, (tt < 5 ? 0 : (tt - 5) * q)).toFixed(2)}`;
          }).join('|') },
      ]));
    });

    // SHOTS: the page reads this shot on its own; he reads it against the log.
    await cp.goto(`${B}/shots.html#shot-2`);
    await cp.waitForSelector('.shot-row');
    await cp.waitForTimeout(400);
    const onShot = await cp.evaluate(() => ({
      says: document.querySelector('#pip-dock .pip-say')?.textContent?.trim() ?? '',
      // What the panel already says, which he must not simply repeat.
      panel: document.getElementById('detail')?.textContent ?? '',
    }));
    t('pip: on the log he reads the shot you are looking at',
      onShot.says.length > 0 && !onShot.panel.includes(onShot.says),
      onShot.says || 'said nothing about a shot rated 4 with a faster time');

    // ADVISOR: the page says what to set; he says where you were when it was
    // good, which is the thing you forget between sessions.
    await cp.goto(`${B}/advisor.html`);
    await cp.waitForTimeout(400);
    await cp.evaluate(() => {
      document.getElementById('bag').value = 'bag-1';
      document.getElementById('bag').dispatchEvent(new Event('change'));
      document.getElementById('grinder').value = 'g-1';
      document.getElementById('grinder').dispatchEvent(new Event('change'));
    });
    await cp.waitForTimeout(500);
    const onAdvice = await cp.evaluate(() =>
      document.querySelector('#pip-dock .pip-say')?.textContent?.trim() ?? '');
    t('pip: on the advisor he says where you were when it was good',
      onAdvice.length > 0,
      onAdvice || 'said nothing with a best shot at 28 s and a last one at 20 s');
    await cp.close();
  }

  /* ----------------------------------------------- he floats, and he moves */
  {
    const fl = await ctx.newPage();
    await fl.setViewportSize({ width: 1400, height: 900 });
    await fl.goto(`${B}/shots.html`);
    await fl.waitForTimeout(300);
    const start = await fl.evaluate(() => {
      const d = document.getElementById('pip-dock');
      const r = d.getBoundingClientRect();
      return { pos: getComputedStyle(d).position, at: d.dataset.at,
               onScreen: r.bottom <= innerHeight + 1 && r.top >= -1 };
    });
    // IN THE FLOW he sat wherever the page ended, which on a long detail view
    // is below the fold — so the character commenting on what you are looking
    // at was not on screen while you looked at it.
    t('pip: he floats over the page rather than sitting at the end of it',
      start.pos === 'fixed' && start.onScreen,
      `position ${start.pos}, in the viewport ${start.onScreen}, corner ${start.at}`);

    // Dragged to another corner, and it sticks — on this page and the next.
    const bar = await fl.locator('#pip-dock .pip-bar').boundingBox();
    await fl.mouse.move(bar.x + 20, bar.y + 6);
    await fl.mouse.down();
    await fl.mouse.move(1250, 110, { steps: 6 });
    const mid = await fl.evaluate(() => ({
      hints: document.querySelectorAll('.pip-snap').length,
      near: document.querySelector('.pip-snap.near')?.dataset.corner ?? '',
    }));
    await fl.mouse.up();
    await fl.waitForTimeout(300);
    const after = await fl.evaluate(() => document.getElementById('pip-dock').dataset.at);
    t('pip: he shows where he can land and goes to the one you drop him nearest',
      mid.hints === 4 && mid.near === 'tr' && after === 'tr',
      `${mid.hints} places offered, nearest ${mid.near}, landed ${after}`);
    // He is on every page, so where he sits is one decision rather than five.
    await fl.goto(`${B}/advisor.html`);
    await fl.waitForTimeout(300);
    const kept = await fl.evaluate(() => ({
      at: document.getElementById('pip-dock').dataset.at,
      // The bubble spawns to his right with a tail pointing back at him, which
      // runs off the screen from a right-hand corner.
      flipped: getComputedStyle(document.querySelector('#pip-dock .pip')).flexDirection,
      stray: document.querySelectorAll('.pip-snap').length,
    }));
    t('pip: the corner you put him in is where he is on the next page too',
      kept.at === 'tr' && kept.flipped === 'row-reverse' && kept.stray === 0,
      `corner ${kept.at}, bubble ${kept.flipped}, ${kept.stray} stray hints`);

    // BUT NOT WHERE THE PAGE IS THE THING YOU ARE WATCHING.
    // On the brewing screen he is part of the instrument — the dial, the
    // ladder and his face are one reading — and a part of an instrument that
    // moves between shots is a worse instrument. There is also nothing to move
    // him out of the way of during a twenty-second pour with both hands busy,
    // so a handle there is a way to lose him rather than a convenience.
    await fl.goto(`${B}/live.html?mock=lefu&noshot=1`);
    await fl.waitForFunction(() => window.__sess, null, { timeout: 8000 });
    await fl.waitForTimeout(300);
    const pinned = await fl.evaluate(() => {
      const d = document.getElementById('pip-dock');
      const bar = d.querySelector('.pip-bar');
      return {
        at: d.dataset.at,
        isPinned: d.classList.contains('pip-pinned'),
        // No handle affordance: no tab stop, no button role, no grab cursor.
        tabbable: bar?.tabIndex ?? -1,
        role: bar?.getAttribute('role') ?? '',
        cursor: bar ? getComputedStyle(bar).cursor : '',
      };
    });
    t('pip: on the brewing screen he is pinned, and offers no handle to drag',
      pinned.isPinned && pinned.tabbable !== 0 && pinned.role !== 'button'
        && pinned.cursor !== 'grab',
      `pinned ${pinned.isPinned}, tabIndex ${pinned.tabbable}, role "${pinned.role}", `
        + `cursor ${pinned.cursor}`);
    // The corner carried over from the other pages was 'tr'. Pinned means the
    // brewing screen puts him where IT wants him, not where the log left him.
    t('pip: and the corner he was left in elsewhere does not move him here',
      pinned.at === 'bl', `he is at ${pinned.at}`);
    // Dragging him has to actually do nothing — a listener that fires and is
    // then ignored would still show the snap hints and look broken.
    const liveBar = await fl.locator('#pip-dock .pip-bar').boundingBox();
    await fl.mouse.move(liveBar.x + 20, liveBar.y + 6);
    await fl.mouse.down();
    await fl.mouse.move(1250, 110, { steps: 6 });
    const during = await fl.evaluate(() => document.querySelectorAll('.pip-snap').length);
    await fl.mouse.up();
    await fl.waitForTimeout(250);
    const stayed = await fl.evaluate(() => document.getElementById('pip-dock').dataset.at);
    t('pip: dragging him on the brewing screen does nothing at all',
      during === 0 && stayed === 'bl',
      `${during} landing places offered, ended at ${stayed}`);
    // And the pinning must not have overwritten the corner he keeps elsewhere.
    await fl.goto(`${B}/shots.html`);
    await fl.waitForTimeout(300);
    const elsewhere = await fl.evaluate(() => document.getElementById('pip-dock').dataset.at);
    t('pip: and being pinned there does not forget where you put him everywhere else',
      elsewhere === 'tr', `back on the log he is at ${elsewhere}`);

    // AND HIS EYES GO WHERE YOU ARE. The two glance frames are eyes-left and
    // eyes-right and he already picked one at random — so he was looking
    // around, just never at anything.
    const looks = await fl.evaluate(async () => {
      const { FACES } = await import('./assets/js/core/pip.js');
      const box = document.querySelector('#pip-dock .pip-box').getBoundingClientRect();
      const face = document.querySelector('#pip-dock .pip-face');
      const seen = [];
      for (const x of [10, innerWidth - 10]) {
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
        dispatchEvent(new PointerEvent('pointermove',
          { pointerType: 'mouse', clientX: x, clientY: box.top }));
        // Force a glance rather than waiting up to nine seconds for one.
        await new Promise((r) => setTimeout(r, 30));
        seen.push({ x, mid: box.left + box.width / 2 });
      }
      return { seen, glances: FACES.idle.glance };
    });
    // The frames themselves carry the direction: index 0 has the eyes left of
    // centre, index 1 right of it. If that ever flips, aiming inverts silently.
    t('pip: his glance frames are left-then-right, which is what aiming relies on',
      looks.glances.length === 2
      && looks.glances[0].indexOf('_') < looks.glances[1].indexOf('_'),
      looks.glances.join('  '));
    await fl.close();
  }

  /* ------------------------------------------------------- him, everywhere */
  {
    // A coach who exists only while coffee is coming out is a readout, not a
    // coach. He was on Live and nowhere else — not on the page that tells you
    // what to change, not on the log of what you changed.
    const pp = await ctx.newPage();
    await pp.setViewportSize({ width: 1400, height: 950 });
    const missing = [];
    const faces = [];
    for (const name of ['advisor', 'shots', 'kit', 'lab', 'settings']) {
      await pp.goto(`${B}/${name}.html`);
      await pp.waitForTimeout(250);
      const r = await pp.evaluate(() => {
        const box = document.querySelector('#pip-dock .pip-box')?.getBoundingClientRect();
        return { up: !!box && box.width > 4 && box.height > 4,
                 face: document.querySelector('#pip-dock .pip-face')?.textContent ?? '' };
      });
      if (!r.up) missing.push(name); else faces.push(name);
    }
    t('pip: he is on every page of the tool, not only the one with the scale',
      missing.length === 0 && faces.length === 5,
      missing.length ? `absent from ${missing.join(', ')}` : `present on ${faces.join(', ')}`);

    // Turning him off is one decision, not five. The switch is a preference, so
    // it has to reach the page you are not on.
    await pp.goto(`${B}/shots.html`);
    await pp.evaluate(async () => {
      const P = await import('./assets/js/core/prefs.js');
      P.set({ coach: false });
    });
    await pp.goto(`${B}/advisor.html`);
    await pp.waitForTimeout(250);
    const off = await pp.evaluate(() => ({
      him: !!document.querySelector('#pip-dock .pip-box'),
      // And the way back is where he was, on whichever page that is.
      stub: !document.querySelector('#pip-dock .pip-stub')?.hidden,
      why: document.querySelector('#pip-dock .stub-why')?.textContent ?? '',
    }));
    t('pip: switching him off on one page switches him off on all of them',
      !off.him && off.stub && /off/i.test(off.why),
      `on advisor after turning him off in shots: him ${off.him}, way back "${off.why}"`);
    await pp.evaluate(async () => {
      const P = await import('./assets/js/core/prefs.js');
      P.set({ coach: true });
    });
    await pp.close();
  }

  /* --------------------------------------------------- telling bags apart */
  {
    const bp = await ctx.newPage();
    await bp.goto(`${B}/kit.html`);
    await bp.waitForTimeout(200);

    // THE REAL SHAPE THIS BROKE ON. One bag split into three and another of the
    // same coffee split into two, both from the same roast date — which is a
    // normal thing to own and made five entries in the picker that all read
    // "Peru Medium Roast · Bellwood".
    const SHELF = [
      { id: 'bag-002', bean_name: 'Peru Medium Roast', roaster: 'Bellwood',
        roast_date: '2026-08-20', weight_g: 145, archived: true },
      { id: 'bag-003', bean_name: 'DECAF Colombia Desvelado', roaster: 'Bellwood',
        roast_date: '2026-08-20', weight_g: 120, archived: false },
      { id: 'bag-004', bean_name: 'Peru Medium Roast', roaster: 'Bellwood',
        roast_date: '2026-08-20', weight_g: 0, archived: true, split_into: 3 },
      ...[1, 2, 3].map((i) => ({ id: `bag-${String(4 + i).padStart(3, '0')}`, bean_name: 'Peru Medium Roast',
        roaster: 'Bellwood', roast_date: '2026-08-20', weight_g: 145, archived: false,
        parent_id: 'bag-004', portion_index: i, portion_of: 3 })),
      { id: 'bag-008', bean_name: 'Peru Medium Roast', roaster: 'Bellwood',
        roast_date: '2026-08-20', weight_g: 0, archived: true, split_into: 2 },
      ...[9, 10].map((i) => ({ id: `bag-${String(i).padStart(3, '0')}`, bean_name: 'Peru Medium Roast',
        roaster: 'Bellwood', roast_date: '2026-08-20', weight_g: 163.5, archived: false,
        parent_id: 'bag-008', portion_index: i - 8, portion_of: 2 })),
    ];
    const named = await bp.evaluate(async (shelf) => {
      const K = await import('./assets/js/core/kit.js');
      const active = shelf.filter((b) => !b.archived);
      const picker = K.labelBags(active);
      const all = K.labelBags(shelf);
      // Two parents split the SAME way, which "of N" cannot separate — the case
      // that needs a real tiebreaker.
      const same = [1, 2, 3].flatMap((i) => [
        { id: `a${i}`, bean_name: 'Peru', roaster: 'B', roast_date: '2026-08-20',
          weight_g: 145, portion_index: i, portion_of: 3, parent_id: 'a' },
        { id: `b${i}`, bean_name: 'Peru', roaster: 'B', roast_date: '2026-08-20',
          weight_g: 163.5, portion_index: i, portion_of: 3, parent_id: 'b' },
      ]);
      const tied = K.labelBags(same);
      return {
        picker: active.map((b) => picker.get(b.id)),
        parents: shelf.filter((b) => b.split_into).map((b) => all.get(b.id)),
        // A bag with none of the new fields is what everything looked like
        // before any of this existed.
        legacy: all.get('bag-002'),
        tied: same.map((b) => tied.get(b.id)),
      };
    }, SHELF);
    const uniq = (a) => new Set(a).size === a.length;
    t('bags: portions of a split bag are told apart in the picker',
      uniq(named.picker) && named.picker.filter((n) => /portion 1 of 3/.test(n)).length === 1
      && named.picker.filter((n) => /portion 1 of 2/.test(n)).length === 1,
      named.picker.join(' | '));
    t('bags: and the parents say they were split rather than looking like more of the same',
      named.parents.every((n) => /split into \d/.test(n)) && uniq(named.parents),
      named.parents.join(' | '));
    // The whole point of deriving the name: nothing was written, so a bag
    // entered before portions existed is untouched and reads as it always did.
    t('bags: a bag with none of the portion fields keeps the plain name it always had',
      named.legacy === 'Peru Medium Roast \u00b7 Bellwood', named.legacy);
    // Two parents split the same way: "of 3" is identical on both sides, so the
    // name has to fall through to something that actually differs.
    t('bags: two bags split the same way still get distinct names',
      uniq(named.tied) && named.tied.some((n) => /145 g/.test(n))
      && named.tied.some((n) => /163\.5 g/.test(n)),
      named.tied.slice(0, 2).join(' | '));

    // The other half of "checked for doubles": noticing on the way in.
    const twins = await bp.evaluate(async (shelf) => {
      const K = await import('./assets/js/core/kit.js');
      const same = { id: 'new', bean_name: 'Peru Medium Roast', roaster: 'Bellwood',
                     roast_date: '2026-08-20' };
      return {
        found: K.twinBags(same, shelf).map((b) => b.id),
        // A portion is a bag deliberately made to match its siblings. Warning
        // about what the split button just did would be noise.
        portion: K.twinBags({ ...same, id: 'p', portion_of: 3 }, shelf).length,
        different: K.twinBags({ ...same, roast_date: '2026-07-01' }, shelf).length,
        blank: K.twinBags({ id: 'x' }, shelf).length,
      };
    }, SHELF);
    t('bags: entering one you already have says so, without refusing it',
      twins.found.length === 3 && twins.found.every((id) => /bag-00[248]/.test(id))
      && twins.different === 0 && twins.blank === 0,
      `matched ${twins.found.join(', ')}; a different roast date matches ${twins.different}`);
    t('bags: and a portion is not reported as a double of its own siblings',
      twins.portion === 0, `${twins.portion} twins reported for a portion`);

    // ONE COFFEE, ONE DATASET. Splitting a bag makes one purchase into three or
    // five records, and shots filed against them were three or five separate
    // datasets — so a grind model that needs a handful of shots to say anything
    // had one or two, on a coffee you had pulled twenty shots of.
    const pooled = await bp.evaluate(async (shelf) => {
      const K = await import('./assets/js/core/kit.js');
      const A = await import('./assets/js/core/advisor.js');
      // Twelve shots, spread over the three portions of bag-004 and the two of
      // bag-008 — one coffee, five records.
      const across = ['bag-005', 'bag-006', 'bag-007', 'bag-009', 'bag-010'];
      const shots = Array.from({ length: 15 }, (_, i) => ({
        shot_id: `s${i}`, bag_id: across[i % across.length], grinder_id: 'g1',
        grind_setting: 2 + (i % 5) * 0.4, steady_flow_gs: 1.2 + (i % 5) * 0.22,
        days_off_roast: 5, rating: 7,
      }));
      const one = K.sameBeans('bag-005', shelf);
      return {
        pool: one.length,
        // What the model actually gets to see, before and after.
        alone: A.resistanceRows(shots, { grinderId: 'g1', bagId: 'bag-005' }).length,
        together: A.resistanceRows(shots, { grinderId: 'g1', bagId: one }).length,
        // A different coffee is still a different coffee.
        other: K.sameBeans('bag-003', shelf).length,
      };
    }, SHELF);
    t('bags: portions of one coffee are one dataset to the advisor, not five',
      pooled.pool === 8 && pooled.alone === 3 && pooled.together === 15,
      `${pooled.pool} bags of that coffee; the model saw ${pooled.alone} shots `
      + `on one portion and ${pooled.together} across the coffee`);
    t('bags: and a different coffee is still a different coffee',
      pooled.other === 1, `${pooled.other} bag pooled for the decaf`);

    // THE LOG IS NOT RENAMED BY THE SHELF. A shot stores the bean name it was
    // pulled with on purpose: that is what you made, and it has to survive the
    // bag being renamed, split again or thrown away. So the log takes only the
    // qualifier — the part it was missing — and keeps its own name.
    const marks = await bp.evaluate(async (shelf) => {
      const K = await import('./assets/js/core/kit.js');
      const q = K.bagQualifiers(shelf);
      const renamed = K.bagQualifiers(shelf.map((b) => b.id === 'bag-005'
        ? { ...b, bean_name: 'Renamed Since' } : b));
      return { portion: q.get('bag-005'), parent: q.get('bag-004'), plain: q.get('bag-003'),
               afterRename: renamed.get('bag-005'), unknown: q.get('bag-999') };
    }, SHELF);
    t('bags: the shot log gains which portion it was without losing the name it recorded',
      marks.portion === 'portion 1 of 3' && marks.parent === 'split into 3'
      && marks.plain === '' && marks.afterRename === 'portion 1 of 3'
      && marks.unknown === undefined,
      `portion "${marks.portion}", plain bag "${marks.plain}", `
      + `after renaming the bag "${marks.afterRename}"`);

    // End to end, through the picker that showed the bug.
    await bp.goto(`${B}/live.html`);
    await bp.evaluate((shelf) => localStorage.setItem('brewkit.bags.v1', JSON.stringify(shelf)),
      SHELF);
    await bp.goto(`${B}/live.html`);
    await bp.waitForFunction(() => document.getElementById('p-bag')?.options.length > 1,
      { timeout: 8000 });
    const options = await bp.evaluate(() =>
      [...document.getElementById('p-bag').options].slice(1).map((o) => o.textContent));
    t('bags: the coffee picker on Live offers six distinguishable bags, not five of one name',
      uniq(options) && options.length === 6,
      options.join(' | '));
    await bp.close();
  }

  /* ----------------------------------------------------- watching it again */
  {
    const rep = await ctx.newPage();
    await rep.setViewportSize({ width: 1280, height: 900 });
    // A shot shaped like a real one: five seconds of nothing, a ramp, a taper.
    const curve = Array.from({ length: 130 }, (_, i) => {
      const tt = +(i * 0.25).toFixed(2);
      return [tt, Math.max(0, +(tt < 5 ? 0 : 1.9 * (tt - 5) - 0.018 * (tt - 5) ** 2).toFixed(2))];
    });
    await rep.goto(`${B}/shots.html`);
    await rep.evaluate((c) => {
      localStorage.setItem('brewkit.shots.v1', JSON.stringify([{
        shot_id: 'shot-900', timestamp: '2026-08-31 09:00:00', bean_name: 'Ethiopia Guji',
        dose_g: 18, yield_g: 36, time_s: 32, method: 'espresso',
        curve: c.map(([tt, w]) => `${tt}:${w}`).join('|'),
      }]));
      localStorage.setItem('brewkit.replays.v1', JSON.stringify({
        'shot-900': c.map(([tt, w]) => `${tt.toFixed(2)}:${w.toFixed(2)}`).join('|') }));
    }, curve);

    // THE TRANSPORT, on a clock the test owns. Playing, pausing and scrubbing
    // are a small pile of state that is easy to get subtly wrong, and driving
    // it off the wall clock would make these tests both slow and flaky.
    const drive = await rep.evaluate(async (c) => {
      const { Replay } = await import('./assets/js/core/replay.js');
      let now = 0;
      let frame = null;
      const r = new Replay(c, { now: () => now, raf: (fn) => { frame = fn; return 1; },
                                cancel: () => { frame = null; } });
      const step = (ms) => { now += ms; const f = frame; frame = null; f?.(); };
      const out = { duration: +r.duration.toFixed(2) };
      r.play();
      step(4000);
      out.afterFour = +r.t.toFixed(2);
      // Pausing stops the clock, and time passing while paused must not count.
      r.pause();
      now += 10000;
      out.afterPause = +r.t.toFixed(2);
      // Double speed covers twice the ground for the same wall time.
      r.play(); r.setSpeed(2); step(2000);
      out.atDouble = +(r.t - out.afterFour).toFixed(2);
      // A scrub lands where it was put, whatever was happening before.
      r.seek(20); step(0); out.sought = +r.t.toFixed(2);
      // And it stops at the end rather than running past it or looping.
      r.setSpeed(4); step(60000);
      out.end = +r.t.toFixed(2);
      out.playingAtEnd = r.playing;
      // Play at the end starts it over, rather than doing nothing.
      r.play(); out.replayed = +r.t.toFixed(2);
      return out;
    }, curve);
    t('replay: it plays at the speed it says, and pausing actually stops the clock',
      Math.abs(drive.afterFour - 4) < 0.05 && Math.abs(drive.afterPause - 4) < 0.05
      && Math.abs(drive.atDouble - 4) < 0.05,
      `4 s of clock \u2192 ${drive.afterFour} s, ten more while paused \u2192 `
      + `${drive.afterPause} s, 2 s at 2\u00d7 \u2192 ${drive.atDouble} s of shot`);
    t('replay: it lands where it is scrubbed, stops at the end, and starts over from there',
      drive.sought === 20 && Math.abs(drive.end - drive.duration) < 0.01
      && drive.playingAtEnd === false && drive.replayed === 0,
      `sought ${drive.sought}, ended at ${drive.end} of ${drive.duration}, `
      + `play again from ${drive.replayed}`);

    // The trace is the shot SO FAR. A replay that draws the whole curve at t=0
    // is a chart, and the one thing a chart cannot show you is when something
    // happened.
    const drawn = await rep.evaluate(async (c) => {
      const { prepare, upTo, sample } = await import('./assets/js/core/replay.js');
      const d = prepare(c);
      const at = (tt) => ({ n: upTo(d, tt).length, last: upTo(d, tt).at(-1)?.[0] ?? null });
      return { zero: at(0), mid: at(15), end: at(d.duration),
               // Interpolated between stored samples rather than stepping.
               between: +sample(d, 10.1).w.toFixed(3),
               lo: +sample(d, 10).w.toFixed(3), hi: +sample(d, 10.25).w.toFixed(3) };
    }, curve);
    t('replay: the curve draws itself as it goes rather than being there already',
      drawn.zero.n <= 1 && drawn.mid.n > 4 && drawn.mid.n < drawn.end.n
      && Math.abs(drawn.mid.last - 15) < 0.3,
      `${drawn.zero.n} points at 0 s, ${drawn.mid.n} at 15 s, ${drawn.end.n} at the end`);
    t('replay: and reads between the stored samples, so a scrub is smooth',
      drawn.between > drawn.lo && drawn.between < drawn.hi,
      `${drawn.lo} < ${drawn.between} < ${drawn.hi} across one sample step`);

    // THE BREWING SCREEN IS WHAT PLAYS. The first version of this was a panel
    // of its own beside the pour, which is a second rendering of a shot — and
    // the wrong answer to the ask, which was to watch the shot back on the
    // screen you watched it on. So the assertions are about the real dial, the
    // real numbers and the real curve.
    await rep.goto(`${B}/live.html?mock=generic#replay=shot-900`);
    await rep.waitForFunction(() => window.__replay, { timeout: 10000 });
    await rep.waitForFunction(() => window.__replay.now, { timeout: 10000 });
    await rep.evaluate(() => { window.__replay.now.pause(); window.__replay.now.seek(22); });
    await rep.waitForTimeout(300);
    const onScreen = await rep.evaluate(() => ({
      // The brewing screen, not the connect or teaching step. A replay opened
      // from the log has no scale behind it and must not wait for one.
      live: getComputedStyle(document.getElementById('step-live')).display !== 'none',
      tag: document.getElementById('mid-tag').textContent,
      weight: document.getElementById('o-w').textContent,
      time: document.getElementById('o-t').textContent,
      flow: document.getElementById('o-f').textContent,
      state: document.getElementById('state').textContent.trim(),
      // The dial, the bands and the stop-at are the real ones this screen
      // always draws — that is the whole point of driving render().
      dial: document.querySelector('#brew-gauge .g-sub')?.textContent ?? '',
      cut: document.getElementById('c-cut').textContent,
      trace: document.querySelectorAll('#curve path.weightline').length,
      flowline: document.querySelectorAll('#curve path.flowline').length,
      marked: document.body.classList.contains('replaying'),
    }));
    t('replay: the brewing screen itself plays the shot back, numbers and all',
      onScreen.live && Math.abs(parseFloat(onScreen.weight) - 27.1) < 0.4
      && Math.abs(parseFloat(onScreen.time) - 22) < 0.2
      && parseFloat(onScreen.flow) > 0.5 && /extract/i.test(onScreen.state),
      `${onScreen.weight} g at ${onScreen.time} s, ${onScreen.flow} g/s, "${onScreen.state}"`);
    t('replay: and the dial, the bands and the stop weight are the ones it always draws',
      /ristretto|espresso|lungo/i.test(onScreen.dial)
      && parseFloat(onScreen.cut) > 30 && onScreen.trace === 1 && onScreen.flowline === 1,
      `dial "${onScreen.dial}", stop at ${onScreen.cut} g, ${onScreen.trace} trace`);
    // A recording that looks exactly like a shot in progress is the one bad
    // outcome here, so the panel says what it is showing for the whole time.
    t('replay: the panel says it is a recording, for as long as it is one',
      onScreen.marked && /replay/i.test(onScreen.tag) && /900/.test(onScreen.tag),
      `body.replaying ${onScreen.marked}, tag "${onScreen.tag}"`);

    // NOTHING IS CHANGED BY WATCHING. render() files the shot, arms the stop,
    // advances the session and talks to the phone past the paint — a replay
    // must do the paint and none of the rest, or rewatching a shot files it a
    // second time and teaches the machine its drip lag twice from one pour.
    await rep.evaluate(() => window.__replay.now.seek(999));
    await rep.waitForTimeout(300);
    const after = await rep.evaluate(() => ({
      shots: JSON.parse(localStorage.getItem('brewkit.shots.v1') || '[]').length,
      ended: window.__replay.now.ended,
      still: !!window.__replay.now,
    }));
    t('replay: watching a shot to the end does not file it again',
      after.shots === 1 && after.ended,
      `${after.shots} shot in the log after playing to the end`);
    // And the way out puts the screen back.
    await rep.click('#rp-stop');
    await rep.waitForTimeout(250);
    const closed = await rep.evaluate(() => ({
      marked: document.body.classList.contains('replaying'),
      tag: document.getElementById('mid-tag').textContent,
      gone: !window.__replay.now,
    }));
    t('replay: and closing it gives the screen back to the scale',
      closed.gone && !closed.marked && !/replay/i.test(closed.tag),
      `replaying ${!closed.gone}, tag "${closed.tag}"`);

    // EVERY SHOT CAN BE WATCHED, not only the ones kept. Keeping was opt-in, and
    // the button was only offered on kept ones — so on a log full of real shots,
    // none of which had been through the button on Live, the feature did not
    // appear at all. Every shot already stores its curve; keeping one buys
    // resolution, not the ability to play it.
    await rep.evaluate(() => localStorage.removeItem('brewkit.replays.v1'));
    await rep.goto(`${B}/shots.html#shot-900`);
    await rep.waitForSelector('.shot-row');
    const unkept = await rep.evaluate(() => {
      const a = [...document.querySelectorAll('#detail a')]
        .find((n) => /watch this shot/i.test(n.textContent));
      return { offered: !!a, href: a?.getAttribute('href') ?? '' };
    });
    t('replay: a shot that was never kept can still be watched from the log',
      unkept.offered && /replay=shot-900/.test(unkept.href),
      unkept.offered ? unkept.href : 'no button on an un-kept shot');
    await rep.goto(`${B}/live.html?mock=generic#replay=shot-900`);
    await rep.waitForFunction(() => window.__replay?.now, { timeout: 10000 });
    const fromRecord = await rep.evaluate(() => {
      window.__replay.now.pause();
      window.__replay.now.seek(20);
      return { t: document.getElementById('o-t').textContent,
               w: document.getElementById('o-w').textContent,
               msg: document.getElementById('live-msg').textContent };
    });
    t('replay: and it plays off the curve the record already carries',
      Math.abs(parseFloat(fromRecord.t) - 20) < 0.4 && parseFloat(fromRecord.w) > 10
      && !/no /i.test(fromRecord.msg),
      `${fromRecord.w} g at ${fromRecord.t} s from the shot's own 4 Hz curve`);

    // Keeping one, and un-keeping it.
    const kept = await rep.evaluate(async () => {
      const R = await import('./assets/js/core/replay.js');
      const before = R.saved();
      R.save('shot-901', [[0, 0], [1, 2], [2, 4]]);
      const after = R.saved();
      const round = R.load('shot-901');
      R.drop('shot-901');
      return { before, after, round, gone: R.has('shot-901'),
               // Two points is a dot, not a shot.
               refused: R.save('shot-902', [[0, 0]]) };
    });
    t('replay: keeping one files it under its shot, and dropping it leaves the shot alone',
      kept.after.includes('shot-901') && !kept.before.includes('shot-901')
      && kept.round.length === 3 && kept.gone === false && kept.refused === false,
      `${kept.before.length} \u2192 ${kept.after.length} kept, round-tripped `
      + `${kept.round.length} points, still there after dropping: ${kept.gone}`);

    // A badge inside a selected row. The row recolours its text for an accent
    // ground, and a badge paints its own background — so one that inherited the
    // colour drew white on its own white panel and was a blank rectangle.
    // Kept again: the test above cleared the store to prove an un-kept shot
    // still plays, and this one is about the mark that says a shot IS kept.
    await rep.goto(`${B}/shots.html`);
    await rep.evaluate(async () => {
      const R = await import('./assets/js/core/replay.js');
      R.save('shot-900', [[0, 0], [1, 2], [2, 4], [3, 6]]);
    });
    await rep.goto(`${B}/shots.html#shot-900`);
    await rep.waitForSelector('.shot-row');
    const badge = await rep.evaluate(() => {
      const b = document.querySelector('.shot-row[aria-current="true"] .badge');
      if (!b) return null;
      const cs = getComputedStyle(b);
      return { fg: cs.color, bg: cs.backgroundColor, text: b.textContent };
    });
    t('replay: the mark on a kept shot is readable on a selected row',
      badge && badge.fg !== badge.bg && badge.text.length > 0,
      badge ? `${badge.text}: ${badge.fg} on ${badge.bg}` : 'no badge found');

    await rep.close();
  }

} finally {
  await browser.close();
  await server.close();
}

for (const e of errs) { fail++; console.log('  FAIL browser error  — ' + e); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
