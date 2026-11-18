'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Product } from '@/lib/types';

/** One picture or video of an item, in the order a shopper swipes through them. */
export type ItemMedia = { kind: 'video'; src: string; poster?: string } | { kind: 'image'; src: string };

/** An item's media: the video first (when there is one), then the first photo, then the shop's other photos. */
export function itemMedia(product: Pick<Product, 'image' | 'photos' | 'video' | 'videoPoster'>): ItemMedia[] {
  return [
    ...(product.video ? [{ kind: 'video' as const, src: product.video, poster: product.videoPoster }] : []),
    { kind: 'image' as const, src: product.image },
    ...(product.photos ?? []).map((src) => ({ kind: 'image' as const, src })),
  ];
}

/**
 * Pages that slide sideways, like a photo post: swipe on a phone, arrows on a computer, dots for where you are.
 * Inside the vertical feed a sideways swipe moves between the pages and an up/down swipe still moves between items.
 */
export function SwipeGallery<T>({ items, render, index: wanted, onIndexChange, className, dotsClassName, dark = false }: {
  items: T[];
  render: (item: T, i: number, active: boolean) => React.ReactNode;
  // Jump to this page when it changes (a thumbnail was tapped).
  index?: number;
  onIndexChange?: (i: number) => void;
  className?: string;
  dotsClassName?: string;
  // Light dots and arrows on a dark picture (the feed).
  dark?: boolean;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const go = useCallback((i: number) => {
    const el = strip.current;
    if (!el) return;
    el.scrollTo({ left: Math.max(0, Math.min(items.length - 1, i)) * el.clientWidth, behavior: 'smooth' });
  }, [items.length]);
  useEffect(() => {
    if (wanted !== undefined && wanted !== index) go(wanted);
    // Only when asked from outside: following our own scrolling here would fight the finger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  const onScroll = () => {
    const el = strip.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== index) {
      setIndex(i);
      onIndexChange?.(i);
    }
  };
  const many = items.length > 1;
  const arrow = cn('absolute top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full shadow-md backdrop-blur transition hover:scale-105 md:flex',
    dark ? 'bg-black/45 text-white' : 'bg-background/90 text-foreground');
  return (
    <div className={cn('relative', className)}>
      <div ref={strip} onScroll={onScroll} className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item, i) => (
          <div key={i} className="relative h-full w-full shrink-0 snap-center snap-always">{render(item, i, i === index)}</div>
        ))}
      </div>
      {many && (
        <>
          {index > 0 && <button type="button" onClick={() => go(index - 1)} className={cn(arrow, 'left-2')} aria-label="Previous"><ChevronLeft className="h-5 w-5" /></button>}
          {index < items.length - 1 && <button type="button" onClick={() => go(index + 1)} className={cn(arrow, 'right-2')} aria-label="Next"><ChevronRight className="h-5 w-5" /></button>}
          <div className={cn('pointer-events-none absolute inset-x-0 z-10 flex justify-center gap-1.5', dotsClassName ?? 'bottom-3')} aria-label={`${index + 1} / ${items.length}`}>
            {items.map((_, i) => (
              <span key={i} className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-4' : 'w-1.5',
                dark ? (i === index ? 'bg-white' : 'bg-white/50') : (i === index ? 'bg-primary' : 'bg-foreground/25'))} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
