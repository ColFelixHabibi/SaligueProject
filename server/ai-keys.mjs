// An account's own AI key (DeepSeek): two accounts never share one key.
// The key is kept on the server with the account that added it (table user_ai_keys), is never sent back to the app
// (only "••••1234"), and is checked with DeepSeek the moment it is saved, so a wrong or deleted key is refused at once.
// It is stored encrypted (a key made once and kept in app_config, like the chat-file secret), so a copy of the
// database is not a copy of everyone's keys.
//   DEEPSEEK_API_KEY   the platform's own key, used by accounts that did not add one
//   DEEPSEEK_API_URL   only for a proxy or a test server (default https://api.deepseek.com)
//   DEEPSEEK_MODEL     the model AI writing uses (default deepseek-chat)
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { db, json, now, parse } from './db.mjs';

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
 * At rest a key is sealed with AES-256-GCM under a key made once and kept in app_config (never in the code).
 * Keys saved before this are still plain text ("sk-…") and are read as they are, then sealed on the next save.
 */
const BOX = 'ai_keys';
const SEALED = 'enc1:';

function boxKey() {
  const saved = parse(db.prepare('select value from app_config where key = ?').get(BOX)?.value)?.secret;
  if (typeof saved === 'string' && /^[a-f0-9]{64}$/.test(saved)) return Buffer.from(saved, 'hex');
  const fresh = randomBytes(32).toString('hex');
  db.prepare('insert into app_config (key, value) values (?, ?) on conflict (key) do update set value = excluded.value').run(BOX, json({ secret: fresh }));
  return Buffer.from(fresh, 'hex');
}

let made = null; // made on first use, so starting the server never touches the database for nothing
const sealingKey = () => (made ??= boxKey());

function seal(secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealingKey(), iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${SEALED}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${body.toString('base64url')}`;
}

/** The key as saved. Null only when the sealing key was lost (then the account simply adds its key again). */
function unseal(saved) {
  if (typeof saved !== 'string' || !saved.startsWith(SEALED)) return saved ?? null; // plain text from before sealing
  try {
    const [iv, tag, body] = saved.slice(SEALED.length).split(':');
    const decipher = createDecipheriv('aes-256-gcm', sealingKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const hintOf = (secret) => `••••${String(secret ?? '').slice(-4)}`;

/** The account's own key, or null when it has none. */
export function userAiKey(userId, provider = 'deepseek') {
  if (!userId) return null;
  return unseal(db.prepare('select secret from user_ai_keys where user_id = ? and provider = ?').get(userId, provider)?.secret);
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
