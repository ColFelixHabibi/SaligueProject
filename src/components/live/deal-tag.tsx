'use client';

import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

/** Minutes and seconds left until `until` (ticks every second); null once it is over. */
export function useCountdown(until?: string | null) {
  const [left, setLeft] = useState(() => (until ? new Date(until).getTime() - Date.now() : 0));
  useEffect(() => {
    if (!until) return;
    const tick = () => setLeft(new Date(until).getTime() - Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until || left <= 0) return null;
  const s = Math.floor(left / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "⚡ Live deal 4:59" with the usual price crossed out. Disappears when the countdown ends. */
export function DealTag({ was, until, className }: { was: number; until: string; className?: string }) {
  const left = useCountdown(until);
  if (!left) return null;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', className)}>
      <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-400 px-1.5 py-0.5 font-extrabold text-black"><Zap className="h-3 w-3 fill-current" /> {left}</span>
      <s className="text-muted-foreground">{formatPrice(was)}</s>
    </span>
  );
}
