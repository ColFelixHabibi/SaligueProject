'use client';

import Link from 'next/link';
import { HelpCircle, MapPin, MessageCircle, PackageCheck, ShoppingCart, Sparkles, Store, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FollowButton } from '@/components/follow-button';
import { MessageSellerButton } from '@/components/message-seller-button';
import { SellerAvatar } from '@/components/seller-avatar';
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
  const details = [
    { label: 'Kind', value: `${categoryLabel(product.category)}${product.type ? ` · ${product.type}` : ''}` },
    product.size && { label: 'Size', value: product.size },
    product.color && { label: 'Colour', value: product.color },
    product.brand && { label: 'Brand', value: product.brand },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <SellerAvatar src={product.sellerAvatar} name={product.shop?.name ?? product.seller} className="h-11 w-11" />
          <Link href={product.sellerId ? profileHref(product.sellerId) : productHref(product)} className="min-w-0 flex-1">
            <p className="truncate font-semibold">{product.shop?.name ?? product.seller}{product.sellerVerified && <VerifiedBadge className="ml-1" />}</p>
            {product.shop?.city && <p className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" /> {product.shop.city}</p>}
          </Link>
          <FollowButton sellerId={product.sellerId} />
        </div>
        <Link href={productHref(product)} className="block text-lg font-bold leading-tight hover:underline">{product.name}</Link>
        <div className="flex items-center justify-between">
          <p className="text-2xl font-extrabold text-primary">{formatPrice(Number(product.price))}</p>
          {product.stock !== 0 && <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600"><PackageCheck className="h-4 w-4" /> {t('In stock')}</span>}
        </div>
        {details.length > 0 && (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {details.map((d) => (
              <div key={d.label} className="rounded-xl bg-muted/60 px-3 py-2">
                <dt className="text-[11px] text-muted-foreground">{t(d.label)}</dt>
                <dd className="truncate font-semibold">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <Button variant="secondary" asChild><Link href={`/mirror?item=${product.id}`}><Wand2 className="mr-1.5 h-4 w-4" /> {t('Wear it')}</Link></Button>
          <Button disabled={product.stock === 0} onClick={() => { addToCart(product); toast({ title: t('Added to cart') }); }}><ShoppingCart className="mr-1.5 h-4 w-4" /> {t('Cart')}</Button>
          <MessageSellerButton product={product} size="icon" variant="outline" label={t('Message')} />
        </div>
        <Link href={`${productHref(product)}#questions`} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <HelpCircle className="h-4 w-4" /> {t('Ask the shop')}
          <MessageCircle className="ml-3 h-4 w-4" /> <span>{t('Reviews')}</span>
        </Link>
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
                <p className="px-1.5 pb-1.5 text-[11px] font-bold text-primary">{formatPrice(Number(p.price))}</p>
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
