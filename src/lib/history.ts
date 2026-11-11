'use client';

// Everything this person saw or scrolled past, kept in one list they can go back through (My Saligue → History).
// The list lives on the server (server/index.mjs → view_history): one row per item and person, so it stays short,
// anything can be taken out on its own, and the whole list can be cleared in one go. A visitor who is not signed in
// keeps no list at all (there is no account to keep it for).
import { useEffect, useSyncExternalStore } from 'react';
import { api, apiUrl, getToken, mediaUrl } from './api';
import type { Product } from './types';

/** One item in the list: the item as the feed shows it, with when it was last on screen and how often. */
export type SeenItem = Product & { seenAt: string; times: number };

// Files come from the server ("/media/…"): made whole here, so the photos also load inside the phone app.
const withMedia = (p: SeenItem): SeenItem => ({ ...p, image: mediaUrl(p.image), cutout: mediaUrl(p.cutout), sellerAvatar: mediaUrl(p.sellerAvatar), video: mediaUrl(p.video), videoPoster: mediaUrl(p.videoPoster) });

// One list for the whole app: opening History shows what was just watched, and taking something out of it removes
// it here at once.
let list: SeenItem[] | null = null;
const listeners = new Set<() => void>();
const set = (next: SeenItem[]) => {
  list = next;
  listeners.forEach((l) => l());
};

let inflight: Promise<SeenItem[]> | null = null;
/** Loads the list from the server (one request at a time; a failure keeps what is already on screen). */
export function reloadHistory(): Promise<SeenItem[]> {
  if (!getToken()) {
    set([]);
    return Promise.resolve([]);
  }
  inflight ??= api<SeenItem[]>('/history')
    .then((rows) => {
      const next = rows.map(withMedia);
      set(next);
      return next;
    })
    .catch(() => list ?? [])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The list (null while it is loading for the first time). Pass false when the caller loads it itself. */
export function useHistory(autoLoad = true): SeenItem[] | null {
  useEffect(() => {
    if (autoLoad && list === null) void reloadHistory();
  }, [autoLoad]);
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => list, () => list);
}

/** Takes one item out of the list. Throws if the server did not: the item then stays where the person sees it. */
export async function forgetSeen(productId: string) {
  await api(`/history/${encodeURIComponent(productId)}`, { method: 'DELETE' });
  set((list ?? []).filter((p) => p.id !== productId));
}

/** Clears the whole list. */
export async function clearHistory() {
  await api('/history', { method: 'DELETE' });
  set([]);
}

// What came on screen is sent in small batches, and once more when the app goes to the background, so the list is
// there next time without a request for every swipe.
const MAX_BATCH = 50;
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(leaving = false): Promise<unknown> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!queue.length) return Promise.resolve();
  const events = queue.splice(0, MAX_BATCH).map((productId) => ({ productId }));
  if (leaving) {
    // The tab is closing: send it on its way without waiting for an answer.
    const token = getToken();
    fetch(apiUrl('/history'), {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ events }),
    }).catch(() => {});
    return Promise.resolve();
  }
  return api('/history', { body: { events } }).catch(() => {});
}
/** Sends what was just seen right away (before the list is opened, so it is in it). */
export const sendHistoryNow = () => flush();
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush(true));
}

/**
 * Notes that an item came on screen. `times` counts watching the same one again (the list keeps one entry per
 * item, with how often it was seen). Nothing is kept for a visitor who is not signed in.
 */
export function noteSeen(productId: string, times = 1) {
  if (typeof window === 'undefined' || !productId || !getToken()) return;
  // Bounded, so one very long watch cannot fill the queue on its own.
  for (let i = 0; i < Math.max(1, Math.min(5, Math.round(times))); i += 1) queue.push(productId);
  if (!timer) timer = setTimeout(() => void flush(), 4000);
}
