'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import type { Product } from '@/lib/types';
import { api } from '@/lib/api';
import { useProductStore } from './use-product-store';

// Saves are private (the wishlist); likes are public counts (use-likes.ts).
interface WishlistState {
  ids: string[];
  isInitialized: boolean;
}
export const useWishlistStore = create<WishlistState>()(() => ({ ids: [], isInitialized: false }));

async function change(id: string, saved: boolean) {
  const before = useWishlistStore.getState().ids;
  useWishlistStore.setState({ ids: saved ? [id, ...before.filter((x) => x !== id)] : before.filter((x) => x !== id) });
  try {
    await api(`/me/wishlist/${id}`, { method: saved ? 'PUT' : 'DELETE' });
  } catch (error) {
    useWishlistStore.setState({ ids: before });
    throw error;
  }
}

const actions = {
  addToWishlist: (item: Product) => change(item.id, true),
  removeFromWishlist: (id: string) => change(id, false),
};

export function subscribeToWishlist(_uid: string) {
  let active = true;
  useWishlistStore.setState({ ids: [], isInitialized: false });
  api<string[]>('/me/wishlist')
    .then((ids) => active && useWishlistStore.setState({ ids, isInitialized: true }))
    .catch((error) => {
      console.error('Failed to load saved items:', error);
      if (active) useWishlistStore.setState({ isInitialized: true });
    });
  return () => {
    active = false;
  };
}

export function useWishlist() {
  const ids = useWishlistStore((s) => s.ids);
  const isInitialized = useWishlistStore((s) => s.isInitialized);
  const products = useProductStore((s) => s.products);
  const wishlistItems = useMemo(() => products.filter((p) => ids.includes(p.id) && p.status !== 'archived'), [ids, products]);
  return { wishlistItems, isInitialized, ...actions };
}
