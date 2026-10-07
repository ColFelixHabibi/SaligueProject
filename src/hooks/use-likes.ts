'use client';

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

interface LikesState { liked: Set<string>; isInitialized: boolean }
export const useLikesStore = create<LikesState>()(() => ({ liked: new Set(), isInitialized: false }));

export function subscribeToLikes(uid: string | null) {
  if (!uid) {
    useLikesStore.setState({ liked: new Set(), isInitialized: true });
    return () => {};
  }
  let active = true;
  useLikesStore.setState({ liked: new Set(), isInitialized: false });
  const load = async () => {
    const { data, error } = await supabase.from('product_likes').select('product_id').eq('user_id', uid);
    if (!active) return;
    if (error) {
      console.error('Failed to load likes:', error);
      useLikesStore.setState({ isInitialized: true });
      return;
    }
    useLikesStore.setState({ liked: new Set((data ?? []).map((row) => row.product_id)), isInitialized: true });
  };
  void load();
  const channel = supabase.channel(`likes-${uid}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'product_likes', filter: `user_id=eq.${uid}` }, () => { void load(); })
    .subscribe();
  return () => { active = false; void supabase.removeChannel(channel); };
}

export async function toggleLike(productId: string) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Please wait a moment and try again.');
  const wasLiked = useLikesStore.getState().liked.has(productId);
  const next = new Set(useLikesStore.getState().liked);
  if (wasLiked) next.delete(productId); else next.add(productId);
  useLikesStore.setState({ liked: next });
  const result = wasLiked
    ? await supabase.from('product_likes').delete().eq('product_id', productId).eq('user_id', user.id)
    : await supabase.from('product_likes').insert({ product_id: productId, user_id: user.id });
  if (result.error) {
    const undo = new Set(useLikesStore.getState().liked);
    if (wasLiked) undo.add(productId); else undo.delete(productId);
    useLikesStore.setState({ liked: undo });
    throw result.error;
  }
}

export function useLiked(productId: string) {
  return useLikesStore((s) => s.liked.has(productId));
}
