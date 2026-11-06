// An account's own AI key (DeepSeek): two accounts never share one key.
// The key is kept on the server with the account that added it (table user_ai_keys), is never sent back to the app
// (only "••••1234"), and is checked with DeepSeek the moment it is saved, so a wrong or deleted key is refused at once.
// It is stored encrypted under a sealing key kept OUTSIDE the database (SALIGUE_SEAL_KEY, or the file
// /etc/saligue/seal.key), so a copy of the database is not a copy of everyone's keys. Without that key the server
// falls back to the older sealing key kept in app_config (which a database copy does include) and says so at start.
//   SALIGUE_SEAL_KEY   64 hex characters (openssl rand -hex 32); or SALIGUE_SEAL_FILE, a file holding them
//   DEEPSEEK_API_KEY   the platform's own key, used by accounts that did not add one
//   DEEPSEEK_API_URL   only for a proxy or a test server (default https://api.deepseek.com)
//   DEEPSEEK_MODEL     the model AI writing uses (default deepseek-chat)
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { db, json, now, parse } from './db.mjs';
import { outsideKey } from './secrets.mjs';

const API = (process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com').replace(/\/+$/, '');

/** The AI companies an account may bring its own key for. */
export const KEY_PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    // DeepSeek keys look like sk-0123456789abcdef…: anything else is a typo or another company's key.
    shape: /^sk-[A-Za-z0-9_-]{16,80}$/,
    where: 'platform.deepseek.com → API keys',
  },
};

/**
 * At rest a key is sealed with AES-256-GCM.
 *   enc2:  under the sealing key from outside the database (SALIGUE_SEAL_KEY / /etc/saligue/seal.key): the safe form.
 *   enc1:  under the older key kept in app_config, in the same database as the keys (read, then sealed again as enc2).
 *   sk-…   plain text from before sealing (read, then sealed again).
 */
const BOX = 'ai_keys';
const OLD = 'enc1:';
const NEW = 'enc2:';
const HEX = /^[a-f0-9]{64}$/;

/** The older key in app_config. make: create it when missing (only when there is no outside key to use instead). */
function databaseKey(make) {
  const saved = parse(db.prepare('select value from app_config where key = ?').get(BOX)?.value)?.secret;
  if (typeof saved === 'string' && HEX.test(saved)) return Buffer.from(saved, 'hex');
  if (!make) return null;
  const fresh = randomBytes(32).toString('hex');
  db.prepare('insert into app_config (key, value) values (?, ?) on conflict (key) do update set value = excluded.value').run(BOX, json({ secret: fresh }));
  return Buffer.from(fresh, 'hex');
}

const outsideSealingKey = outsideKey;

