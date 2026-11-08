// The iPhone's version of tests/applinks.test.mjs. A shared Saligue link opens the app on an iPhone only when three
// things agree, and they live in three different files:
//   - ios/App/App/App.entitlements — the address the app claims (Associated Domains, `applinks:`);
//   - public/.well-known/apple-app-site-association — the same address answering with the app's Team ID and bundle id;
//   - ios/App/App/SceneDelegate.swift — the handshake that gives the link to the web app once iOS opens it.
// Nothing here fails loudly on a phone: it simply opens Safari instead, which is why it is checked here.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { AASA, BUNDLE_ID, ENTITLEMENTS, appAssociation, claimedHosts, teamId } from '../scripts/apple-association.mjs';
import { FIRST_ADDRESS } from '../scripts/site-url.mjs';

const host = new URL(FIRST_ADDRESS).host;
const pbxproj = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
const gradle = readFileSync('android/app/build.gradle', 'utf8');
const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');

test('the app claims the address the site is served on', () => {
  // Xcode turns these lines into the Associated Domains capability; a host that is not the site's claims nothing.
  assert.deepEqual(claimedHosts(), [`applinks:${host}`]);
  // Both platforms must claim the same address, or a link opens the app on one phone and a browser on the other.
  assert.ok(manifest.includes(`android:host="${host}"`), `AndroidManifest.xml must own https://${host}/`);
});

test('Xcode actually builds with those entitlements', () => {
  assert.ok(existsSync(ENTITLEMENTS), `${ENTITLEMENTS} is missing: the app would claim no address`);
  // Set in both the Debug and the Release configuration of the App target, or an Archive ships without it.
  assert.equal(pbxproj.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g)?.length, 2);
});

test('the app the association file points at is the app the phone installs', () => {
  // The bundle id lives in the Xcode project and in Capacitor; the Android id must be the same word, so one person
  // describes the same app in both stores.
  assert.equal(BUNDLE_ID, /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/.exec(pbxproj)?.[1]);
  assert.equal(BUNDLE_ID, /applicationId\s+"([^"]+)"/.exec(gradle)?.[1]);
  // iOS reads the app id out of the file Apple fetches, and it must be <TeamID>.<bundle id>.
  const detail = JSON.parse(appAssociation('A1B2C3D4E5')).applinks.details[0];
  assert.equal(detail.appID, `A1B2C3D4E5.${BUNDLE_ID}`);
  assert.deepEqual(detail.paths, ['*']);
});

// Only meaningful once the app has an Apple Developer account: until then nothing is published, which is correct —
// Apple's CDN caches a wrong file for hours, so an absent one is the honest answer.
test("a published association file names a real Team ID and this app", { skip: existsSync(AASA) ? false : 'no Apple Team ID yet' }, () => {
  const detail = JSON.parse(readFileSync(AASA, 'utf8')).applinks.details[0];
  assert.match(detail.appID, /^[A-Z0-9]{10}\.com\.indeciana\.saligue$/);
  assert.deepEqual(detail.paths, ['*']);
});

test('a Team ID is only believed when it looks like one', () => {
  // A pasted Apple ID (an e-mail), a lowercase id or a half-copied one would publish a file iOS ignores, so each is
  // refused and nothing is published instead.
  assert.equal(teamId({ env: {}, file: '' }), null);
  assert.equal(teamId({ env: { APPLE_TEAM_ID: 'someone@example.com' }, file: '' }), null);
  assert.equal(teamId({ env: { APPLE_TEAM_ID: 'a1b2c3d4e5' }, file: '' }), null);
  assert.equal(teamId({ env: { APPLE_TEAM_ID: 'A1B2C3D4E5' }, file: '' }), 'A1B2C3D4E5');
});

test('the link iOS hands over reaches the page', () => {
  // iOS delivers a Universal Link as an NSUserActivity; without this forwarding in the scene delegate Capacitor never
  // hears about it and the app opens on the home page instead of the shared product or lesson.
  const scene = readFileSync('ios/App/App/SceneDelegate.swift', 'utf8');
  assert.match(scene, /func scene\(_ scene: UIScene, continue userActivity: NSUserActivity\)/);
  assert.match(scene, /SceneDelegateProxy\.shared\.scene\(scene, continue: userActivity\)/);
});
