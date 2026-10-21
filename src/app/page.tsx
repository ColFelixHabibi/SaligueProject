
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { PlusCircle, Radio } from 'lucide-react';
import { useLives } from '@/lib/lives';
import { SellerAvatar } from '@/components/seller-avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FeedSlide } from '@/components/social/feed-slide';
import { retryProducts, useProductStore } from '@/hooks/use-product-store';
import { useLikesStore } from '@/hooks/use-likes';
import { useWishlistStore } from '@/hooks/use-wishlist';
import { forYou, similarTo } from '@/lib/recommend';
import { interests } from '@/lib/taste';
import { api } from '@/lib/api';
import { useCartStore } from '@/hooks/use-cart-store';
import { useOrders } from '@/lib/orders';
import type { Product } from '@/lib/types';

// "For You": a full-screen, swipeable feed ranked by what the visitor likes and saves.
export default function ForYouPage() {
  const { products, isInitialized, error } = useProductStore();
  const { liked, isInitialized: likesInitialized } = useLikesStore();
  const { ids: savedIds, isInitialized: savesInitialized } = useWishlistStore();
  const cartEntries = useCartStore((s) => s.entries);
  const lives = useLives()?.lives ?? [];
  const orders = useOrders('buyer');
  const bought = useMemo(() => new Set((orders ?? []).filter((o) => o.status !== 'cancelled').flatMap((o) => o.items.map((i) => i.productId))), [orders]);
  // Refresh the ranking when catalog membership or ranking metadata changes, but
  // leave it stable when like counts update so slides do not jump while browsing.
  const catalogKey = products
    .map((p) => `${p.id}:${p.status}:${p.createdAt ?? ''}:${p.official ? 1 : 0}:${p.embedding?.join(',') ?? ''}`)
    .join('|');
  // Rank once per visit and when ranking metadata changes, not on every like or save.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // The server's feed, learned from everyone's behaviour (server/recommend.mjs); the device's own ranking
  // is used until it arrives or when offline.
  const [serverFeed, setServerFeed] = useState<{ id: string; reason: string | null }[] | null>(null);
  useEffect(() => {
    if (!likesInitialized) return;
    api<{ items: { id: string; reason: string | null }[] }>('/feed').then((d) => setServerFeed(d.items)).catch(() => setServerFeed(null));
  }, [likesInitialized]);
  const reasons = useMemo(() => new Map((serverFeed ?? []).map((x) => [x.id, x.reason])), [serverFeed]);
  const ranked = useMemo(() => {
    if (serverFeed?.length) {
      const known = new Map(products.map((p) => [p.id, p]));
      return serverFeed.map((x) => known.get(x.id)).filter(Boolean) as Product[];
    }
    return forYou(products, liked, new Set(savedIds), { cart: new Set(Object.keys(cartEntries)), bought, interest: interests() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogKey, isInitialized, likesInitialized, savesInitialized, orders === null, serverFeed]);

  // "More like this": liking an item brings two look-alikes right after it.
  const [feed, setFeed] = useState<Product[]>([]);
  useEffect(() => setFeed(ranked), [ranked]);
  const knownLikes = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!likesInitialized) return;
    const before = knownLikes.current;
    knownLikes.current = new Set(liked);
    if (!before) return;
    const fresh = [...liked].filter((id) => !before.has(id));
    if (!fresh.length) return;
    setFeed((current) => {
      let next = [...current];
      for (const id of fresh) {
        const at = next.findIndex((p) => p.id === id);
        if (at < 0) continue;
        const shownSoFar = new Set(next.slice(0, at + 1).map((p) => p.id));
        const alike = similarTo(next[at], products, 2, shownSoFar);
        next = next.filter((p) => !alike.some((a) => a.id === p.id));
        next.splice(at + 1, 0, ...alike);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liked, likesInitialized]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  return (
    <div className="relative mx-auto h-[calc(100dvh-4rem-4rem)] max-w-md snap-y snap-mandatory overflow-y-auto bg-background md:h-dvh">
      {/* Says what this page is: a feed picked for you (Explore is the shop, the Fitting Room is for trying on). */}
      <div className="pointer-events-none sticky top-0 z-20 flex h-0 justify-start px-3">

        {lives.length > 0 && (
          <Link href={lives.length === 1 ? `/live/watch?id=${lives[0].id}` : '/live'} className="pointer-events-auto ml-2 mt-3 flex items-center gap-1.5 rounded-full bg-primary py-1 pl-1 pr-3 text-xs font-extrabold text-primary-foreground shadow-md">
            <span className="flex -space-x-2">{lives.slice(0, 3).map((l) => <SellerAvatar key={l.id} src={l.sellerAvatar} name={l.sellerName} className="h-6 w-6 ring-2 ring-primary" />)}</span>
            <Radio className="h-3.5 w-3.5" /> LIVE
          </Link>
        )}
      </div>
      {!isInitialized ? (
        <Skeleton className="h-full w-full rounded-none" />
      ) : error ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-2xl font-bold">Couldn’t load the feed</p>
          <p className="text-muted-foreground">Check your connection and try again.</p>
          <Button onClick={retryProducts}>Retry</Button>
        </div>
      ) : feed.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-2xl font-bold">Nothing here yet</p>
          <p className="text-muted-foreground">Be the first to post an item on Saligue.</p>
          <Button asChild>
            <Link href="/sell"><PlusCircle className="mr-2 h-4 w-4" /> Sell an item</Link>
          </Button>
        </div>
      ) : (
        // Live data (like counts) from the store, order from the ranking.
        feed
          .map((p) => byId.get(p.id))
          .filter((p) => p?.status === 'active')
          .map((p) => <FeedSlide key={p!.id} product={p!} reason={reasons.get(p!.id) ?? null} />)
      )}
    </div>
  );
}
