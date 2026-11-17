// The one place the builds learn Saligue's public address from, so moving to a real domain is one line in
// /etc/saligue.env (SITE_URL=…) and not a hunt through the code:
//   1. SALIGUE_SERVER or SITE_URL in the environment (a build run by hand, or CI),
//   2. SITE_URL in /etc/saligue.env (the live server: the same file the running server reads),
//   3. the address Saligue started on.
// When that address is a Cloudflare quick tunnel that has since restarted under a new name, the new name (written
// by the running server, server/tunnel.mjs) is used instead, so the next app build works with today's address.
// Phones already installed keep the address they were built with, so an old address must keep being served
// (deploy/switch-domain.sh keeps it) until nobody uses those versions any more.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIRST_ADDRESS = 'https://78-47-151-100.sslip.io';
const QUICK = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

function configured() {
  const fromEnv = process.env.SALIGUE_SERVER || process.env.SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const file = process.env.SALIGUE_ENV_FILE || '/etc/saligue.env';
  if (existsSync(file)) {
    try {
      const line = /^\s*SITE_URL\s*=\s*["']?([^"'\s#]+)/m.exec(readFileSync(file, 'utf8'));
      if (line) return line[1].replace(/\/+$/, '');
    } catch {
      // Not readable by this user: fall through to the first address.
    }
  }
  return FIRST_ADDRESS;
}

export function siteUrl() {
  const url = configured();
  if (!QUICK.test(url) || process.env.SALIGUE_SERVER) return url;
  try {
    const tunnel = readFileSync(join(process.env.SALIGUE_DATA || 'data', 'tunnel-url'), 'utf8').trim();
    if (QUICK.test(tunnel)) return tunnel;
  } catch {
    // The tunnel has kept its name.
  }
  return url;
}
