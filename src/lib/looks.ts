'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { api, mediaUrl } from './api';

// Looks: a person's named boards ("Wedding", "Office") of items and lessons. Only for people with an account.
export type LookPiece = { kind: 'product' | 'lesson'; id: string };
export type Look = { id: string; name: string; ownerId: string; ownerName: string; count: number; covers: string[]; items: LookPiece[]; updatedAt: string | null; auto?: boolean };

const withMedia = (l: Look): Look => ({ ...l, covers: l.covers.map((c) => mediaUrl(c) ?? c) });

let mine: Look[] | null = null;
let loading = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (next: Look[]) => {
  mine = next;
  emit();
};

export function reloadLooks() {
  loading = true;
  return api<Look[]>('/looks')
    .then((list) => set(list.map(withMedia)))
    .catch(() => set(mine ?? []))
    .finally(() => (loading = false));
}

/** My looks (null while loading). */
export function useMyLooks(enabled = true) {
  useEffect(() => {
    if (enabled && mine === null && !loading) void reloadLooks();
  }, [enabled]);
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => mine, () => mine);
}

export const getLook = (id: string) => api<Look>(`/looks/${id}`).then(withMedia);

export async function createLook(name: string) {
  const look = withMedia(await api<Look>('/looks', { body: { name } }));
  set([look, ...(mine ?? [])]);
  return look;
}

export async function renameLook(id: string, name: string) {
  const look = withMedia(await api<Look>(`/looks/${id}`, { method: 'PATCH', body: { name } }));
  set((mine ?? []).map((l) => (l.id === id ? look : l)));
  return look;
}

export async function deleteLook(id: string) {
  await api(`/looks/${id}`, { method: 'DELETE' });
  set((mine ?? []).filter((l) => l.id !== id));
}

/** Puts a piece in a look, or takes it out if it is already there. */
/** Takes an item out of the automatic "Added to cart" collection. */
export async function removeFromCartLook(productId: string) {
  const look = withMedia(await api<Look>(`/looks/cart/items/${productId}`, { method: 'DELETE' }));
  set((mine ?? []).map((l) => (l.id === 'cart' ? look : l)).filter((l) => l.id !== 'cart' || l.count > 0));
  return look;
}

export async function togglePiece(lookId: string, piece: LookPiece) {
  const r = await api<{ added: boolean; look: Look }>(`/looks/${lookId}/items`, { body: piece });
  const look = withMedia(r.look);
  set([look, ...(mine ?? []).filter((l) => l.id !== lookId)]);
  return r.added;
}

export const inLook = (look: Look, piece: LookPiece) => look.items.some((i) => i.kind === piece.kind && i.id === piece.id);
