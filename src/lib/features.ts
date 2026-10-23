'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { api, onServerEvent } from './api';

// Feature switches set in Admin → Features. Off features are hidden here and refused by the server.
let state: Record<string, boolean> = {};
let loaded = false;
const listeners = new Set<() => void>();
const load = () =>
  api<Record<string, boolean>>('/features')
    .then((f) => {
      state = f;
      listeners.forEach((l) => l());
    })
    .catch(() => {});

/** on('live') → false when an admin switched Live off (true until known). */
export function useFeatures() {
  useEffect(() => {
    if (!loaded) {
      loaded = true;
      void load();
      onServerEvent('features', () => void load());
    }
  }, []);
  const f = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state, () => state);
  return (name: string) => f[name] !== false;
}
