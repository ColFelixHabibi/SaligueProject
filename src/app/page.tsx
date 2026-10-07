
'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FeedSlide } from '@/components/social/feed-slide';
import { useProductStore } from '@/hooks/use-product-store';
import { useLikesStore } from '@/hooks/use-likes';
import { useWishlistStore } from '@/hooks/use-wishlist';
import { forYou } from '@/lib/recommend';

// "For You": a full-screen, swipeable feed ranked by what the visitor likes and saves.
export default function ForYouPage() {
  const { products, isInitialized } = useProductStore();
  const liked = useLikesStore((s) => s.liked);
  const savedIds = useWishlistStore((s) => s.ids);
  // Rank once per visit (and when the catalog changes), not on every like, so items don't jump around.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const feed = useMemo(() => forYou(products, liked, new Set(savedIds)), [products.length, isInitialized]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  return (
    <div className="mx-auto h-[calc(100dvh-4rem-4rem)] max-w-md snap-y snap-mandatory overflow-y-auto bg-black md:h-[calc(100dvh-4rem)]">
      {!isInitialized ? (
        <Skeleton className="h-full w-full rounded-none" />
      ) : feed.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center text-white">
          <p className="text-2xl font-bold">Nothing here yet</p>
          <p className="text-white/70">Be the first to post an item on Saligue.</p>
          <Button asChild>
            <Link href="/sell"><PlusCircle className="mr-2 h-4 w-4" /> Sell an item</Link>
          </Button>
        </div>
      ) : (
        // Live data (like counts) from the store, order from the ranking.
        feed.map((p) => byId.get(p.id)).filter(Boolean).map((p) => <FeedSlide key={p!.id} product={p!} />)
      )}
    </div>
  );
}
