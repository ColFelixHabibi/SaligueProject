
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
  // Copy of the seller's shop profile (name and full address) when the item was listed or the shop was updated.
  shop?: Shop;
  // Listed by INDECIANA's official account: shown as recommended and opened on INDECIANA's own page.
  official?: boolean;
  // Number of people who liked the item (see use-likes.ts).
  likeCount?: number;
  // The item has a sound (stored in productAudio/{id}, see src/lib/audio.ts).
  sound?: { name: string; duration: number };
};

export type Comment = { id: string; uid: string; name: string; text: string; createdAt?: string | null };

// A seller's shop: shown with every item so buyers know exactly where the shop is.
export type Shop = {
  name: string;
  phone: string;
  whatsapp?: string;
  country: string;
  city: string;
  district?: string;
  street: string;
  landmark?: string;
  mapUrl?: string;
  hours?: string;
};

export function shopAddressLines(shop: Shop): string[] {
  return [
    [shop.street, shop.landmark && `near ${shop.landmark}`].filter(Boolean).join(', '),
    [shop.district, shop.city].filter(Boolean).join(', '),
    shop.country,
  ].filter(Boolean);
}

export function isShopComplete(shop?: Partial<Shop> | null): shop is Shop {
  return !!(shop?.name && shop.phone && shop.country && shop.city && shop.street);
}

export type OrderStatus = 'placed' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
export type PaymentMethod = 'mobile_money' | 'cash_on_delivery' | 'pickup';

export type OrderItem = { productId: string; name: string; price: number; quantity: number };

export type DeliveryAddress = {
  fullName: string;
  phone: string;
  country: string;
  city: string;
  district?: string;
  street: string;
  landmark?: string;
  notes?: string;
};

// One order per seller; a checkout with items from several shops creates several orders.
export type Order = {
  id: string;
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  sellerId: string;
  shop: Shop | null;
  items: OrderItem[];
  total: number;
  delivery: DeliveryAddress;
  paymentMethod: PaymentMethod;
  paymentStatus: 'unpaid' | 'paid';
  status: OrderStatus;
  createdAt?: string | null;
};
