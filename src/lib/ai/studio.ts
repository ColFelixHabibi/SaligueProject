'use client';

import { api } from '@/lib/api';
import { context2d, createCanvas, fitWithin, loadImage } from './canvas';
import { LookRejected, keepOnlyChanged } from './composite';

// Saligue AI Studio: Saligue's own GPU server (ai-server/) running Leffa and SDXL Inpainting.
// Its address comes from a ?ai= link, this device's saved setting, or the app setting INDECIANA saved on the server.

const STORAGE_KEY = 'saligue-ai-studio-url';

// Categories the realistic try-on model supports; others use on-device dressing only.
export const REALISTIC_CATEGORIES = ['top', 'outerwear', 'dress', 'bottom'];

function clean(url: string | null | undefined) {
  const trimmed = url?.trim().replace(/\/+$/, '');
  return trimmed && /^https?:\/\//.test(trimmed) ? trimmed : null;
}

let resolved: Promise<string | null> | null = null;

export function setStudioUrl(url: string | null) {
  try {
    if (url) localStorage.setItem(STORAGE_KEY, url);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable.
  }
  resolved = null;
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
async function cropBack(result: string, padded: Padded): Promise<string> {
  if (padded.box.w === padded.width && padded.box.h === padded.height) return result;
  const img = await loadImage(result);
  const sx = img.naturalWidth / padded.width, sy = img.naturalHeight / padded.height;
  const out = createCanvas(Math.round(padded.box.w * sx), Math.round(padded.box.h * sy));
  context2d(out).drawImage(img, padded.box.x * sx, padded.box.y * sy, padded.box.w * sx, padded.box.h * sy, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.92);
}

async function call(path: string, body: object): Promise<string> {
  const url = await getStudio();
  if (!url) throw new Error('Saligue AI Studio is not running right now.');
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `AI Studio error (${response.status}).`);
  return data.image;
}

let cloud: Promise<boolean> | null = null;
let unlimited = false;

/** True when the server has the paid try-on (no daily limit): every result can be dressed. */
export const isUnlimited = () => unlimited;

/**
 * Whether "Make it realistic" can run: on Saligue's own AI Studio, or through the Saligue server,
 * which uses the public Leffa model (see server/tryon.mjs).
 */
export function getRealistic(): Promise<boolean> {
  if (!cloud) {
    cloud = getStudio().then(async (url) => {
      if (url) return true;
      try {
        const info = await api<{ available?: boolean; unlimited?: boolean }>('/ai/tryon');
        unlimited = !!info?.unlimited;
        return !!info?.available;
      } catch {
        return false;
      }
    });
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
const looks = new Map<string, Promise<string>>();
let lane: Promise<unknown> = Promise.resolve();

// Each failed attempt asks the AI for a different variation next time (not the cached picture).
const attempts = new Map<string, number>();

/**
 * Realistically redraws the garment on the person. Only the new garment is taken from the AI's picture; a
 * picture where the AI also changed other clothes is never shown: the AI is asked once more for another
 * variation, and if that one is wrong too, this fails so the shopper can tap Try again.
 */
export function realisticTryOn(personUrl: string, garmentUrl: string, category: string, description = ''): Promise<string> {
  const key = `${fingerprint(personUrl)}|${fingerprint(garmentUrl)}|${category}`;
  let look = looks.get(key);
  if (!look) {
    const run = async () => {
      const padded = await padToShape(await toJpeg(personUrl), isUnlimited() ? 2 / 3 : 3 / 4);
      const body = { person: padded.url, garment: await toJpeg(garmentUrl), category, description };
      for (let tries = 0; tries < 2; tries++) {
        const variant = attempts.get(key) ?? 0;
        const image = (await getStudio()) ? await call('/api/tryon', { ...body, variant }) : (await api<{ image: string }>('/ai/tryon', { body: { ...body, variant } })).image;
        // The paid try-on (fal.ai FASHN) returns a finished, clean photo: shown as it is. Cutting out "only what
        // changed" was made for the free models, and on a good picture it leaves halos around the garment.
        if (isUnlimited()) return cropBack(image, padded);
        try {
          return await cropBack(await keepOnlyChanged(body.person, image, category), padded);
        } catch (error) {
          attempts.set(key, variant + 1);
          if (!(error instanceof LookRejected)) {
            console.error('Could not check the look:', error);
            throw new Error('This look could not be finished cleanly. Tap Try again.');
          }
        }
      }
      throw new Error('The AI changed more than this item, so the look was not shown. Tap Try again.');
    };
    look = lane.then(run, run);
    lane = look.catch(() => {});
    looks.set(key, look);
    look.catch(() => looks.delete(key));
  }
  return look;
}

/** Dresses the person as described (SDXL Inpainting), keeping face and body. Returns a JPEG data URL. */
export async function dressAsDescribed(personUrl: string, prompt: string, coverage: 'full' | 'clothes' = 'full') {
  return call('/api/dress', { person: await toJpeg(personUrl), prompt, coverage });
}
