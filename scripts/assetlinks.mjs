// public/.well-known/assetlinks.json is what tells Android that Saligue owns its own address: with it, a Saligue
// link sent on WhatsApp opens the app on the page it points at; without it, every link opens a browser tab.
//
// Android only believes it when the file lists the SHA-256 of the certificate the installed app is signed with.
// So the app build reads the signing key and makes sure that fingerprint is published — a rotated key can never
// leave the file quietly pointing at the old one.
//
// A build on a machine without the key (CI, a fresh clone) keeps what is published: the fingerprint is public by
// design, it is not a secret.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const PACKAGE_NAME = 'com.indeciana.saligue';
export const ASSETLINKS = 'public/.well-known/assetlinks.json';
export const PLAY_FINGERPRINT_FILE = 'deploy/play-signing-sha256';

const SHA256 = /SHA256:\s*([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31})/;
// What Android compares: 32 bytes, each as two uppercase hex digits, colon-separated.
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** The fingerprints already published (in the repository). */
export function published() {
  try {
    const list = JSON.parse(readFileSync(ASSETLINKS, 'utf8'));
    return list.flatMap((entry) => entry?.target?.sha256_cert_fingerprints ?? []);
  } catch {
    return [];
  }
}

/** The release key's certificate SHA-256, or null when this machine has no signing key. */
export function signingFingerprint(properties = process.env.SALIGUE_SIGNING || '/etc/saligue/android-signing.properties') {
  if (!existsSync(properties)) return null;
  let props;
  try {
    props = Object.fromEntries(
      readFileSync(properties, 'utf8')
        .split('\n')
        .filter((line) => line.includes('='))
        .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
    );
  } catch {
    return null;
  }
  if (!props.storeFile || !existsSync(props.storeFile)) return null;
  try {
    // keytool ships with the same JDK Gradle needs, so the build that signs the APK can always read its key back.
    const out = execFileSync(
      'keytool',
      ['-list', '-v', '-keystore', props.storeFile, '-storepass', props.storePassword ?? '', ...(props.keyAlias ? ['-alias', props.keyAlias] : [])],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return SHA256.exec(out)?.[1].toUpperCase() ?? null;
  } catch {
    return null;
  }
}

/**
 * A fingerprint in the one shape Android compares, or null. Google's is copied by hand out of the Play Console, so it
 * arrives as whatever that page showed: with or without colons, in either case. Anything that is not 32 bytes of hex
 * (a SHA-1, a half-copied line, a whole certificate) is refused rather than published — Android would compare it with
 * nothing and quietly leave links opening a browser.
 */
export function normalizeFingerprint(text) {
  const hex = String(text ?? '')
    .toUpperCase()
    .replace(/[\s:]/g, '');
  const fingerprint = /^[0-9A-F]{64}$/.test(hex) ? (hex.match(/.{2}/g) ?? []).join(':') : '';
  return FINGERPRINT.test(fingerprint) ? fingerprint : null;
}

/**
 * The certificate Google signs with, when Play App Signing re-signs the bundle, or null while nobody has said.
 * Read from SALIGUE_PLAY_SHA256 (a build) or from deploy/play-signing-sha256 (a line pasted once), the same way
 * scripts/apple-association.mjs reads the Apple Team ID.
 */
export function playFingerprint({ file = PLAY_FINGERPRINT_FILE, env = process.env } = {}) {
  const given = normalizeFingerprint(env.SALIGUE_PLAY_SHA256);
  if (given) return given;
  if (!existsSync(file)) return null;
  try {
    const line = readFileSync(file, 'utf8')
      .split('\n')
      .map((text) => text.replace(/#.*/, '').trim())
      .find(Boolean);
    return normalizeFingerprint(line);
  } catch {
    return null;
  }
}

/**
 * The published list plus any key that is not in it yet. Keys are never dropped: Play's certificate and this
 * project's own both have to stay, because Android compares the certificate of the *installed* app and Saligue is
 * installed both from the site (our key) and from Play (Google's).
 */
export function mergePublished(known, additions) {
  const next = [...known];
  for (const key of additions) if (key && !next.includes(key)) next.push(key);
  return next;
}

export function assetLinks(fingerprints) {
  const list = [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: PACKAGE_NAME, sha256_cert_fingerprints: fingerprints } }];
  return `${JSON.stringify(list, null, 2)}\n`;
}

/**
 * Makes sure the key this build is signed with is published, keeping any other fingerprints already there (an older
 * key still in use on phones, or Play App Signing's, which Play Console → App integrity shows once the bundle is
 * uploaded). Returns the fingerprints now published.
 */
export function refreshAssetLinks({ log = console.log } = {}) {
  const known = published();
  // Two certificates can be in play at once: this project's, which signs the APK the site hands out, and Google's,
  // when Play App Signing re-signs the bundle for phones that install from Play. Android compares against the
  // certificate of the *installed* app, so both have to be listed or links work on one channel and not the other.
  const wanted = [
    ["this build's signing key", signingFingerprint()],
    ["Google's Play App Signing key", playFingerprint()],
  ].filter(([, key]) => key);
  const next = mergePublished(known, wanted.map(([, key]) => key));
  if (next.length === known.length) {
    log(
      known.length
        ? `App links: ${known.length} fingerprint(s) published, up to date.`
        : 'App links: no signing key on this machine and none pasted — nothing published (deploy/play-store.md §1).',
    );
    return known;
  }
  mkdirSync(dirname(ASSETLINKS), { recursive: true });
  writeFileSync(ASSETLINKS, assetLinks(next));
  for (const [what, key] of wanted) if (!known.includes(key)) log(`App links: published ${what} (${key.slice(0, 11)}…).`);
  log(`App links: ${next.length} fingerprint(s) in ${ASSETLINKS}. Commit it.`);
  return next;
}
