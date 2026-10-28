'use client';

import { create } from 'zustand';
import type { Product } from '@/lib/types';
import { api, mediaUrl, onServerEvent } from '@/lib/api';

interface ProductState {
  products: Product[];
  isInitialized: boolean;
  error: string | null;
  addProduct: (item: Omit<Product, 'id'>) => Promise<string>;
  updateProduct: (id: string, updatedProduct: Product) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  archiveProduct: (id: string) => Promise<void>;
}

// The AI fingerprints come apart from the catalogue (small, cached by the browser until items change) and are
// added to the items when they arrive: "looks like", search and outfits use them; the feed shows before.
let fingerprints = new Map<string, number[]>();
let fingerprintsLoading: Promise<void> | null = null;
function withFingerprints(products: Product[]) {
  return fingerprints.size ? products.map((p) => (fingerprints.has(p.id) ? { ...p, embedding: fingerprints.get(p.id) } : p)) : products;
}
function loadFingerprints() {
  fingerprintsLoading ??= api<Record<string, string>>('/products/fingerprints')
    .then((all) => {
      fingerprints = new Map(Object.entries(all).map(([id, b64]) => [id, Array.from(new Int8Array(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer))]));
      useProductStore.setState((s) => ({ products: withFingerprints(s.products) }));
    })
    .catch(() => {})
    .finally(() => { fingerprintsLoading = null; });
  return fingerprintsLoading;
}

async function reload() {
  const products = (await api<Product[]>('/products')).map((p) => ({ ...p, image: mediaUrl(p.image), cutout: mediaUrl(p.cutout), sellerAvatar: mediaUrl(p.sellerAvatar), video: mediaUrl(p.video), videoPoster: mediaUrl(p.videoPoster) }));
  useProductStore.setState({ products: withFingerprints(products), isInitialized: true, error: null });
  void loadFingerprints();
}

export const useProductStore = create<ProductState>()(() => ({
  products: [],
  isInitialized: false,
  error: null,
  addProduct: async (item) => {
    const { id } = await api<{ id: string }>('/products', { body: item });
    await reload();
    return id;
  },
  updateProduct: async (id, updatedProduct) => {
    // id, seller, official and likeCount are managed by the server.
    const { id: _id, sellerId: _sellerId, official: _official, likeCount: _likeCount, shop: _shop, sellerAvatar: _avatar, rating: _rating, ratingCount: _ratingCount, video: _video, videoPoster: _poster, videoDuration: _duration, sold: _sold, sample: _sample, ...fields } = updatedProduct;
    // The fingerprint from the catalogue is a rounded copy: only a new photo's fingerprint is sent.
    if (fields.embedding && fields.embedding === useProductStore.getState().products.find((p) => p.id === id)?.embedding) delete fields.embedding;
    await api(`/products/${id}`, { method: 'PATCH', body: fields });
    await reload();
  },
  deleteProduct: async (id) => {
    await api(`/products/${id}`, { method: 'DELETE' });
    await reload();
  },
  archiveProduct: async (id) => {
    await api(`/products/${id}`, { method: 'PATCH', body: { status: 'archived' } });
    await reload();
  },
}));

/** Loads the catalog and keeps it up to date while the app is open. */
export function subscribeToProducts() {
  const load = () =>
    reload().catch((error) => {
      console.error('Failed to load products:', error);
      useProductStore.setState({ isInitialized: true, error: error.message });
    });
  void load();
  return onServerEvent('products', () => void load());
}

export function retryProducts() {
  useProductStore.setState({ isInitialized: false, error: null });
  void reload().catch((error) => useProductStore.setState({ isInitialized: true, error: error.message }));
}
