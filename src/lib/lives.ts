'use client';

import { useEffect, useState } from 'react';
import { api, mediaUrl, onServerEvent } from './api';

// Saligue Live, the light part: who is live and the live timer. Kept apart from the video code (live.ts),
// so menus and the feed don't load the video library.

export type Live = {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerAvatar: string | null;
  sellerVerified?: boolean;
  official: boolean;
  title: string;
  description: string;
  status: 'live' | 'ended';
  productIds: string[];
  pinnedProductId: string | null;
  pinnedCommentId: string | null;
  likeCount: number;
  peakViewers: number;
  chatMode: 'everyone' | 'followers' | 'off';
  slowSeconds: number;
  videoFit?: 'fit' | 'fill';
  moderators?: { uid: string; name: string }[];
  // Cover picture for the list of lives.
  thumbnail?: string | null;
  // Hearts the host hopes to reach (0 = none).
  heartGoal?: number;
  poll?: LivePoll | null;
  startedAt: string;
  endedAt: string | null;
};

export type LivePoll = { id: string; question: string; open: boolean; total: number; options: { text: string; votes: number }[] };
export type LiveGift = { id: string; emoji: string; name: string; coins: number };
export type LiveComment = {
  id: string; uid: string; name: string; text: string; kind: 'comment' | 'question' | 'join'; createdAt: string;
  // The comment this one answers, and the gift it announces.
  replyTo?: { id: string; name: string; text: string } | null;
  gift?: LiveGift | null;
};
export type LiveGuest = { uid: string; name: string; status: 'requested' | 'accepted' };
export type Burst = { id: number; emoji: string; x: number };

export const withMedia = (l: Live): Live => ({ ...l, sellerAvatar: mediaUrl(l.sellerAvatar ?? undefined) ?? null, thumbnail: mediaUrl(l.thumbnail ?? undefined) ?? null });

/** Lives happening now, kept up to date. */
export function useLives() {
  const [state, setState] = useState<{ enabled: boolean; lives: Live[]; recent: Live[] } | null>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      api<{ enabled: boolean; lives: Live[]; recent?: Live[] }>('/lives')
        .then((d) => active && setState({ enabled: d.enabled, lives: d.lives.map(withMedia), recent: (d.recent ?? []).map(withMedia) }))
        .catch(() => active && setState({ enabled: false, lives: [], recent: [] }));
    void load();
    const stops = [onServerEvent('lives', () => void load()), onServerEvent('live', (d: { type?: string }) => d?.type === 'ended' && void load())];
    return () => {
      active = false;
      stops.forEach((s) => s());
    };
  }, []);
  return state;
}


/** "12:05" since a start time. */
export function useElapsed(since: string | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return '0:00';
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
