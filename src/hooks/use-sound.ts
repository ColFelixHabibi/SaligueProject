'use client';

import { create } from 'zustand';

// Whether item sounds play aloud, like TikTok: on by default. Browsers only allow sound after the
// visitor's first tap, so until then sounds play muted and the first tap anywhere turns them up.
interface SoundState {
  soundOn: boolean;
  // False until the browser allows sound (after the first tap or key press).
  unlocked: boolean;
  toggle: () => void;
}

const KEY = 'saligue-sound-off';
// When the browser started allowing sound (the visitor's first tap).
let unlockedAt = 0;

function savedSoundOn() {
  try {
    return localStorage.getItem(KEY) !== '1';
  } catch {
    return true;
  }
}

export const useSoundStore = create<SoundState>()((set, get) => ({
  soundOn: true,
  unlocked: false,
  toggle: () => {
    // The tap that unlocked sound (e.g. on "Tap for sound") turns it on, not off.
    if (get().soundOn && Date.now() - unlockedAt < 800) return;
    const soundOn = !get().soundOn;
    set({ soundOn, unlocked: true });
    try {
      localStorage.setItem(KEY, soundOn ? '0' : '1');
    } catch {
      // Not remembered.
    }
  },
}));

if (typeof window !== 'undefined') {
  // After the page has rendered, so the first render matches the prerendered HTML.
  setTimeout(() => useSoundStore.setState({ soundOn: savedSoundOn() }), 0);
  const unlock = () => {
    unlockedAt = Date.now();
    useSoundStore.setState({ unlocked: true });
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

/** Whether sounds should be heard right now. */
export const useAudible = () => useSoundStore((s) => s.soundOn && s.unlocked);
