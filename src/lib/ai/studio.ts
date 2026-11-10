'use client';

import { api } from '@/lib/api';
import { context2d, createCanvas, fitWithin, loadImage } from './canvas';
import { LookRejected, keepOnlyChanged } from './composite';
import { ensureTryOnConsent } from './consent';

// Saligue AI Studio: Saligue's own GPU server (ai-server/) running Leffa and SDXL Inpainting.
// Its address comes from a ?ai= link, this device's saved setting, or the app setting INDECIANA saved on the server.

const STORAGE_KEY = 'saligue-ai-studio-url';

// Categories the realistic try-on model supports; others use on-device dressing only.
export const REALISTIC_CATEGORIES = ['top', 'outerwear', 'dress', 'bottom'];

// Which AI really drew a look, as the server reports it: Saligue's own Studio, the paid model, or a free one.
type LookEngine = 'own' | 'fashn' | 'free';
const QUALITIES = ['fast', 'high', 'ultra'] as const;
export type TryOnQuality = (typeof QUALITIES)[number];

function clean(url: string | null | undefined) {
  const trimmed = url?.trim().replace(/\/+$/, '');
  return trimmed && /^https?:\/\//.test(trimmed) ? trimmed : null;
}

let resolved: Promise<string | null> | null = null;
let cloud: Promise<boolean> | null = null;
let unlimited = false;

/** Forget what was found before, so a changed Studio address or feature switch is picked up at once. */
function forgetAvailability() {
  resolved = null;
  cloud = null;
  unlimited = false;
}

export function setStudioUrl(url: string | null) {
  try {
    if (url) localStorage.setItem(STORAGE_KEY, url);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable.
  }
  forgetAvailability();
}

async function findStudioUrl(): Promise<string | null> {
  const fromLink = clean(new URLSearchParams(window.location.search).get('ai'));
  if (fromLink) {
    setStudioUrl(fromLink);
    return fromLink;
  }
  try {
    const saved = clean(localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch {
    // Storage unavailable.
  }
  try {
    const config = await api<{ studioUrl?: string } | null>('/config/ai');
    return clean(config?.studioUrl);
  } catch {
    return null;
  }
}

/** The AI Studio address if one is configured and answering, otherwise null. */
export function getStudio(): Promise<string | null> {
  if (!resolved) {
    resolved = (async () => {
      const url = await findStudioUrl();
      if (!url) return null;
      try {
        const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
        return response.ok ? url : null;
      } catch {
        return null;
      }
    })();
  }
  return resolved;
}

// Photos are flattened onto white and capped in size to keep uploads quick.
async function toJpeg(src: string, maxEdge = 1024) {
  const img = await loadImage(src);
  const fitted = fitWithin(img, maxEdge);
  const out = createCanvas(fitted.width, fitted.height);
  const ctx = context2d(out);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(fitted, 0, 0);
  return out.toDataURL('image/jpeg', 0.92);
}

// The try-on AIs work at a fixed shape (FASHN 2:3, the free models 3:4) and crop or stretch other photos, so
// the result would no longer line up with the shopper's photo. The photo is padded to that shape (with a
// blurred copy of itself, so the AI sees a natural background) and the padding is cut off the result again:
// before and after match pixel for pixel.
type Padded = { url: string; width: number; height: number; box: { x: number; y: number; w: number; h: number } };
async function padToShape(src: string, ratio: number): Promise<Padded> {
  const img = await loadImage(src);
  const w = img.naturalWidth, h = img.naturalHeight;
  if (Math.abs(w / h - ratio) < 0.02) return { url: src, width: w, height: h, box: { x: 0, y: 0, w, h } };
  const W = w / h > ratio ? w : Math.round(h * ratio);
  const H = w / h > ratio ? Math.round(w / ratio) : h;
  const out = createCanvas(W, H);
  const ctx = context2d(out);
  const cover = Math.max(W / w, H / h);
  ctx.filter = 'blur(24px)';
  ctx.drawImage(img, (W - w * cover) / 2, (H - h * cover) / 2, w * cover, h * cover);
  ctx.filter = 'none';
  const box = { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
  ctx.drawImage(img, box.x, box.y);
  return { url: out.toDataURL('image/jpeg', 0.92), width: W, height: H, box };
}
// Each AI fits the photo into its own frame and centres it, and those frames differ (FASHN 2:3, Leffa 3:4), so the
// picture that comes back is not always the shape that was sent. Undoing that fit first keeps the crop square when
// the two shapes differ; when they match it does exactly what a plain scale would.
async function cropBack(result: string, padded: Padded): Promise<string> {
  if (padded.box.w === padded.width && padded.box.h === padded.height) return result;
  const img = await loadImage(result);
  const scale = Math.min(img.naturalWidth / padded.width, img.naturalHeight / padded.height);
  const left = (img.naturalWidth - padded.width * scale) / 2;
  const top = (img.naturalHeight - padded.height * scale) / 2;
  const out = createCanvas(Math.round(padded.box.w * scale), Math.round(padded.box.h * scale));
  context2d(out).drawImage(img, left + padded.box.x * scale, top + padded.box.y * scale, padded.box.w * scale, padded.box.h * scale, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.92);
}

// One redraw at a time is queued behind the last (see realisticTryOn), so a request that never answers would hold
// every other look behind it: a GPU that is busy or a network that has gone quiet ends here instead of hanging.
const CALL_TIMEOUT = 180_000;
// Through the Saligue server the same photo is tried on our own AI first and, when that fails, the paid one, each with
// its own minutes (server/tryon.mjs): the app waits long enough for both, so a slow look is never cut off.
const SERVER_CALL_TIMEOUT = 240_000;

async function call(path: string, body: object): Promise<string> {
  const url = await getStudio();
  if (!url) throw new Error('Saligue AI Studio is not running right now.');
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT),
    });
  } catch (error) {
    if ((error as Error)?.name === 'TimeoutError') throw new Error('Saligue AI Studio is taking too long. Tap Try again.');
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `AI Studio error (${response.status}).`);
  if (!data.image) throw new Error('Saligue AI Studio sent no picture. Tap Try again.');
  return data.image;
}

