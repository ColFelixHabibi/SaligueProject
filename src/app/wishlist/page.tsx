
'use client';

import { useMemo } from 'react';
import ProductCard from '@/components/product-card';
import { useWishlist } from '@/hooks/use-wishlist';
import { useDashboardSearchStore } from '@/hooks/use-dashboard-search-store';
import { Heart } from 'lucide-react';

export default function WishlistPage() {
  const { wishlistItems } = useWishlist();
  const { searchQuery } = useDashboardSearchStore();

  const filteredItems = useMemo(() => {
    if (!searchQuery) {
      return wishlistItems;
    }
    return wishlistItems.filter(item =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery, wishlistItems]);

  return (
    <div className="container mx-auto py-8 px-4 md:py-12">
      <div className="text-center mb-12">
        <Heart className="mx-auto h-16 w-16 mb-4 text-accent" />
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight font-headline text-primary">My Saligue</h1>
        <p className="mt-4 text-lg md:text-xl text-muted-foreground">
          Your collection of favorite fashion items.
        </p>
      </div>

      {filteredItems.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredItems.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 border-2 border-dashed rounded-lg">
            <h2 className="text-2xl font-semibold text-muted-foreground">
              {searchQuery ? 'No items match your search' : 'Your wishlist is empty'}
            </h2>
            <p className="mt-2 text-muted-foreground">
              {searchQuery ? 'Try a different search term.' : 'Start exploring and add items you love!'}
            </p>
        </div>
      )}
    </div>
  );
}
