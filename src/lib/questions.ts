'use client';

import { useEffect, useState } from 'react';
import { api, mediaUrl, onServerEvent } from './api';

export type ShopQuestion = { id: string; uid: string; name: string; avatar: string | null; text: string; answer: string | null; answeredAt: string | null; createdAt: string; productId: string; productName: string; productImage: string | null };

/** The shop's questions across its items (null while loading); refreshes when one arrives or is answered. */
export function useShopQuestions(enabled = true) {
  const [list, setList] = useState<ShopQuestion[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const load = () => api<ShopQuestion[]>('/seller/questions')
      .then((l) => setList(l.map((q) => ({ ...q, avatar: mediaUrl(q.avatar ?? undefined) ?? null, productImage: mediaUrl(q.productImage ?? undefined) ?? null }))))
      .catch(() => setList([]));
    void load();
    return onServerEvent('questions', () => void load());
  }, [enabled]);
  return list;
}
