import type { Product } from './types';
import { cosine } from './ai/embed';

// Every Nth slot in the feed goes to an INDECIANA item when available.
const OFFICIAL_EVERY = 4;
// No more than this many items of the same kind in a row, so the feed stays varied.
const MAX_SAME_IN_ROW = 2;

function ageInDays(product: Product) {
  const created = product.createdAt ? Date.parse(product.createdAt) : NaN;
  return Number.isFinite(created) ? (Date.now() - created) / 86_400_000 : 30;
}

// A small, stable-per-day shuffle, so the feed changes from day to day but not while scrolling.
function dailyNoise(id: string) {
  const day = new Date().toISOString().slice(0, 10);
  let h = 2166136261;
  for (const c of `${day}:${id}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export type TasteSignals = {
  liked: Set<string>;
  saved: Set<string>;
  // Items in the bag and items bought.
  cart?: Set<string>;
  bought?: Set<string>;
  // Learned on the device (taste.ts): opened, watched, tried on, messaged about; negative for quick skips.
  interest?: Map<string, number>;
};

/** How much each item tells us about the shopper's taste. */
function weights(products: Product[], s: TasteSignals) {
  const w = new Map<string, number>();
  const add = (id: string, v: number) => w.set(id, (w.get(id) ?? 0) + v);
  s.liked.forEach((id) => add(id, 3));
  s.saved.forEach((id) => add(id, 3));
  s.cart?.forEach((id) => add(id, 3));
  s.bought?.forEach((id) => add(id, 5));
  s.interest?.forEach((v, id) => add(id, v));
  const known = new Set(products.map((p) => p.id));
  for (const id of [...w.keys()]) if (!known.has(id)) w.delete(id);
  return w;
}

/**
 * "For You" order, personal to each shopper:
 * - looks like what they liked, saved, bought, tried on or watched (AI image similarity to their taste),
 * - the kinds of items, brands, colours and price range they go for,
 * - plus fresh and popular items, a little daily variety, and new discoveries when we know little yet.
 * Items they already bought are left out; liked and saved ones come after new discoveries.
 */
export function forYou(products: Product[], liked: Set<string>, saved: Set<string>, more: Omit<TasteSignals, 'liked' | 'saved'> = {}): Product[] {
  const signals: TasteSignals = { liked, saved, ...more };
  const active = products.filter((p) => p.status === 'active' && !signals.bought?.has(p.id));
  const byId = new Map(products.map((p) => [p.id, p]));
  const w = weights(products, signals);
  const positive = [...w].filter(([, v]) => v > 0.3).map(([id, v]) => ({ p: byId.get(id)!, v }));
  const negative = [...w].filter(([, v]) => v < 0).map(([id, v]) => ({ p: byId.get(id)!, v }));
  const strength = positive.reduce((n, x) => n + x.v, 0);
  // 0 for a brand-new visitor, close to 1 once we've seen enough of their taste.
  const confidence = Math.min(1, strength / 12);

  // Taste fingerprint: the weighted average look of what they like.
  const dims = positive.find((x) => x.p.embedding?.length)?.p.embedding?.length ?? 0;
  const centroid = dims ? new Array<number>(dims).fill(0) : null;
  if (centroid) for (const { p, v } of positive) if (p.embedding?.length === dims) p.embedding.forEach((x, i) => (centroid[i] += x * v));

  // Preferences for kinds of items, brands and colours, and the usual price.
  const share = (key: (p: Product) => string | undefined) => {
    const m = new Map<string, number>();
    for (const { p, v } of positive) {
      const k = key(p)?.toLowerCase();
      if (k) m.set(k, (m.get(k) ?? 0) + v);
    }
    return (p: Product) => (strength ? (m.get(key(p)?.toLowerCase() ?? '') ?? 0) / strength : 0);
  };
  const category = share((p) => p.category);
  const type = share((p) => p.type);
  const brand = share((p) => p.brand);
  const color = share((p) => p.color);
  const prices = positive.map((x) => Number(x.p.price)).filter((n) => n > 0).sort((a, b) => a - b);
  const usualPrice = prices.length ? prices[Math.floor(prices.length / 2)] : 0;

  const score = (p: Product) => {
    let taste = 0;
    if (p.embedding?.length && centroid) {
      const toCentroid = cosine(centroid, p.embedding);
      const toClosest = Math.max(...positive.filter((x) => x.p.embedding?.length && x.p.id !== p.id).map((x) => cosine(x.p.embedding!, p.embedding!)), 0);
      taste = 0.6 * toCentroid + 0.4 * toClosest;
    }
    const dislike = negative.length && p.embedding?.length
      ? Math.max(0, ...negative.filter((x) => x.p.embedding?.length).map((x) => cosine(x.p.embedding!, p.embedding!))) * 0.3
      : 0;
    const affinity = category(p) * 0.5 + type(p) * 0.4 + brand(p) * 0.3 + color(p) * 0.2;
    const priceFit = usualPrice ? Math.exp(-Math.abs(Math.log((Number(p.price) || usualPrice) / usualPrice))) * 0.15 : 0;
    const freshness = Math.exp(-ageInDays(p) / 14);
    const popularity = Math.log1p(p.likeCount ?? 0) / 5 + (p.ratingCount ? ((p.rating ?? 0) / 5) * 0.15 : 0);
    const soldOut = p.stock === 0 ? 0.6 : 0;
    // Already liked or saved: still shown, but after new discoveries.
    const seen = liked.has(p.id) || saved.has(p.id) || (signals.interest?.get(p.id) ?? 0) > 2 ? 0.35 : 0;
    return confidence * (taste + affinity + priceFit - dislike)
      + (1 - confidence * 0.6) * (freshness * 0.4 + popularity)
      + dailyNoise(p.id) * (0.25 - confidence * 0.15)
      - seen - soldOut;
  };

  const ranked = active.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s).map((r) => r.p);

  // Keep it varied: never more than MAX_SAME_IN_ROW of one kind in a row.
  const varied: Product[] = [];
  const pool = [...ranked];
  while (pool.length) {
    const recent = varied.slice(-MAX_SAME_IN_ROW).map((p) => p.category);
    const tooMany = recent.length === MAX_SAME_IN_ROW && recent.every((c) => c === recent[0]);
    const i = tooMany ? Math.max(0, pool.findIndex((p) => p.category !== recent[0])) : 0;
    varied.push(pool.splice(i, 1)[0]);
  }

  const official = varied.filter((p) => p.official);
  const others = varied.filter((p) => !p.official);
  if (!official.length) return others;
  const feed: Product[] = [];
  while (official.length || others.length) {
    if (official.length && (feed.length % OFFICIAL_EVERY === 1 || !others.length)) feed.push(official.shift()!);
    else if (others.length) feed.push(others.shift()!);
  }
  return feed;
}

/** Items that look most like this one (for "more like this" right after a like). */
export function similarTo(product: Product, products: Product[], count: number, exclude: Set<string>): Product[] {
  if (!product.embedding?.length) return products.filter((p) => p.status === 'active' && p.category === product.category && !exclude.has(p.id)).slice(0, count);
  return products
    .filter((p) => p.status === 'active' && p.id !== product.id && !exclude.has(p.id) && p.embedding?.length)
    .map((p) => ({ p, s: cosine(product.embedding!, p.embedding!) + (p.category === product.category ? 0.05 : 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, count)
    .map((x) => x.p);
}