/** True when the server has the paid try-on (no daily limit): every result can be dressed. */
export const isUnlimited = () => unlimited;

/**
 * Whether "Make it realistic" can run: on Saligue's own AI Studio, or through the Saligue server,
 * which uses the public Leffa model (see server/tryon.mjs).
 *
 * The server is asked first even when a Studio address is saved: the App calls the Studio straight from the
 * browser, so Admin → Features and the per-country rules (server/index.mjs needFeature) would otherwise never
 * apply to it, and realistic try-on could not be closed where it must be.
 */
export function getRealistic(): Promise<boolean> {
  if (!cloud) {
    cloud = (async () => {
      try {
        const info = await api<{ available?: boolean; unlimited?: boolean }>('/ai/tryon');
        unlimited = !!info?.unlimited;
        if (!info?.available) return false;
      } catch {
        return false;
      }
      return !!(await getStudio());
    })();
  }
  return cloud;
}

// Quick fingerprint of a long data URL, for caching results.
function fingerprint(text: string) {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(text.length / 4096));
  for (let i = 0; i < text.length; i += step) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

// Looks already made in this visit, and one redraw at a time (the AI handles one picture at once).
// Each kept look holds a whole picture, so only the most recent ones are held: a long visit tapping through
// choices would otherwise fill the phone's memory.
const LOOKS_KEPT = 40;
const looks = new Map<string, Promise<string>>();
let lane: Promise<unknown> = Promise.resolve();

// Each failed attempt asks the AI for a different variation next time (not the cached picture).
const attempts = new Map<string, number>();

// Which AI drew the latest look of each garment in this visit. When the shopper keeps an outfit, the app tells
// Saligue which AI made it (see keepLook): that is the signal the engine chain learns from (server/ai-learn.mjs),
// so a model whose looks people keep is the one tried first next time.
const DRAWN_KEPT = 60;
const drawnBy = new Map<string, LookEngine>();
const drawnKey = (garmentUrl: string, category: string) => `${fingerprint(garmentUrl)}|${category}`;

function rememberEngine(garmentUrl: string, category: string, engine: LookEngine) {
  drawnBy.delete(drawnKey(garmentUrl, category));
  drawnBy.set(drawnKey(garmentUrl, category), engine);
  while (drawnBy.size > DRAWN_KEPT) drawnBy.delete(drawnBy.keys().next().value as string);
}

/** Tells Saligue what happened to a look. Never waits, never fails the shopper: a lost note is not a lost look. */
function reportLook(engine: LookEngine, category: string, kept: boolean, reason: string) {
  void api('/ai/tryon/feedback', { body: { engine, category, kept, reason }, timeoutMs: 15_000 }).catch(() => {});
}

