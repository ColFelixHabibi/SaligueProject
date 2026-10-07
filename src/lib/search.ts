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
    .filter((r) => r.score === 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((r) => r.p);
}

// Words people use for each kind of item.
const TYPE_WORDS: Record<string, string[]> = {
  top: ['top', 'tops', 'shirt', 'shirts', 't-shirt', 'tshirt', 'blouse', 'tank', 'tee', 'sweater', 'hoodie', 'polo', 'vest'],
  outerwear: ['jacket', 'jackets', 'coat', 'coats', 'blazer', 'parka', 'cardigan'],
  dress: ['dress', 'dresses', 'gown', 'kitenge', 'robe'],
  bottom: ['trousers', 'pants', 'jeans', 'skirt', 'skirts', 'shorts', 'leggings', 'joggers'],
  shoes: ['shoes', 'shoe', 'sneakers', 'sneaker', 'trainers', 'boots', 'heels', 'sandals', 'loafers', 'slippers'],
  hat: ['hat', 'hats', 'cap', 'caps', 'beanie'],
  eyewear: ['glasses', 'sunglasses', 'eyewear', 'shades'],
  bag: ['bag', 'bags', 'handbag', 'backpack', 'purse', 'clutch'],
  accessory: ['watch', 'belt', 'necklace', 'bracelet', 'earrings', 'scarf', 'tie'],
};
const COLORS = ['black', 'white', 'red', 'blue', 'navy', 'green', 'yellow', 'pink', 'purple', 'orange', 'brown', 'beige', 'grey', 'gray', 'gold', 'silver', 'cream'];
const SIZE_PATTERN = /\b(?:size\s*)?(xxs|xs|s|m|l|xl|xxl|xxxl|\d{2}(?:\.\d)?)\b/i;
const FILLER = new Set(['size', 'by', 'from', 'in', 'a', 'an', 'the', 'for', 'with', 'and', 'or', 'i', 'want', 'need', 'looking', 'some', 'me', 'my', 'of', 'please', 'color', 'colour', 'brand', 'type']);

export type ParsedDescription = { category?: string; size?: string; color?: string; brand?: string };

/** Understands a free-text description like "size M blue jeans by Levi's". */
export function parseDescription(text: string, products: Product[]): ParsedDescription {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-z0-9.'-]+/).filter(Boolean);
  const parsed: ParsedDescription = {};
  for (const [category, list] of Object.entries(TYPE_WORDS)) {
    if (words.some((w) => list.includes(w))) {
      parsed.category = category;
      break;
    }
  }
  const size = lower.match(SIZE_PATTERN)?.[1];
  // A lone "s"/"m"/"l" only counts as a size when the word "size" is there, to avoid matching articles.
  if (size && (size.length > 1 || /\bsize\b/.test(lower))) parsed.size = size.toUpperCase();
  parsed.color = COLORS.find((c) => words.includes(c));
  const brands = [...new Set(products.map((p) => p.brand?.trim()).filter(Boolean) as string[])];
  parsed.brand = brands.find((b) => lower.includes(b.toLowerCase()));
  return parsed;
}

const sameSize = (productSize: string | undefined, wanted: string) =>
  !!productSize && productSize.toUpperCase().split(/[\s,/]+/).includes(wanted);

/**
 * Search from a description: type, size and brand narrow the choice, then the AI ranks
 * the remaining items by how well they look like the whole description.
 */
export async function describeSearch(products: Product[], text: string, onProgress?: Progress): Promise<{ results: Product[]; parsed: ParsedDescription }> {
  const parsed = parseDescription(text, products);
  let pool = products.filter((p) => p.status === 'active');
  if (parsed.category) pool = pool.filter((p) => p.category === parsed.category);
  if (parsed.size) pool = pool.filter((p) => sameSize(p.size, parsed.size!));
  if (parsed.brand) pool = pool.filter((p) => p.brand?.toLowerCase() === parsed.brand!.toLowerCase());
  if (parsed.color) {
    const colored = pool.filter((p) => p.color?.toLowerCase().includes(parsed.color!));
    if (colored.length) pool = colored;
  }
  if (!pool.length) return { results: [], parsed };

  const narrowed = !!(parsed.category || parsed.size || parsed.brand);
  const meaningful = text.toLowerCase().split(/\s+/).filter((w) => w.length > 1 && !FILLER.has(w)).join(' ');
  const textEmbedding = meaningful ? await embedText(meaningful, onProgress) : null;
  const scored = pool.map((p) => ({ p, visual: textEmbedding && p.embedding?.length ? cosine(textEmbedding, p.embedding) : 0 }));
  const best = Math.max(0, ...scored.map((s) => s.visual));
  // When the description already narrowed things down (type/size/brand), keep all of those, best first.
  const floor = narrowed ? -Infinity : Math.max(0.2, best - 0.06);
  return {
    results: scored.filter((s) => s.visual >= floor).sort((a, b) => b.visual - a.visual).slice(0, MAX_RESULTS).map((s) => s.p),
    parsed,
  };
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

  // Keep strong visual matches (relative to the best one, above an absolute floor so unrelated
  // items never appear), plus items matching every word of the query.
  const best = Math.max(0, ...scored.map((s) => s.visual));
  const visualFloor = query.imageEmbedding ? Math.max(0.55, best - 0.15) : Math.max(0.2, best - 0.05);
  return scored
    .filter((s) => s.keywords === 1 || (s.visual > 0 && s.visual >= visualFloor))
    .sort((a, b) => b.visual + b.keywords * 0.1 - (a.visual + a.keywords * 0.1))
    .slice(0, MAX_RESULTS)
    .map((s) => s.p);
}
