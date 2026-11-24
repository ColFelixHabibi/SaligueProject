'use client';

import { useSyncExternalStore } from 'react';

// Live choices kept on this device, like "Hide like counts": whether lives appear as full cards in For You (with a
// silent moving preview), and whether a live may suggest a gift after you have watched a while. Both start on.
export type LivePref = 'liveInFeed' | 'giftNudge';
const KEYS: Record<LivePref, string> = { liveInFeed: 'saligue-live-in-feed', giftNudge: 'saligue-gift-nudge' };
const listeners = new Set<() => void>();

const read = (pref: LivePref) => {
  try {
    return localStorage.getItem(KEYS[pref]) !== '0';
  } catch {
    return true;
  }
};

export function setLivePref(pref: LivePref, on: boolean) {
  try {
    localStorage.setItem(KEYS[pref], on ? '1' : '0');
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
  listeners.forEach((l) => l());
}

export const useLivePref = (pref: LivePref) =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => read(pref),
    () => true
  );
