'use client';

import { useSyncExternalStore } from 'react';

// Data saver: videos don't start by themselves (they play when tapped), to save mobile data.
const KEY = 'saligue-data-saver';
const listeners = new Set<() => void>();

const read = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

export function setDataSaver(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Storage blocked: the setting lasts until the page closes.
  }
  listeners.forEach((l) => l());
}

export const useDataSaver = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => false
  );
