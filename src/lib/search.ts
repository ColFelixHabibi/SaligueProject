'use client';

import type { Product } from './types';
import { categoryLabel } from './categories';
import { cosine, embedText } from './ai/embed';
import type { Progress } from './ai/models';

export type SearchQuery = {
  text?: string;
  // Embedding of a photo the shopper uploaded (from embedImage).
  imageEmbedding?: number[];
  category?: string;
};

const MAX_RESULTS = 24;

function keywordScore(product: Product, words: string[]) {
  const haystack = [
    product.name, product.description, product.brand, product.color,
    product.size, product.condition, product.category, categoryLabel(product.category),
  ].join(' ').toLowerCase();
  return words.filter((w) => haystack.includes(w)).length / words.length;
}

/** Instant keyword search, used while the AI model loads and as a fallback. */
export function keywordSearch(products: Product[], query: SearchQuery): Product[] {
  const pool = products.filter((p) => p.status === 'active' && (!query.category || p.category === query.category));
  const words = (query.text ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return pool.slice(0, MAX_RESULTS);
  return pool
    .map((p) => ({ p, score: keywordScore(p, words) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((r) => r.p);
}

/**
 * AI search over the catalog using on-device MobileCLIP embeddings,
 * blended with keyword matches. Results are best match first.
 */
export async function aiSearch(products: Product[], query: SearchQuery, onProgress?: Progress): Promise<Product[]> {
  const pool = products.filter((p) => p.status === 'active' && (!query.category || p.category === query.category));
  const text = query.text?.trim() ?? '';
  if (!text && !query.imageEmbedding) return pool.slice(0, MAX_RESULTS);

  const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const textEmbedding = text ? await embedText(text, onProgress) : null;

  const scored = pool.map((p) => {
    const keywords = words.length ? keywordScore(p, words) : 0;
    let visual = 0;
    if (p.embedding?.length) {
      if (query.imageEmbedding) visual = cosine(query.imageEmbedding, p.embedding);
      else if (textEmbedding) visual = cosine(textEmbedding, p.embedding);
    }
    return { p, keywords, visual };
  });

  // Keep strong visual matches relative to the best one, plus anything matching the words.
  const best = Math.max(0, ...scored.map((s) => s.visual));
  const visualFloor = query.imageEmbedding ? Math.max(0.55, best - 0.15) : Math.max(0.2, best - 0.05);
  return scored
    .filter((s) => s.keywords > 0 || (s.visual > 0 && s.visual >= visualFloor))
    .sort((a, b) => b.visual + b.keywords * 0.1 - (a.visual + a.keywords * 0.1))
    .slice(0, MAX_RESULTS)
    .map((s) => s.p);
}
