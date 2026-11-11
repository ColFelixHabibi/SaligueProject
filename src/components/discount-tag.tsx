'use client';

import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

/**
 * "−25%" with the usual price crossed out, for a post the shop put on sale.
 * The price shown next to it is already the lower one (server/index.mjs, priceOf).
 */
export function DiscountTag({ percent, was, className }: { percent: number; was: number; className?: string }) {
  if (!(percent > 0)) return null;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', className)}>
      <span className="inline-flex items-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[11px] font-extrabold text-white">−{percent}%</span>
      <s className="text-muted-foreground">{formatPrice(Number(was))}</s>
    </span>
  );
}
