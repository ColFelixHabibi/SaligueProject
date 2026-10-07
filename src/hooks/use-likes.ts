
'use client';

import { create } from 'zustand';
import { collectionGroup, doc, increment, onSnapshot, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

// Likes are public (a count on each product); Saves are the private wishlist (see use-wishlist.ts).
// A like is products/{productId}/likes/{uid} plus the product's likeCount, written together.

interface LikesState {
  liked: Set<string>;
}

export const useLikesStore = create<LikesState>()(() => ({ liked: new Set() }));

export function subscribeToLikes(uid: string | null) {
  if (!uid) {
    useLikesStore.setState({ liked: new Set() });
    return () => {};
  }
  return onSnapshot(
    query(collectionGroup(db, 'likes'), where('uid', '==', uid)),
    (snapshot) => {
      useLikesStore.setState({ liked: new Set(snapshot.docs.map((d) => d.ref.parent.parent!.id)) });
    },
    (error) => console.error('Failed to load likes:', error)
  );
}

export async function toggleLike(productId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Please wait a moment and try again.');
  const wasLiked = useLikesStore.getState().liked.has(productId);
  const likeRef = doc(db, 'products', productId, 'likes', uid);
  const productRef = doc(db, 'products', productId);

  // Update the screen right away; the live listener corrects it if the write fails.
  const next = new Set(useLikesStore.getState().liked);
  if (wasLiked) next.delete(productId);
  else next.add(productId);
  useLikesStore.setState({ liked: next });

  const batch = writeBatch(db);
  if (wasLiked) batch.delete(likeRef);
  else batch.set(likeRef, { uid, createdAt: serverTimestamp() });
  batch.update(productRef, { likeCount: increment(wasLiked ? -1 : 1) });
  try {
    await batch.commit();
  } catch (error) {
    const undo = new Set(useLikesStore.getState().liked);
    if (wasLiked) undo.add(productId);
    else undo.delete(productId);
    useLikesStore.setState({ liked: undo });
    throw error;
  }
}

export function useLiked(productId: string) {
  return useLikesStore((s) => s.liked.has(productId));
}
