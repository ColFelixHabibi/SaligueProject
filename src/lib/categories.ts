
// What kind of item a product is. Decides where it is placed on the body when dressing.
export const CATEGORIES = [
  { value: 'top', label: 'Tops & Shirts' },
  { value: 'outerwear', label: 'Jackets & Coats' },
  { value: 'dress', label: 'Dresses' },
  { value: 'bottom', label: 'Trousers & Skirts' },
  { value: 'shoes', label: 'Shoes' },
  { value: 'hat', label: 'Hats & Caps' },
  { value: 'eyewear', label: 'Glasses' },
  { value: 'bag', label: 'Bags' },
  { value: 'accessory', label: 'Other Accessories' },
] as const;

export type Category = (typeof CATEGORIES)[number]['value'];

export function categoryLabel(value: string) {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function isCategory(value: string): value is Category {
  return CATEGORIES.some((c) => c.value === value);
}
