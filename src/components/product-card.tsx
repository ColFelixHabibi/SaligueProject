
'use client';

import { trackAd } from '@/lib/ads';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, Heart, Star, Wand2 } from 'lucide-react';
import { toggleLike, useLiked } from '@/hooks/use-likes';
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
  // "shop": a clean tile for browsing many items (Explore); "social" (default): with likes, comments and sharing.
  variant?: 'social' | 'shop';
  // Shown as an ad (Saligue Ads campaign id).
  sponsoredBy?: string;
}

/** Calm shop tile: big photo, heart and try-on on the photo, then just name, price, rating and shop. */
function ShopTile({ product, className, sponsoredBy }: { product: Product; className?: string; sponsoredBy?: string }) {
  const href = productHref(product);
  const tile = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = tile.current;
    if (!element || !sponsoredBy) return;
    const observer = new IntersectionObserver(([entry]) => entry.intersectionRatio >= 0.5 && trackAd(sponsoredBy, 'impression'), { threshold: [0.5] });
    observer.observe(element);
    return () => observer.disconnect();
  }, [sponsoredBy]);
  const liked = useLiked(product.id);
  const shopName = product.official ? 'INDECIANA' : product.shop?.name ?? product.seller;
  return (
    <div ref={tile} onClickCapture={() => sponsoredBy && trackAd(sponsoredBy, 'click')} className={cn('group flex flex-col', className)}>
      <div className="relative overflow-hidden rounded-2xl bg-muted">
        <Link href={href} className="block aspect-[4/5]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={product.image} alt={product.name} loading="lazy" className="h-full w-full object-contain p-4 transition-transform duration-500 group-hover:scale-105" />
        </Link>
        <button
          type="button"
          onClick={() => toggleLike(product.id).catch(() => {})}
          aria-pressed={liked}
          aria-label={liked ? 'Unlike' : 'Like'}
          className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-background/90 shadow-sm transition hover:scale-105"
        >
          <Heart className={cn('h-5 w-5', liked ? 'fill-primary text-primary' : 'text-foreground')} />
        </button>
        <Link href={`/mirror?item=${product.id}`} className="absolute bottom-2 right-2 flex h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground shadow transition hover:bg-primary/90">
          <Wand2 className="h-4 w-4" /> Try on
        </Link>
        {product.official && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-foreground/85 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-background">
            <BadgeCheck className="h-3 w-3" /> INDECIANA
          </span>
        )}
        {product.stock === 0 ? (
          <span className="absolute bottom-2 left-2 rounded-full bg-destructive px-2.5 py-1 text-[10px] font-bold uppercase text-destructive-foreground">Sold out</span>
        ) : product.stock != null && product.stock <= 3 ? (
          <span className="absolute bottom-2 left-2 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-bold uppercase text-white">Only {product.stock} left</span>
        ) : null}
      </div>
      <Link href={href} className="mt-2.5 space-y-0.5 px-0.5">
        <p className="text-lg font-bold text-foreground">{formatPrice(Number(product.price))}</p>
        <p className="truncate text-sm font-medium text-foreground/90">{product.name}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {(product.ratingCount ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 font-semibold text-foreground"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{product.rating?.toFixed(1)}</span>
          )}
          <span className="truncate">{sponsoredBy ? <><b className="font-semibold text-foreground">Sponsored</b> · {shopName}</> : shopName}</span>
        </p>
      </Link>
    </div>
  );
}

/** Product tile for grids: photo, social actions, comments that open below the photo, and the essentials. */
export default function ProductCard({ product, className, variant = 'social', sponsoredBy }: ProductCardProps) {
  if (variant === 'shop') return <ShopTile product={product} className={className} sponsoredBy={sponsoredBy} />;
  return <SocialCard product={product} className={className} />;
}

function SocialCard({ product, className }: { product: Product; className?: string }) {
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
