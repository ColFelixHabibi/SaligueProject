
'use client';

import { create } from 'zustand';
import type { Product } from '@/lib/types';
import { persist, createJSONStorage } from 'zustand/middleware';

interface ProductState {
  products: Product[];
  isInitialized: boolean;
  addProduct: (item: Product) => void;
  updateProduct: (id: string, updatedProduct: Product) => void;
  deleteProduct: (id: string) => void;
  archiveProduct: (id: string) => void;
}

const storageKey = 'product-storage-global';

export const useProductStore = create(
  persist<ProductState>(
    (set) => ({
      products: [], 
      isInitialized: false,
      addProduct: (item) =>
        set((state) => ({
          products: [{ ...item, status: 'active' }, ...state.products],
        })),
      updateProduct: (id, updatedProduct) =>
        set((state) => ({
          products: state.products.map((product) =>
            product.id === id ? updatedProduct : product
          ),
        })),
      deleteProduct: (id) =>
        set((state) => ({
          products: state.products.filter((product) => product.id !== id),
        })),
      archiveProduct: (id) =>
        set((state) => ({
            products: state.products.map((product) =>
                product.id === id ? { ...product, status: 'archived' } : product
            ),
        })),
    }),
    {
      name: storageKey,
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isInitialized = true;
        }
      },
    }
  )
);
