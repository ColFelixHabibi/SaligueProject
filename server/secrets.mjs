// The server's one secret kept OUTSIDE the database: 64 hex characters in SALIGUE_SEAL_KEY, or in the file
// /etc/saligue/seal.key (SALIGUE_SEAL_FILE to move it). A copy of the database alone then opens nothing.
// Each use gets its own key derived from it (HKDF with a label), so one use cannot stand in for another.
//   ai-keys.mjs     seals accounts' AI keys (with the key itself: keys were sealed that way first)
//   chat-media.mjs  signs chat-file links (derived, label 'chat-files')
// Create it once: openssl rand -hex 32 > /etc/saligue/seal.key && chmod 600 /etc/saligue/seal.key  (and back it up offline)
import { hkdfSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const HEX = /^[a-f0-9]{64}$/;

function read() {
  const fromEnv = process.env.SALIGUE_SEAL_KEY?.trim().toLowerCase();
  if (fromEnv) {
    if (!HEX.test(fromEnv)) throw new Error('SALIGUE_SEAL_KEY must be 64 hex characters (openssl rand -hex 32).');
    return Buffer.from(fromEnv, 'hex');
  }
  const file = process.env.SALIGUE_SEAL_FILE || '/etc/saligue/seal.key';
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8').trim().toLowerCase();
  if (!HEX.test(text)) throw new Error(`${file} must hold 64 hex characters (openssl rand -hex 32).`);
  return Buffer.from(text, 'hex');
}

let cached; // undefined = not read yet; read once, so starting the server never touches anything for nothing
/** The outside key, or null when this server has none (callers then fall back to their older key in the database). */
export function outsideKey() {
  if (cached === undefined) cached = read();
  return cached;
}

/** A 32-byte key for one use, derived from the outside key; null without one. */
export function derivedKey(label) {
  const key = outsideKey();
  return key ? Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), `saligue:${label}`, 32)) : null;
}
