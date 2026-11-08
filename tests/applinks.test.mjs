// Shared Saligue links open the app only when three things agree: the app's package name, the key it is signed
// with, and the address it claims. They live in three different files, so this keeps them from drifting apart —
// which would fail silently (links simply open a browser, with nothing broken enough to notice).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ASSETLINKS,
  PACKAGE_NAME,
  mergePublished,
  normalizeFingerprint,
  playFingerprint,
  published,
  signingFingerprint,
} from '../scripts/assetlinks.mjs';
import { FIRST_ADDRESS } from '../scripts/site-url.mjs';

const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const gradle = readFileSync('android/app/build.gradle', 'utf8');
const host = new URL(FIRST_ADDRESS).host;
// The in-app side of a link (where it lands) and the two places that can fetch the app itself.
const appLinks = readFileSync('src/components/app-links.tsx', 'utf8');
const appUpdate = readFileSync('src/components/app-update.tsx', 'utf8');
const native = readFileSync('src/lib/native.ts', 'utf8');

test('the app is published as the app that owns Saligue links', () => {
  const list = JSON.parse(readFileSync(ASSETLINKS, 'utf8'));
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(list[0].target.namespace, 'android_app');
  assert.equal(list[0].target.package_name, PACKAGE_NAME);
  // The package named in the file must be the one the APK is built as, or Android matches nothing.
  assert.equal(PACKAGE_NAME, /applicationId\s+"([^"]+)"/.exec(gradle)?.[1]);
});

