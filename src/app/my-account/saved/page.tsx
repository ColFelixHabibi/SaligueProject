'use client';

import Link from 'next/link';
import { Bookmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ProductCard from '@/components/product-card';
import { useWishlist } from '@/hooks/use-wishlist';

/** Items the shopper saved for later. */
export default function MySaved() {
  const { wishlistItems } = useWishlist();
  if (!wishlistItems.length) {
    return (
      <div className="rounded-2xl border-2 border-dashed bg-background py-16 text-center">
        <Bookmark className="mx-auto mb-3 h-10 w-10 text-primary" />
        <p className="font-semibold">Nothing saved yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Tap the bookmark on any item to keep it here.</p>
        <Button className="mt-4" asChild><Link href="/search">Explore items</Link></Button>
      </div>
    );
  }
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">{wishlistItems.map((p) => <ProductCard key={p.id} product={p} variant="shop" />)}</div>;
}
