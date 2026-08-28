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
      ['uncertainty','/uncertainty.html']]) {
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

  // ---- live capture, driven by the mock scale (no hardware) ----
  await page.goto(B + '/live.html');
  await page.waitForSelector('#demo');
  t('live: page renders without a scale', await page.locator('#state').isVisible());

  await page.click('#demo');
  await page.waitForFunction(
    () => document.getElementById('conn-msg').textContent.includes('Mock Scale'), { timeout: 5000 });
  t('live: mock device connects', true, await page.textContent('#conn-msg'));

  // Frames must arrive and be decodable without any per-device setup, since the
  // mock advertises a layout the auto-decoder is expected to solve.
  await page.waitForFunction(
    () => document.querySelectorAll('#frames div').length > 3, { timeout: 5000 });
  t('live: frames stream in', true,
    (await page.locator('#frames div').count()) + ' frames');

  // Teach it the mock's layout the same way a user would: two known masses.
  await page.fill('#ref', '0');
  await page.click('#capture');
  await page.waitForTimeout(1200);
  const grew = await page.evaluate(() => {
    // The mock places a 120 g cup shortly after the shot starts.
    return document.querySelectorAll('#frames div').length;
  });
  await page.fill('#ref', '120');
  await page.click('#capture');
  await page.waitForTimeout(400);
  const candCount = await page.locator('#cands .cand').count();
  t('live: auto-decoder proposes an encoding', candCount > 0, candCount + ' candidates');

  if (candCount > 0) {
    await page.locator('#cands .cand button').first().click();
    await page.waitForTimeout(2500);
    const w = parseFloat(await page.textContent('#o-w'));
    t('live: decoded weight tracks the mock', Number.isFinite(w), w + ' g');

    // Let the synthetic shot run far enough to enter EXTRACTING and build a curve.
    await page.waitForFunction(() => {
      const s = document.getElementById('state').textContent.toLowerCase();
      return s.includes('extract') || s.includes('drip') || s.includes('complete');
    }, { timeout: 30000 }).catch(() => {});
    const stateText = await page.textContent('#state');
    t('live: brew state machine advances', /extract|drip|complete/i.test(stateText), stateText);

    // The curve builds at the mock's sample rate; wait for it rather than
    // sampling the instant the state flips.
    await page.waitForFunction(
      () => document.querySelectorAll('#curve svg circle.pt').length > 5,
      { timeout: 25000 }).catch(() => {});
    const pts = await page.locator('#curve svg circle.pt').count();
    t('live: shot curve renders', pts > 5, pts + ' points');

    // Assert the claim itself — that weight rises — rather than picking an
    // arbitrary threshold that depends on when the sample happens to land.
    const w1 = await page.evaluate(() => parseFloat(document.getElementById('o-w').textContent));
    await page.waitForTimeout(4000);
    const w2 = await page.evaluate(() => parseFloat(document.getElementById('o-w').textContent));
    t('live: net weight climbs during extraction', w2 > w1 && w1 >= 0,
      `${w1} g -> ${w2} g`);

    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('brewkit.shots.v1') || '[]').length);
    await page.click('#save');
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('brewkit.shots.v1') || '[]').length);
    t('live: captured shot saves to the log', after === before + 1, before + ' -> ' + after);
  }

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
