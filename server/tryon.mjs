// Realistic try-on ("Make it realistic") through Leffa (MIT, Meta 2025): redraws the person wearing the garment.
// Uses Saligue's own AI Studio when one is set up (ai-server/, e.g. on a GPU server); until then, the public
// Leffa demo on Hugging Face, which needs no account but allows only a few free runs a day.
//   TRYON_SPACE   another Hugging Face Space with the same API (default franciszzj/Leffa)
//   HF_TOKEN      optional free Hugging Face token: more runs per day
// When Leffa is busy or its free daily limit is used up, tops and jackets fall back to IDM-VTON
// (yisol/IDM-VTON, CC BY-NC-SA 4.0), which also redraws the person wearing the garment.
// Unlimited, commercial use: FASHN on fal.ai (pay per image, no daily cap). Switch it on with FAL_KEY or
// `node server/admin.mjs tryon <fal key>`; it is then used first and the free models only as a fallback.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, handle_file } from '@gradio/client';
import { DATA_DIR, db, parse } from './db.mjs';

const SPACE = process.env.TRYON_SPACE || 'franciszzj/Leffa';
const FALLBACK_SPACE = process.env.TRYON_FALLBACK_SPACE || 'yisol/IDM-VTON';
// Last free fallback: Kolors Virtual Try-On (Kuaishou's public demo; not on Hugging Face's shared GPU quota).
// It sometimes redraws other clothes too; the app checks every look and throws those away (composite.ts).
const LAST_SPACE = process.env.TRYON_LAST_SPACE || 'Kwai-Kolors/Kolors-Virtual-Try-On';
// A Hugging Face token (Platform settings, or HF_TOKEN) gives the free models a bigger daily allowance
// than an anonymous server; a PRO account (about $9/month) gives much more.
export function hfToken() {
  return process.env.HF_TOKEN || parse(db.prepare("select value from app_config where key = 'hftoken'").get()?.value)?.token || null;
}
const auth = () => (hfToken() ? { hf_token: hfToken() } : undefined);
/** Forget connections made without (or with an old) token. */
export const resetTryOnClients = () => clients.clear();

const clients = new Map();
/** A new token means new allowance: try every model again. */
export function clearResting() {
  resting?.clear?.();
  clients.clear();
}
async function connect(space) {
  if (!clients.has(space)) {
    const client = Client.connect(space, auth());
    client.catch(() => clients.delete(space));
    clients.set(space, client);
  }
  return clients.get(space);
}

async function download(url) {
  const response = await fetch(url, hfToken() ? { headers: { Authorization: `Bearer ${hfToken()}` } } : undefined);
  if (!response.ok) throw new Error(`Could not download the result (${response.status}).`);
  const type = response.headers.get('content-type') || 'image/png';
  return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
}

// A model whose free daily quota is used up is skipped until the time Hugging Face gives ("Try again in 12:17:54"),
// so shoppers don't wait for refusals before the next model answers.
const resting = new Map(); // space → time it can be tried again
const available = (space) => (resting.get(space) ?? 0) < Date.now();
function rest(space, error) {
  const m = /Try again in (\d+):(\d+):(\d+)/.exec(String(error?.message ?? error));
  if (m) resting.set(space, Date.now() + ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000);
  else if (isBusy(String(error?.message ?? error))) resting.set(space, Date.now() + 10 * 60_000);
}

const isBusy = (message) => /quota|exceeded|GPU|rate|queue|busy|limit/i.test(message);

// Leffa has two models: VITON-HD (tops only, best quality) and DressCode (tops, trousers and dresses).
const GARMENT = {
  top: ['viton_hd', 'upper_body'],
  outerwear: ['viton_hd', 'upper_body'],
  bottom: ['dress_code', 'lower_body'],
  dress: ['dress_code', 'dresses'],
};
export const REALISTIC_CATEGORIES = Object.keys(GARMENT);

function toBlob(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl ?? ''));
  if (!match) throw Object.assign(new Error('Invalid image.'), { status: 400 });
  const bytes = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
  return new Blob([bytes], { type: match[1] || 'image/jpeg' });
}

async function leffa(person, garment, category, variant = 0) {
  const [model, kind] = GARMENT[category] ?? GARMENT.top;
  const app = await connect(SPACE);
  const result = await app.predict('/leffa_predict_vt', {
    src_image_path: handle_file(toBlob(person)),
    ref_image_path: handle_file(toBlob(garment)),
    ref_acceleration: false,
    step: 30,
    scale: 2.5,
    seed: 42 + variant * 1009,
    vt_model_type: model,
    vt_garment_type: kind,
    vt_repaint: false,
  });
  const url = result?.data?.[0]?.url;
  if (!url) throw new Error('Leffa returned no picture.');
  return download(url);
}

