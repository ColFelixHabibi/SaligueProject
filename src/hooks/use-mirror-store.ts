
'use client';

import { create } from 'zustand';
import type { Point } from '@/lib/ai/pose';
import { encodeCanvas } from '@/lib/ai/canvas';

// The shopper's own photo with the background removed, kept on this device only.
interface MirrorState {
  personUrl: string | null;
  // Body landmarks with x/y as fractions of the image size, so they survive resizing.
  landmarks: Point[] | null;
  isLoaded: boolean;
  // Restores the photo saved on this device; call from an effect (after hydration).
  restore: () => void;
  setPerson: (canvas: HTMLCanvasElement, landmarks: Point[] | null) => void;
  clear: () => void;
}

const STORAGE_KEY = 'saligue-mirror-v1';

function load(): Pick<MirrorState, 'personUrl' | 'landmarks'> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved?.personUrl) return { personUrl: saved.personUrl, landmarks: saved.landmarks ?? null };
  } catch {
    // Nothing saved or storage unavailable.
  }
  return { personUrl: null, landmarks: null };
}

export const useMirrorStore = create<MirrorState>()((set, get) => ({
  personUrl: null,
  landmarks: null,
  isLoaded: false,
  restore: () => {
    if (!get().isLoaded) set({ ...load(), isLoaded: true });
  },
  setPerson: (canvas, landmarks) => {
    const personUrl = canvas.toDataURL('image/png');
    const normalized = landmarks?.map((p) => ({ x: p.x / canvas.width, y: p.y / canvas.height, visibility: p.visibility })) ?? null;
    set({ personUrl, landmarks: normalized, isLoaded: true });
    try {
      // A smaller copy is enough to restore the photo on the next visit.
      const compact = encodeCanvas(canvas, { transparent: true, maxLength: 2_500_000, maxEdge: 1400 });
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ personUrl: compact, landmarks: normalized }));
    } catch {
      // Too big or storage unavailable: the photo just won't be remembered after closing the app.
    }
  },
  clear: () => {
    set({ personUrl: null, landmarks: null });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore.
    }
  },
}));
