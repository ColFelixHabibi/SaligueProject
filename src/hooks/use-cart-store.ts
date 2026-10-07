'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import type { Product } from '@/lib/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useProductStore } from './use-product-store';

interface CartItem extends Product { quantity: number }
interface CartState {
  entries: Record<string, number>;
  uid: string | null;
  isInitialized: boolean;
}

const ANONYMOUS_CART_KEY = 'cart-anonymous';
function loadAnonymousCart(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(ANONYMOUS_CART_KEY) || '{}'); } catch { return {}; }
}
function saveAnonymousCart(entries: Record<string, number>) {
  try { localStorage.setItem(ANONYMOUS_CART_KEY, JSON.stringify(entries)); } catch { /* Storage unavailable. */ }
}

export const useCartStore = create<CartState>()(() => ({ entries: {}, uid: null, isInitialized: false }));

async function setQuantity(id: string, quantity: number) {
  const { uid, entries } = useCartStore.getState();
  if (uid) {
    if (quantity > 0) {
      const { error } = await supabase.from('cart_items').upsert({ user_id: uid, product_id: id, quantity }, { onConflict: 'user_id,product_id' });
      if (error) throw error;
    } else {
      const { error } = await supabase.from('cart_items').delete().eq('user_id', uid).eq('product_id', id);
      if (error) throw error;
    }
    return;
  }
  const next = { ...entries };
  if (quantity > 0) next[id] = quantity; else delete next[id];
  useCartStore.setState({ entries: next });
  saveAnonymousCart(next);
}

const actions = {
  addToCart: (item: Product) => setQuantity(item.id, (useCartStore.getState().entries[item.id] ?? 0) + 1),
  removeFromCart: (id: string) => setQuantity(id, 0),
  updateQuantity: (id: string, quantity: number) => setQuantity(id, Math.max(0, Math.min(99, quantity))),
  clearCart: async () => {
    const { uid, entries } = useCartStore.getState();
    if (uid) {
      const ids = Object.keys(entries);
      if (!ids.length) return;
      const { error } = await supabase.from('cart_items').delete().eq('user_id', uid).in('product_id', ids);
      if (error) throw error;
    } else {
      useCartStore.setState({ entries: {} });
      saveAnonymousCart({});
    }
  },
};

export function subscribeToCart(uid: string | null) {
  if (!uid) {
    useCartStore.setState({ uid: null, entries: loadAnonymousCart(), isInitialized: true });
    return () => {};
  }

  let active = true;
  useCartStore.setState({ uid, isInitialized: false });
  const anonymous = loadAnonymousCart();
  if (Object.keys(anonymous).length) {
    void supabase.from('cart_items')
      .upsert(Object.entries(anonymous).map(([product_id, quantity]) => ({ user_id: uid, product_id, quantity })), { onConflict: 'user_id,product_id' })
      .then(({ error }) => {
        if (!error) saveAnonymousCart({});
        else console.error('Failed to merge cart:', error);
      });
  }

  const load = async () => {
    const { data, error } = await supabase.from('cart_items').select('product_id,quantity').eq('user_id', uid);
    if (!active) return;
    if (error) { console.error('Failed to load cart:', error); useCartStore.setState({ isInitialized: true }); return; }
    const entries: Record<string, number> = {};
    for (const row of data ?? []) entries[row.product_id] = row.quantity;
    useCartStore.setState({ entries, isInitialized: true });
  };
  void load();
  const channel = supabase.channel(`cart-${uid}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cart_items', filter: `user_id=eq.${uid}` }, () => { void load(); })
    .subscribe();
  return () => { active = false; void supabase.removeChannel(channel); };
}

export function useCart() {
  const entries = useCartStore((s) => s.entries);
  const isInitialized = useCartStore((s) => s.isInitialized);
  const products = useProductStore((s) => s.products);
  const cartItems = useMemo<CartItem[]>(
    () => Object.entries(entries).flatMap(([id, quantity]) => {
      const product = products.find((p) => p.id === id);
      return product ? [{ ...product, quantity }] : [];
    }), [entries, products]
  );
  return { cartItems, isInitialized, ...actions };
}
