
'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Compass, Flame, PlusCircle, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FeedSlide } from '@/components/social/feed-slide';
import { retryProducts, useProductStore } from '@/hooks/use-product-store';
import { useLikesStore } from '@/hooks/use-likes';
import { useWishlistStore } from '@/hooks/use-wishlist';
import { forYou } from '@/lib/recommend';

// "For You": a full-screen, swipeable feed ranked by what the visitor likes and saves.
export default function ForYouPage() {
  const { products, isInitialized, error } = useProductStore();
  const { liked, isInitialized: likesInitialized } = useLikesStore();
  const { ids: savedIds, isInitialized: savesInitialized } = useWishlistStore();
  // Refresh the ranking when catalog membership or ranking metadata changes, but
  // leave it stable when like counts update so slides do not jump while browsing.
  const catalogKey = products
    .map((p) => `${p.id}:${p.status}:${p.createdAt ?? ''}:${p.official ? 1 : 0}:${p.embedding?.join(',') ?? ''}`)
    .join('|');
  // Rank once per visit and when ranking metadata changes, not on every like or save.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const feed = useMemo(
    () => forYou(products, liked, new Set(savedIds)),
    [catalogKey, isInitialized, likesInitialized, savesInitialized]
  );
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  return (
    <div className="relative mx-auto h-[calc(100dvh-4rem-4rem)] max-w-md snap-y snap-mandatory overflow-y-auto bg-background md:h-dvh">
      {/* Says what this page is: a feed picked for you (Explore is the shop, the Fitting Room is for trying on). */}
      <div className="pointer-events-none sticky top-0 z-20 flex h-0 justify-center">
        <div className="pointer-events-auto mt-3 flex items-center gap-1 rounded-full bg-black/45 p-1 text-xs font-semibold text-white backdrop-blur">
          <span className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5"><Flame className="h-3.5 w-3.5" /> For You</span>
          <Link href="/search" className="flex items-center gap-1 rounded-full px-3 py-1.5 hover:bg-white/15"><Compass className="h-3.5 w-3.5" /> Explore</Link>
          <Link href="/mirror" className="flex items-center gap-1 rounded-full px-3 py-1.5 hover:bg-white/15"><Wand2 className="h-3.5 w-3.5" /> Try on</Link>
        </div>
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
          .map((p) => <FeedSlide key={p!.id} product={p!} />)
      )}
    </div>
  );
}
