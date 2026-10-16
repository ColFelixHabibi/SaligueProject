'use client';

import { friendlyError } from '@/lib/errors';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Camera, Compass, Flame, Loader2, Search, SlidersHorizontal, Star, Wand2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import ProductCard from '@/components/product-card';
import { PageIntro } from '@/components/layout/page-intro';
import { useProductStore } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { CATEGORIES } from '@/lib/categories';
import type { Product } from '@/lib/types';
import { aiSearch, keywordSearch } from '@/lib/search';
import { fileToImage, trimTransparent } from '@/lib/ai/canvas';
import { removeBackground } from '@/lib/ai/segment';
import { embedImage, warmUpSearch } from '@/lib/ai/embed';
import { cn } from '@/lib/utils';

type Sort = 'relevance' | 'newest' | 'price-asc' | 'price-desc' | 'rating' | 'popular';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'relevance', label: 'Best match' },
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Top rated' },
  { value: 'popular', label: 'Most liked' },
];

type Filters = { categories: string[]; min?: number; max?: number; sizes: string[]; colors: string[]; minRating: number; inStock: boolean };
const NO_FILTERS: Filters = { categories: [], sizes: [], colors: [], minRating: 0, inStock: false };

const words = (value?: string) => (value ?? '').toUpperCase().split(/[\s,/]+/).filter(Boolean);