function encrypt(key, prefix, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${prefix}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${body.toString('base64url')}`;
}

function seal(secret) {
  const key = outsideSealingKey();
  return key ? encrypt(key, NEW, secret) : encrypt(databaseKey(true), OLD, secret);
}

function decrypt(key, sealed) {
  if (!key) return null;
  try {
    const [iv, tag, body] = sealed.split(':');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** The key as saved. Null only when its sealing key was lost (then the account simply adds its key again). */
function unseal(saved) {
  if (typeof saved !== 'string') return null;
  if (saved.startsWith(NEW)) return decrypt(outsideSealingKey(), saved.slice(NEW.length));
  if (saved.startsWith(OLD)) return decrypt(databaseKey(false), saved.slice(OLD.length));
  return saved; // plain text from before sealing
}

/** Whether a saved value should be sealed again: anything not yet under the outside key, once there is one. */
const stale = (saved) => !!outsideSealingKey() && typeof saved === 'string' && !saved.startsWith(NEW);

/**
 * Run at start: every key still in the older form is sealed again under the outside key, and then the older
 * sealing key is deleted from the database, so a database copy holds nothing that opens the keys.
 * Keys that cannot be opened any more (their sealing key was lost) are left alone; their owners add them again.
 * Returns what it did, for the start-up log.
 */
export function resealAiKeys() {
  if (!outsideSealingKey()) {
    const any = db.prepare('select count(*) as n from user_ai_keys').get().n;
    return { outside: false, keys: any };
  }
  let moved = 0;
  let lost = 0;
  const rows = db.prepare(`select user_id, provider, secret from user_ai_keys where secret not like '${NEW}%'`).all();
  for (const row of rows) {
    const secret = unseal(row.secret);
    if (!secret) { lost++; continue; }
    db.prepare('update user_ai_keys set secret = ? where user_id = ? and provider = ?').run(seal(secret), row.user_id, row.provider);
    moved++;
  }
  // The older sealing key goes once nothing it opens is left.
  const left = db.prepare(`select count(*) as n from user_ai_keys where secret like '${OLD}%'`).get().n;
  if (!left) db.prepare('delete from app_config where key = ?').run(BOX);
  return { outside: true, moved, lost, oldKeyRemoved: !left };
}

const hintOf = (secret) => `••••${String(secret ?? '').slice(-4)}`;

/** The account's own key, or null when it has none. */
export function userAiKey(userId, provider = 'deepseek') {
  if (!userId) return null;
  const saved = db.prepare('select secret from user_ai_keys where user_id = ? and provider = ?').get(userId, provider)?.secret;
  const secret = unseal(saved);
  // Still in an older form: sealed again under the outside key now, so it does not wait for the next start.
  if (secret && stale(saved)) db.prepare('update user_ai_keys set secret = ? where user_id = ? and provider = ?').run(seal(secret), userId, provider);
  return secret;
}

/**
 * The key AI features must use for this account: the account's own first, otherwise the platform's.
 * AI features call this with the signed-in account's id, never with a key from the app.
 */
export function aiKeyOf(userId, provider = 'deepseek') {
  const own = userAiKey(userId, provider);
  if (own) return { key: own, source: 'yours' };
  const platform = process.env.DEEPSEEK_API_KEY?.trim();
  return platform ? { key: platform, source: 'platform' } : { key: null, source: 'none' };
}

/** What the app may know about this account's key: never the key itself. */
export function aiKeySummary(userId, provider = 'deepseek') {
  const row = db.prepare('select hint, created_at, checked_at from user_ai_keys where user_id = ? and provider = ?').get(userId, provider);
  return {
    saved: !!row,
    hint: row?.hint ?? null,
    addedAt: row?.created_at ?? null,
    checkedAt: row?.checked_at ?? null,
    // 'yours' once the account added one, else 'platform' (Saligue's own key) or 'none'.
    source: aiKeyOf(userId, provider).source,
  };
}

/**
 * Asks DeepSeek whether a key works (GET /user/balance: 200 with the balance when it does, 401/403 when it does not).
 * refused = DeepSeek says the key is wrong; unreachable = we could not ask (the key is still worth keeping).
 */
export async function checkAiKey(provider, secret) {
  const meta = KEY_PROVIDERS[provider];
  if (!meta) return { ok: false, refused: true, reason: 'Unknown provider.' };
  if (!meta.shape.test(secret)) return { ok: false, refused: true, reason: `A ${meta.label} key starts with sk- (${meta.where}).` };
  const response = await fetch(`${API}/user/balance`, {
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response) return { ok: false, unreachable: true, reason: `DeepSeek did not answer, so the key is kept and not checked yet.` };
  const data = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403) {
    return { ok: false, refused: true, reason: 'DeepSeek refused this key. Copy it again from your DeepSeek account, and check it was not deleted.' };
  }
  if (!response.ok) return { ok: false, unreachable: true, reason: `DeepSeek answered ${response.status}. The key is kept and will be checked again later.` };
  const info = data?.balance_infos?.[0];
  return {
    ok: true,
    available: data?.is_available !== false,
    balance: info?.total_balance ? `${info.total_balance} ${info.currency}` : null,
  };
}

/** Saves (or replaces) the account's key. checkedAt is null when DeepSeek could not be reached. */
export function saveAiKey(userId, provider, secret, checkedAt = null) {
  db.prepare(`insert into user_ai_keys (user_id, provider, secret, hint, created_at, checked_at) values (?, ?, ?, ?, ?, ?)
    on conflict (user_id, provider) do update set secret = excluded.secret, hint = excluded.hint, created_at = excluded.created_at, checked_at = excluded.checked_at`)
    .run(userId, provider, seal(secret), hintOf(secret), now(), checkedAt);
}

/** Forgets the account's key (AI features then use the platform's key, when there is one). */
export function removeAiKey(userId, provider = 'deepseek') {
  return db.prepare('delete from user_ai_keys where user_id = ? and provider = ?').run(userId, provider).changes > 0;
}

/**
 * Checks the key the account already saved, without asking it to paste the key again (the card's "Check again").
 * The saved key never travels to the app, so this is the only way a key kept while DeepSeek was unreachable is retried.
 */
export async function recheckAiKey(userId, provider = 'deepseek') {
  const secret = userAiKey(userId, provider);
  if (!secret) return { ok: false, none: true, reason: 'This account has no key saved yet.' };
  const check = await checkAiKey(provider, secret);
  if (check.ok) db.prepare('update user_ai_keys set checked_at = ? where user_id = ? and provider = ?').run(now(), userId, provider);
  return check;
}

/**
 * Asks DeepSeek for text, using this account's own key when it has one, Saligue's otherwise.
 * This is what makes a saved key do something: every AI feature that writes text calls this with the
 * signed-in account's id, so two accounts genuinely never spend the same key.
 * Throws an error with .status/.code so the route can answer with a clear message.
 */
export async function aiComplete(userId, messages, { maxTokens = 400, temperature = 0.6, provider = 'deepseek' } = {}) {
  const { key: secret, source } = aiKeyOf(userId, provider);
  if (!secret) {
    throw Object.assign(new Error('This account has no AI key yet. Add your DeepSeek key in Settings, or ask Saligue for one.'), { code: 'no_key', status: 503 });
  }
  const response = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat',
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response) {
    throw Object.assign(new Error('DeepSeek did not answer. Check your connection and try again.'), { code: 'unreachable', status: 504 });
  }
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error(source === 'yours'
      ? 'DeepSeek refused this account’s key. Add it again in Settings.'
      : 'Saligue’s AI key was refused. Please tell INDECIANA.'), { code: 'key_refused', status: 502 });
  }
  if (response.status === 402) {
    throw Object.assign(new Error(source === 'yours'
      ? 'This DeepSeek account has no credit left. Top it up, or use Saligue’s key.'
      : 'Saligue’s AI key has no credit left.'), { code: 'no_credit', status: 402 });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`DeepSeek answered ${response.status}. Try again in a moment.`), { code: 'ai_failed', status: 502 });
  }
  const data = await response.json().catch(() => null);
  const text = String(data?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) {
    throw Object.assign(new Error('DeepSeek sent nothing back. Try again.'), { code: 'empty', status: 502 });
  }
  return { text, source, model: data?.model ?? null, tokens: data?.usage?.total_tokens ?? null };
}
