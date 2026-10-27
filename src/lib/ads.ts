'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

// Saligue Ads in the app: sponsored items to show, and their views and clicks (server: /api/ads, ads.mjs).

// Each ad comes with a one-time code (serveId); the server bills a view only for that code, once, after the ad
// was on screen for at least a second.
export type Sponsored = { serveId: string; campaignId: string; productId: string; headline: string };

/** A few sponsored items for this place in the app, picked once per visit. */
export function useSponsored(placement: 'feed' | 'explore', count: number) {
  const [ads, setAds] = useState<Sponsored[]>([]);
  useEffect(() => {
    api<Sponsored[]>(`/ads?placement=${placement}&count=${count}`).then(setAds).catch(() => setAds([]));
  }, [placement, count]);
  return ads;
}

const MIN_VIEW_MS = 1000;
let queue: { serveId: string; kind: 'impression' | 'click'; ms?: number }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const viewed = new Set<string>();
const visibleSince = new Map<string, { at: number; timer: ReturnType<typeof setTimeout> }>();

function send(event: (typeof queue)[number]) {
  queue.push(event);
  if (!timer) {
    timer = setTimeout(() => {
      const events = queue.splice(0);
      timer = null;
      api('/ads/events', { body: { events } }).catch(() => {});
    }, 1500);
  }
}

/**
 * Call when an ad comes on screen (true) or leaves it (false). It counts as a view only after staying on screen
 * a full second; a quick scroll past is not a view.
 */
export function adOnScreen(serveId: string, onScreen: boolean) {
  if (viewed.has(serveId)) return;
  const current = visibleSince.get(serveId);
  if (!onScreen) {
    if (current) clearTimeout(current.timer);
    visibleSince.delete(serveId);
    return;
  }
  if (current) return;
  const at = Date.now();
  visibleSince.set(serveId, {
    at,
    timer: setTimeout(() => {
      visibleSince.delete(serveId);
      viewed.add(serveId);
      send({ serveId, kind: 'impression', ms: Date.now() - at });
    }, MIN_VIEW_MS),
  });
}

/** A tap on the ad (counted once, and only after a real view). */
export function adClicked(serveId: string) {
  send({ serveId, kind: 'click' });
}

/** Places sponsored items into a list: the first after `first` items, then every `every` items. */
export function mixSponsored<T extends { id: string }>(items: T[], sponsored: { item: T; campaignId: string }[], first: number, every: number) {
  const out: (T & { sponsoredBy?: string })[] = [];
  const ads = sponsored.filter((s) => s.item);
  let next = 0;
  items.forEach((item, i) => {
    if (next < ads.length && i === first + next * every) {
      out.push({ ...ads[next].item, sponsoredBy: ads[next].campaignId });
      next++;
    }
    if (!ads.some((a) => a.item.id === item.id)) out.push(item);
  });
  return out;
}
