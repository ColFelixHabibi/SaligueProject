'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import type { Product } from '@/lib/types';
import { api } from '@/lib/api';
import { useProductStore } from './use-product-store';

interface CartItem extends Product {
  quantity: number;
}
interface CartState {
  // productId -> quantity
  entries: Record<string, number>;
  isInitialized: boolean;
}

export const useCartStore = create<CartState>()(() => ({ entries: {}, isInitialized: false }));

async function setQuantity(id: string, quantity: number) {
  const before = useCartStore.getState().entries;
  const next = { ...before };
  if (quantity > 0) next[id] = quantity;
  else delete next[id];
  useCartStore.setState({ entries: next });
  try {
    await api(`/me/cart/${id}`, { method: 'PUT', body: { quantity } });
  } catch (error) {
    useCartStore.setState({ entries: before });
    throw error;
  }
}

const actions = {
  addToCart: (item: Product) => setQuantity(item.id, Math.min(99, (useCartStore.getState().entries[item.id] ?? 0) + 1)),
  removeFromCart: (id: string) => setQuantity(id, 0),
  updateQuantity: (id: string, quantity: number) => setQuantity(id, Math.max(0, Math.min(99, quantity || 0))),
  clearCart: async () => {
    await api('/me/cart', { method: 'DELETE' });
    useCartStore.setState({ entries: {} });
  },
};

/** Loads the cart of the current account (guests have accounts too). */
export function subscribeToCart(_uid: string) {
  let active = true;
  useCartStore.setState({ isInitialized: false });
  api<Record<string, number>>('/me/cart')
    .then((entries) => active && useCartStore.setState({ entries, isInitialized: true }))
    .catch((error) => {
      console.error('Failed to load cart:', error);
      if (active) useCartStore.setState({ isInitialized: true });
    });
  return () => {
    active = false;
  };
}

export function useCart() {
  const entries = useCartStore((s) => s.entries);
  const isInitialized = useCartStore((s) => s.isInitialized);
  const products = useProductStore((s) => s.products);
  const cartItems = useMemo<CartItem[]>(
    () =>
      Object.entries(entries).flatMap(([id, quantity]) => {
        const product = products.find((p) => p.id === id);
        return product ? [{ ...product, quantity }] : [];
      }),
    [entries, products]
  );
  return { cartItems, isInitialized, ...actions };
}
