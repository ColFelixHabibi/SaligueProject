
'use client';

import { create } from 'zustand';
import type { Product } from '@/lib/types';
import { persist, createJSONStorage } from 'zustand/middleware';

interface CartItem extends Product {
  quantity: number;
}

interface CartState {
  cartItems: CartItem[];
  isInitialized: boolean;
  addToCart: (item: Product) => void;
  removeFromCart: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
}

const getStorageKey = (uid?: string) => {
    return uid ? `cart-storage-${uid}` : 'cart-storage-anonymous';
}

export const useCart = create(
  persist<CartState>(
    (set) => ({
      cartItems: [],
      isInitialized: false,
      addToCart: (item) =>
        set((state) => {
          const existingItem = state.cartItems.find((cartItem) => cartItem.id === item.id);
          if (existingItem) {
            return {
              cartItems: state.cartItems.map((cartItem) =>
                cartItem.id === item.id
                  ? { ...cartItem, quantity: cartItem.quantity + 1 }
                  : cartItem
              ),
            };
          } else {
            return {
              cartItems: [...state.cartItems, { ...item, quantity: 1 }],
            };
          }
        }),
      removeFromCart: (id) =>
        set((state) => ({
          cartItems: state.cartItems.filter((item) => item.id !== id),
        })),
      updateQuantity: (id, quantity) =>
        set((state) => ({
          cartItems: state.cartItems.map((item) =>
            item.id === id ? { ...item, quantity: Math.max(0, quantity) } : item
          ).filter(item => item.quantity > 0),
        })),
      clearCart: () => set({ cartItems: [] }),
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
