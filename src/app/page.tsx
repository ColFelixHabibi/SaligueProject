
'use client';

import { mixSponsored, useSponsored } from '@/lib/ads';
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
  const sponsored = useSponsored('feed', 3);

  return (
    <div className="relative mx-auto h-[calc(100dvh-4rem-4rem)] max-w-md snap-y snap-mandatory overflow-y-auto bg-background md:h-dvh">
      {/* Says what this page is: a feed picked for you (Explore is the shop, the Fitting Room is for trying on). */}
      <div className="pointer-events-none sticky top-0 z-40 flex h-0 justify-start px-3">
        {/* Who is live: the seller's photo in a pink ring with a LIVE tag, like stories. */}
        {lives.length > 0 && (
          <Link href={lives.length === 1 ? `/live/watch?id=${lives[0].id}` : '/live'} aria-label={`${lives.length} live now`} className="pointer-events-auto relative mt-3 flex flex-col items-center">
            <span className="rounded-full bg-gradient-to-tr from-primary to-[#e30613] p-[3px] shadow-lg">
              <SellerAvatar src={lives[0].sellerAvatar} name={lives[0].sellerName} className="h-12 w-12 ring-2 ring-background" />
            </span>
            <span className="-mt-2.5 flex items-center gap-0.5 rounded-md bg-primary px-1.5 py-px text-[10px] font-extrabold tracking-wide text-primary-foreground ring-2 ring-background">
              <Radio className="h-3 w-3" /> LIVE{lives.length > 1 ? ` ${lives.length}` : ''}
            </span>
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
        mixSponsored(
          feed.map((p) => byId.get(p.id)).filter((p): p is Product => p?.status === 'active'),
          sponsored.map((a) => ({ item: byId.get(a.productId)!, campaignId: a.campaignId })).filter((a) => a.item?.status === 'active'),
          3,
          7
        ).map((p) => <FeedSlide key={`${p.id}${p.sponsoredBy ?? ''}`} product={p} reason={p.sponsoredBy ? null : reasons.get(p.id) ?? null} sponsoredBy={p.sponsoredBy} />)
      )}
    </div>
  );
}
