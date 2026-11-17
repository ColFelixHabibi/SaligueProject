'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, GraduationCap, ShoppingBag, Wand2 } from 'lucide-react';
import { Price } from '@/components/price';
import { ensureProduct, useProductStore } from '@/hooks/use-product-store';
import { adClicked, adOnScreen, type Sponsored } from '@/lib/ads';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { productHref } from '@/lib/links';

/**
 * A Learning ad: one sponsored item, full screen, between two lessons — never over a lesson that is playing. It is
 * asked for only when the shopper scrolls close to it, for the lesson just before it, so that lesson's teacher is
 * paid their share of the view (server/ads.mjs). With no ad to show, nothing is left in the feed.
 */
export function LessonAdSlide({ afterLesson }: { afterLesson: string }) {
  const t = useT();
  const here = useRef<HTMLDivElement>(null);
  const [ad, setAd] = useState<Sponsored | null | undefined>(undefined);
  const product = useProductStore((s) => (ad ? s.products.find((p) => p.id === ad.productId) : undefined));

  // Ask for the ad one screen ahead, once.
  useEffect(() => {
    const element = here.current;
    if (!element || ad !== undefined) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      api<Sponsored[]>(`/ads?placement=learn&count=1&lesson=${encodeURIComponent(afterLesson)}`)
        .then(async ([first]) => {
          if (first) await ensureProduct(first.productId);
          setAd(first ?? null);
        })
        .catch(() => setAd(null));
    }, { rootMargin: '100% 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [afterLesson, ad]);

  // A view counts after a full second at least half on screen (src/lib/ads.ts).
  useEffect(() => {
    const element = here.current;
    if (!element || !ad || !product) return;
    const observer = new IntersectionObserver(([entry]) => adOnScreen(ad.serveId, entry.intersectionRatio >= 0.5), { threshold: [0, 0.5] });
    observer.observe(element);
    return () => {
      observer.disconnect();
      adOnScreen(ad.serveId, false);
    };
  }, [ad, product]);

  if (!ad || !product) return <div ref={here} aria-hidden className="h-px" />;
  const image = product.cutout || product.image;
  return (
    <section ref={here} className="relative flex h-full w-full snap-start snap-always flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-amber-100 via-background to-primary/10 px-6 pb-24 pt-20 text-center dark:from-amber-950/40">
      <p className="absolute left-4 top-16 flex items-center gap-1.5 rounded-full bg-background/80 px-3 py-1 text-xs font-semibold text-muted-foreground shadow-sm backdrop-blur md:top-20">
        <GraduationCap className="h-3.5 w-3.5 text-amber-600" /> {t('Sponsored')} · {t('supports this teacher')}
      </p>
      <Link href={productHref(product)} onClick={() => adClicked(ad.serveId)} className="block w-full max-w-xs">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={product.name} className="mx-auto aspect-square w-full rounded-3xl bg-background object-contain p-4 shadow-xl" />
      </Link>
      {ad.headline && <p className="mt-5 max-w-sm text-lg font-extrabold leading-tight">{ad.headline}</p>}
      <p className="mt-2 max-w-sm truncate font-semibold">{product.name}</p>
      <p className="text-lg font-bold text-primary"><Price product={product} /></p>
      <div className="mt-4 flex w-full max-w-xs gap-2">
        <Link href={productHref(product)} onClick={() => adClicked(ad.serveId)} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary font-bold text-primary-foreground shadow">
          <ShoppingBag className="h-5 w-5" /> {t('Shop')}
        </Link>
        <Link href={`/mirror?item=${product.id}`} onClick={() => adClicked(ad.serveId)} aria-label={t('Wear it')} title={t('Wear it')} className="flex h-12 w-12 items-center justify-center rounded-full border bg-background">
          <Wand2 className="h-5 w-5 text-primary" />
        </Link>
      </div>
      <p className="absolute inset-x-0 bottom-6 flex flex-col items-center text-xs text-muted-foreground">
        {t('Next lesson')} <ChevronDown className="h-4 w-4 animate-bounce" />
      </p>
    </section>
  );
}
