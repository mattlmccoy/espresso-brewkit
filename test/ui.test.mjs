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
/**
 * A fork with no client id of its own. The repo ships one now, so the only way
 * to test the "you must supply one" half of the page is to serve the module a
 * deployment would have left empty.
 */
const noShippedId = () => page.route('**/config.js', (route) => route.fulfill({
  contentType: 'text/javascript', body: "export const GOOGLE_CLIENT_ID = '';\n" }));
const shippedIdBack = () => page.unroute('**/config.js');
/** The client-id box folds away once the site ships an id of its own. */
const openClientBox = () => page.evaluate(() => {
  document.getElementById('own-project').open = true;
});

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

  // Three palettes, cycled. The button is named for where it takes you.
  const cycle = await page.evaluate(async () => {
    const { THEMES } = await import('./assets/js/ui.js');
    const btn = document.querySelector('[data-theme-toggle]');
    const seen = [];
    for (let i = 0; i < 4; i++) {
      seen.push(`${document.documentElement.getAttribute('data-theme')}>${btn.textContent}`);
      btn.click();
    }
    return { seen, order: THEMES.join(','), at: document.documentElement.getAttribute('data-theme') };
  });
  t('theme: three of them, and the button names the next one',
    cycle.order === 'light,dark,terminal'
    && cycle.seen.every((s) => {
      const [now, next] = s.split('>');
      const order = ['light', 'dark', 'terminal'];
      return order[(order.indexOf(now) + 1) % 3].toLowerCase() === next.toLowerCase();
    }), cycle.seen.join(' · '));
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
  t('kit: one pane is on screen, not four',
    panes.total === 4 && panes.visible.length === 1 && panes.selected.length === 1
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

  // ---- the session steps itself, driven by the scale ----
  // The whole point: weighing beans, grinding and pulling should advance the
  // session on their own. No clicks below except the rating at the end.
  await page.goto(B + '/live.html?mock=lefu&noshot=1');
  await page.waitForFunction(
    () => document.getElementById('step-live').style.display !== 'none', { timeout: 8000 });
  await page.selectOption('#p-bag', kitIds.bag);
  await page.selectOption('#p-grinder', kitIds.grinder);
  await page.fill('#p-grind', '12.5');

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
    seen.grinderDone = { phase: m.phase, say: say(m), cand: m.candidate };
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
  t('flow: at the target it says to lift the cup, with no clock running',
    job.seen.atTarget.phase === 'ready' && job.seen.atTarget.cand === 18.2
    && job.seen.atTarget.hold === null
    && /18\.2 g — lift the dosing cup off to move on to the grind/.test(job.seen.atTarget.say),
    job.seen.atTarget.say);
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
  t('flow: grounds near the dose that was weighed end the step',
    job.seen.grinderDone.phase === 'ready' && job.seen.grinderDone.cand === 17.9
    && /lift the portafilter off to move on to brewing/.test(job.seen.grinderDone.say),
    job.seen.grinderDone.say);
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
    const start = () => { const m = new SessionMachine(); m.setReady(true); m.setTarget(18);
                          m.step_(0, 0, 0, true); return m; };

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
    placed.cupTare === 30 && placed.cupPhase === 'fill', `tared ${placed.cupTare}`);
  t('flow: the same 30 g poured in over six seconds is coffee, and is not',
    placed.pourTare === null && placed.pourCand === 30,
    `tare ${placed.pourTare}, candidate ${placed.pourCand}`);
  t('flow: and a portafilter needs no such argument, being heavier than any dose',
    placed.pfTare === 469, `tared ${placed.pfTare}`);

  // ---- and the ways out when it cannot know you are done ----
  const ways = await page.evaluate(async () => {
    const { SessionMachine, prompt } = await import('./assets/js/core/session.js');
    const ready = (target) => {
      const m = new SessionMachine();
      m.setReady(true);
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

    // Nowhere near the target: the app cannot tell finished from paused, so the
    // countdown it always had is the fallback. Kept under the vessel threshold
    // so this is unambiguously a dose and not a container.
    const odd = ready(30);
    const oddAt = run(odd, 0.2, 10, 12.4);

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
    return { oddAt, oddDose: odd.dose, pourAt, pourDose: pouring.dose,
             byHand, handDose: asked.dose, handWhy: asked.events.at(-1)?.text ?? '',
             onTare, tareStep: tared.step, before, after };
  });
  t('hands-free: a dose nowhere near the target still commits on a long hold',
    ways.oddDose === 12.4 && ways.oddAt && ways.oddAt.t > 4.5 && ways.oddAt.t < 8,
    `${ways.oddDose} g at ${ways.oddAt?.t} s, aiming at 30`);
  t('hands-free: but a pour that never rests is left alone',
    ways.pourAt === null && ways.pourDose === null,
    `dose ${ways.pourDose} after 12 s of climbing`);
  t('hands-free: and you can always just say so',
    ways.byHand.committed === 'dose' && ways.handDose === 18.2, `${ways.handDose} g by hand`);
  t('hands-free: the log says which of the ways it was',
    /because you said so/.test(ways.handWhy), ways.handWhy);
  t('hands-free: a tare with nothing behind it still means nothing',
    ways.onTare.committed === null && ways.tareStep === 'dose', ways.tareStep);
  t('hands-free: at the target there is no countdown to run',
    ways.before.hold === null && ways.after.phase === 'ready' && ways.after.hold === null,
    `${ways.after.phase}, hold ${ways.after.hold}`);

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

  await page.click('#r-rate button:nth-child(8)');
  await page.click('#save');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('save-msg').textContent),
    { timeout: 5000 });
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
    && /lift the dosing cup off/i.test(caught.hint),
    `${caught.value} — ${caught.hint}`);
  t('hands-free: and no countdown bar, because nothing is counting down',
    caught.bar === true, `bar hidden: ${caught.bar}`);
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
  }));
  t('setup: choosing both advances it with no click',
    afterPick.step === 'dose' && /dosing cup on the scale/i.test(afterPick.hint),
    afterPick.hint);
  t('setup: the highlight comes off, and the tile says what was chosen',
    afterPick.wanted === 0 && /Guji/.test(afterPick.tile),
    `${afterPick.wanted} flagged, tile "${afterPick.tile}"`);

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
  }
  await phone.close();
  await page.evaluate(() => document.getElementById('pair-dlg').close());

  // ---- Lab holds the analysis tools ----
  await page.goto(B + '/lab.html');
  const labLinks = await page.$$eval('.tool-card', (as) => as.map((a) => a.getAttribute('href')));
  t('lab: the analysis tools moved behind one page',
    ['./calculator.html', './explore.html', './quality.html', './uncertainty.html']
      .every((h) => labLinks.includes(h)), labLinks.join(' '));
  const navLinks = await page.$$eval('.nav a', (as) => as.map((a) => a.getAttribute('href')));
  t('lab: the daily loop is what the nav shows',
    navLinks.join(',') === './live.html,./shots.html,./advisor.html,./kit.html,./lab.html'
      + ',./sync.html',
    navLinks.join(' '));
  t('lab: and Sync rides in as the account chip, not as a sixth tab',
    await page.locator('.nav a[data-account]').count() === 1
    && (await page.getAttribute('.nav a[data-account]', 'href')) === './sync.html',
    'one chip, last');







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



  // ---- the Google site-verification file ----
  // It has to be served byte for byte at its exact path: Google fetches it and
  // compares the contents. A build step that "helpfully" rewrites it, or a
  // refactor that tidies it away, silently un-verifies the site.
  const verify = await page.evaluate(async () => {
    const res = await fetch('./google5caa7feb8604ab88.html');
    return { ok: res.ok, status: res.status, body: (await res.text()).trim() };
  });
  t('verification: Google\u2019s file is served from the site root',
    verify.ok, `HTTP ${verify.status}`);
  t('verification: its contents are exactly what Google wrote',
    verify.body === 'google-site-verification: google5caa7feb8604ab88.html', verify.body);
  // The deploy refuses to ship a page missing its closing tag. This file has no
  // opening one either, and must not be mistaken for a truncated page.
  const guard = await (async () => {
    const { readFile } = await import('node:fs/promises');
    const yml = await readFile('.github/workflows/pages.yml', 'utf8');
    return /grep -q '<html' "\$f" \|\| continue/.test(yml);
  })();
  t('verification: the deploy guard skips files that are not pages', guard,
    guard ? 'guarded' : 'the sanity check would reject the verification file');

  // ---- signing in to Google, driven end to end against a fake ----
  // The real popup needs a Google account CI cannot have, so the transport is
  // injectable: everything except Google's own window is exercised here.
  await noShippedId();
  await page.goto(B + '/sync.html');
  await page.evaluate(() => localStorage.removeItem('brewkit.sync.v1'));
  await page.reload();
  await page.waitForSelector('#gsignin', { timeout: 5000 });

  t('signin: the button is disabled until there is a client ID to authorise',
    await page.locator('#gsignin').isDisabled()
    && await page.locator('#no-client').isVisible(), 'blocked with a reason');
  t('signin: every permission is named before you are asked for it',
    (await page.locator('#scopes li').count()) === 3
    && /private folder/i.test(await page.innerText('#scopes')),
    (await page.innerText('#scopes')).replace(/\s+/g, ' ').slice(0, 80));
  t('signin: it is Google\u2019s button, not one of ours',
    (await page.locator('#gsignin svg path').count()) === 4
    && /Sign in with Google/.test(await page.textContent('#gsignin')),
    'four-colour G, official wording');

  await page.fill('#client', '123-abc.apps.googleusercontent.com');
  await page.click('#save-client');
  await page.waitForTimeout(200);
  t('signin: a valid client ID enables the button',
    !(await page.locator('#gsignin').isDisabled()), 'enabled');

  // Stand a fake Google in, then click the real button.
  const flow = await page.evaluate(async () => {
    const calls = { scopes: null, revoked: null, prompts: [] };
    const gis = {
      initTokenClient: (o) => {
        calls.scopes = o.scope;
        calls.prompts.push(o.prompt);
        return { requestAccessToken: () => o.callback({ access_token: 'tok-abc' }) };
      },
      revoke: (t) => { calls.revoked = t; },
    };
    const fetchImpl = async (url) => {
      if (String(url).includes('userinfo')) {
        return { ok: true, json: async () => ({
          name: 'Ada Lovelace', email: 'ada@example.com',
          picture: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        }) };
      }
      if (String(url).includes('files?')) return { ok: true, json: async () => ({ files: [] }) };
      return { ok: true, json: async () => ({}) };
    };
    window.__syncTest.use(gis, fetchImpl);
    return calls;
  });
  await page.click('#gsignin');
  await page.waitForFunction(
    () => document.getElementById('signed-in').style.display !== 'none', { timeout: 5000 });

  const scopes = await page.evaluate(async () => (await import('./assets/js/core/sync.js')).SCOPE);
  t('signin: it asks for identity and the narrowest Drive scope, nothing more',
    scopes === 'openid email profile https://www.googleapis.com/auth/drive.appdata', scopes);

  t('signin: the account is shown once signed in',
    (await page.textContent('#acct-name')) === 'Ada Lovelace'
    && (await page.textContent('#acct-email')) === 'ada@example.com',
    `${await page.textContent('#acct-name')} · ${await page.textContent('#acct-email')}`);
  await page.waitForFunction(
    () => /url\(/.test(document.getElementById('avatar').style.backgroundImage), { timeout: 4000 })
    .catch(() => {});
  t('signin: with their avatar',
    /url\(/.test(await page.getAttribute('#avatar', 'style') ?? ''),
    (await page.getAttribute('#avatar', 'style') ?? '').slice(0, 40));
  t('signin: and it synced in the same action',
    /Synced|First sync/.test(await page.textContent('#sync-msg')),
    await page.textContent('#sync-msg'));

  // A return visit: the account is remembered, the token deliberately is not.
  await page.reload();
  await page.waitForSelector('#signed-in', { timeout: 5000 });
  const syncStored = await page.evaluate(() => localStorage.getItem('brewkit.sync.v1'));
  t('signin: the account survives a reload so the page knows who you are',
    (await page.textContent('#acct-name')) === 'Ada Lovelace',
    await page.textContent('#acct-name'));
  t('signin: the access token is never persisted',
    !/tok-abc/.test(syncStored), 'no token in storage');
  t('signin: an expired session says so rather than pretending',
    /expired/i.test(await page.textContent('#status'))
    && /Reconnect/.test(await page.textContent('#sync')),
    `${await page.textContent('#status')} · ${await page.textContent('#sync')}`);

  // Signing out hands the token back rather than just forgetting it.
  const out = await page.evaluate(async () => {
    let revoked = null;
    const gis = { initTokenClient: (o) => ({ requestAccessToken: () => o.callback({ access_token: 'tok-xyz' }) }),
                  revoke: (t) => { revoked = t; } };
    const fetchImpl = async (url) => String(url).includes('userinfo')
      ? { ok: true, json: async () => ({ name: 'Ada Lovelace', email: 'ada@example.com' }) }
      : { ok: true, json: async () => ({ files: [] }) };
    const c = window.__syncTest.use(gis, fetchImpl);
    await c.signIn();
    await c.signOut();
    return { revoked, token: c.token,
             stored: JSON.parse(localStorage.getItem('brewkit.sync.v1')).account };
  });
  t('signin: signing out revokes the token with Google',
    out.revoked === 'tok-xyz' && out.token === null && out.stored === null,
    `revoked ${out.revoked}, account cleared`);

  // ---- a client id nobody has to type ----
  // Asking each visitor for an OAuth client id meant asking them to make a
  // Google Cloud project before they could use a coffee log. The id ships with
  // the deployment instead — it can, because it is public by construction and
  // secured by an origin allowlist rather than by secrecy.
  await shippedIdBack();
  await page.goto(B + '/sync.html');
  const shipped = await page.evaluate(async () => {
    const sync = await import('./assets/js/core/sync.js');
    const meta = document.createElement('meta');
    meta.name = 'brewkit-client-id';
    meta.content = 'shipped-999.apps.googleusercontent.com';
    document.head.appendChild(meta);
    localStorage.removeItem('brewkit.sync.v1');

    const bare = sync.config();
    // An override wins, and is the only thing written down.
    sync.saveConfig({ clientId: 'mine-1.apps.googleusercontent.com' });
    const overridden = sync.config();
    const storedWith = JSON.parse(localStorage.getItem('brewkit.sync.v1'));
    // Clearing it returns to the shipped id rather than breaking sign-in.
    sync.saveConfig({ clientId: '' });
    const cleared = sync.config();
    // Saving something else must not disturb the override, or the lack of one.
    sync.saveConfig({ lastSync: '2026-08-28T00:00:00Z' });
    const untouched = sync.config();
    // Pasting the shipped id by hand is not an override, so it is not stored.
    sync.saveConfig({ clientId: 'shipped-999.apps.googleusercontent.com' });
    const same = JSON.parse(localStorage.getItem('brewkit.sync.v1'));
    sync.saveConfig({ clientId: '', lastSync: null, account: null });
    meta.remove();
    return {
      bare: [bare.clientId, bare.ownClientId, bare.shippedClientId].join('|'),
      overridden: [overridden.clientId, overridden.ownClientId].join('|'),
      storedWith: storedWith.clientId,
      cleared: [cleared.clientId, cleared.ownClientId].join('|'),
      untouched: untouched.clientId,
      sameStored: same.clientId,
      afterMeta: sync.config().shippedClientId,
    };
  });
  t('client id: a shipped id is what sign-in uses when you have not set one',
    shipped.bare === 'shipped-999.apps.googleusercontent.com||'
      + 'shipped-999.apps.googleusercontent.com', shipped.bare);
  t('client id: your own overrides it',
    shipped.overridden === 'mine-1.apps.googleusercontent.com|mine-1.apps.googleusercontent.com',
    shipped.overridden);
  t('client id: and the override is the only part written to storage',
    shipped.storedWith === 'mine-1.apps.googleusercontent.com', shipped.storedWith);
  t('client id: clearing it falls back rather than breaking sign-in',
    shipped.cleared === 'shipped-999.apps.googleusercontent.com|', shipped.cleared);
  t('client id: saving anything else leaves it alone',
    shipped.untouched === 'shipped-999.apps.googleusercontent.com', shipped.untouched);
  t('client id: pasting the shipped id by hand is not stored as an override',
    shipped.sameStored === '', `[${shipped.sameStored}]`);
  t('client id: with the meta gone, the deployment id is what is left',
    /\.apps\.googleusercontent\.com$/.test(shipped.afterMeta), shipped.afterMeta);

  // The repo really does ship one — which is the whole point, and the one
  // assertion that would quietly stop meaning anything if config.js emptied.
  await page.goto(B + '/sync.html');
  const fromRepo = await page.evaluate(async () => {
    const sync = await import('./assets/js/core/sync.js');
    return { shipped: sync.shippedClientId(), disabled: document.getElementById('gsignin').disabled };
  });
  t('client id: this deployment ships one, so nobody is asked to make a project',
    /^\d+-\w+\.apps\.googleusercontent\.com$/.test(fromRepo.shipped)
    && fromRepo.disabled === false, fromRepo.shipped.slice(0, 22) + '…');

  // The page has to change shape too: with an id, sign-in is one click and the
  // console instructions stop being something you must do.
  // Serve the page with the meta in it, the way a real deployment would,
  // rather than injecting it after the module has already read it.
  await page.route('**/sync.html', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace('<head>',
      '<head>\n<meta name="brewkit-client-id" content="shipped-999.apps.googleusercontent.com">');
    await route.fulfill({ response: res, body, headers: { 'content-type': 'text/html' } });
  });
  await page.goto(B + '/sync.html');
  await page.waitForSelector('#gsignin', { timeout: 4000 });
  const shippedUi = await page.evaluate(() => ({
    disabled: document.getElementById('gsignin').disabled,
    noClient: document.getElementById('no-client').style.display,
    summary: document.getElementById('client-summary').textContent.replace(/\s+/g, ' ').trim(),
    open: document.getElementById('own-project').open,
    setup: document.getElementById('setup-tag').textContent,
    box: document.getElementById('client').value,
  }));
  t('client id: shipped, the Google button is live with nothing typed in',
    shippedUi.disabled === false && shippedUi.noClient === 'none', 'enabled');
  t('client id: and the console steps become "deploying your own copy"',
    shippedUi.setup === 'Deploying your own copy'
    && shippedUi.summary === 'Use a different Google project',
    `${shippedUi.setup} · ${shippedUi.summary}`);
  t('client id: the panel is folded away and the box stays empty',
    shippedUi.open === false && shippedUi.box === '',
    `open=${shippedUi.open} box="${shippedUi.box}"`);

  await page.unroute('**/sync.html');
  await noShippedId();
  await page.goto(B + '/sync.html');
  const bareUi = await page.evaluate(() => ({
    disabled: document.getElementById('gsignin').disabled,
    setup: document.getElementById('setup-tag').textContent,
    open: document.getElementById('own-project').open,
  }));
  t('client id: without one, the page still asks for yours and says so',
    bareUi.disabled === true && bareUi.setup === 'Setting it up, once' && bareUi.open === true,
    `${bareUi.setup}, panel open`);
  await shippedIdBack();

  // ---- the account, on every page ----
  // The chip reads the stored profile, not a token — which is the whole reason
  // a page holding no credential can still say whose log this is.
  await page.evaluate(async () => {
    const sync = await import('./assets/js/core/sync.js');
    sync.saveConfig({ account: { name: 'Ada Lovelace', email: 'ada@example.com', picture: '' } });
  });
  const chips = {};
  for (const name of ['live.html', 'shots.html', 'kit.html', 'lab.html', 'advisor.html']) {
    await page.goto(`${B}/${name}`);
    await page.waitForSelector('.nav a[data-account]', { timeout: 4000 });
    chips[name] = [await page.textContent('.nav a[data-account] .acct-face'),
                   await page.textContent('.nav a[data-account] .acct-name')].join('|');
  }
  t('account: the signed-in face follows you across the tool',
    Object.values(chips).every((v) => v === 'AL|Ada Lovelace')
    && Object.keys(chips).length === 5, JSON.stringify(chips));
  t('account: and says which account, not just that there is one',
    /ada@example\.com/.test(await page.getAttribute('.nav a[data-account]', 'title') ?? ''),
    await page.getAttribute('.nav a[data-account]', 'title'));

  await page.evaluate(async () => {
    const sync = await import('./assets/js/core/sync.js');
    sync.saveConfig({ account: null });
  });
  await page.goto(B + '/live.html');
  t('account: signed out, the same control is the way in to Sync',
    (await page.textContent('.nav a[data-account]')).trim() === 'Sync'
    && await page.locator('.nav a[data-account] .acct-face').count() === 0,
    await page.textContent('.nav a[data-account]'));

  // ---- when Google refuses ----
  // The commonest failure by far is an unpublished app whose owner never added
  // themselves as a test user. Google's popup shows the reason on its own page
  // and then never redirects back, so the page has to infer it.
  const help = await page.evaluate(async () => {
    const s = await import('./assets/js/core/sync.js');
    const ids = (m) => s.signInHelp(m, { origin: 'https://x.test' }).map((c) => c.id).join(',');
    return {
      blocked: ids('Access blocked: has not completed the Google verification process'),
      denied: ids('The user did not approve (access_denied)'),
      closed: ids('Sign-in window was closed.'),
      mismatch: ids('Error 400: redirect_uri_mismatch'),
      badClient: ids('invalid_client'),
      offline: ids('Could not load Google Sign-In. Check the network, and any content blocker.'),
      originAdvice: s.signInHelp('Sign-in window was closed.', { origin: 'https://x.test' })[1],
      testerAdvice: s.signInHelp('access_denied', {})[0].detail,
    };
  });
  t('signin: a blocked app is diagnosed as the missing test user',
    help.blocked === 'tester', help.blocked);
  t('signin: so is a bare access_denied', help.denied === 'tester', help.denied);
  t('signin: a closed window is indistinguishable, so it names both causes',
    help.closed === 'tester,origin', help.closed);
  t('signin: a mismatch points at the origin allowlist alone',
    help.mismatch === 'origin', help.mismatch);
  t('signin: a bad client id leads with the client id',
    help.badClient === 'client,origin', help.badClient);
  t('signin: failing to reach Google is not a setup mistake, and says nothing',
    help.offline === '', `[${help.offline}]`);
  t('signin: the origin advice quotes the exact origin to paste',
    help.originAdvice.title.includes('https://x.test'), help.originAdvice.title);
  t('signin: and separates the two fields people confuse',
    /Authorised domains/.test(help.originAdvice.detail)
    && /github\.io/.test(help.originAdvice.detail), 'origins vs domains named');
  t('signin: the test-user advice says where the setting lives',
    /Test users/.test(help.testerAdvice) && /Audience/.test(help.testerAdvice),
    help.testerAdvice.slice(0, 60));

  // And it has to reach the screen, not just exist as a function.
  await page.goto(B + '/sync.html');
  await openClientBox();
  await page.fill('#client', '123-abc.apps.googleusercontent.com');
  await page.click('#save-client');
  await page.waitForTimeout(150);
  const refused = await page.evaluate(async () => {
    const gis = { initTokenClient: (o) => ({
      requestAccessToken: () => o.error_callback({ type: 'popup_closed' }) }) };
    window.__syncTest.use(gis, async () => ({ ok: true, json: async () => ({}) }));
    document.getElementById('gsignin').click();
    await new Promise((r) => setTimeout(r, 120));
    const box = document.getElementById('signin-help');
    return { hidden: box.hidden, text: box.textContent,
             msg: document.getElementById('sync-msg').textContent };
  });
  t('signin: a refusal puts the fix on screen rather than "window was closed"',
    !refused.hidden && /Test users/.test(refused.text),
    `${refused.msg} → ${refused.text.replace(/\s+/g, ' ').slice(0, 70)}`);

  // The setup instructions must carry the same answer, for someone reading
  // before they hit the error rather than after.
  const steps = (await page.innerText('.steps-list')).replace(/\s+/g, ' ');
  t('setup: the step people miss is its own step, with the error it causes',
    /Test users/.test(steps) && /Access blocked/.test(steps), 'named and quoted');
  t('setup: and the origin field is distinguished from authorised domains',
    /JavaScript origins/.test(steps) && /Authorised domains/.test(steps), 'both named');

  // ---- syncing two devices ----
  // The merge is pure and gets tested hard; the Drive half needs a real Google
  // account, so it is kept thin and exercised here through a fake transport.
  await page.goto(B + '/sync.html');
  const merge = await page.evaluate(async () => {
    const sync = await import('./assets/js/core/sync.js');
    const local = [{ shot_id: 'a', rating: 7, timestamp: '2026-08-01 09:00:00' },
                   { shot_id: 'b', rating: 5, timestamp: '2026-08-02 09:00:00' }];
    const remote = [{ shot_id: 'a', rating: 9, timestamp: '2026-08-05 09:00:00' },
                    { shot_id: 'c', rating: 6, timestamp: '2026-08-03 09:00:00' }];
    const union = sync.mergeStore(local, remote, 'shot_id', 'shot');
    const withDeath = sync.mergeStore(local, remote, 'shot_id', 'shot',
      [{ type: 'shot', id: 'c' }, { type: 'bag', id: 'a' }]);
    const noStamps = sync.mergeStore(
      [{ shot_id: 'x', rating: 1 }], [{ shot_id: 'x', rating: 2 }], 'shot_id', 'shot');
    return {
      ids: union.map((r) => r.shot_id).sort().join(','),
      clash: union.find((r) => r.shot_id === 'a').rating,
      afterDeath: withDeath.map((r) => r.shot_id).sort().join(','),
      localWins: noStamps[0].rating,
    };
  });
  t('sync: merging two devices loses nothing', merge.ids === 'a,b,c', merge.ids);
  t('sync: the later edit wins a clash', merge.clash === 9,
    `kept ${merge.clash} (remote, edited 08-05) over 7 (local, 08-01)`);
  t('sync: a deletion travels, and only for its own type',
    merge.afterDeath === 'a,b', `${merge.afterDeath} — the bag tombstone must not delete shot a`);
  t('sync: with no usable timestamp, the device in front of you wins',
    merge.localWins === 1, String(merge.localWins));

  // Round-trip the whole dataset through a fake Drive. The stores are shared
  // fixture for everything after this, so put them back afterwards — a test
  // that wrecks the fixture fails three unrelated ones further down.
  const fixture = await page.evaluate(() => ({
    shots: localStorage.getItem('brewkit.shots.v1'),
    tombs: localStorage.getItem('brewkit.tombstones.v1'),
  }));
  const round = await page.evaluate(async () => {
    const sync = await import('./assets/js/core/sync.js');
    localStorage.setItem('brewkit.shots.v1', JSON.stringify(
      [{ shot_id: 'keep-1', dose_g: 18 }]));
    localStorage.setItem('brewkit.tombstones.v1', '[]');
    const fromOtherDevice = {
      format: 1, written_at: '2026-08-20T00:00:00Z',
      tombstones: [{ type: 'shot', id: 'gone-1', at: '2026-08-20T00:00:00Z' }],
      data: { 'brewkit.shots.v1': [{ shot_id: 'phone-1', dose_g: 17 },
                                   { shot_id: 'gone-1', dose_g: 16 }] },
    };
    const applied = sync.apply(fromOtherDevice);
    const after = JSON.parse(localStorage.getItem('brewkit.shots.v1')).map((r) => r.shot_id).sort();
    const snap = sync.snapshot();
    const badFormat = sync.apply({ format: 99 });
    return { applied: applied.ok, after, snapFormat: snap.format,
             stores: Object.keys(snap.data).length, badFormat: badFormat.ok,
             badMsg: badFormat.error };
  });
  t('sync: a remote snapshot merges into local storage',
    round.applied && round.after.join(',') === 'keep-1,phone-1',
    round.after.join(',') + ' (gone-1 deleted on the other device)');
  t('sync: a snapshot carries every store that travels',
    round.snapFormat === 1 && round.stores === 6, round.stores + ' stores');
  t('sync: an unknown format is refused rather than half-applied',
    round.badFormat === false && /format/i.test(round.badMsg), round.badMsg);

  // Deleting really does leave a tombstone, through the app's own code paths.
  const deaths = await page.evaluate(async () => {
    const store = await import('./assets/js/core/store.js');
    const sync = await import('./assets/js/core/sync.js');
    localStorage.setItem('brewkit.tombstones.v1', '[]');
    localStorage.setItem('brewkit.shots.v1', JSON.stringify([{ shot_id: 'doomed', dose_g: 18 }]));
    store.remove('doomed');
    return sync.tombstones().map((x) => `${x.type}:${x.id}`);
  });
  t('sync: deleting a shot records a tombstone, not just a removal',
    deaths.includes('shot:doomed'), deaths.join(',') || 'none recorded');

  await page.evaluate((f) => {
    if (f.shots === null) localStorage.removeItem('brewkit.shots.v1');
    else localStorage.setItem('brewkit.shots.v1', f.shots);
    if (f.tombs === null) localStorage.removeItem('brewkit.tombstones.v1');
    else localStorage.setItem('brewkit.tombstones.v1', f.tombs);
  }, fixture);

  const setup = await page.innerText('#client-msg, .steps-list');
  t('sync: the page states what only the user can do',
    /console\.cloud\.google\.com/i.test(await page.innerText('.steps-list')),
    'setup steps present');
  t('sync: and is honest that a phone cannot stream the scale',
    /no iOS browser has Web Bluetooth/i.test(await page.innerText('body')),
    'iOS limitation stated');
  await page.fill('#client', 'not-a-client-id');
  await page.click('#save-client');
  t('sync: a client id that cannot work is refused up front',
    /apps\.googleusercontent\.com/.test(await page.textContent('#client-msg')),
    await page.textContent('#client-msg'));

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
  await page.fill('#c-capacity', '3');
  await page.fill('#c-installed', '2026-01-01');
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
  for (const scheme of ['light', 'dark', 'terminal']) {
    const c2 = await browser.newContext({ viewport: { width: 1300, height: 900 },
      colorScheme: scheme === 'terminal' ? 'dark' : scheme });
    const p2 = await c2.newPage();
    await p2.goto(B + '/explore.html');
    // Terminal is never reached by a system preference, so it is asked for.
    if (scheme === 'terminal') {
      await p2.evaluate(() => document.documentElement.setAttribute('data-theme', 'terminal'));
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
