// Minimal static server for the test run. Mirrors what the Pages workflow
// publishes: the contents of site/, with the versioned dataset mounted at
// /data so the sample loader can fetch ./data/shots.csv.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Resolve a URL path to a file, keeping it inside the directory it maps to. */
function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const rel = clean === '/' ? '/index.html' : clean;
  // /data/* is served from the repo's data/, everything else from site/.
  const base = rel.startsWith('/data/') ? ROOT : join(ROOT, 'site');
  const full = join(base, rel);
  return full.startsWith(base) ? full : null;
}

export function serve() {
  const server = createServer(async (req, res) => {
    const file = resolve(req.url);
    if (!file) { res.writeHead(403).end('forbidden'); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => ok({
      origin: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}
