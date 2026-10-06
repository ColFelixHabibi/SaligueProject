
'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import type { Product } from '@/lib/types';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useProductStore } from './use-product-store';

interface WishlistState {
  ids: string[];
  isInitialized: boolean;
}

export const useWishlistStore = create<WishlistState>()(() => ({
  ids: [],
  isInitialized: false,
}));

const wishlistDoc = (uid: string, productId: string) => doc(db, 'users', uid, 'wishlist', productId);

const actions = {
  addToWishlist: async (item: Product) => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('You must be logged in to use the wishlist.');
    await setDoc(wishlistDoc(uid, item.id), { addedAt: serverTimestamp() });
  },
  removeFromWishlist: async (id: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteDoc(wishlistDoc(uid, id));
  },
};

// Keeps the wishlist in sync with the signed-in user's saved items. Returns an unsubscribe function.
export function subscribeToWishlist(uid: string | null) {
  if (!uid) {
    useWishlistStore.setState({ ids: [], isInitialized: true });
    return () => {};
  }
  useWishlistStore.setState({ isInitialized: false });
  return onSnapshot(
    collection(db, 'users', uid, 'wishlist'),
    (snapshot) => {
      useWishlistStore.setState({ ids: snapshot.docs.map((d) => d.id), isInitialized: true });
    },
    (error) => {
      console.error('Failed to load wishlist:', error);
      useWishlistStore.setState({ isInitialized: true });
    }
  );
}

export function useWishlist() {
  const ids = useWishlistStore((s) => s.ids);
  const isInitialized = useWishlistStore((s) => s.isInitialized);
  const products = useProductStore((s) => s.products);

  const wishlistItems = useMemo(
    () => products.filter((p) => ids.includes(p.id) && p.status !== 'archived'),
    [ids, products]
  );

  return { wishlistItems, isInitialized, ...actions };
}
