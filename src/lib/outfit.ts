import type { Product } from './types';
import { isCategory, type Category } from './categories';
import { cosine } from './ai/embed';

/** Where a product goes in an outfit (older listings with free-text categories count as tops). */
export function outfitSlot(product: Pick<Product, 'category'>): Category {
  return isCategory(product.category) ? product.category : 'top';
}

// What a complete look needs, most important first. With a dress, tops and trousers are not needed.
const ESSENTIALS: Category[] = ['top', 'bottom', 'shoes'];
const EXTRAS: Category[] = ['outerwear', 'bag', 'hat', 'eyewear', 'accessory'];

export function missingSlots(outfit: Product[]): { essential: Category[]; extra: Category[] } {
  const worn = new Set(outfit.map(outfitSlot));
  const hasDress = worn.has('dress');
  return {
    essential: ESSENTIALS.filter((c) => !worn.has(c) && !(hasDress && (c === 'top' || c === 'bottom'))),
    extra: EXTRAS.filter((c) => !worn.has(c)),
  };
}

// Colours that go with anything.
const NEUTRALS = ['black', 'white', 'grey', 'gray', 'beige', 'cream', 'navy', 'brown', 'denim'];
const colorOf = (p: Product) => (p.color ?? '').toLowerCase();

function colorScore(candidate: Product, outfit: Product[]) {
  const c = colorOf(candidate);
  if (!c) return 0;
  if (NEUTRALS.some((n) => c.includes(n))) return 0.15;
  // A second loud colour clashes; repeating the outfit's accent colour matches.
  const accents = outfit.map(colorOf).filter((o) => o && !NEUTRALS.some((n) => o.includes(n)));
  if (!accents.length) return 0.1;
  return accents.some((a) => a.includes(c) || c.includes(a)) ? 0.1 : -0.1;
}

/**
 * Items in stock for one slot, best first: how well they go with the rest of the outfit (AI image
 * similarity of style, colour harmony), popularity, and INDECIANA's own items.
 */
export function rankForSlot(products: Product[], outfit: Product[], category: Category, limit = 12): Product[] {
  // Judge the match against the other pieces, not the item currently in this slot.
  const others = outfit.filter((p) => outfitSlot(p) !== category);
  const style = others.filter((p) => p.embedding?.length).map((p) => p.embedding!);
  const worn = new Set(outfit.map((p) => p.id));
  const score = (p: Product) => {
    const similarity = style.length && p.embedding?.length ? style.reduce((sum, e) => sum + cosine(e, p.embedding!), 0) / style.length : 0;
    return similarity + colorScore(p, others) + Math.log1p(p.likeCount ?? 0) / 8 + (p.official ? 0.1 : 0);
  };
  return products
    .filter((p) => p.status === 'active' && !worn.has(p.id) && outfitSlot(p) === category)
    .map((p) => ({ p, s: score(p) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((r) => r.p);
}

/** Items in stock that complete the outfit, per missing slot (see rankForSlot). */
export function completeTheLook(products: Product[], outfit: Product[], perSlot = 8): { category: Category; items: Product[] }[] {
  const { essential, extra } = missingSlots(outfit);
  return [...essential, ...extra]
    .map((category) => ({ category, items: rankForSlot(products, outfit, category, perSlot) }))
    .filter((row) => row.items.length > 0);
}
