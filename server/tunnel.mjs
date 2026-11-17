// The public address, when it is a Cloudflare quick tunnel. Such a tunnel gets a new random name every time it
// restarts (a reboot, a crash, an update), while SITE_URL in /etc/saligue.env still names the old one — which the
// server cannot rewrite (it runs with /etc read-only). So the server watches the tunnel's own log: when the tunnel
// announces a new address, that address becomes the site's address at once (links, emails, the app-update check),
// is kept in data/tunnel-url for the next app build (scripts/site-url.mjs), and the admins are told.
// Installed apps find it through the fixed address (/api/site, src/lib/api.ts → rediscover).
// With a real domain (deploy/switch-domain.sh) none of this is needed and it stays idle.
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './db.mjs';

const FILE = join(DATA_DIR, 'tunnel-url');
const QUICK = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
let current = null;
try {
  const saved = readFileSync(FILE, 'utf8').trim();
  if (QUICK.test(saved)) current = saved;
} catch {
  // No tunnel address seen yet.
}

/** The tunnel's latest address, when SITE_URL is a quick tunnel and the tunnel has announced a newer one. */
export function tunnelUrl() {
  const configured = (process.env.SITE_URL || '').replace(/\/+$/, '');
  return QUICK.test(configured) && current && current !== configured ? current : null;
}

/** Reads the tunnel's log once; calls `changed(newUrl, oldUrl)` when it announced a different address. */
export function checkTunnel(changed) {
  if (!QUICK.test((process.env.SITE_URL || '').replace(/\/+$/, ''))) return;
  execFile('journalctl', ['-u', 'saligue-tunnel', '-n', '400', '-o', 'cat', '--no-pager'], { timeout: 15_000 }, (error, out) => {
    if (error) return;
    const found = [...String(out).matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)].map((m) => m[0]);
    const latest = found.at(-1);
    if (!latest || latest === (current ?? process.env.SITE_URL?.replace(/\/+$/, ''))) return;
    const before = current ?? process.env.SITE_URL;
    current = latest;
    try {
      writeFileSync(FILE, latest);
    } catch {
      // The next build reads SITE_URL instead.
    }
    changed(latest, before);
  });
}
