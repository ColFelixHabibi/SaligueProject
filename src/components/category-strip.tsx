'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { LayoutGrid } from 'lucide-react';
import { useProductStore } from '@/hooks/use-product-store';
import { CATEGORIES } from '@/lib/categories';
import { cn } from '@/lib/utils';

/**
 * Categories as round pictures with one word under each, like Amazon and Alibaba: a real item from the shop
 * shows what each category is, so no long labels are needed.
 */
export function CategoryStrip({ value, onChange, allowAll = true, withBoutique = false, className }: {
  value: string | null;
  onChange: (value: string | null) => void;
  allowAll?: boolean;
  withBoutique?: boolean;
  className?: string;
}) {
  const products = useProductStore((s) => s.products);
  const covers = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products) if (p.status === 'active' && !map.has(p.category)) map.set(p.category, p.cutout || p.image);
    return map;
  }, [products]);

  const bubble = (active: boolean) =>
    cn('flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 bg-muted transition md:h-[72px] md:w-[72px]', active ? 'border-primary ring-2 ring-primary/30' : 'border-transparent');
  const label = (active: boolean) => cn('max-w-[4.5rem] truncate text-xs', active ? 'font-bold text-primary' : 'font-medium text-foreground');

  return (
    <div className={cn('-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]', className)} role="tablist" aria-label="Categories">
      {allowAll && (
        <button type="button" role="tab" aria-selected={!value} onClick={() => onChange(null)} className="flex shrink-0 flex-col items-center gap-1">
          <span className={bubble(!value)}><LayoutGrid className={cn('h-7 w-7', !value ? 'text-primary' : 'text-muted-foreground')} /></span>
          <span className={label(!value)}>All</span>
        </button>
      )}
      {withBoutique && (
        <Link href="/indeciana" className="flex shrink-0 flex-col items-center gap-1">
          <span className={cn(bubble(false), 'bg-foreground font-serif text-lg tracking-widest text-background')}>I</span>
          <span className={label(false)}>INDECIANA</span>
        </Link>
      )}
      {CATEGORIES.map((c) => {
        const active = value === c.value;
        const cover = covers.get(c.value);
        return (
          <button key={c.value} type="button" role="tab" aria-selected={active} title={c.label} onClick={() => onChange(active ? null : c.value)} className="flex shrink-0 flex-col items-center gap-1">
            <span className={bubble(active)}>
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt="" loading="lazy" className="h-full w-full object-contain p-2" />
              ) : (
                <span className="text-lg font-bold text-muted-foreground">{c.short.charAt(0)}</span>
              )}
            </span>
            <span className={label(active)}>{c.short}</span>
          </button>
        );
      })}
    </div>
  );
}
