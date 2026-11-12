'use client';

import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

type Priced = { price: number | string; discount?: { percent: number; was: number } | null };

/**
 * An item's price, the same everywhere: what is paid now, then — when the shop put it on sale — the usual price
 * crossed out and the % off in a red tag ("$90  ~~$120~~  −25%"). The price is already the lower one
 * (server/index.mjs, priceOf). Colours follow the text around it, so it reads on photos and on cards alike.
 */
export function Price({ product, className }: { product: Priced; className?: string }) {
  const d = product.discount;
  const onSale = !!d && d.percent > 0 && Number(d.was) > Number(product.price);
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5', className)}>
      <span>{formatPrice(Number(product.price))}</span>
      {onSale && (
        <>
          <s className="text-[0.8em] font-medium opacity-70">{formatPrice(Number(d.was))}</s>
          <span className="self-center rounded-full bg-rose-600 px-1.5 py-px text-[0.7em] font-extrabold leading-tight text-white">−{d.percent}%</span>
        </>
      )}
    </span>
  );
}
