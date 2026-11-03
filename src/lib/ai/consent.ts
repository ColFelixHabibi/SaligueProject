'use client';

import { ask } from '@/components/confirm-dialog';

// The Fitting Room only takes photos of the person using it. Asked once per device, before the first photo
// (or before the first realistic try-on for photos added before this was asked). The server refuses a realistic
// try-on without it (server/index.mjs, POST /api/ai/tryon).
const KEY = 'saligue-tryon-consent-v1';

export function hasTryOnConsent() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

/** True once the person confirmed the photo is of them; asks the first time. */
export async function ensureTryOnConsent(): Promise<boolean> {
  if (hasTryOnConsent()) return true;
  const ok = await ask({
    title: 'Only a photo of you',
    description:
      'Use a photo of yourself only, never of someone else, and no photos of children. Your photo stays on this device. To show clothes realistically, it is sent to the try-on AI, which uses it only to make your picture. Saligue deletes that picture within 24 hours. You can remove your photo at any time.',
    confirm: 'This is me, continue',
  });
  if (!ok) return false;
  try {
    localStorage.setItem(KEY, new Date().toISOString());
  } catch {
    // Storage blocked: asked again next time.
  }
  return true;
}
