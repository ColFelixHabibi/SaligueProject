
export type Product = {
  id: string;
  name: string;
  price: number;
  // Original photo as uploaded by the seller (JPEG data URL).
  image: string;
  // The item with its background removed (transparent WebP/PNG data URL), used for dressing.
  cutout?: string;
  // MobileCLIP embedding of the cut-out, used for AI search.
  embedding?: number[];
  // One of CATEGORIES in src/lib/categories.ts (older listings may hold other text).
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
