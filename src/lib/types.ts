
export type Product = {
  id: string;
  name: string;
  price: number;
  image: string;
  category: string;
  seller: string;
  sellerId?: string;
  sellerEmail?: string;
  status: 'active' | 'archived' | 'draft';
  description?: string;
  size?: string;
  color?: string;
  brand?: string;
  condition?: string;
  contact?: string;
  createdAt?: string;
};

// Product details sent to the AI flows. Images are left out to keep requests small.
export type CatalogItem = Pick<Product, 'id' | 'name' | 'price' | 'category' | 'seller'> &
  Partial<Pick<Product, 'description' | 'size' | 'color' | 'brand' | 'condition'>>;

export function toCatalog(products: Product[]): CatalogItem[] {
  return products
    .filter((p) => p.status === 'active')
    .map(({ id, name, price, category, seller, description, size, color, brand, condition }) => ({
      id, name, price, category, seller, description, size, color, brand, condition,
    }));
}
