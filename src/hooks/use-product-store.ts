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

async function reload() {
  const products = (await api<Product[]>('/products')).map((p) => ({ ...p, image: mediaUrl(p.image), cutout: mediaUrl(p.cutout) }));
  useProductStore.setState({ products, isInitialized: true, error: null });
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
    const { id: _id, sellerId: _sellerId, official: _official, likeCount: _likeCount, shop: _shop, ...fields } = updatedProduct;
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
