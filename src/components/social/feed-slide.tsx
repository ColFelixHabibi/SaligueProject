
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, MapPin, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ActionRail } from '@/components/social/action-rail';
import { CommentsPanel } from '@/components/social/comments-panel';
import { VideoMaker } from '@/components/social/video-maker';
import { useCart } from '@/hooks/use-cart-store';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { productHref } from '@/lib/links';
import { formatPrice } from '@/lib/orders';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

/** One full-screen item in the For You feed. Comments open below the image. */
export function FeedSlide({ product }: { product: Product }) {
  const { toast } = useToast();
  const { addToCart } = useCart();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const image = product.image;

  const add = async () => {
    try {
      await addToCart(product);
      toast({ title: 'Added to cart', description: product.name });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Try again', description: friendlyError(error) });
    }
  };

  return (
    <section className="relative flex h-full snap-start snap-always flex-col overflow-hidden bg-black text-white">
      <div className={cn('relative min-h-0 transition-[height] duration-300', commentsOpen ? 'h-[46%]' : 'h-full')}>
        {/* Blurred copy fills the screen; the item itself is shown whole. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
        <Link href={productHref(product)} className="absolute inset-0 flex items-center justify-center p-4 pb-28">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={product.name} className="max-h-full max-w-full rounded-xl object-contain shadow-2xl" />
        </Link>

        <div className={cn('absolute bottom-6 right-3 z-10', commentsOpen && 'hidden')}>
          <ActionRail
            product={product}
            variant="overlay"
            commentsOpen={commentsOpen}
            onToggleComments={() => setCommentsOpen((o) => !o)}
            onMakeVideo={() => setVideoOpen(true)}
          />
        </div>

        {!commentsOpen && (
          <div className="absolute inset-x-0 bottom-0 z-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-4 pr-20">
            {product.official && (
              <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider">
                <BadgeCheck className="h-3.5 w-3.5" /> Recommended by INDECIANA
              </span>
            )}
            <Link href={productHref(product)} className="block text-xl font-bold leading-tight hover:underline">{product.name}</Link>
            <p className="mt-1 text-2xl font-extrabold text-primary">{formatPrice(Number(product.price))}</p>
            {product.shop && (
              <p className="mt-1 flex items-center gap-1 text-sm text-white/85">
                <MapPin className="h-4 w-4 shrink-0" /> {product.shop.name} · {product.shop.city}
              </p>
            )}
            <Button size="sm" className="mt-3" onClick={add}>
              <ShoppingCart className="mr-2 h-4 w-4" /> Add to cart
            </Button>
          </div>
        )}
      </div>

      {commentsOpen && (
        <div className="flex min-h-0 flex-1 flex-col bg-background p-4 text-foreground">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-semibold">{product.name}</p>
            <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setCommentsOpen(false)}>
              Close
            </button>
          </div>
          <CommentsPanel productId={product.id} sellerId={product.sellerId} className="min-h-0 flex-1" />
        </div>
      )}

      <VideoMaker
        open={videoOpen}
        onOpenChange={setVideoOpen}
        imageUrl={product.cutout || product.image}
        title={product.name}
        subtitle={[formatPrice(Number(product.price)), product.shop?.name].filter(Boolean).join(' · ')}
      />
    </section>
  );
}
