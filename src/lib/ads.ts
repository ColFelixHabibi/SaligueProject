'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

// Saligue Ads in the app: sponsored items to show, and their views and clicks (server: /api/ads, ads.mjs).

export type Sponsored = { campaignId: string; productId: string; headline: string };

/** A few sponsored items for this place in the app, picked once per visit. */
export function useSponsored(placement: 'feed' | 'explore', count: number) {
  const [ads, setAds] = useState<Sponsored[]>([]);
  useEffect(() => {
    api<Sponsored[]>(`/ads?placement=${placement}&count=${count}`).then(setAds).catch(() => setAds([]));
  }, [placement, count]);
  return ads;
}

// Views and clicks are sent in small batches; each view is counted once per ad per page visit.
let queue: { campaignId: string; kind: 'impression' | 'click' }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const viewed = new Set<string>();

export function trackAd(campaignId: string, kind: 'impression' | 'click') {
  if (kind === 'impression') {
    if (viewed.has(campaignId)) return;
    viewed.add(campaignId);
  }
  queue.push({ campaignId, kind });
  if (!timer) {
    timer = setTimeout(() => {
      const events = queue.splice(0);
      timer = null;
      api('/ads/events', { body: { events } }).catch(() => {});
    }, 2000);
  }
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
