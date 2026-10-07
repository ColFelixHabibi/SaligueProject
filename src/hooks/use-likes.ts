'use client';

import { create } from 'zustand';
import { api } from '@/lib/api';
import { useProductStore } from './use-product-store';

// Likes are public (a count on each product); Saves are the private wishlist (see use-wishlist.ts).
interface LikesState {
  liked: Set<string>;
  isInitialized: boolean;
}
export const useLikesStore = create<LikesState>()(() => ({ liked: new Set(), isInitialized: false }));

export function subscribeToLikes(_uid: string) {
  let active = true;
  useLikesStore.setState({ liked: new Set(), isInitialized: false });
  api<string[]>('/me/likes')
    .then((ids) => active && useLikesStore.setState({ liked: new Set(ids), isInitialized: true }))
    .catch((error) => {
      console.error('Failed to load likes:', error);
      if (active) useLikesStore.setState({ isInitialized: true });
    });
  return () => {
    active = false;
  };
}

export async function toggleLike(productId: string) {
  // Update the screen right away; the server's answer confirms it.
  const before = useLikesStore.getState().liked;
  const next = new Set(before);
  if (next.has(productId)) next.delete(productId);
  else next.add(productId);
  useLikesStore.setState({ liked: next });
  try {
    const { liked, likeCount } = await api<{ liked: boolean; likeCount: number }>(`/products/${productId}/like`, { method: 'POST' });
    const confirmed = new Set(useLikesStore.getState().liked);
    if (liked) confirmed.add(productId);
    else confirmed.delete(productId);
    useLikesStore.setState({ liked: confirmed });
    useProductStore.setState((s) => ({ products: s.products.map((p) => (p.id === productId ? { ...p, likeCount } : p)) }));
  } catch (error) {
    useLikesStore.setState({ liked: before });
    throw error;
  }
}

export function useLiked(productId: string) {
  return useLikesStore((s) => s.liked.has(productId));
}
