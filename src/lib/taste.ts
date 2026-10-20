'use client';

// What this shopper shows interest in, learned from what they do (kept on this device):
// opening an item, watching it in the feed, trying it on, adding it to the bag, messaging the shop.
// Likes, saves and orders come from the server; together they drive the For You feed (recommend.ts).

export type Signal = 'view' | 'dwell' | 'wear' | 'cart' | 'message' | 'skip';

const WEIGHTS: Record<Signal, number> = { view: 1, dwell: 0.6, wear: 2.5, cart: 3, message: 3, skip: -0.4 };
const KEY = 'saligue-taste-v1';
// Interest fades: a signal from three weeks ago counts about a third.
const HALF_LIFE_DAYS = 14;
const MAX_ITEMS = 400;

type Stored = Record<string, { w: number; t: number }>;

function load(): Stored {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function decayed(entry: { w: number; t: number }, now = Date.now()) {
  return entry.w * Math.pow(0.5, (now - entry.t) / (HALF_LIFE_DAYS * 86_400_000));
}

/** Notes that the shopper did something with an item. */
export function noteInterest(productId: string, signal: Signal, times = 1) {
  if (typeof window === 'undefined' || !productId) return;
  const data = load();
  const now = Date.now();
  const current = data[productId] ? decayed(data[productId], now) : 0;
  // Capped, so one item can't take over the whole feed.
  data[productId] = { w: Math.max(-2, Math.min(12, current + WEIGHTS[signal] * times)), t: now };
  const keys = Object.keys(data);
  if (keys.length > MAX_ITEMS) {
    keys.sort((a, b) => Math.abs(decayed(data[a], now)) - Math.abs(decayed(data[b], now))).slice(0, keys.length - MAX_ITEMS).forEach((k) => delete data[k]);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked: the feed still uses likes and saves.
  }
}

/** Current interest per item (after fading). */
export function interests(): Map<string, number> {
  const now = Date.now();
  return new Map(Object.entries(load()).map(([id, e]) => [id, decayed(e, now)]));
}
