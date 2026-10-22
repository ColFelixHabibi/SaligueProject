
'use client';

import { create } from 'zustand';
import type { Point } from '@/lib/ai/pose';
import { encodeCanvas } from '@/lib/ai/canvas';

// The shopper's own photo with the background removed, kept on this device only.
interface MirrorState {
  personUrl: string | null;
  // The photo as taken (with its background). The realistic try-on works on this one, so nothing the
  // background removal blurred (an outstretched arm, a bracelet) is lost.
  photoUrl: string | null;
  // Body landmarks with x/y as fractions of the image size, so they survive resizing.
  landmarks: Point[] | null;
  isLoaded: boolean;
  // Restores the photo saved on this device; call from an effect (after hydration).
  restore: () => void;
  setPerson: (canvas: HTMLCanvasElement, landmarks: Point[] | null, original?: HTMLCanvasElement) => void;
  clear: () => void;
}

const STORAGE_KEY = 'saligue-mirror-v1';

function load(): Pick<MirrorState, 'personUrl' | 'photoUrl' | 'landmarks'> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    // Photos saved before are shown as taken (their old cut-out could have holes).
    if (saved?.personUrl) return { personUrl: saved.photoUrl ?? saved.personUrl, photoUrl: saved.photoUrl ?? null, landmarks: saved.landmarks ?? null };
  } catch {
    // Nothing saved or storage unavailable.
  }
  return { personUrl: null, photoUrl: null, landmarks: null };
}

export const useMirrorStore = create<MirrorState>()((set, get) => ({
  personUrl: null,
  photoUrl: null,
  landmarks: null,
  isLoaded: false,
  restore: () => {
    if (!get().isLoaded) set({ ...load(), isLoaded: true });
  },
  setPerson: (canvas, landmarks, original) => {
    const personUrl = canvas === original ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png');
    const photoUrl = original ? original.toDataURL('image/jpeg', 0.92) : null;
    const normalized = landmarks?.map((p) => ({ x: p.x / canvas.width, y: p.y / canvas.height, visibility: p.visibility })) ?? null;
    set({ personUrl, photoUrl, landmarks: normalized, isLoaded: true });
    try {
      // A smaller copy is enough to restore the photo on the next visit.
      const compact = encodeCanvas(canvas, { transparent: canvas !== original, maxLength: 2_000_000, maxEdge: 1400 });
      const photo = original ? encodeCanvas(original, { transparent: false, maxLength: 1_000_000, maxEdge: 1400 }) : null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ personUrl: compact, photoUrl: photo, landmarks: normalized }));
    } catch {
      // Too big or storage unavailable: the photo just won't be remembered after closing the app.
    }
  },
  clear: () => {
    set({ personUrl: null, photoUrl: null, landmarks: null });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore.
    }
  },
}));
