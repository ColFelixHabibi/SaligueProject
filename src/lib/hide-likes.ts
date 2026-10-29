'use client';

import { useSyncExternalStore } from 'react';

// Hide like counts: hearts still work, but nobody's numbers are shown to you (less comparing, more taste).
// Shops and teachers still see their own numbers in their dashboards. Kept on this device.
const KEY = 'saligue-hide-likes';
const listeners = new Set<() => void>();

const read = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

export function setHideLikes(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Storage blocked: the setting lasts until the page closes.
  }
  listeners.forEach((l) => l());
}

export const useHideLikes = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => false
  );
