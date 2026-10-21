import FASHION_TYPES from './fashion-types.json';


// What kind of item a product is. Decides where it is placed on the body when dressing.
// `short` is the one-word name used under category pictures on phones.
export const CATEGORIES = [
  { value: 'top', label: 'Tops & Shirts', short: 'Tops' },
  { value: 'outerwear', label: 'Jackets & Coats', short: 'Jackets' },
  { value: 'dress', label: 'Dresses', short: 'Dresses' },
  { value: 'bottom', label: 'Trousers & Skirts', short: 'Bottoms' },
  { value: 'shoes', label: 'Shoes', short: 'Shoes' },
  { value: 'hat', label: 'Hats & Caps', short: 'Hats' },
  { value: 'eyewear', label: 'Glasses', short: 'Glasses' },
  { value: 'bag', label: 'Bags', short: 'Bags' },
  { value: 'accessory', label: 'Other Accessories', short: 'More' },
] as const;

export type Category = (typeof CATEGORIES)[number]['value'];

export function categoryLabel(value: string) {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function isCategory(value: string): value is Category {
  return CATEGORIES.some((c) => c.value === value);
}

// The exact type of each kind of item (shared with the server, which refuses anything else).
export const TYPES = FASHION_TYPES as Record<Category, string[]>;

export function typesOf(category: string): string[] {
  return isCategory(category) ? TYPES[category] : [];
}

