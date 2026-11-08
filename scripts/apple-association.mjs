// public/.well-known/apple-app-site-association is the iPhone's half of what assetlinks.json does for Android: it
// tells iOS that Saligue owns Saligue's address, so a link sent on WhatsApp opens the app on the page it points at
// instead of a Safari tab.
//
// Two things must agree, or nothing happens — and nothing looks broken either, links just keep opening in Safari:
//   - this file, naming the Team ID and bundle id of the app, served at
//     https://<site>/.well-known/apple-app-site-association with no redirects and as application/json;
//   - the Associated Domains capability in ios/App/App/App.entitlements (applinks:<site>).
//
// The Team ID only exists once the app is signed with an Apple Developer account, so it is read from APPLE_TEAM_ID
// (a build, or a CI secret) or from deploy/apple-team-id (a line pasted once). Until then nothing is published: a
// wrong file is worse than none, because Apple's CDN caches the failure for hours.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const BUNDLE_ID = 'com.indeciana.saligue';
export const AASA = 'public/.well-known/apple-app-site-association';
export const ENTITLEMENTS = 'ios/App/App/App.entitlements';
export const TEAM_ID_FILE = 'deploy/apple-team-id';

// Apple Team IDs are ten uppercase letters/digits (A1B2C3D4E5).
const TEAM = /^[A-Z0-9]{10}$/;

/** The Apple Team ID of this app, or null when nobody has said yet. */
export function teamId({ file = TEAM_ID_FILE, env = process.env } = {}) {
  const given = (env.APPLE_TEAM_ID ?? '').trim();
  if (TEAM.test(given)) return given;
  if (!existsSync(file)) return null;
  try {
    const line = readFileSync(file, 'utf8')
      .split('\n')
      .map((text) => text.replace(/#.*/, '').trim())
      .find(Boolean);
    return line && TEAM.test(line) ? line : null;
  } catch {
    return null;
  }
}

/**
 * The association file itself: one app, claiming every path on this address — the same claim assetlinks.json makes
 * for Android. Which of those paths the app can actually show is decided in the app (src/components/app-links.tsx).
 */
export function appAssociation(team) {
  const details = [{ appID: `${team}.${BUNDLE_ID}`, paths: ['*'] }];
  return `${JSON.stringify({ applinks: { details } }, null, 2)}\n`;
}

/** The hosts the app claims, read back from the entitlements Xcode builds with. */
export function claimedHosts(file = ENTITLEMENTS) {
  try {
    return [...readFileSync(file, 'utf8').matchAll(/applinks:([A-Za-z0-9.-]+)/g)].map((match) => match[1]);
  } catch {
    return [];
  }
}

/**
 * Publishes the association file for the Team ID this machine knows, or takes it down when there is none. Returns
 * the appID now published (or null). Called from scripts/build-app.mjs on every app build, so the file can never
 * name a Team ID, or an address, that no longer matches the app being released.
 */
export function refreshAppleAssociation({ log = console.log } = {}) {
  const team = teamId();
  if (!team) {
    if (existsSync(AASA)) rmSync(AASA, { force: true });
    log('Universal links: no Apple Team ID yet — nothing published, iPhone links open in Safari (deploy/ios.md §1).');
    return null;
  }
  const body = appAssociation(team);
  if (existsSync(AASA) && readFileSync(AASA, 'utf8') === body) {
    log(`Universal links: already published for ${team}.${BUNDLE_ID}.`);
    return { team, appID: `${team}.${BUNDLE_ID}` };
  }
  mkdirSync(dirname(AASA), { recursive: true });
  writeFileSync(AASA, body);
  log(`Universal links: published ${team}.${BUNDLE_ID} as ${AASA}.`);
  return { team, appID: `${team}.${BUNDLE_ID}` };
}
