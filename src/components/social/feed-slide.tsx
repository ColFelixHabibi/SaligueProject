
'use client';

import { VerifiedBadge } from '@/components/verified-badge';

import { useT } from '@/lib/i18n';

import { ProfileAvatar, profileHref } from '@/components/profile-avatar';

import { adClicked, adOnScreen } from '@/lib/ads';
import { noteInterest } from '@/lib/taste';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, EyeOff, HelpCircle, MapPin, MoreHorizontal, Music2, Play, ShoppingCart, Volume2, VolumeX, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useDataSaver } from '@/lib/data-saver';
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
import { ExpandableText } from '@/components/expandable-text';

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
export function FeedSlide({ product, reason, sponsoredBy, onHide }: { product: Product; reason?: string | null; sponsoredBy?: string; onHide?: () => void }) {
  const { toast } = useToast();
  const { addToCart } = useCart();
  const { soundOn, unlocked, toggle } = useSoundStore();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const slideRef = useRef<HTMLElement>(null);
  useSlideSound(product, slideRef);
  useWatchTime(product, slideRef);
  // A sponsored slide counts as seen after filling most of the screen for a second.
  useEffect(() => {
    const element = slideRef.current;
    if (!element || !sponsoredBy) return;
    const observer = new IntersectionObserver(([entry]) => adOnScreen(sponsoredBy, entry.intersectionRatio >= 0.6), { threshold: [0, 0.6] });
    observer.observe(element);
    return () => {
      observer.disconnect();
      adOnScreen(sponsoredBy, false);
    };
  }, [sponsoredBy]);
  const image = product.videoPoster ?? product.image;
  // The item's video plays while its slide fills the screen (silent unless sound is on), like TikTok.
  const videoRef = useRef<HTMLVideoElement>(null);
  // Data saver: videos wait for a tap instead of playing by themselves.
  const saver = useDataSaver();
  const t = useT();
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const element = slideRef.current;
    const v = videoRef.current;
    if (!element || !v) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.intersectionRatio >= 0.6) !saver && v.play().catch(() => {});
      else v.pause();
    }, { threshold: [0, 0.6] });
    observer.observe(element);
    return () => observer.disconnect();
  }, [product.video, saver]);
  // "Show less like this": For You learns it, and the item leaves the feed now.
  const showLess = () => {
    noteInterest(product.id, 'less');
    onHide?.();
    toast({ title: t('You’ll see less like this') });
  };
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = !(soundOn && unlocked);
  }, [soundOn, unlocked]);

  const add = async () => {
    try {
      await addToCart(product);
      toast({ title: 'Added to cart', description: product.name });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Try again', description: friendlyError(error) });
    }
  };

  return (
    <section ref={slideRef} data-feed-product={product.id} className="relative flex h-full snap-start snap-always flex-col overflow-hidden bg-muted text-foreground">
      <div className={cn('relative min-h-0 transition-[height] duration-300', commentsOpen ? 'h-[46%]' : 'h-full')}>
        {/* Blurred copy fills the screen; the item itself is shown whole. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" />
        {product.video ? (
          <video ref={videoRef} src={product.video} poster={product.videoPoster} muted loop playsInline preload={saver ? 'none' : 'metadata'} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
            onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play().catch(() => {}) : e.currentTarget.pause())}
            className="absolute inset-0 h-full w-full object-contain pb-24" aria-label={product.name} />
        ) : (
          <Link href={productHref(product)} className="absolute inset-0 flex items-center justify-center p-4 pb-28">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt={product.name} className="max-h-full max-w-full rounded-xl object-contain shadow-2xl" />
          </Link>
        )}

        {product.video && !playing && saver && (
          <button type="button" onClick={() => videoRef.current?.play().catch(() => {})} className="absolute left-1/2 top-[40%] z-10 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur" aria-label="Play video">
            <Play className="h-8 w-8 fill-white" />
          </button>
        )}
        {/* Why this item, and "show less": the viewer can see and steer the algorithm. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="absolute right-3 top-[6.5rem] z-10 flex h-9 w-9 items-center justify-center rounded-full bg-background/90 shadow backdrop-blur" aria-label="More options">
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="flex items-start gap-2 font-normal">
              <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span><b className="block text-sm">{t('Why am I seeing this?')}</b><span className="text-xs text-muted-foreground">{sponsoredBy ? 'A shop paid to show this item (Sponsored).' : reason ?? 'New and popular items, mixed for variety.'}</span></span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={showLess}><EyeOff className="mr-2 h-4 w-4" /> {t('Show less like this')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sound on/off for the whole feed, on every item, so it can be turned on before reaching items with a sound. */}
        <button
          type="button"
          onClick={toggle}
          className="absolute right-3 top-14 z-10 flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-2 text-xs font-semibold shadow backdrop-blur"
          aria-label={soundOn ? 'Turn sound off' : 'Turn sound on'}
        >
          {soundOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          {soundOn && !unlocked && 'Tap for sound'}
        </button>

        <div className={cn('absolute bottom-6 right-3 z-10 flex flex-col items-center gap-5', commentsOpen && 'hidden')}>
          {product.sellerId && <ProfileAvatar id={product.sellerId} name={product.shop?.name ?? product.seller} src={product.sellerAvatar} />}
          <ActionRail product={product} variant="overlay" commentsOpen={commentsOpen} onToggleComments={() => setCommentsOpen((o) => !o)} />
        </div>

        {!commentsOpen && (
          <div className="absolute inset-x-0 bottom-0 z-0 bg-gradient-to-t from-background via-background/85 to-transparent p-4 pr-20 pt-16">
            {product.official && (
              <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold tracking-wider text-primary-foreground">
                <BadgeCheck className="h-3.5 w-3.5" /> INDECIANA
              </span>
            )}
            {product.sample && <span className="mb-1.5 ml-1 inline-flex rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-black" title="A sample item while Saligue is new">Sample</span>}
            {sponsoredBy && <p className="mb-1 inline-flex items-center rounded bg-foreground/80 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-background">Sponsored</p>}
            <Link href={productHref(product)} onClick={() => sponsoredBy && adClicked(sponsoredBy)} className="line-clamp-2 block text-xl font-bold leading-tight hover:underline" title={reason ?? undefined}>{product.name}</Link>
            {product.description && <ExpandableText text={product.description} lines={1} className="mt-0.5 text-sm text-muted-foreground" />}
            {product.shop && (
              <Link href={product.sellerId ? profileHref(product.sellerId) : productHref(product)} className="mt-1.5 flex w-fit max-w-full items-center gap-1.5 text-sm font-semibold text-foreground/80 hover:underline">
                <MapPin className="h-4 w-4 shrink-0" /> <span className="truncate">{product.shop.name} · {product.shop.city}</span>{product.sellerVerified && <VerifiedBadge />}
              </Link>
            )}
            {product.sound && (
              <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                <Music2 className="h-4 w-4 shrink-0" /> <span className="truncate">{product.sound.name}</span>
              </p>
            )}
            <div className="mt-2 flex items-center gap-3">
              <p className="text-2xl font-extrabold text-primary">{formatPrice(Number(product.price))}</p>
              <Button size="icon" className="h-10 w-10 rounded-full" onClick={add} aria-label={t('Add to cart')} title={t('Add to cart')}>
                <ShoppingCart className="h-5 w-5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {commentsOpen && (
        <div className="flex min-h-0 flex-1 flex-col bg-background p-4 text-foreground">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-semibold">{product.name}</p>
            <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted hover:bg-muted/70" onClick={() => setCommentsOpen(false)} aria-label="Close" title="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <CommentsPanel productId={product.id} sellerId={product.sellerId} className="min-h-0 flex-1" />
        </div>
      )}
    </section>
  );
}
