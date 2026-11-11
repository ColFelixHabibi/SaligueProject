'use client';

import Link from 'next/link';
import { HelpCircle, MapPin, PackageCheck, PackageX, ShoppingBag, ShoppingCart, Sparkles, Store, Wand2, Shirt, Ruler, Palette, Tag } from 'lucide-react';
import { Stars } from '@/components/stars';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FollowButton } from '@/components/follow-button';
import { MessageSellerButton } from '@/components/message-seller-button';
import { SellerAvatar } from '@/components/seller-avatar';
import { DiscountTag } from '@/components/discount-tag';
import { VerifiedBadge } from '@/components/verified-badge';
import { profileHref } from '@/components/profile-avatar';
import { SuggestedShops } from '@/components/suggested-shops';
import { useCart } from '@/hooks/use-cart-store';
import { useProductStore } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { categoryLabel } from '@/lib/categories';
import { useT } from '@/lib/i18n';
import { productHref } from '@/lib/links';
import { formatPrice } from '@/lib/orders';
import { similarTo } from '@/lib/recommend';
import type { Product } from '@/lib/types';

/**
 * Computers: what the feed shows, beside it (like TikTok's comments panel, but for shopping): the shop, the
 * details, buy or try on, and more like it. Phones keep the full-screen feed only.
 */
export function FeedSidePanel({ product }: { product: Product | null }) {
  const t = useT();
  const { toast } = useToast();
  const { addToCart } = useCart();
  const products = useProductStore((s) => s.products);
  if (!product) return <SuggestedShops className="pt-2" />;
  const more = similarTo(product, products, 6, new Set([product.id]));
  // An icon says what each detail is (kind, size, colour, brand); the word is in the tooltip for screen readers.
  const details = [
    { label: 'Kind', icon: Shirt, value: `${categoryLabel(product.category)}${product.type ? ` · ${product.type}` : ''}` },
    product.size && { label: 'Size', icon: Ruler, value: product.size },
    product.color && { label: 'Colour', icon: Palette, value: product.color },
    product.brand && { label: 'Brand', icon: Tag, value: product.brand },
  ].filter(Boolean) as { label: string; icon: typeof Shirt; value: string }[];
  const icon = 'h-11 w-full rounded-xl';

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <SellerAvatar src={product.sellerAvatar} name={product.shop?.name ?? product.seller} className="h-11 w-11" />
          <Link href={product.sellerId ? profileHref(product.sellerId) : productHref(product)} className="min-w-0 flex-1">
            <p className="truncate font-semibold">{product.shop?.name ?? product.seller}{product.sellerVerified && <VerifiedBadge className="ml-1" />}</p>
            {product.shop?.city && <p className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" /> {product.shop.city}</p>}
          </Link>
          <FollowButton sellerId={product.sellerId} iconOnly />
        </div>
        <Link href={productHref(product)} className="block text-lg font-bold leading-tight hover:underline">{product.name}</Link>
        <div className="flex items-center justify-between">
          <span className="flex min-w-0 flex-col">
            <p className="text-2xl font-extrabold text-primary">{formatPrice(Number(product.price))}</p>
            {product.discount && <DiscountTag percent={product.discount.percent} was={product.discount.was} />}
          </span>
          {/* Sold so far, what is left (the stock the shop sets), then the stars: icons beside the price. */}
          <span className="flex items-center gap-3 text-sm">
          {(product.sold ?? 0) > 0 && <span className="flex items-center gap-1.5 font-semibold" title={t('sold')}><ShoppingBag className="h-4 w-4 text-primary" /> {product.sold}</span>}
          {product.stock === 0
            ? <span className="flex items-center gap-1.5 font-semibold text-destructive"><PackageX className="h-4 w-4" /> {t('Sold out')}</span>
            : product.stock != null
              ? <span title={t('left')} className={cn('flex items-center gap-1.5 font-semibold', product.stock <= 3 ? 'text-amber-600' : 'text-emerald-600')}><PackageCheck className="h-4 w-4" /> {product.stock}</span>
              : <span className="flex items-center gap-1.5 font-semibold text-emerald-600" title={t('In stock')} aria-label={t('In stock')}><PackageCheck className="h-4 w-4" /></span>}
          <Link href={`${productHref(product)}#reviews`} className="flex items-center gap-1.5 text-sm hover:underline" aria-label={t('Reviews')} title={t('Reviews')}>
            <Stars rating={product.rating ?? 0} size="h-4 w-4" />
            {(product.ratingCount ?? 0) > 0 && <><b>{(product.rating ?? 0).toFixed(1)}</b> <span className="text-muted-foreground">({product.ratingCount})</span></>}
          </Link>
          </span>
        </div>
        {details.length > 0 && (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {details.map((d) => (
              <div key={d.label} className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/60 px-3 py-2" title={t(d.label)}>
                <dt><d.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-label={t(d.label)} /></dt>
                <dd className="truncate font-semibold">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {/* Wear it, Cart, message the shop, ask a question: four icons in a row. */}
        <div className="grid grid-cols-4 gap-2">
          <Button variant="secondary" className={icon} asChild><Link href={`/mirror?item=${product.id}`} aria-label={t('Wear it')} title={t('Wear it')}><Wand2 className="h-5 w-5" /></Link></Button>
          <Button className={icon} disabled={product.stock === 0} onClick={() => { addToCart(product); toast({ title: t('Added to cart') }); }} aria-label={t('Cart')} title={t('Cart')}><ShoppingCart className="h-5 w-5" /></Button>
          <MessageSellerButton product={product} size="icon" variant="outline" label={t('Message')} className={icon} />
          <Button variant="outline" className={icon} asChild><Link href={`${productHref(product)}#questions`} aria-label={t('Ask the shop')} title={t('Ask the shop')}><HelpCircle className="h-5 w-5" /></Link></Button>
        </div>
      </div>

      {more.length > 0 && (
        <section className="space-y-2">
          <p className="flex items-center gap-2 font-bold"><Sparkles className="h-5 w-5 text-primary" /> {t('More like this')}</p>
          <div className="grid grid-cols-3 gap-2">
            {more.map((p) => (
              <Link key={p.id} href={productHref(p)} className="group overflow-hidden rounded-xl border bg-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.cutout || p.image} alt={p.name} loading="lazy" className="aspect-square w-full bg-muted object-contain p-1 transition group-hover:scale-105" />
                <p className="truncate px-1.5 pt-1 text-[11px] font-medium">{p.name}</p>
                <p className="px-1.5 pb-1.5 text-[11px] font-bold text-primary">{formatPrice(Number(p.price))}{p.discount && <span className="ml-1 font-bold text-rose-600">−{p.discount.percent}%</span>}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
      <SuggestedShops className="pt-2" />
      <Link href="/search" className="flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-semibold hover:bg-muted"><Store className="h-4 w-4" /> {t('Explore')}</Link>
    </div>
  );
}
