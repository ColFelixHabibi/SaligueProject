'use client';

import { create } from 'zustand';
import type { Product } from '@/lib/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useUserRoleStore } from './use-user-role-store';

interface ProductState {
  products: Product[];
  isInitialized: boolean;
  error: string | null;
  addProduct: (item: Omit<Product, 'id'>) => Promise<string>;
  updateProduct: (id: string, updatedProduct: Product) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  archiveProduct: (id: string) => Promise<void>;
}

function fromRow(row: any): Product {
  const { seller_id, seller_email, created_at, like_count, ...fields } = row;
  return { ...fields, sellerId: seller_id, sellerEmail: seller_email, createdAt: created_at, likeCount: like_count } as Product;
}

function toRow(product: Partial<Product>) {
  const { id: _id, sellerId, sellerEmail, createdAt, likeCount, ...fields } = product;
  return {
    ...fields,
    ...(sellerId !== undefined ? { seller_id: sellerId } : {}),
    ...(sellerEmail !== undefined ? { seller_email: sellerEmail } : {}),
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    ...(likeCount !== undefined ? { like_count: likeCount } : {}),
  };
}

export const useProductStore = create<ProductState>()(() => ({
  products: [],
  isInitialized: false,
  error: null,
  addProduct: async (item) => {
    if (!isSupabaseConfigured) throw new Error('Add your Supabase URL and anon key to .env.local first.');
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('You must be logged in to list a product.');
    const { shop, official } = useUserRoleStore.getState();
    const { data, error } = await supabase.from('products')
      .insert(toRow({ ...item, shop: shop ?? undefined, official, sellerId: user.id, status: 'active' }))
      .select('id').single();
    if (error) throw error;
    return data.id;
  },
  updateProduct: async (id, updatedProduct) => {
    const { id: _id, sellerId: _sellerId, official: _official, likeCount: _likeCount, ...fields } = updatedProduct;
    const { error } = await supabase.from('products').update(toRow(fields)).eq('id', id);
    if (error) throw error;
  },
  deleteProduct: async (id) => {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw error;
  },
  archiveProduct: async (id) => {
    const { error } = await supabase.from('products').update({ status: 'archived' }).eq('id', id);
    if (error) throw error;
  },
}));

let stopProductSubscription: (() => void) | null = null;

export function subscribeToProducts() {
  let active = true;
  const load = async () => {
    if (!isSupabaseConfigured) {
      useProductStore.setState({ isInitialized: true, error: 'Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.' });
      return;
    }
    const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: false });
    if (!active) return;
    if (error) {
      console.error('Failed to load products:', error);
      useProductStore.setState({ isInitialized: true, error: error.message });
      return;
    }
    useProductStore.setState({ products: (data ?? []).map(fromRow), isInitialized: true, error: null });
  };

  void load();
  const channel = isSupabaseConfigured
    ? supabase.channel(`products-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => { void load(); })
      .subscribe()
    : null;
  const stop = () => {
    active = false;
    if (channel) void supabase.removeChannel(channel);
    if (stopProductSubscription === stop) stopProductSubscription = null;
  };
  stopProductSubscription = stop;
  return () => stopProductSubscription?.();
}

export function retryProducts() {
  stopProductSubscription?.();
  useProductStore.setState({ isInitialized: false, error: null });
  subscribeToProducts();
}
