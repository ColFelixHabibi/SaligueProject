
'use client';

import { useProductStore } from '@/hooks/use-product-store';
import ProductCard from '@/components/product-card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Wand2 } from 'lucide-react';

export default function Home() {
  const { products, isInitialized } = useProductStore();

  const activeProducts = products.filter(p => p.status === 'active');

  if (!isInitialized) {
    return (
        <div className="container mx-auto py-8 px-4 md:py-12">
            <div className="text-center mb-12">
                <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight font-headline bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                Saligue
                </h1>
                <p className="mt-4 text-lg md:text-xl text-muted-foreground">
                Drip? AI’s got you.
                </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                        <Skeleton className="h-80 w-full" />
                        <Skeleton className="h-6 w-3/4" />
                        <Skeleton className="h-4 w-1/2" />
                    </div>
                ))}
            </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 md:py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight font-headline bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
          Saligue
        </h1>
        <p className="mt-4 text-lg md:text-xl text-muted-foreground">
          Drip? AI’s got you.
        </p>
        <p className="mx-auto mt-2 max-w-xl text-muted-foreground">
          Add your photo, search any item, and see yourself wearing it — then contact the owner directly.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button size="lg" asChild>
            <Link href="/mirror"><Wand2 className="mr-2 h-5 w-5" /> Mirror My-Self</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/search"><Search className="mr-2 h-5 w-5" /> AI Search</Link>
          </Button>
        </div>
      </div>

      <div id="mirror-my-self">
        {activeProducts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {activeProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 border-2 border-dashed rounded-lg">
            <h2 className="text-2xl font-semibold text-muted-foreground">
              No Products Yet
            </h2>
            <p className="mt-2 text-muted-foreground">
              Be the first to list an item for sale!
            </p>
            <Button asChild className="mt-4">
              <Link href="/sell">Sell Your First Item</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
