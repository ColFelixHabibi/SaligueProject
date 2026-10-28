'use client';

// What this shopper shows interest in, learned from what they do: opening an item, watching it in the feed,
// trying it on, adding it to the bag, messaging the shop, sharing, skipping quickly.
// Kept on this device and sent to Saligue's server (server/recommend.mjs), which learns from everyone's behaviour.
// Nothing is recorded when the shopper chose "Essential only" in the cookie banner.
import { api, getToken } from './api';

export type Signal = 'view' | 'dwell' | 'wear' | 'cart' | 'message' | 'skip' | 'share' | 'less';

const WEIGHTS: Record<Signal, number> = { view: 1, dwell: 0.6, wear: 2.5, cart: 3, message: 3, skip: -0.4, share: 2, less: -4 };
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

/** Whether the shopper allowed personalisation (cookie banner). Until they choose, nothing is sent. */
function allowed() {
  try {
    return JSON.parse(localStorage.getItem('saligue-cookie-choice') || 'null')?.choice === 'accepted';
  } catch {
    return false;
  }
}

// Sent in small batches, and when the app goes to the background.
let queue: { productId: string; kind: Signal; times: number }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
function flush(leaving = false) {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!queue.length) return;
  const events = queue.splice(0, 100);
  if (leaving) {
    const token = getToken();
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/interactions`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ events }),
    }).catch(() => {});
  } else {
    api('/interactions', { body: { events } }).catch(() => {});
  }
}
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush(true));
}

/** Notes that the shopper did something with an item. */
export function noteInterest(productId: string, signal: Signal, times = 1) {
  if (typeof window === 'undefined' || !productId || !allowed()) return;
  queue.push({ productId, kind: signal, times });
  if (!timer) timer = setTimeout(() => flush(), 4000);
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

/** Notes what the shopper searched for: items like it come up in their For You. */
export function noteSearch(q: string) {
  if (typeof window === 'undefined' || q.trim().length < 2 || !allowed() || !getToken()) return;
  api('/searches', { body: { q: q.trim() } }).catch(() => {});
}

/** Current interest per item (after fading). */
export function interests(): Map<string, number> {
  const now = Date.now();
  return new Map(Object.entries(load()).map(([id, e]) => [id, decayed(e, now)]));
}
