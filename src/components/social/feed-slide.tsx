
'use client';

import { noteInterest } from '@/lib/taste';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, MapPin, Music2, ShoppingCart, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ActionRail } from '@/components/social/action-rail';
import { CommentsPanel } from '@/components/social/comments-panel';
import { useCart } from '@/hooks/use-cart-store';
import { useAudible, useSoundStore } from '@/hooks/use-sound';
import { useToast } from '@/hooks/use-toast';
import { loadProductSound } from '@/lib/audio';
import { friendlyError } from '@/lib/errors';
import { productHref } from '@/lib/links';
import { formatPrice } from '@/lib/orders';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Plays an item's sound, looping, while its slide fills the screen, like TikTok. */
function useSlideSound(product: Product, ref: React.RefObject<HTMLElement | null>) {
  const audible = useAudible();
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
      const { soundOn, unlocked } = useSoundStore.getState();
      audio.muted = !(soundOn && unlocked);
      audio.play().catch(() => {});
    });
    return () => {
      cancelled = true;
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
    };
  }, [visible, product.id, product.sound]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audible;
    if (visible && audio.paused) audio.play().catch(() => {});
  }, [audible, visible]);
}

/** Learns from how long the shopper watches a slide: a few seconds means interest, a quick swipe means less. */
function useWatchTime(product: Product, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let since: number | null = null;
    const finish = () => {
      if (since === null) return;
      const seconds = (Date.now() - since) / 1000;
      since = null;
      if (seconds >= 3) noteInterest(product.id, 'dwell', Math.min(3, seconds / 3));
      else if (seconds < 1) noteInterest(product.id, 'skip');
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.intersectionRatio >= 0.6) since ??= Date.now();
      else finish();
    }, { threshold: [0, 0.6, 1] });
    observer.observe(element);
    return () => {
      observer.disconnect();
      finish();
    };
  }, [product.id, ref]);
}

/** One full-screen item in the For You feed. Comments open below the image. */
export function FeedSlide({ product, reason }: { product: Product; reason?: string | null }) {
  const { toast } = useToast();
  const { addToCart } = useCart();
  const { soundOn, unlocked, toggle } = useSoundStore();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const slideRef = useRef<HTMLElement>(null);
  useSlideSound(product, slideRef);
  useWatchTime(product, slideRef);
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
    <section ref={slideRef} className="relative flex h-full snap-start snap-always flex-col overflow-hidden bg-muted text-foreground">
      <div className={cn('relative min-h-0 transition-[height] duration-300', commentsOpen ? 'h-[46%]' : 'h-full')}>
        {/* Blurred copy fills the screen; the item itself is shown whole. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" />
        <Link href={productHref(product)} className="absolute inset-0 flex items-center justify-center p-4 pb-28">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={product.name} className="max-h-full max-w-full rounded-xl object-contain shadow-2xl" />
        </Link>

        {/* Sound on/off for the whole feed, on every item, so it can be turned on before reaching items with a sound. */}
        <button
          type="button"
          onClick={toggle}
          className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-2 text-xs font-semibold shadow backdrop-blur"
          aria-label={soundOn ? 'Turn sound off' : 'Turn sound on'}
        >
          {soundOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          {soundOn && !unlocked && 'Tap for sound'}
        </button>

        <div className={cn('absolute bottom-6 right-3 z-10', commentsOpen && 'hidden')}>
          <ActionRail product={product} variant="overlay" commentsOpen={commentsOpen} onToggleComments={() => setCommentsOpen((o) => !o)} />
        </div>

        {!commentsOpen && (
          <div className="absolute inset-x-0 bottom-0 z-0 bg-gradient-to-t from-background via-background/85 to-transparent p-4 pr-20 pt-16">
            {product.official && (
              <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-primary-foreground">
                <BadgeCheck className="h-3.5 w-3.5" /> Recommended by INDECIANA
              </span>
            )}
            {reason && <p className="mb-1 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">✨ {reason}</p>}
            <Link href={productHref(product)} className="block text-xl font-bold leading-tight hover:underline">{product.name}</Link>
            <p className="mt-1 text-2xl font-extrabold text-primary">{formatPrice(Number(product.price))}</p>
            {product.shop && (
              <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0" /> {product.shop.name} · {product.shop.city}
              </p>
            )}
            {product.sound && (
              <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
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
