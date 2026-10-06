
'use client';

import { Suspense, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BadgeCheck, ShoppingCart, Wand2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ShopAddress } from '@/components/shop-address';
import { useProductStore } from '@/hooks/use-product-store';
import { useCart } from '@/hooks/use-cart-store';
import { useToast } from '@/hooks/use-toast';
import { categoryLabel } from '@/lib/categories';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

// INDECIANA's own display: its items open here, never on the generic product page.
function IndecianaStore() {
  const router = useRouter();
  const { toast } = useToast();
  const params = useSearchParams();
  const { products, isInitialized } = useProductStore();
  const { addToCart } = useCart();

  const collection = useMemo(() => products.filter((p) => p.official && p.status === 'active'), [products]);
  const selected = collection.find((p) => p.id === params.get('item')) ?? collection[0];

  const handleAdd = async () => {
    if (!selected) return;
    await addToCart(selected);
    toast({ title: 'Added to Cart', description: `${selected.name} has been added to your cart.` });
  };

  return (
    <div>
      <section className="bg-gradient-to-r from-primary to-secondary px-4 py-10 text-center text-primary-foreground md:py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] opacity-80">Saligue by</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-[0.15em] md:text-6xl">INDECIANA</h1>
        <p className="mx-auto mt-3 flex max-w-xl items-center justify-center gap-2 opacity-90">
          <BadgeCheck className="h-5 w-5" /> Official collection
        </p>
      </section>

      <div className="container mx-auto px-4 py-8 md:py-12">
        {!isInitialized ? (
          <Skeleton className="h-[480px] w-full" />
        ) : !selected ? (
          <div className="rounded-lg border-2 border-dashed py-16 text-center text-muted-foreground">
            INDECIANA&apos;s collection is coming soon.
          </div>
        ) : (
          <>
            <div className="grid gap-8 md:grid-cols-2">
              <Card className="overflow-hidden">
                <Image src={selected.image} alt={selected.name} width={700} height={900} className="aspect-[3/4] w-full object-cover" />
              </Card>
              <div className="space-y-5">
                <div>
                  <Badge>INDECIANA</Badge>
                  <h2 className="mt-3 text-3xl font-extrabold md:text-4xl">{selected.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{categoryLabel(selected.category)}</p>
                  <p className="mt-4 text-4xl font-bold text-primary">{formatPrice(Number(selected.price))}</p>
                </div>
                {selected.description && <p className="text-muted-foreground">{selected.description}</p>}
                <div className="flex flex-wrap gap-2 text-sm">
                  {[selected.size && `Size ${selected.size}`, selected.color, selected.brand, selected.condition].filter(Boolean).map((d) => (
                    <span key={d as string} className="rounded-full bg-muted px-3 py-1">{d}</span>
                  ))}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button size="lg" className="h-14 flex-1 text-lg" asChild>
                    <Link href={`/mirror?item=${selected.id}`}><Wand2 className="mr-2 h-5 w-5" /> Try it on</Link>
                  </Button>
                  <Button size="lg" variant="outline" className="h-14 flex-1 text-lg" onClick={handleAdd}>
                    <ShoppingCart className="mr-2 h-5 w-5" /> Add to Cart
                  </Button>
                </div>
                {selected.shop && (
                  <Card>
                    <CardContent className="p-4">
                      <ShopAddress shop={selected.shop} email={selected.sellerEmail} />
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            {collection.length > 1 && (
              <div className="mt-14">
                <h3 className="mb-6 text-2xl font-bold">The INDECIANA collection</h3>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {collection.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        router.replace(`/indeciana?item=${p.id}`, { scroll: false });
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className={cn('overflow-hidden rounded-lg border text-left transition hover:shadow-md', p.id === selected.id && 'ring-2 ring-primary')}
                    >
                      <Image src={p.image} alt={p.name} width={300} height={380} className="aspect-[4/5] w-full object-cover" />
                      <div className="p-2">
                        <p className="truncate text-sm font-semibold">{p.name}</p>
                        <p className="text-sm font-bold text-primary">{formatPrice(Number(p.price))}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
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
