
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, MapPin, Music2, ShoppingCart, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ActionRail } from '@/components/social/action-rail';
import { CommentsPanel } from '@/components/social/comments-panel';
import { useCart } from '@/hooks/use-cart-store';
import { useSoundStore } from '@/hooks/use-sound';
import { useToast } from '@/hooks/use-toast';
import { loadProductSound } from '@/lib/audio';
import { friendlyError } from '@/lib/errors';
import { productHref } from '@/lib/links';
import { formatPrice } from '@/lib/orders';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Plays an item's sound while its slide fills the screen (muted until the visitor turns sound on). */
function useSlideSound(product: Product, ref: React.RefObject<HTMLElement | null>) {
  const soundOn = useSoundStore((s) => s.soundOn);
  const [visible, setVisible] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !product.sound) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.intersectionRatio >= 0.6), { threshold: [0, 0.6, 1] });
    observer.observe(element);
    return () => observer.disconnect();
  }, [product.sound, ref]);

  useEffect(() => {
    if (!visible || !product.sound) return;
    let cancelled = false;
    loadProductSound(product.id).then((src) => {
      if (cancelled || !src) return;
      const audio = audioRef.current ?? new Audio(src);
      audioRef.current = audio;
      audio.loop = true;
      audio.muted = !useSoundStore.getState().soundOn;
      audio.play().catch(() => {});
    });
    return () => {
      cancelled = true;
      audioRef.current?.pause();
    };
  }, [visible, product.id, product.sound]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !soundOn;
    if (visible && audio.paused) audio.play().catch(() => {});
  }, [soundOn, visible]);
}

/** One full-screen item in the For You feed. Comments open below the image. */
export function FeedSlide({ product }: { product: Product }) {
  const { toast } = useToast();
  const { addToCart } = useCart();
  const { soundOn, toggle } = useSoundStore();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const slideRef = useRef<HTMLElement>(null);
  useSlideSound(product, slideRef);
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
    <section ref={slideRef} className="relative flex h-full snap-start snap-always flex-col overflow-hidden bg-black text-white">
      <div className={cn('relative min-h-0 transition-[height] duration-300', commentsOpen ? 'h-[46%]' : 'h-full')}>
        {/* Blurred copy fills the screen; the item itself is shown whole. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
        <Link href={productHref(product)} className="absolute inset-0 flex items-center justify-center p-4 pb-28">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={product.name} className="max-h-full max-w-full rounded-xl object-contain shadow-2xl" />
        </Link>

        {product.sound && (
          <button
            type="button"
            onClick={toggle}
            className="absolute right-3 top-3 z-10 rounded-full bg-black/40 p-2 backdrop-blur"
            aria-label={soundOn ? 'Turn sound off' : 'Turn sound on'}
          >
            {soundOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>
        )}

        <div className={cn('absolute bottom-6 right-3 z-10', commentsOpen && 'hidden')}>
          <ActionRail product={product} variant="overlay" commentsOpen={commentsOpen} onToggleComments={() => setCommentsOpen((o) => !o)} />
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
            {product.sound && (
              <p className="mt-1 flex items-center gap-1 text-sm text-white/85">
                <Music2 className="h-4 w-4 shrink-0" /> <span className="truncate">{product.sound.name}</span>
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
    </section>
  );
}
