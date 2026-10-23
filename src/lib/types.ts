
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
  // Exact type within the category, e.g. "Jeans" or "Watch" (see src/lib/fashion-types.json).
  type?: string;
  seller: string;
  sellerId?: string;
  // The seller's profile photo.
  sellerAvatar?: string;
  sellerVerified?: boolean;
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
  // Hidden from shoppers after several reports (only its seller still sees it).
  hidden?: boolean;
  // Number of people who liked the item (see use-likes.ts).
  likeCount?: number;
  // The item has a sound (stored in productAudio/{id}, see src/lib/audio.ts).
  sound?: { name: string; duration: number };
  // Short video (up to 1 min 30 s) and its cover picture; whether the photo shows the item alone or worn.
  video?: string;
  videoPoster?: string;
  videoDuration?: number;
  photoType?: 'item' | 'worn';
  // How many are left; null or undefined when the seller doesn't track stock.
  stock?: number | null;
  // Average star rating (0 when not rated yet) and number of reviews.
  rating?: number;
  ratingCount?: number;
};

export type Review = { id: string; uid: string; name: string; rating: number; text: string; createdAt: string };

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
  // The shop's description, shown as the bio on its profile.
  bio?: string;
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
export type PaymentMethod = 'online' | 'mobile_money' | 'cash_on_delivery' | 'pickup';

export type OrderItem = { productId: string; name: string; price: number; quantity: number; image?: string };

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
  paidAt?: string | null;
  status: OrderStatus;
  createdAt?: string | null;
};

// Direct chat between a buyer and a shop (see src/lib/messages.ts).
export type Conversation = {
  id: string;
  // The current account's side of the conversation.
  role: 'buyer' | 'seller';
  other: { id: string; name: string; official: boolean; isGuest: boolean; avatar: string | null };
  lastMessage: { text: string; fromMe: boolean; productId: string | null; createdAt: string } | null;
  unread: number;
  lastMessageAt: string;
};

export type Message = { id: string; senderId: string; text: string; productId: string | null; orderId: string | null; createdAt: string };
