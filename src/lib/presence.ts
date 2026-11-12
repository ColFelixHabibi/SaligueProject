'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { api, getToken } from './api';

// Online status (the green dot on a photo). Every avatar on screen registers its account here, and one request every
// 45 seconds asks the server which of them are online (server/index.mjs, /api/presence: seen in the last 2 minutes).
// That same request keeps this account online while the app is open, so a signed-in person shows as online.

const EVERY_MS = 45_000;
const watched = new Map<string, number>(); // account → how many avatars show it
let online = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;

const emit = () => listeners.forEach((l) => l());

async function poll() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (!getToken()) return;
  const ids = [...watched.keys()].slice(0, 100);
  try {
    const { online: list } = await api<{ online: string[] }>(`/presence?ids=${encodeURIComponent(ids.join(','))}`);
    const next = new Set(list);
    if (next.size !== online.size || [...next].some((id) => !online.has(id))) {
      online = next;
      emit();
    }
  } catch {
    // No connection: keep the dots as they were; the next round tries again.
  }
}

/** Starts the 45-second round once (the heartbeat), and checks again when the app comes back to the screen. */
export function startPresence() {
  if (timer || typeof window === 'undefined') return;
  const loop = () => {
    void poll();
    timer = setTimeout(loop, EVERY_MS);
  };
  loop();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void poll());
}

/** Avatars that appear together are asked about in one request, a moment after they show. */
function soon() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    void poll();
  }, 400);
}

/** True while this account is online. Pass nothing (or a guest) to get false. */
export function useOnline(userId?: string | null) {
  useEffect(() => {
    if (!userId) return;
    startPresence();
    const known = watched.has(userId);
    watched.set(userId, (watched.get(userId) ?? 0) + 1);
    if (!known) soon();
    return () => {
      const n = (watched.get(userId) ?? 1) - 1;
      if (n <= 0) watched.delete(userId);
      else watched.set(userId, n);
    };
  }, [userId]);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => !!userId && online.has(userId),
    () => false,
  );
}