// IDM-VTON dresses the upper body only (tops and jackets).
async function idmVton(person, garment, description, variant = 0) {
  const app = await connect(FALLBACK_SPACE);
  const result = await app.predict('/tryon', {
    dict: { background: handle_file(toBlob(person)), layers: [], composite: null },
    garm_img: handle_file(toBlob(garment)),
    garment_des: description || 'garment',
    is_checked: true,
    is_checked_crop: false,
    denoise_steps: 30,
    seed: 42 + variant * 1009,
  });
  const url = result?.data?.[0]?.url;
  if (!url) throw new Error('IDM-VTON returned no picture.');
  return download(url);
}

// ---------------------------------------------------------------------------
// FASHN (fal.ai queue API): https://queue.fal.run/fal-ai/fashn/tryon/v1.6
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Saligue's own AI server (ai-server/, installed with install.sh on a GPU server): used first, no daily limit.
// Set with AI_SERVER_URL + AI_SERVER_KEY, Platform settings, or `node server/admin.mjs aiserver <url> <key>`.
// ---------------------------------------------------------------------------

export function ownAi() {
  const saved = parse(db.prepare("select value from app_config where key = 'aiserver'").get()?.value) ?? {};
  const url = (process.env.AI_SERVER_URL || saved.url || '').replace(/\/+$/, '');
  const key = process.env.AI_SERVER_KEY || saved.key || '';
  return url && key ? { url, key } : null;
}

