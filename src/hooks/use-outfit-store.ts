'use client';

import { create } from 'zustand';
import type { Product } from '@/lib/types';
import { outfitSlot } from '@/lib/outfit';

// The outfit the shopper is putting together in the Mirror: one product id per slot, kept on this device.
interface OutfitState {
  // slot (category) -> product id
  slots: Record<string, string>;
  isLoaded: boolean;
  restore: () => void;
  wear: (product: Product) => void;
  takeOff: (slot: string) => void;
  clear: () => void;
}

const STORAGE_KEY = 'saligue-outfit-v1';

// A dress replaces a top and trousers, and the other way round.
const REPLACES: Record<string, string[]> = { dress: ['top', 'bottom'], top: ['dress'], bottom: ['dress'] };

function save(slots: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // Storage unavailable: the outfit just won't be remembered.
  }
}

export const useOutfitStore = create<OutfitState>()((set, get) => ({
  slots: {},
  isLoaded: false,
  restore: () => {
    if (get().isLoaded) return;
    let slots: Record<string, string> = {};
    try {
      slots = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') ?? {};
    } catch {
      // Nothing saved.
    }
    set({ slots, isLoaded: true });
  },
  wear: (product) => {
    const slot = outfitSlot(product);
    const slots = { ...get().slots };
    for (const other of REPLACES[slot] ?? []) delete slots[other];
    slots[slot] = product.id;
    set({ slots });
    save(slots);
  },
  takeOff: (slot) => {
    const slots = { ...get().slots };
    delete slots[slot];
    set({ slots });
    save(slots);
  },
  clear: () => {
    set({ slots: {} });
    save({});
  },
}));
