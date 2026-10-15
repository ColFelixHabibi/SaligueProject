
'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BadgeCheck, ShoppingBag, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ShopAddress } from '@/components/shop-address';
import { ActionRail } from '@/components/social/action-rail';
import { CommentsPanel } from '@/components/social/comments-panel';
import { useProductStore } from '@/hooks/use-product-store';
import { useCart } from '@/hooks/use-cart-store';
import { useToast } from '@/hooks/use-toast';
import { categoryLabel } from '@/lib/categories';
import { formatPrice } from '@/lib/orders';
import { BASE_PATH } from '@/lib/paths';
import { cn } from '@/lib/utils';
import { ReportButton } from '@/components/social/report-button';
import { SoundChip } from '@/components/social/sound-chip';

// INDECIANA's logo, if provided (public/brand/indeciana-logo.png). The wordmark is shown otherwise.
const LOGO = `${BASE_PATH}/brand/indeciana-logo.png`;

function Wordmark() {
  const [logoOk, setLogoOk] = useState(true);
  return logoOk ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={LOGO} alt="INDECIANA" className="mx-auto h-24 w-auto object-contain md:h-32" onError={() => setLogoOk(false)} />
  ) : (
    <h1 className="font-serif text-4xl font-light tracking-[0.18em] sm:text-6xl sm:tracking-[0.25em] md:text-8xl md:tracking-[0.3em]">INDECIANA</h1>
  );
}

// INDECIANA's own boutique: its items open here, never on the generic product page.
function IndecianaStore() {
  const router = useRouter();
  const { toast } = useToast();
  const params = useSearchParams();
  const { products, isInitialized } = useProductStore();
  const { addToCart } = useCart();
  const [filter, setFilter] = useState('');
  const [commentsOpen, setCommentsOpen] = useState(false);

  const collection = useMemo(() => products.filter((p) => p.official && p.status === 'active'), [products]);
  const categories = useMemo(() => [...new Set(collection.map((p) => p.category))], [collection]);
  const shown = filter ? collection.filter((p) => p.category === filter) : collection;
  const selected = collection.find((p) => p.id === params.get('item')) ?? collection[0];

  const select = (id: string) => {
    setCommentsOpen(false);
    router.replace(`/indeciana?item=${id}`, { scroll: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const add = async () => {
    if (!selected) return;
    await addToCart(selected);
    toast({ title: 'Added to bag', description: selected.name });
  };

  return (
    <div className="min-h-full bg-background text-foreground">
      <section className="border-b border-border px-4 py-14 text-center md:py-20">
        <p className="mb-6 text-[11px] font-semibold uppercase tracking-[0.5em] text-muted-foreground">Saligue presents</p>
        <Wordmark />
        <p className="mt-6 flex items-center justify-center gap-2 text-sm tracking-widest text-muted-foreground">
          <BadgeCheck className="h-4 w-4 text-primary" /> OFFICIAL HOUSE COLLECTION
        </p>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-10 md:py-14">
        {!isInitialized ? (
          <Skeleton className="h-[480px] w-full bg-muted" />
        ) : !selected ? (
          <div className="py-20 text-center">
            <p className="font-serif text-3xl tracking-widest">The collection arrives soon</p>
            <p className="mt-3 text-muted-foreground">INDECIANA&apos;s first pieces will appear here.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
              <div>
                <div className="overflow-hidden bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={selected.image} alt={selected.name} className="aspect-[4/5] w-full object-contain p-4" />
                </div>
                <div className="mt-2 rounded-md border bg-card text-foreground">
                  <div className="px-2 py-1">
                    <ActionRail product={selected} variant="bar" commentsOpen={commentsOpen} onToggleComments={() => setCommentsOpen((o) => !o)} />
                  </div>
                  {commentsOpen && <CommentsPanel productId={selected.id} sellerId={selected.sellerId} className="border-t p-3" />}
                </div>
              </div>

              <div className="flex flex-col gap-6 md:pt-6">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">{categoryLabel(selected.category)}</p>
                  <h2 className="mt-3 font-serif text-4xl font-light leading-tight md:text-5xl">{selected.name}</h2>
                  <p className="mt-5 text-2xl tracking-wider">{formatPrice(Number(selected.price))}</p>
                  <SoundChip key={selected.id} product={selected} autoPlay className="mt-3" />
                </div>
                {selected.description && <p className="leading-relaxed text-foreground/80">{selected.description}</p>}
                <dl className="grid grid-cols-2 gap-px overflow-hidden bg-border text-sm">
                  {[['Size', selected.size], ['Colour', selected.color], ['Brand', selected.brand], ['Condition', selected.condition]]
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k} className="bg-background p-4">
                        <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">{k}</dt>
                        <dd className="mt-1">{v}</dd>
                      </div>
                    ))}
                </dl>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Button size="lg" className="h-14 rounded-none bg-primary text-base text-primary-foreground hover:bg-primary/90" asChild>
                    <Link href={`/mirror?item=${selected.id}`}><Wand2 className="mr-2 h-5 w-5" /> Wear it</Link>
                  </Button>
                  <Button size="lg" variant="outline" className="h-14 rounded-none border-foreground bg-transparent text-base text-foreground hover:bg-foreground hover:text-background" onClick={add}>
                    <ShoppingBag className="mr-2 h-5 w-5" /> Add to bag
                  </Button>
                </div>
                <ReportButton product={selected} />
                {selected.shop && (
                  <div className="rounded-md border bg-card p-4 text-foreground">
                    <ShopAddress shop={selected.shop} email={selected.sellerEmail} />
                  </div>
                )}
              </div>
            </div>

            <section className="mt-20">
              <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
                <h3 className="font-serif text-3xl font-light tracking-widest">The collection</h3>
                {categories.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {['', ...categories].map((c) => (
                      <button
                        key={c || 'all'}
                        type="button"
                        onClick={() => setFilter(c)}
                        className={cn('border px-4 py-1.5 text-xs uppercase tracking-widest', filter === c ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-foreground')}
                      >
                        {c ? categoryLabel(c) : 'All'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">
                {shown.map((p) => (
                  <button key={p.id} type="button" onClick={() => select(p.id)} className="group text-left">
                    <div className={cn('overflow-hidden bg-muted', p.id === selected.id && 'ring-2 ring-primary ring-offset-4 ring-offset-background')}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.image} alt={p.name} loading="lazy" className="aspect-[4/5] w-full object-contain p-3 transition-transform duration-500 group-hover:scale-105" />
                    </div>
                    <p className="mt-3 truncate text-sm tracking-wide">{p.name}</p>
                    <p className="text-sm text-muted-foreground">{formatPrice(Number(p.price))}</p>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        <section className="mx-auto mt-24 max-w-2xl border-t border-border pt-12 text-center">
          <p className="text-[11px] uppercase tracking-[0.5em] text-muted-foreground">About</p>
          <p className="mt-4 font-serif text-2xl font-light leading-relaxed text-foreground/85">
            INDECIANA is the house behind Saligue — curated fashion you can try on with AI before you buy.
          </p>
        </section>
      </div>

    </div>
  );
}

export default function IndecianaPage() {
  return (
    <Suspense>
      <IndecianaStore />
    </Suspense>
  );
}
