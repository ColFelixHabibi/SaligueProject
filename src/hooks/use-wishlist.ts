
'use client';

import { create } from 'zustand';
import type { Product } from '@/lib/types';
import { persist, createJSONStorage } from 'zustand/middleware';

interface WishlistState {
  wishlistItems: Product[];
  isInitialized: boolean;
  addToWishlist: (item: Product) => void;
  removeFromWishlist: (id: string) => void;
}

const getStorageKey = (uid?: string) => {
    return uid ? `wishlist-storage-${uid}` : 'wishlist-storage-anonymous';
}


export const useWishlist = create(
  persist<WishlistState>(
    (set) => ({
      wishlistItems: [],
      isInitialized: false,
      addToWishlist: (item) =>
        set((state) => ({
          wishlistItems: [...state.wishlistItems, item],
        })),
      removeFromWishlist: (id) =>
        set((state) => ({
          wishlistItems: state.wishlistItems.filter((item) => item.id !== id),
        })),
    }),
    {
      name: getStorageKey(),
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isInitialized = true;
        }
      },
    }
  )
);
