'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { api, mediaUrl } from './api';

// People I blocked: their items, lessons and comments are hidden from me (the server also stops messages,
// comments and follows between us).
export type BlockedPerson = { id: string; name: string; avatar: string | null; isShop: boolean };

let list: BlockedPerson[] = [];
let ids = new Set<string>();
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadBlocks() {
  try {
    list = (await api<BlockedPerson[]>('/me/blocks')).map((p) => ({ ...p, avatar: mediaUrl(p.avatar ?? undefined) ?? null }));
  } catch {
    list = [];
  }
  ids = new Set(list.map((p) => p.id));
  loaded = true;
  emit();
}

export async function setBlocked(id: string, blocked: boolean) {
  await api(`/blocks/${id}`, { body: { blocked } });
  await loadBlocks();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The ids I blocked (a Set), loaded once per visit. */
export function useBlockedIds() {
  useEffect(() => {
    if (!loaded) void loadBlocks();
  }, []);
  return useSyncExternalStore(subscribe, () => ids, () => ids);
}

export function useBlockedList() {
  useBlockedIds();
  return useSyncExternalStore(subscribe, () => list, () => list);
}
