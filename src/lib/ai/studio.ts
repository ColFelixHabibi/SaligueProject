'use client';

import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { context2d, createCanvas, fitWithin, loadImage } from './canvas';

// Saligue AI Studio: Saligue's own GPU server (ai-server/) running Leffa and SDXL Inpainting.
// Its address comes from a ?ai= link, this device's saved setting, or config/ai in Firestore (set by INDECIANA).

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
    const config = await getDoc(doc(db, 'config', 'ai'));
    return clean(config.data()?.studioUrl);
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

/** Realistically redraws the garment on the person (Leffa). Returns a JPEG data URL. */
export async function realisticTryOn(personUrl: string, garmentUrl: string, category: string) {
  return call('/api/tryon', { person: await toJpeg(personUrl), garment: await toJpeg(garmentUrl), category });
}

/** Dresses the person as described (SDXL Inpainting), keeping face and body. Returns a JPEG data URL. */
export async function dressAsDescribed(personUrl: string, prompt: string, coverage: 'full' | 'clothes' = 'full') {
  return call('/api/dress', { person: await toJpeg(personUrl), prompt, coverage });
}
