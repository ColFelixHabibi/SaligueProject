
'use client';

import { create } from 'zustand';

// Whether item sounds play aloud. Browsers only allow sound after the user taps once,
// so it starts off and the speaker button turns it on for the whole visit.
export const useSoundStore = create<{ soundOn: boolean; toggle: () => void }>()((set) => ({
  soundOn: false,
  toggle: () => set((s) => ({ soundOn: !s.soundOn })),
}));