function FilterPanel({ filters, onChange, products }: { filters: Filters; onChange: (f: Filters) => void; products: Product[] }) {
  const toggle = (key: 'categories' | 'sizes' | 'colors', value: string) =>
    onChange({ ...filters, [key]: filters[key].includes(value) ? filters[key].filter((v) => v !== value) : [...filters[key], value] });
  // Only offer sizes and colours that exist in the shop.
  const sizes = useMemo(() => [...new Set(products.flatMap((p) => words(p.size)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 24), [products]);
  const colors = useMemo(() => [...new Set(products.map((p) => p.color?.trim()).filter(Boolean) as string[])].sort().slice(0, 20), [products]);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Category</h3>
        {CATEGORIES.map((c) => (
          <label key={c.value} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
            <Checkbox checked={filters.categories.includes(c.value)} onCheckedChange={() => toggle('categories', c.value)} /> {c.label}
          </label>
        ))}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Price ($)</h3>
        <div className="flex items-center gap-2">
          <Input type="number" min="0" inputMode="numeric" placeholder="Min" value={filters.min ?? ''} onChange={(e) => onChange({ ...filters, min: e.target.value ? Number(e.target.value) : undefined })} />
          <span className="text-muted-foreground">–</span>
          <Input type="number" min="0" inputMode="numeric" placeholder="Max" value={filters.max ?? ''} onChange={(e) => onChange({ ...filters, max: e.target.value ? Number(e.target.value) : undefined })} />
        </div>
      </section>
      {sizes.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Size</h3>
          <div className="flex flex-wrap gap-2">
            {sizes.map((s) => (
              <button key={s} type="button" onClick={() => toggle('sizes', s)} className={cn('h-9 min-w-10 rounded-lg border px-2 text-sm font-medium', filters.sizes.includes(s) ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>{s}</button>
            ))}
          </div>
        </section>
      )}
      {colors.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Colour</h3>
          {colors.map((c) => (
            <label key={c} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm capitalize">
              <Checkbox checked={filters.colors.includes(c)} onCheckedChange={() => toggle('colors', c)} /> {c}
            </label>
          ))}
        </section>
      )}
      <section className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Customer rating</h3>
        {[4, 3, 2].map((r) => (
          <button key={r} type="button" onClick={() => onChange({ ...filters, minRating: filters.minRating === r ? 0 : r })} className={cn('flex w-full items-center gap-1 rounded-md px-2 py-1 text-sm', filters.minRating === r ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-muted')}>
            {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={cn('h-4 w-4', i <= r ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />)}
            <span className="ml-1">& up</span>
          </button>
        ))}
      </section>
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Checkbox checked={filters.inStock} onCheckedChange={(v) => onChange({ ...filters, inStock: !!v })} /> In stock only
      </label>
    </div>
  );
}

function SearchContent() {
  const { toast } = useToast();
  const params = useSearchParams();
  const { products, isInitialized } = useProductStore();

  const [text, setText] = useState(params.get('q') ?? '');
  const [results, setResults] = useState<Product[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [queryPhoto, setQueryPhoto] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(() => ({ ...NO_FILTERS, categories: params.get('category') ? [params.get('category')!] : [] }));
  const [sort, setSort] = useState<Sort>('relevance');
  const searchId = useRef(0);
  const photoRef = useRef<HTMLInputElement>(null);

  const run = async (query: { text: string; imageEmbedding?: number[] }) => {
    const id = ++searchId.current;
    if (!query.text.trim() && !query.imageEmbedding) {
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
      run({ text });
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
      await run({ text: '', imageEmbedding: embedding });
    } catch (error: any) {
      console.error('Photo search failed:', error);
      toast({ variant: 'destructive', title: 'Photo search failed', description: friendlyError(error) });
      setBusy(null);
    }
  };

  const clearSearch = () => {
    searchId.current++;
    setText('');
    setQueryPhoto(null);
    setResults(null);
    setBusy(null);
  };

  const filterCount = filters.categories.length + filters.sizes.length + filters.colors.length + (filters.min !== undefined ? 1 : 0) + (filters.max !== undefined ? 1 : 0) + (filters.minRating ? 1 : 0) + (filters.inStock ? 1 : 0);

  const shown = useMemo(() => {
    const base = results ?? products.filter((p) => p.status === 'active');
    const list = base.filter((p) =>
      (!filters.categories.length || filters.categories.includes(p.category)) &&
      (filters.min === undefined || Number(p.price) >= filters.min) &&
      (filters.max === undefined || Number(p.price) <= filters.max) &&
      (!filters.sizes.length || words(p.size).some((s) => filters.sizes.includes(s))) &&
      (!filters.colors.length || filters.colors.some((c) => p.color?.trim() === c)) &&
      (!filters.minRating || (p.rating ?? 0) >= filters.minRating) &&
      (!filters.inStock || p.stock !== 0)
    );
    const sorted = [...list];
    if (sort === 'newest') sorted.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    if (sort === 'price-asc') sorted.sort((a, b) => Number(a.price) - Number(b.price));
    if (sort === 'price-desc') sorted.sort((a, b) => Number(b.price) - Number(a.price));
    if (sort === 'rating') sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0));
    if (sort === 'popular') sorted.sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0));
    return sorted;
  }, [results, products, filters, sort]);

  return (
    <div className="container mx-auto space-y-6 px-4 py-6 md:py-8">
      <PageIntro
        icon={Compass}
        title="Explore"
        subtitle="Shop every item on Saligue: search, filter by size, price and colour, and compare."
        links={[{ href: '/', label: 'For You', icon: Flame }, { href: '/mirror', label: 'Fitting Room', icon: Wand2 }]}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQueryPhoto(null);
            run({ text });
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={warmUpSearch}
              placeholder="Search items, brands, colours…"
              className="h-12 rounded-full border-0 bg-background pl-10 text-base text-foreground shadow"
              enterKeyHint="search"
            />
          </div>
          <Button type="submit" size="lg" variant="secondary" className="h-12 rounded-full px-6" disabled={!!busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
          </Button>
          <Button type="button" size="lg" variant="secondary" className="h-12 rounded-full px-4" onClick={() => photoRef.current?.click()} disabled={!!busy} aria-label="Search with a photo" title="Search with a photo">
            <Camera className="h-5 w-5" /><span className="ml-2 hidden sm:inline">Photo</span>
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
        </form>
      </PageIntro>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-6 rounded-2xl border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold">Filters</h2>
              {filterCount > 0 && <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setFilters(NO_FILTERS)}>Clear all</Button>}
            </div>
            <FilterPanel filters={filters} onChange={setFilters} products={products} />
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" className="h-10 lg:hidden">
                  <SlidersHorizontal className="mr-2 h-4 w-4" /> Filters{filterCount > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{filterCount}</span>}
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[85vw] max-w-sm overflow-y-auto">
                <SheetHeader className="mb-4"><SheetTitle>Filters</SheetTitle></SheetHeader>
                <FilterPanel filters={filters} onChange={setFilters} products={products} />
                {filterCount > 0 && <Button variant="outline" className="mt-6 w-full" onClick={() => setFilters(NO_FILTERS)}>Clear all</Button>}
              </SheetContent>
            </Sheet>
            <p className="text-sm text-muted-foreground">
              <b className="text-foreground">{shown.length}</b> {shown.length === 1 ? 'item' : 'items'}
              {results && (queryPhoto ? ' like your photo' : text ? <> for “{text}”</> : '')}
            </p>
            {queryPhoto && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={queryPhoto} alt="Item you searched with" className="h-9 w-9 rounded border bg-muted object-contain" />
            )}
            {(results || queryPhoto) && (
              <Button type="button" variant="ghost" size="sm" onClick={clearSearch}><X className="mr-1 h-4 w-4" /> Clear search</Button>
            )}
            {busy && <span className="flex items-center gap-1 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {busy}</span>}
            <div className="ml-auto flex items-center gap-2">
              <Label className="hidden text-sm text-muted-foreground sm:block">Sort by</Label>
              <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
                <SelectTrigger className="h-10 w-48"><SelectValue /></SelectTrigger>
                <SelectContent>{SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {!isInitialized ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4] w-full" />)}
            </div>
          ) : shown.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
              {shown.map((product) => <ProductCard key={product.id} product={product} />)}
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-dashed py-16 text-center text-muted-foreground">
              <p className="font-semibold text-foreground">No items match</p>
              <p className="mt-1 text-sm">Try fewer filters or other words.</p>
              {filterCount > 0 && <Button variant="outline" className="mt-4" onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>}
            </div>
          )}
        </div>
      </div>
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
