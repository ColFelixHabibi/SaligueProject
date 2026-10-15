'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Music2, Pause } from 'lucide-react';
import { loadProductSound } from '@/lib/audio';
import { useAudible } from '@/hooks/use-sound';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

// One sound at a time across the page.
let current: { audio: HTMLAudioElement; stop: () => void } | null = null;

/**
 * ♪ button for an item's sound (looping) until tapped again or another one starts.
 * With `autoPlay` (item pages) it starts by itself once sound is on, like the feed.
 */
export function SoundChip({ product, className, autoPlay }: { product: Product; className?: string; autoPlay?: boolean }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const mine = useRef<HTMLAudioElement | null>(null);
  const audible = useAudible();
  const stoppedByUser = useRef(false);

  // Stop this card's sound when the card goes away.
  useEffect(() => () => {
    if (current && current.audio === mine.current) current.stop();
  }, []);

  useEffect(() => {
    if (autoPlay && audible && product.sound && state === 'idle' && !stoppedByUser.current) start();
    // Start once sound becomes allowed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, audible, product.id]);

  if (!product.sound) return null;

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (state === 'playing') {
      stoppedByUser.current = true;
      current?.stop();
      return;
    }
    start();
  };

  async function start() {
    current?.stop();
    setState('loading');
    const src = await loadProductSound(product.id);
    if (!src) {
      setState('idle');
      return;
    }
    const audio = new Audio(src);
    audio.loop = true;
    mine.current = audio;
    const stop = () => {
      audio.pause();
      if (current?.audio === audio) current = null;
      setState('idle');
    };
    current = { audio, stop };
    try {
      await audio.play();
      setState('playing');
    } catch {
      stop();
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn('inline-flex max-w-[70%] items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium shadow backdrop-blur', className)}
      aria-label={state === 'playing' ? `Stop the sound of ${product.name}` : `Play the sound of ${product.name}`}
    >
      {state === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === 'playing' ? <Pause className="h-3.5 w-3.5" /> : <Music2 className="h-3.5 w-3.5" />}
      <span className="truncate">{product.sound.name}</span>
    </button>
  );
}
