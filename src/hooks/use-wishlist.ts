'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import type { Product } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { useProductStore } from './use-product-store';

interface WishlistState { ids: string[]; isInitialized: boolean }
export const useWishlistStore = create<WishlistState>()(() => ({ ids: [], isInitialized: false }));

const actions = {
  addToWishlist: async (item: Product) => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Please wait for your account to connect, then try again.');
    const { error } = await supabase.from('wishlists').upsert({ user_id: user.id, product_id: item.id }, { onConflict: 'user_id,product_id' });
    if (error) throw error;
  },
  removeFromWishlist: async (id: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('wishlists').delete().eq('user_id', user.id).eq('product_id', id);
    if (error) throw error;
  },
};

export function subscribeToWishlist(uid: string | null) {
  if (!uid) {
    useWishlistStore.setState({ ids: [], isInitialized: true });
    return () => {};
  }
  let active = true;
  useWishlistStore.setState({ ids: [], isInitialized: false });
  const load = async () => {
    const { data, error } = await supabase.from('wishlists').select('product_id').eq('user_id', uid);
    if (!active) return;
    if (error) {
      console.error('Failed to load wishlist:', error);
      useWishlistStore.setState({ isInitialized: true });
      return;
    }
    useWishlistStore.setState({ ids: (data ?? []).map((row) => row.product_id), isInitialized: true });
  };
  void load();
  const channel = supabase.channel(`wishlist-${uid}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'wishlists', filter: `user_id=eq.${uid}` }, () => { void load(); })
    .subscribe();
  return () => { active = false; void supabase.removeChannel(channel); };
}

export function useWishlist() {
  const ids = useWishlistStore((s) => s.ids);
  const isInitialized = useWishlistStore((s) => s.isInitialized);
  const products = useProductStore((s) => s.products);
  const wishlistItems = useMemo(() => products.filter((p) => ids.includes(p.id) && p.status !== 'archived'), [ids, products]);
  return { wishlistItems, isInitialized, ...actions };
}
