'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, mediaUrl, onServerEvent } from './api';
import { friendlyError } from './errors';

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
  // Watch again after the live: ready when the recording is saved.
  replay?: { video: string; poster: string | null; duration: number | null; startedAt?: string } | null;
  replayStatus?: 'recording' | 'processing' | 'ready' | 'none' | null;
  // How people on camera share the screen, and who records the replay (the server, or the host's phone).
  layout?: 'side' | 'grid';
  recorder?: 'server' | 'phone';
  // Live-only deals running now, by item.
  deals?: Record<string, { price: number; was: number; until: string }>;
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
/** An item the host held up during the live, with the places shoppers have claimed. */
export type LiveDrop = {
  id: string;
  productId: string;
  name: string;
  image: string | null;
  price: number;
  was: number;
  slots: number;
  claimed: number;
  // Places left and the item still sellable: the claim button is only useful then.
  open: boolean;
  // My place, while it lasts.
  mine: { claimId: string; expiresAt: string } | null;
  // Places taken, in order; paid once the shopper ordered it (that place stays taken).
  claimers: { name: string; paid?: boolean }[];
  at: string;
};
export type Burst = { id: number; emoji: string; x: number };

export const withMedia = (l: Live): Live => ({
  ...l,
  sellerAvatar: mediaUrl(l.sellerAvatar ?? undefined) ?? null,
  thumbnail: mediaUrl(l.thumbnail ?? undefined) ?? null,
  replay: l.replay ? { ...l.replay, video: mediaUrl(l.replay.video) ?? l.replay.video, poster: mediaUrl(l.replay.poster ?? undefined) ?? null } : null,
});

type LivesData = { enabled: boolean; lives: Live[]; recent: Live[]; error: string | null };
type LivesState = LivesData & { reload: () => void };

// Who is live is the same list for everyone, and the header, the sidebar, the feed and the Live pages all ask
// for it at once. It lives here once, so a page load makes one request instead of one per component.
const FRESH_MS = 30_000;

let state: LivesState | null = null;
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;
let subscribed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function fetchLives(): Promise<void> {
  // Several parts of the page ask together: they all wait on the one request already on its way.
  if (inFlight) return inFlight;
  inFlight = api<{ enabled: boolean; lives: Live[]; recent?: Live[] }>('/lives')
    .then((d) => {
      state = { enabled: d.enabled, lives: d.lives.map(withMedia), recent: (d.recent ?? []).map(withMedia), error: null, reload: reloadLives };
      fetchedAt = Date.now();
    })
    // No connection: keep what is on screen (never blank the list) and say what went wrong. Not cached as
    // fresh, so the next page opened tries again on its own.
    .catch((e) => {
      state = { enabled: state?.enabled ?? false, lives: state?.lives ?? [], recent: state?.recent ?? [], error: friendlyError(e), reload: reloadLives };
      fetchedAt = 0;
    })
    .then(() => {
      inFlight = null;
      emit();
    });
  return inFlight;
}

/** Ask the server again now — the "Try again" button after a failed refresh. */
export function reloadLives() {
  void fetchLives();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Lives happening now, kept up to date. Fetched once for the whole app; a failed refresh says so and keeps the lives already shown. */
export function useLives() {
  useEffect(() => {
    if (!subscribed) {
      // One subscription for the whole app: a live starting, or ending, refreshes it everywhere.
      subscribed = true;
      onServerEvent('lives', () => void fetchLives());
      onServerEvent('live', (d: { type?: string }) => d?.type === 'ended' && void fetchLives());
    }
    // A page opened long after the list was fetched shows it at once, then refreshes behind the scenes.
    if (!state || Date.now() - fetchedAt > FRESH_MS) void fetchLives();
  }, []);
  return useSyncExternalStore(subscribe, () => state, () => state);
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
