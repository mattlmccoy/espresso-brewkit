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
const t = (name, ok, extra = '') => {
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? '  — ' + extra : ''));
};

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
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
  // 1. Landing page + load sample data
  await page.goto(B + '/index.html');
  await page.click('#load-sample');
  await page.waitForFunction(() => document.getElementById('sample-msg').textContent.includes('loaded'), {timeout:5000});
  const msg = await page.textContent('#sample-msg');
  t('index: sample data loads', msg.includes('15 shots loaded'), msg.trim());

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

  // 9. Theme toggle persists
  await page.goto(B + '/index.html');
  await page.click('[data-theme-toggle]');
  const themeAttr = await page.getAttribute('html', 'data-theme');
  await page.goto(B + '/explore.html');
  const themeAfter = await page.getAttribute('html', 'data-theme');
  t('theme: toggles and persists across pages', themeAttr === themeAfter && !!themeAttr, themeAttr);

  // 10. Nav marking
  const current = await page.locator('.nav a[aria-current="page"]').innerText();
  // innerText reflects CSS text-transform, which the design language applies.
  t('nav: marks current page', current.trim().toLowerCase() === 'explore', current);

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

    // Items in one grid row must share a top edge — an adjacency margin leaking
    // into grid children silently staircases them.
    const rows = await page.evaluate(() => {
      const bad = [];
      for (const g of document.querySelectorAll('.grid')) {
        const kids = [...g.children].filter(k => k.getBoundingClientRect().height > 0);
        const byRow = new Map();
        for (const k of kids) {
          const r = k.getBoundingClientRect();
          const key = Math.round(r.bottom / 5);
          byRow.set(key, [...(byRow.get(key) || []), Math.round(r.top)]);
        }
        for (const tops of byRow.values()) {
          if (new Set(tops).size > 1) bad.push(tops.join('/'));
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
    const tops = [...document.querySelectorAll('.nav a')].map(a => Math.round(a.getBoundingClientRect().top));
    return new Set(tops).size;
  });
  const mobileOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t('mobile: nav stays on one row', navRows === 1, navRows + ' row(s)');
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

  await page.fill('#ref', '0');
  await page.click('#capture');
  await page.waitForTimeout(1100);
  await page.fill('#ref', '120');
  await page.click('#capture');
  await page.waitForTimeout(400);
  const candCount = await page.locator('#cands .cand').count();
  t('live: auto-decoder proposes an encoding', candCount > 0, candCount + ' candidates');

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

  await page.waitForFunction(
    () => document.querySelectorAll('#curve svg circle.pt').length > 5, { timeout: 25000 }).catch(() => {});
  const pts = await page.locator('#curve svg circle.pt').count();
  t('live: shot curve renders', pts > 5, pts + ' points');

  const w1 = await page.evaluate(() => parseFloat(document.getElementById('o-w').textContent));
  await page.waitForTimeout(4000);
  const w2 = await page.evaluate(() => parseFloat(document.getElementById('o-w').textContent));
  t('live: net weight climbs during extraction', w2 > w1 && w1 >= 0, `${w1} g -> ${w2} g`);

  // Saving is on the Rate step now, and Stop is what turns a running curve into
  // the scalars a record is made of. Walking that path is the test.
  const shotsBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('brewkit.shots.v1') || '[]').length);
  await page.click('#stop');
  await page.waitForFunction(() => /g in/.test(document.getElementById('live-msg').textContent),
    { timeout: 5000 });
  await page.click('#stepper button[data-step="rate"]');
  await page.click('#r-rate button:nth-child(7)');
  await page.click('#r-tags button:nth-child(3)');
  await page.click('#save');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('save-msg').textContent),
    { timeout: 5000 });
  const shots = await page.evaluate(() => JSON.parse(localStorage.getItem('brewkit.shots.v1') || '[]'));
  const last = shots.at(-1) ?? {};
  t('live: captured shot saves to the log', shots.length === shotsBefore + 1,
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
  t('live: yield and time come from the curve, not a guess',
    last.yield_g > 1 && last.time_s > 1 && Math.abs(last.ratio - last.yield_g / last.dose_g) < 1e-6,
    `${last.yield_g} g in ${last.time_s} s, ratio ${last.ratio?.toFixed?.(2)}`);
  t('live: the diagnosis is shown where the shot ends',
    (await page.locator('#r-diag').innerText()).trim().length > 10,
    (await page.locator('#r-diag').innerText()).replace(/\s+/g, ' ').slice(0, 70));

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
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 8000 });

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
      // A channel opening at 16 s: flow climbs when it should be sagging.
      channel: codes(build((t) => t < 2 ? 0 : t < 5 ? (t - 2) * 0.5 : t < 30 ? 1.4 + Math.max(0, t - 16) * 0.09 : 0.04), { ratio: 2.4 }),
      // Choked: nothing for 14 s, then a trickle.
      choked: codes(build((t) => (t < 14 ? 0 : t < 33 ? 0.45 : 0)), { ratio: 1.4 }),
      // Gusher: water through almost immediately, fast throughout.
      gusher: codes(build((t) => (t < 1 ? 0 : t < 12 ? 2.9 : 0.03)), { ratio: 2 }),
    };
  });
  t('diagnose: a clean curve is reported as clean', diag.clean.codes.length === 0,
    diag.clean.codes.join(',') || 'no findings');
  t('diagnose: a late flow rise is called channelling', diag.channel.codes.includes('channeling'),
    diag.channel.codes.join(','));
  t('diagnose: channelling is not confused with a slow shot',
    !diag.channel.codes.includes('choked'), diag.channel.codes.join(','));
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

  // ---- Kit: a bag and a grinder, through the UI ----
  await page.goto(B + '/kit.html');
  await page.fill('#b-name', 'Test Guji');
  await page.fill('#b-roaster', 'Test Roasters');
  await page.fill('#b-weight', '250');
  const roasted = new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10);
  await page.fill('#b-roast', roasted);
  await page.click('#b-save');
  await page.waitForFunction(() => /Added/.test(document.getElementById('b-msg').textContent));
  const bagCards = await page.locator('#bags .bx').count();
  t('kit: a bag is saved and listed', bagCards === 1, bagCards + ' bag(s)');
  t('kit: days off roast is shown, not the raw date',
    /9 d off roast/i.test(await page.innerText('#bags')),
    (await page.innerText('#bags')).replace(/\s+/g, ' ').slice(0, 80));

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

  // ---- the session flow, end to end, against the recognised mock scale ----
  await page.goto(B + '/live.html?mock=lefu');
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 8000 });
  await page.click('#stepper button[data-step="prep"]');
  t('session: the stepper marks the current step',
    (await page.getAttribute('#stepper button[data-step="prep"]', 'aria-current')) === 'step');
  await page.selectOption('#p-bag', kitIds.bag);
  await page.selectOption('#p-grinder', kitIds.grinder);
  await page.fill('#p-grind', '12.5');
  await page.fill('#p-dose', '18.2');
  await page.fill('#p-ratio', '2');
  t('session: the target is stated in the units you set it in',
    /18\.2 g in, 36\.4 g out/.test(await page.textContent('#p-target')),
    await page.textContent('#p-target'));

  await page.click('#stepper button[data-step="dose"]');
  await page.fill('#d-manual', '18.2');
  await page.click('#stepper button[data-step="grind"]');
  await page.fill('#g-manual', '17.9');
  t('session: retention is derived from dose and grounds out',
    /retention 0\.30 g \(1\.6%\)/.test(await page.textContent('#g-retention')),
    await page.textContent('#g-retention'));

  await page.click('#stepper button[data-step="brew"]');
  await page.click('#arm');
  await page.waitForFunction(
    () => document.getElementById('state').dataset.state === 'extracting', { timeout: 20000 });
  await page.waitForTimeout(4000);
  await page.click('#stop');
  await page.waitForFunction(() => /g in/.test(document.getElementById('live-msg').textContent),
    { timeout: 5000 });
  t('session: the shot summary reports the curve scalars',
    /First drip/i.test(await page.innerText('#b-summary'))
    && /Steady flow/i.test(await page.innerText('#b-summary')),
    (await page.innerText('#b-summary')).replace(/\s+/g, ' ').slice(0, 70));

  await page.click('#stepper button[data-step="rate"]');
  await page.click('#r-rate button:nth-child(8)');
  await page.click('#save');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('save-msg').textContent),
    { timeout: 5000 });
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('brewkit.shots.v1')).at(-1));
  t('session: the row links to the bag and the grinder',
    rec.bag_id && rec.grinder_id && rec.grind_setting === 12.5,
    `${rec.bag_id} / ${rec.grinder_id} @ ${rec.grind_setting}`);
  t('session: the bag is copied onto the row so the CSV stands alone',
    rec.bean_name === 'Test Guji' && rec.roaster === 'Test Roasters',
    `${rec.roaster} — ${rec.bean_name}`);
  t('session: days off roast is frozen at the time of the shot', rec.days_off_roast === 9,
    String(rec.days_off_roast));
  t('session: dose, grounds out and retention are all on the row',
    rec.dose_g === 18.2 && rec.grounds_out_g === 17.9 && Math.abs(rec.retention_g - 0.3) < 0.001,
    `${rec.dose_g} / ${rec.grounds_out_g} / ${rec.retention_g}`);
  t('session: the rating is recorded', rec.rating === 8, String(rec.rating));

  // Reopening should not make you re-pick the bag you were already using.
  await page.goto(B + '/live.html?mock=lefu');
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 8000 });
  await page.click('#stepper button[data-step="prep"]');
  t('session: the last coffee, grinder and grind come back',
    (await page.inputValue('#p-grind')) === '12.5'
    && (await page.$eval('#p-bag', (e) => e.value)) === kitIds.bag,
    `${await page.$eval('#p-bag', (e) => e.value)} @ ${await page.inputValue('#p-grind')}`);
  // A sticky default that overwrites what you are typing is worse than no default.
  await page.fill('#p-dose', '20');
  await page.waitForTimeout(150);
  t('session: sticky defaults do not fight the keyboard',
    (await page.inputValue('#p-dose')) === '20', await page.inputValue('#p-dose'));

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
  for (const p of ['index', 'live', 'kit', 'advisor', 'calculator', 'logger', 'explore', 'quality', 'uncertainty']) {
    await page.goto(`${B}/${p}.html`);
    const hrefs = await page.$$eval('.nav a', (as) => as.map((a) => a.getAttribute('href')));
    if (!hrefs.includes('./kit.html') || !hrefs.includes('./advisor.html')) {
      t(`nav: ${p}.html links to the new tools`, false, hrefs.join(' '));
    }
  }
  t('nav: every page links to Kit and Advisor', true, '9 pages checked');

  // Contrast: the chrome uses one foreground against --ink, whose lightness flips
  // between themes — exactly where an illegible pairing hides.
  for (const scheme of ['light', 'dark']) {
    const c2 = await browser.newContext({ viewport:{width:1300,height:900}, colorScheme: scheme });
    const p2 = await c2.newPage();
    await p2.goto(B + '/explore.html');
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
      for (const sel of ['.brand', '.tag', '.nav a[aria-current="page"]', '.eq', 'th', 'button.primary']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const cs = getComputedStyle(el);
        const r = ratio(cs.color, cs.backgroundColor);
        if (r < out.r) out = { sel, r: Math.round(r * 100) / 100 };
      }
      return out;
    });
    t(`contrast (${scheme}): chrome pairs stay legible`, worst.r >= 4.5,
      `worst ${worst.sel} at ${worst.r}:1`);
    await c2.close();
  }

} finally {
  await browser.close();
  await server.close();
}

for (const e of errs) { fail++; console.log('  FAIL browser error  — ' + e); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
