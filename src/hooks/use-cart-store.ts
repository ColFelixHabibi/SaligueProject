
'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import type { Product } from '@/lib/types';
import { collection, deleteDoc, doc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useProductStore } from './use-product-store';

interface CartItem extends Product {
  quantity: number;
}

interface CartState {
  // productId -> quantity
  entries: Record<string, number>;
  uid: string | null;
  isInitialized: boolean;
}

// Carts of signed-out visitors live in this browser until they log in.
const ANONYMOUS_CART_KEY = 'cart-anonymous';

function loadAnonymousCart(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(ANONYMOUS_CART_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveAnonymousCart(entries: Record<string, number>) {
  try {
    localStorage.setItem(ANONYMOUS_CART_KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable (private mode); the cart just won't survive a reload.
  }
}

export const useCartStore = create<CartState>()(() => ({
  entries: {},
  uid: null,
  isInitialized: false,
}));

const cartDoc = (uid: string, productId: string) => doc(db, 'users', uid, 'cart', productId);

async function setQuantity(id: string, quantity: number) {
  const { uid, entries } = useCartStore.getState();
  if (uid) {
    if (quantity > 0) await setDoc(cartDoc(uid, id), { quantity });
    else await deleteDoc(cartDoc(uid, id));
    return;
  }
  const next = { ...entries };
  if (quantity > 0) next[id] = quantity;
  else delete next[id];
  useCartStore.setState({ entries: next });
  saveAnonymousCart(next);
}

const actions = {
  addToCart: (item: Product) => setQuantity(item.id, (useCartStore.getState().entries[item.id] ?? 0) + 1),
  removeFromCart: (id: string) => setQuantity(id, 0),
  updateQuantity: (id: string, quantity: number) => setQuantity(id, Math.max(0, quantity)),
  clearCart: async () => {
    const { uid, entries } = useCartStore.getState();
    if (uid) {
      const batch = writeBatch(db);
      Object.keys(entries).forEach((id) => batch.delete(cartDoc(uid, id)));
      await batch.commit();
    } else {
      useCartStore.setState({ entries: {} });
      saveAnonymousCart({});
    }
  },
};

// Points the cart at the signed-in user's saved cart (or this browser's cart when signed out).
// Returns an unsubscribe function.
export function subscribeToCart(uid: string | null) {
  if (!uid) {
    useCartStore.setState({ uid: null, entries: loadAnonymousCart(), isInitialized: true });
    return () => {};
  }

  useCartStore.setState({ uid, isInitialized: false });

  // Move anything added while signed out into the account.
  const anonymous = loadAnonymousCart();
  if (Object.keys(anonymous).length > 0) {
    const batch = writeBatch(db);
    Object.entries(anonymous).forEach(([id, quantity]) => batch.set(cartDoc(uid, id), { quantity }));
    batch
      .commit()
      .then(() => saveAnonymousCart({}))
      .catch((error) => console.error('Failed to merge cart:', error));
  }

  return onSnapshot(
    collection(db, 'users', uid, 'cart'),
    (snapshot) => {
      const entries: Record<string, number> = {};
      snapshot.forEach((d) => {
        entries[d.id] = d.data().quantity ?? 1;
      });
      useCartStore.setState({ entries, isInitialized: true });
    },
    (error) => {
      console.error('Failed to load cart:', error);
      useCartStore.setState({ isInitialized: true });
    }
  );
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
