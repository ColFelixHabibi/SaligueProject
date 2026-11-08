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

const SHA256 = /SHA256:\s*([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31})/;

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
  const key = signingFingerprint();
  if (!key) {
    log(`App links: no signing key on this machine, keeping ${known.length} published fingerprint(s).`);
    return known;
  }
  if (known.includes(key)) {
    log(`App links: signing key published (${key.slice(0, 11)}…).`);
    return known;
  }
  const next = [...known, key];
  mkdirSync(dirname(ASSETLINKS), { recursive: true });
  writeFileSync(ASSETLINKS, assetLinks(next));
  log(`App links: published this build's signing key (${key.slice(0, 11)}…). Commit ${ASSETLINKS}.`);
  return next;
}