/** The shopper kept this look (wore it, bought it, saved it, carried on with the outfit): a vote for that AI. */
export function keepLook(garmentUrl: string, category: string) {
  const key = drawnKey(garmentUrl, category);
  const engine = drawnBy.get(key);
  if (!engine) return;
  drawnBy.delete(key);
  reportLook(engine, category, true, 'kept');
}

/**
 * Realistically redraws the garment on the person. Only the new garment is taken from the AI's picture; a
 * picture where the AI also changed other clothes is never shown: the AI is asked once more for another
 * variation, and if that one is wrong too, this fails so the shopper can tap Try again.
 * `quality` says how much work the AI may do ('high' unless a screen asks otherwise).
 */
export function realisticTryOn(personUrl: string, garmentUrl: string, category: string, description = '', quality: TryOnQuality = 'high'): Promise<string> {
  const key = `${fingerprint(personUrl)}|${fingerprint(garmentUrl)}|${category}`;
  let look = looks.get(key);
  if (!look) {
    const run = async () => {
      if (!(await ensureTryOnConsent())) throw new Error('Realistic try-on needs a photo of you. Confirm it is you to continue.');
      const padded = await padToShape(await toJpeg(personUrl), isUnlimited() ? 2 / 3 : 3 / 4);
      const body = { person: padded.url, garment: await toJpeg(garmentUrl), category, description, quality };
      for (let tries = 0; tries < 2; tries++) {
        const variant = attempts.get(key) ?? 0;
        const made = (await getStudio())
          ? { image: await call('/api/tryon', { ...body, variant }), finished: false, engine: 'own' as LookEngine }
          : await api<{ image: string; finished?: boolean; engine?: string }>('/ai/tryon', { body: { ...body, variant, consent: 'self' }, timeoutMs: SERVER_CALL_TIMEOUT });
        const engine: LookEngine = made.engine === 'fashn' ? 'fashn' : made.engine === 'free' ? 'free' : 'own';
        const image = made.image;
        // The paid try-on (fal.ai FASHN) returns a finished, clean photo: shown as it is. Cutting out "only what
        // changed" was made for the free models, and on a good picture it leaves halos around the garment.
        // The server says which AI really drew it: when the paid one is down, a free model's picture is checked.
        if (made.finished) {
          rememberEngine(garmentUrl, category, engine);
          return cropBack(image, padded);
        }
        try {
          const clean = await cropBack(await keepOnlyChanged(body.person, image, category), padded);
          rememberEngine(garmentUrl, category, engine);
          return clean;
        } catch (error) {
          attempts.set(key, variant + 1);
          if (!(error instanceof LookRejected)) {
            console.error('Could not check the look:', error);
            throw new Error('This look could not be finished cleanly. Tap Try again.');
          }
          // The AI changed more than this item: a vote against it, so the chain learns which AI to trust.
          reportLook(engine, category, false, 'changed_more_than_the_item');
        }
      }
      throw new Error('The AI changed more than this item, so the look was not shown. Tap Try again.');
    };
    look = lane.then(run, run);
    lane = look.catch(() => {});
    looks.set(key, look);
    look.catch(() => looks.delete(key));
    // The map keeps insertion order, so the oldest look goes first.
    while (looks.size > LOOKS_KEPT) looks.delete(looks.keys().next().value as string);
  }
  return look;
}

/**
 * The words the shopper typed, turned into the prompt the picture model needs (server/index.mjs → ai-keys.mjs),
 * which is most of the difference between a plain try-on and a good one: fabric, fit, pose and light. Falls back
 * to the shopper's own words when there is no AI key or the writer is unreachable, so dressing never waits on it.
 */
async function expandLook(description: string): Promise<{ prompt: string; negative?: string }> {
  try {
    const look = await api<{ prompt?: string; negative?: string }>('/ai/look', { body: { description }, timeoutMs: 20_000 });
    return look?.prompt ? { prompt: look.prompt, negative: look.negative } : { prompt: description };
  } catch {
    return { prompt: description };
  }
}

/** Dresses the person as described (SDXL Inpainting), keeping face and body. Returns a JPEG data URL. */
export async function dressAsDescribed(personUrl: string, prompt: string, coverage: 'full' | 'clothes' = 'full') {
  // The Studio is checked first, so a Studio that is down never costs an AI call.
  if (!(await getStudio())) throw new Error('Saligue AI Studio is not running right now.');
  const [person, written] = await Promise.all([toJpeg(personUrl), expandLook(prompt)]);
  return call('/api/dress', { person, prompt: written.prompt, negative: written.negative, coverage, quality: 'high' });
}
