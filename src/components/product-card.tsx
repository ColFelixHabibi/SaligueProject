
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ActionRail } from '@/components/social/action-rail';
import { CommentsPanel } from '@/components/social/comments-panel';
import { SoundChip } from '@/components/social/sound-chip';
import { Stars } from '@/components/stars';
import { SellerAvatar } from '@/components/seller-avatar';
import { categoryLabel } from '@/lib/categories';
import { productHref } from '@/lib/links';
import { formatPrice } from '@/lib/orders';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ProductCardProps {
  product: Product;
  className?: string;
}

/** Product tile for grids: photo, social actions, comments that open below the photo, and the essentials. */
export default function ProductCard({ product, className }: ProductCardProps) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const href = productHref(product);

  return (
    <Card className={cn('group flex w-full flex-col overflow-hidden', className)}>
      <Link href={href} className="relative block aspect-[4/5] overflow-hidden bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={product.image} alt={product.name} loading="lazy" className="h-full w-full object-contain p-3 transition-transform duration-500 group-hover:scale-105" />
        {product.official && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-foreground/85 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-background">
            <BadgeCheck className="h-3 w-3" /> INDECIANA
          </span>
        )}
        <SoundChip product={product} className="absolute bottom-2 left-2" />
        {product.stock === 0 ? (
          <span className="absolute right-2 top-2 rounded-full bg-destructive px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-destructive-foreground">Sold out</span>
        ) : product.stock != null && product.stock <= 3 ? (
          <span className="absolute right-2 top-2 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">Only {product.stock} left</span>
        ) : null}
      </Link>

      <div className="border-b px-2 py-1">
        <ActionRail
          product={product}
          variant="bar"
          commentsOpen={commentsOpen}
          onToggleComments={() => setCommentsOpen((o) => !o)}
        />
      </div>

      {commentsOpen && <CommentsPanel productId={product.id} sellerId={product.sellerId} className="border-b p-3" />}

      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <Link href={href} className="line-clamp-2 font-semibold leading-snug hover:underline">{product.name}</Link>
          <span className="shrink-0 font-bold text-primary">{formatPrice(Number(product.price))}</span>
        </div>
        <p className="text-xs text-muted-foreground">{categoryLabel(product.category)}{product.size ? ` · Size ${product.size}` : ''}</p>
        {(product.ratingCount ?? 0) > 0 && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Stars rating={product.rating ?? 0} size="h-3.5 w-3.5" /> <span>({product.ratingCount})</span>
          </p>
        )}
        <p className="mt-auto flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
          <SellerAvatar src={product.sellerAvatar} name={product.official ? 'INDECIANA' : product.shop?.name ?? product.seller} className="h-5 w-5 text-[10px]" />
          <span className="truncate">{product.official ? 'INDECIANA' : product.shop ? `${product.shop.name} · ${product.shop.city}` : product.seller}</span>
        </p>
      </div>

    </Card>
  );
}
