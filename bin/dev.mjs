// `npm start` — brewkit on this machine, which is the fastest way to use it and
// the only way to use it on a plane.
//
// The port is fixed on purpose. A Google OAuth client id only works from origins
// registered against it, so a port that changed every restart would mean
// re-registering every restart; 4173 is registered once and forgotten.
//
// SECURE CONTEXTS, AND WHY THE PHONE IS DIFFERENT. Web Bluetooth and WebRTC are
// both restricted to secure contexts, and browsers count http://localhost as
// one — so the laptop is fine over plain HTTP. A phone reaching this server by
// LAN address is not: http://192.168.x.x is not a secure context, and Safari
// will refuse to open a peer connection there. So run the laptop locally and
// open the published https:// copy of view.html on the phone. The two halves of
// the link do not need to share an origin; they only need to exchange codes.
import { networkInterfaces } from 'node:os';
import { serve } from '../test/server.mjs';

const port = Number(process.env.PORT) || 4173;
const lan = process.argv.includes('--lan');
const s = await serve({ port, host: lan ? '0.0.0.0' : '127.0.0.1' });

console.log(`\n  brewkit  ->  http://localhost:${s.port}/live.html\n`);
if (lan) {
  const addrs = Object.values(networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  for (const a of addrs) console.log(`  on this network  ->  http://${a}:${s.port}/`);
  console.log('\n  A phone on a LAN address is not a secure context, so the live viewer\n'
    + '  will not connect there. Open the published https:// copy on the phone.\n');
}
console.log(`  For Google sign-in, add http://localhost:${s.port} under Authorised\n`
  + '  JavaScript origins on your OAuth client id. Everything else works without it.\n');
console.log('  Ctrl-C to stop.\n');