test('every published key is a SHA-256 Android can compare', () => {
  const keys = published();
  assert.ok(keys.length >= 1, `${ASSETLINKS} lists no signing key`);
  // Android ignores the whole file if one entry is malformed (lowercase, missing colons, a SHA-1).
  for (const key of keys) assert.match(key, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
});

// Play App Signing re-signs the bundle with Google's certificate, so a phone that installed Saligue from Play only
// opens Saligue links while Google's fingerprint is published too. It is copied by hand out of the Play Console,
// which prints it in whatever shape it likes — so the shape is normalised here, once.
test('a fingerprint is only published when Android can compare it', () => {
  const canonical = 'E49BD9DE8A7C2B2A1C7951A9CAE54A7F022568EBEEFCBAE9C1BB49307F758A2F';
  const dotted = canonical.match(/.{2}/g).join(':');
  assert.equal(normalizeFingerprint(canonical), dotted);
  assert.equal(normalizeFingerprint(canonical.toLowerCase()), dotted);
  assert.equal(normalizeFingerprint(`  ${dotted}\r\n`), dotted);
  // A SHA-1 (40 hex), a half-copied line, a whole certificate block and an empty file publish nothing at all.
  assert.equal(normalizeFingerprint('E49BD9DE8A7C2B2A1C7951A9CAE54A7F022568EB'), null);
  assert.equal(normalizeFingerprint('-----BEGIN CERTIFICATE-----'), null);
  assert.equal(normalizeFingerprint(''), null);
  assert.equal(normalizeFingerprint(undefined), null);
});

test('a rebuild adds a key, never drops one', () => {
  // Android compares against the certificate of the *installed* app, and Saligue is installed from the site (our
  // key) and from Play (Google's). A refresh that replaced the list would break whichever channel it forgot, and
  // nothing would look broken until someone tapped a shared link.
  const ours = 'E4:9B:D9:DE:8A:7C:2B:2A:1C:79:51:A9:CA:E5:4A:7F:02:25:68:EB:EE:FC:BA:E9:C1:BB:49:30:7F:75:8A:2F';
  const google = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
  assert.deepEqual(mergePublished([ours], [google]), [ours, google]);
  assert.deepEqual(mergePublished([ours], [ours]), [ours]);
  assert.deepEqual(mergePublished([ours, google], []), [ours, google]);
});

test("Play App Signing's key is published once it is pasted", { skip: playFingerprint() ? false : `no Play fingerprint yet (deploy/play-signing-sha256)` }, () => {
  const google = playFingerprint();
  assert.ok(
    published().includes(google),
    'deploy/play-signing-sha256 is filled in but the fingerprint is not in assetlinks.json: run node scripts/build-app.mjs --aab',
  );
});

test('the step that keeps Play installs working is written down where it is needed', () => {
  // Skipped or not, the paragraph that explains it has to name the paste target: it is the only thing left for a
  // human to do before uploading, and Play's own copy of the fingerprint is the only place it exists.
  const play = readFileSync('deploy/play-store.md', 'utf8');
  assert.match(play, /deploy\/play-signing-sha256/);
  assert.match(play, /SALIGUE_PLAY_SHA256/);
});

test('Android is asked to verify Saligue links, for the address the site is served on', () => {
  assert.match(manifest, /android:autoVerify="true"/);
  assert.match(manifest, /android\.intent\.action\.VIEW/);
  assert.match(manifest, /android\.intent\.category\.BROWSABLE/);
  assert.ok(manifest.includes(`android:scheme="https" android:host="${host}"`), `AndroidManifest.xml must own https://${host}/`);
});

test('the address matches the one the site is built for', () => {
  // A new address must be added to the manifest, not replaced: phones already installed were built with the old one
  // (deploy/switch-domain.sh changes the server, this filter is the app's side of the same move).
  assert.equal(host, '78-47-151-100.sslip.io');
});

// Only meaningful on the machine that holds the release key; anywhere else (CI, a laptop) there is nothing to compare.
test('the published key is the release signing key', { skip: signingFingerprint() ? false : 'no signing key on this machine' }, () => {
  assert.ok(published().includes(signingFingerprint()), 'the APK is signed with a key that is not published: links would open in a browser');
});

// A <data> element with no path claims every address on the host. That included /download, so tapping a download
// link on a phone that had Saligue installed opened the app — whose window cannot save a file — and nothing
// downloaded. App Links cannot say "everything except", so the shared pages are named and the download is left out.
test('the app claims pages, never the whole address', () => {
  const data = [...manifest.matchAll(/<data[^>]*>/g)].map((m) => m[0]);
  assert.ok(data.length > 0, 'the app claims no path at all: shared links would never open it');
  for (const tag of data) assert.match(tag, /android:(path|pathPrefix)="/, `${tag} claims every path on the address`);
  assert.ok(!data.some((tag) => tag.includes('android:pathPrefix="/download')), '/download must be left to the browser');
  assert.ok(!data.some((tag) => tag.includes('android:pathPrefix="/"')), 'a "/" prefix claims every path again');
});

// A WebView cannot save a file. The manifest no longer hands /download to the app, but an older build still claims
// every path, so the links that do arrive are handed to the phone's browser instead of a page that cannot download.
test('a link to the download goes to the phone\'s browser, not to a page the app cannot download from', () => {
  assert.match(appLinks, /\^\\\/download\(\\\/\|\$\)/); // the /download/ page and /download/saligue.apk
  assert.match(appLinks, /openInBrowser\(target\.toString\(\)\)/);
});

test('the in-app download and update both hand the file to the browser', () => {
  assert.match(appUpdate, /openInBrowser\(latest\.url\)/);
  assert.match(appUpdate, /openInBrowser\(href\)/);
  // The helper must really leave the WebView: a navigation to an address outside the app is what Capacitor opens in
  // the phone's browser (deploy/play-store.md says why, and why allowNavigation has to stay empty).
  assert.match(native, /export function openInBrowser/);
  assert.match(native, /window\.location\.href = url/);
});

test('the WebView is not told to keep addresses that Capacitor would open in the browser', () => {
  // `server.allowNavigation` holds listed origins inside the WebView. The site's own address must never be listed:
  // it is where the APK is downloaded from, and this window cannot save a file.
  const config = readFileSync('capacitor.config.ts', 'utf8');
  assert.doesNotMatch(config, /allowNavigation/);
});
