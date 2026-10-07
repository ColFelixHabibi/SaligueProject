import type { Product } from './types';
import { cosine } from './ai/embed';

// Every Nth slot in the feed goes to an INDECIANA item when available.
const OFFICIAL_EVERY = 4;

function ageInDays(product: Product) {
  const created = product.createdAt ? Date.parse(product.createdAt) : NaN;
  return Number.isFinite(created) ? (Date.now() - created) / 86_400_000 : 30;
}

/**
 * "For You" order: items that look like what the user liked or saved (AI image similarity),
 * fresh items, and popular items rank higher. INDECIANA items are recommended regularly.
 */
export function forYou(products: Product[], liked: Set<string>, saved: Set<string>): Product[] {
  const active = products.filter((p) => p.status === 'active');
  const taste = active.filter((p) => (liked.has(p.id) || saved.has(p.id)) && p.embedding?.length).map((p) => p.embedding!);

  const score = (p: Product) => {
    const freshness = Math.exp(-ageInDays(p) / 14);
    const popularity = Math.log1p(p.likeCount ?? 0) / 5;
    const similarity = taste.length && p.embedding?.length ? Math.max(...taste.map((t) => cosine(t, p.embedding!))) : 0;
    // Already liked or saved: still shown, but after new discoveries.
    const seen = liked.has(p.id) || saved.has(p.id) ? 0.5 : 0;
    return similarity + freshness * 0.4 + popularity - seen;
  };

  const ranked = active.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s).map((r) => r.p);
  const official = ranked.filter((p) => p.official);
  const others = ranked.filter((p) => !p.official);
  if (!official.length) return others;

  const feed: Product[] = [];
  while (official.length || others.length) {
    if (official.length && (feed.length % OFFICIAL_EVERY === 1 || !others.length)) feed.push(official.shift()!);
    else if (others.length) feed.push(others.shift()!);
  }
  return feed;
}
