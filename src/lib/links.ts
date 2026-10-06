import type { Product } from './types';

/**
 * Where tapping a product goes. INDECIANA's own items always open INDECIANA's store page;
 * everything else opens the regular product page.
 */
export function productHref(product: Pick<Product, 'id' | 'official'>) {
  return product.official ? `/indeciana?item=${product.id}` : `/product?id=${product.id}`;
}