/** Checks the own AI server: reachable, key accepted, which GPU. */
export async function checkOwnAi(url, key) {
  const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
  if (!health?.ok) return { ok: false, reason: 'The AI server does not answer at this address.' };
  // An empty request with the key is refused for missing photos (422), without the right key with 403.
  const probe = await fetch(`${url}/api/tryon`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Saligue-Key': key }, body: '{}', signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!probe || probe.status === 403) return { ok: false, reason: 'The AI server refused the secret key.' };
  return { ok: true, gpu: health.gpu, memoryGb: health.memoryGb, ready: health.ready, busy: health.busy };
}

async function ownAiTryOn(person, garment, category, variant = 0) {
  const { url, key } = ownAi();
  const response = await fetch(`${url}/api/tryon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Saligue-Key': key },
    body: JSON.stringify({ person, garment, category, variant }),
    signal: AbortSignal.timeout(180_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.image) throw new Error(`Own AI server: ${data?.detail ?? response.status}`);
  return data.image;
}

export function falKey() {
  return process.env.FAL_KEY || parse(db.prepare("select value from app_config where key = 'tryon'").get()?.value)?.falKey || null;
}

/** Whether a paid, unlimited try-on provider is switched on. */
export const unlimitedTryOn = () => !!falKey() || !!ownAi();

const FAL_CATEGORY = { top: 'tops', outerwear: 'tops', bottom: 'bottoms', dress: 'one-pieces' };
const FAL_QUEUE = (process.env.FAL_QUEUE_URL || 'https://queue.fal.run').replace(/\/+$/, '');

async function fashn(person, garment, category, variant = 0) {
  const headers = { Authorization: `Key ${falKey()}`, 'Content-Type': 'application/json' };
  const submit = await fetch(`${FAL_QUEUE}/fal-ai/fashn/tryon/v1.6`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model_image: person,
      garment_image: garment,
      category: FAL_CATEGORY[category] ?? 'auto',
      mode: 'balanced',
      garment_photo_type: 'auto',
      output_format: 'jpeg',
      num_samples: 1,
      seed: 42 + variant * 1009,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const queued = await submit.json().catch(() => null);
  if (!submit.ok || !queued?.request_id) throw new Error(`FASHN refused the request (${submit.status}): ${queued?.detail ?? queued?.message ?? ''}`);
  const base = `${FAL_QUEUE}/fal-ai/fashn/tryon/v1.6/requests/${queued.request_id}`;
  const statusUrl = queued.status_url || `${base}/status`;
  const resultUrl = queued.response_url || base;
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const status = await (await fetch(statusUrl, { headers, signal: AbortSignal.timeout(15_000) })).json().catch(() => ({}));
    if (status.status === 'COMPLETED') break;
    if (status.status === 'FAILED' || status.error) throw new Error(`FASHN failed: ${status.error ?? 'unknown error'}`);
  }
  const result = await (await fetch(resultUrl, { headers, signal: AbortSignal.timeout(30_000) })).json().catch(() => null);
  const url = result?.images?.[0]?.url;
  if (!url) throw new Error('FASHN returned no picture.');
  return url.startsWith('data:') ? url : download(url);
}

// ---------------------------------------------------------------------------
// Looks already made are kept (data/tryon-cache), so the same photo and garment are never paid for twice.
// ---------------------------------------------------------------------------

const CACHE_DIR = join(DATA_DIR, 'tryon-cache');
const CACHE_MAX = 3000;
mkdirSync(CACHE_DIR, { recursive: true });
const cacheKey = (person, garment, category, variant) => createHash('sha256').update(person).update('|').update(garment).update('|').update(category).update(`|${variant}`).digest('hex').slice(0, 40);

function fromCache(key) {
  const file = join(CACHE_DIR, `${key}.txt`);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function toCache(key, image) {
  try {
    writeFileSync(join(CACHE_DIR, `${key}.txt`), image);
    const files = readdirSync(CACHE_DIR);
    if (files.length > CACHE_MAX) {
      files.map((f) => ({ f, t: statSync(join(CACHE_DIR, f)).mtimeMs })).sort((a, b) => a.t - b.t)
        .slice(0, files.length - CACHE_MAX).forEach(({ f }) => unlinkSync(join(CACHE_DIR, f)));
    }
  } catch (error) {
    console.error('Could not keep the look:', error.message);
  }
}

async function kolors(person, garment, variant = 0) {
  const app = await connect(LAST_SPACE);
  // Inputs: person, garment, seed, random seed.
  const result = await app.predict(2, [handle_file(toBlob(person)), handle_file(toBlob(garment)), 42 + variant * 1009, false]);
  const url = result?.data?.[0]?.url;
  if (!url) throw new Error('Kolors returned no picture.');
  return download(url);
}

/** Returns the person wearing the garment, as a JPEG/PNG data URL. */
export async function tryOn(person, garment, category, description = '', variant = 0) {
  toBlob(person);
  toBlob(garment);
  const key = cacheKey(person, garment, category, variant);
  const cached = fromCache(key);
  if (cached) return cached;
  const image = await makeLook(person, garment, category, description, variant);
  toCache(key, image);
  return image;
}

async function makeLook(person, garment, category, description, variant) {
  if (ownAi()) {
    try {
      return await ownAiTryOn(person, garment, category, variant);
    } catch (error) {
      console.error('Own AI server failed, trying the backups:', String(error?.message ?? error).slice(0, 200));
    }
  }
  if (falKey()) {
    try {
      return await fashn(person, garment, category, variant);
    } catch (error) {
      console.error('FASHN try-on failed, trying the free models:', error.message);
    }
  }
  let first;
  if (available(SPACE)) {
    try {
      return await leffa(person, garment, category, variant);
    } catch (error) {
      first = error;
      rest(SPACE, error);
      clients.delete(SPACE);
    }
  } else first = new Error('quota: resting');
  if (category === 'top' || category === 'outerwear') {
    if (available(FALLBACK_SPACE)) {
      try {
        return await idmVton(person, garment, description, variant);
      } catch (error) {
        rest(FALLBACK_SPACE, error);
        clients.delete(FALLBACK_SPACE);
        console.error('Realistic try-on fallback failed:', String(error?.message ?? error).slice(0, 160));
      }
    }
    // Kolors (kolors() above) is not used: in tests it drew wrong sleeves and smudges and changed other clothes.
    // Turn it on with TRYON_USE_KOLORS=1 only to experiment; the app's look check still guards every picture.
    if (process.env.TRYON_USE_KOLORS === '1') {
      try {
        return await kolors(person, garment, variant);
      } catch (error) {
        clients.delete(LAST_SPACE);
        console.error('Realistic try-on last fallback failed:', error?.message ?? error);
      }
    }
  }
  const message = String(first?.message ?? first);
  if (isBusy(message) || !available(SPACE)) {
    const back = resting.get(SPACE);
    const when = back ? new Date(back).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' }) : null;
    throw Object.assign(new Error(`The free realistic try-on has used its daily limit${when ? ` and is back at ${when} (Kigali time)` : ''}. Shoes, hats, glasses and bags still work now.`), { status: 503 });
  }
  throw Object.assign(new Error('The realistic AI could not dress you this time. Try again in a moment.'), { status: 502, cause: first });
}
