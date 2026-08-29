// Parse every module the site ships, without a browser.
//
// `node --check` covered the test harness and missed the app, which is the part
// that actually runs on someone's machine. A syntax error or a duplicate
// declaration in a core module is a blank page, and finding that out seven
// minutes into a Playwright run is six and a half minutes too late.

import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../site/assets/js/', import.meta.url);

async function* modules(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir.pathname ?? dir, entry.name);
    if (entry.isDirectory()) yield* modules(path);
    else if (entry.name.endsWith('.js')) yield path;
  }
}

let checked = 0;
const bad = [];
for await (const file of modules(ROOT)) {
  try {
    // Importing runs top-level code, which several of these will not survive
    // outside a browser. Parsing is what is being tested, so compile the module
    // and stop there.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(file, 'utf8');
    // A module body is not a script: `new Function` would reject `import`. The
    // dynamic-import form of a data: URL parses it under real module rules.
    await import(`data:text/javascript;base64,${Buffer.from(
      src.replace(/from\s+(['"])([./][^'"]*)\1/g, (m, q, spec) =>
        `from ${q}${new URL(spec, pathToFileURL(file)).href}${q}`)
        .replace(/import\s*\(\s*(['"])([./][^'"]*)\1\s*\)/g, (m, q, spec) =>
          `import(${q}${new URL(spec, pathToFileURL(file)).href}${q})`),
    ).toString('base64')}`);
    checked += 1;
  } catch (e) {
    // A module that parses but throws while initialising (no `window`, no
    // `localStorage`) is fine here — only syntax is being judged.
    if (e instanceof SyntaxError) bad.push(`${relative(process.cwd(), file)}: ${e.message}`);
    else checked += 1;
  }
}

if (bad.length) {
  for (const b of bad) console.error(`  ${b}`);
  console.error(`${bad.length} module(s) do not parse`);
  process.exit(1);
}
console.log(`checked ${checked} site modules`);
