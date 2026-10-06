
'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Search, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import ProductCard from '@/components/product-card';
import { useProductStore } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { CATEGORIES } from '@/lib/categories';
import type { Product } from '@/lib/types';
import { aiSearch, keywordSearch } from '@/lib/search';
import { fileToImage, trimTransparent } from '@/lib/ai/canvas';
import { removeBackground } from '@/lib/ai/segment';
import { embedImage, warmUpSearch } from '@/lib/ai/embed';

function SearchContent() {
  const { toast } = useToast();
  const params = useSearchParams();
  const { products, isInitialized } = useProductStore();

  const [text, setText] = useState(params.get('q') ?? '');
  const [category, setCategory] = useState('');
  const [results, setResults] = useState<Product[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [queryPhoto, setQueryPhoto] = useState<string | null>(null);
  const searchId = useRef(0);
  const photoRef = useRef<HTMLInputElement>(null);

  const run = async (query: { text: string; category: string; imageEmbedding?: number[] }) => {
    const id = ++searchId.current;
    if (!query.text.trim() && !query.category && !query.imageEmbedding) {
      setResults(null);
      return;
    }
    if (!query.imageEmbedding) setResults(keywordSearch(products, query));
    setBusy('AI is searching…');
    try {
      const found = await aiSearch(products, query, setBusy);
      if (id === searchId.current) setResults(found);
    } catch (error) {
      console.error('AI search failed, keeping keyword results:', error);
    } finally {
      if (id === searchId.current) setBusy(null);
    }
  };

  // Search from the ?q= link once products are loaded.
  const ranInitial = useRef(false);
  useEffect(() => {
    if (isInitialized && !ranInitial.current && text) {
      ranInitial.current = true;
      run({ text, category });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialized]);

  const handlePhoto = async (file: File) => {
    setBusy('Reading item photo…');
    try {
      const cutout = trimTransparent(await removeBackground(await fileToImage(file), 'item', setBusy));
      setQueryPhoto(cutout.toDataURL('image/png'));
      const embedding = await embedImage(cutout, setBusy);
      setText('');
      await run({ text: '', category, imageEmbedding: embedding });
    } catch (error: any) {
      console.error('Photo search failed:', error);
      toast({ variant: 'destructive', title: 'Photo search failed', description: error.message });
      setBusy(null);
    }
  };

  const clear = () => {
    searchId.current++;
    setText('');
    setCategory('');
    setQueryPhoto(null);
    setResults(null);
    setBusy(null);
  };

  const shown = results ?? products.filter((p) => p.status === 'active');

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="mb-10 text-center">
        <h1 className="font-headline text-4xl font-extrabold tracking-tight text-primary md:text-5xl">Find Your Style</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
          Describe what you want or upload a photo of an item. AI on your device finds the closest matches.
        </p>
      </div>

      <Card className="mx-auto mb-12 max-w-3xl border-2 border-primary/10 shadow-lg">
        <CardContent className="space-y-4 p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQueryPhoto(null);
              run({ text, category });
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onFocus={warmUpSearch}
                placeholder="e.g. 'red leather jacket'"
                className="h-12 pl-10 text-lg"
                enterKeyHint="search"
              />
            </div>
            <Button type="submit" className="h-12" disabled={!!busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
            </Button>
          </form>

          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {CATEGORIES.map((c) => (
              <Button
                key={c.value}
                type="button"
                size="sm"
                variant={category === c.value ? 'default' : 'outline'}
                className="shrink-0 rounded-full"
                onClick={() => {
                  const next = category === c.value ? '' : c.value;
                  setCategory(next);
                  setQueryPhoto(null);
                  run({ text, category: next });
                }}
              >
                {c.label}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => photoRef.current?.click()} disabled={!!busy}>
              <Sparkles className="mr-2 h-4 w-4" /> Search with a photo
            </Button>
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) handlePhoto(file);
              }}
            />
            {queryPhoto && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={queryPhoto} alt="Item you searched with" className="h-12 w-12 rounded border bg-muted object-contain" />
            )}
            {(results || queryPhoto) && (
              <Button type="button" variant="ghost" size="sm" onClick={clear}>
                <X className="mr-1 h-4 w-4" /> Clear
              </Button>
            )}
            {busy && <span className="text-sm text-muted-foreground">{busy}</span>}
          </div>
        </CardContent>
      </Card>

      <h2 className="mb-8 text-center text-3xl font-bold">{results ? 'Search Results' : 'All Items'}</h2>
      {!isInitialized ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-full" />
          ))}
        </div>
      ) : shown.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {shown.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <p className="mt-8 text-center text-muted-foreground">
          {results ? 'No results found for your search.' : 'No items listed yet.'}
        </p>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchContent />
    </Suspense>
  );
}
