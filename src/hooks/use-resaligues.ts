'use client';

import { create } from 'zustand';
import { api } from '@/lib/api';
import { useProductStore } from './use-product-store';

// Resaligue (repost): the items this account passed on to its followers. Public, like likes.
interface ResaliguesState {
  ids: Set<string>;
}
export const useResaliguesStore = create<ResaliguesState>()(() => ({ ids: new Set() }));

export function subscribeToResaligues(_uid: string) {
  let active = true;
  useResaliguesStore.setState({ ids: new Set() });
  api<string[]>('/me/resaligues')
    .then((ids) => active && useResaliguesStore.setState({ ids: new Set(ids) }))
    .catch(() => {});
  return () => {
    active = false;
  };
}

/** Resaligues the item, or takes it back. Returns whether it is now resaligued. */
export async function toggleResaligue(productId: string) {
  const before = useResaliguesStore.getState().ids;
  const next = new Set(before);
  if (next.has(productId)) next.delete(productId);
  else next.add(productId);
  useResaliguesStore.setState({ ids: next });
  try {
    const { reposted, repostCount } = await api<{ reposted: boolean; repostCount: number }>(`/products/${productId}/resaligue`, { method: 'POST' });
    const confirmed = new Set(useResaliguesStore.getState().ids);
    if (reposted) confirmed.add(productId);
    else confirmed.delete(productId);
    useResaliguesStore.setState({ ids: confirmed });
    useProductStore.setState((s) => ({ products: s.products.map((p) => (p.id === productId ? { ...p, repostCount } : p)) }));
    return reposted;
  } catch (error) {
    useResaliguesStore.setState({ ids: before });
    throw error;
  }
}

export const useResaligued = (productId: string) => useResaliguesStore((s) => s.ids.has(productId));
