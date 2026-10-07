
'use client';

import { friendlyError } from '@/lib/errors';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Camera, Download, ImageUp, Loader2, RefreshCw, Search, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { dressAsDescribed, getStudio } from '@/lib/ai/studio';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import ProductCard from '@/components/product-card';
import { DressedCard } from '@/components/mirror/dressed-card';
import { OutfitStudio, PhotoInputs } from '@/components/mirror/outfit-studio';
import { parseClothes, type Parsing } from '@/lib/ai/parse';
import { useOutfitStore } from '@/hooks/use-outfit-store';
import { useProductStore } from '@/hooks/use-product-store';
import { useMirrorStore } from '@/hooks/use-mirror-store';
import { useToast } from '@/hooks/use-toast';
import { CATEGORIES } from '@/lib/categories';
import type { Product } from '@/lib/types';
import { aiSearch, describeSearch, type ParsedDescription } from '@/lib/search';
import { categoryLabel } from '@/lib/categories';
import { LocateSellerDialog } from '@/components/mirror/locate-seller';
import { context2d, createCanvas, fileToImage, fitWithin, loadImage, trimTransparent } from '@/lib/ai/canvas';
import { removeBackground } from '@/lib/ai/segment';
import { detectPose } from '@/lib/ai/pose';
import { embedImage, warmUpSearch } from '@/lib/ai/embed';
import { cn } from '@/lib/utils';

const checkerboard =
  'bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]';

function Mirror() {
  const { toast } = useToast();
  const params = useSearchParams();
  const itemId = params.get('item');
  const { products, isInitialized } = useProductStore();
  const { personUrl, landmarks: normalizedLandmarks, restore, setPerson, clear } = useMirrorStore();

  useEffect(() => restore(), [restore]);

  // The full outfit. Opening the Mirror from an item ("Wear it") puts that item on.
  const { slots, restore: restoreOutfit, wear } = useOutfitStore();
  useEffect(() => restoreOutfit(), [restoreOutfit]);
  const wornFrom = useRef<string | null>(null);
  useEffect(() => {
    if (!itemId || wornFrom.current === itemId || !isInitialized) return;
    const product = products.find((p) => p.id === itemId && p.status === 'active');
    if (!product) return;
    wornFrom.current = itemId;
    restoreOutfit();
    wear(product);
  }, [itemId, products, isInitialized, wear, restoreOutfit]);
  const wornIds = useMemo(() => new Set(Object.values(slots)), [slots]);

  // Saligue AI Studio (realistic redraw) is optional: on-device dressing works without it.
  const [studio, setStudio] = useState(false);
  useEffect(() => {
    getStudio().then((url) => setStudio(!!url));
  }, []);

  const [outfitText, setOutfitText] = useState('');
  const [outfitBusy, setOutfitBusy] = useState(false);
  const [outfitUrl, setOutfitUrl] = useState<string | null>(null);
  const handleDescribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personUrl || !outfitText.trim()) return;
    setOutfitBusy(true);
    try {
      setOutfitUrl(await dressAsDescribed(personUrl, outfitText.trim()));
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Could not create the outfit', description: friendlyError(error) });
    } finally {
      setOutfitBusy(false);
    }
  };

  // The shopper's cut-out as a canvas, plus landmarks in its pixel coordinates.
  const [person, setPersonCanvas] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!personUrl) {
      setPersonCanvas(null);
      return;
    }
    let cancelled = false;
    loadImage(personUrl).then((img) => {
      if (cancelled) return;
      const canvas = createCanvas(img.naturalWidth, img.naturalHeight);
      context2d(canvas).drawImage(img, 0, 0);
      setPersonCanvas(canvas);
    });
    return () => {
      cancelled = true;
    };
  }, [personUrl]);
  const landmarks = useMemo(
    () =>
      person && normalizedLandmarks
        ? normalizedLandmarks.map((p) => ({ x: p.x * person.width, y: p.y * person.height, visibility: p.visibility }))
        : null,
    [person, normalizedLandmarks]
  );

  // What the shopper is wearing in the photo, so new clothes replace it instead of going on top.
  const [parsing, setParsing] = useState<Parsing | null>(null);
  const [parseBusy, setParseBusy] = useState<string | null>(null);
  useEffect(() => {
    setParsing(null);
    if (!person) return;
    let cancelled = false;
    parseClothes(person, (message) => !cancelled && setParseBusy(message)).then((result) => {
      if (cancelled) return;
      setParsing(result);
      setParseBusy(null);
    });
    return () => {
      cancelled = true;
      setParseBusy(null);
    };
  }, [person]);

  const [personBusy, setPersonBusy] = useState<string | null>(null);
  const handlePersonFile = async (file: File) => {
    setPersonBusy('Reading your photo…');
    try {
      const working = fitWithin(await fileToImage(file), 1600);
      const cutout = await removeBackground(working, 'person', setPersonBusy);
      const pose = await detectPose(working, setPersonBusy);
      setPerson(cutout, pose);
      if (!pose) {
        toast({
          title: 'Body not found',
          description: 'We removed the background, but could not see your body clearly. Items will be shown next to you.',
        });
      }
    } catch (error: any) {
      console.error('Processing photo failed:', error);
      toast({ variant: 'destructive', title: 'Could not process photo', description: friendlyError(error) });
    } finally {
      setPersonBusy(null);
    }
  };

  // Search
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [results, setResults] = useState<Product[] | null>(null);
  const [searchBusy, setSearchBusy] = useState<string | null>(null);
  const [queryPhoto, setQueryPhoto] = useState<string | null>(null);
  const searchId = useRef(0);

  // Search results; the item the shopper came from is already in the outfit.
  const shown = results ?? [];

  const [parsed, setParsed] = useState<ParsedDescription | null>(null);
  const [chosen, setChosen] = useState<{ product: Product; image: string } | null>(null);

  const runSearch = async (query: { text: string; category: string; imageEmbedding?: number[] }) => {
    const id = ++searchId.current;
    if (!query.text.trim() && !query.category && !query.imageEmbedding) {
      setResults(null);
      setParsed(null);
      return;
    }
    setSearchBusy('AI is searching…');
    try {
      if (query.imageEmbedding) {
        const found = await aiSearch(products, query, setSearchBusy);
        if (id === searchId.current) {
          setResults(found);
          setParsed(null);
        }
      } else {
        const { results: found, parsed: understood } = await describeSearch(products, query.text, setSearchBusy);
        if (id === searchId.current) {
          setResults(found);
          setParsed(understood);
        }
      }
    } catch (error) {
      console.error('AI search failed, keeping keyword results:', error);
    } finally {
      if (id === searchId.current) setSearchBusy(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setQueryPhoto(null);
    runSearch({ text, category });
  };

  const handleCategory = (value: string) => {
    const next = value === category ? '' : value;
    setCategory(next);
    setQueryPhoto(null);
    runSearch({ text, category: next });
  };


  const clearSearch = () => {
    searchId.current++;
    setText('');
    setCategory('');
    setQueryPhoto(null);
    setResults(null);
    setParsed(null);
    setSearchBusy(null);
  };


  return (
    <div className="container mx-auto px-4 py-6 md:py-10">
      {chosen && <LocateSellerDialog product={chosen.product} image={chosen.image} onClose={() => setChosen(null)} />}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2 md:mb-6">
        <div>
          <h1 className="bg-gradient-to-r from-primary to-accent bg-clip-text text-3xl font-extrabold tracking-tight text-transparent md:text-4xl">
            Fitting Room
          </h1>
          <p className="text-sm text-muted-foreground">Wear a whole outfit — clothes, shoes, hat, glasses and bag — before you buy.</p>
        </div>
      </div>

      <div className="space-y-6">
          <Card>
            <CardContent className="space-y-4 p-4">
              <h2 className="text-lg font-semibold">1. Describe what you want to wear</h2>
              <form onSubmit={handleSubmit} className="space-y-3">
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onFocus={warmUpSearch}
                  placeholder="Type, size, colour, brand, budget… e.g. “size M blue jeans by Levi's” or “white sneakers 42”"
                  className="min-h-20 text-base"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => handleCategory(c.value)}
                      className={cn(
                        'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition',
                        category === c.value ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary hover:text-primary'
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <Button type="submit" className="w-full" disabled={!!searchBusy || (!text.trim() && !category)}>
                  {searchBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                  Show me the choices on me
                </Button>
              </form>
              {parsed && (parsed.category || parsed.size || parsed.color || parsed.brand) && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="text-muted-foreground">Understood:</span>
                  {[parsed.category && categoryLabel(parsed.category), parsed.size && `Size ${parsed.size}`, parsed.color, parsed.brand]
                    .filter(Boolean)
                    .map((label) => (
                      <span key={label as string} className="rounded-full bg-primary/10 px-2.5 py-0.5 font-medium capitalize text-primary">{label}</span>
                    ))}
                </div>
              )}
              {(results || searchBusy) && (
                <div className="flex flex-wrap items-center gap-3">
                  {results && (
                    <Button type="button" variant="ghost" size="sm" onClick={clearSearch}>
                      <X className="mr-1 h-4 w-4" /> Clear
                    </Button>
                  )}
                  {searchBusy && <span className="text-sm text-muted-foreground">{searchBusy}</span>}
                </div>
              )}
            </CardContent>
          </Card>

          {(results || searchBusy) && (
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  2. Compare {results ? `${results.length} ${results.length === 1 ? 'choice' : 'choices'}` : 'your choices'} on you
                </h2>
                {person && parseBusy && <p className="text-xs text-muted-foreground">{parseBusy}</p>}
              </div>
              {!personUrl && shown.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">Add your photo to see yourself in them:</span>
                  <PhotoInputs onFile={handlePersonFile} disabled={!!personBusy} compact />
                </div>
              )}
            </div>

            {!isInitialized ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[3/4] w-full" />
                ))}
              </div>
            ) : shown.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed py-16 text-center text-muted-foreground">
                {results ? (
                  <>
                    <p>Nothing matched. Try other words, another size or colour.</p>
                    <Button variant="link" onClick={clearSearch}>
                      <RefreshCw className="mr-2 h-4 w-4" /> Start again
                    </Button>
                  </>
                ) : (
                  <p className="px-6">Looking for matching items…</p>
                )}
              </div>
            ) : person ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((product) => (
                  <DressedCard key={product.id} product={product} person={person} landmarks={landmarks} parsing={parsing} personUrl={personUrl!} studio={studio} onChoose={(image) => setChosen({ product, image })} onWear={() => wear(product)} worn={wornIds.has(product.id)} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {shown.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
          </div>
          )}

          <div>
            <h2 className="mb-3 text-xl font-semibold">{results ? '3. Your full outfit' : '2. Your full outfit'}</h2>
            <OutfitStudio
              products={products}
              person={person}
              landmarks={landmarks}
              personUrl={personUrl}
              studio={studio}
              photoBusy={personBusy ?? parseBusy}
              onPhoto={handlePersonFile}
              onRemovePhoto={clear}
              parsing={parsing}
            />
          </div>

          {studio && personUrl && (
            <Card className="border-primary/30">
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">Dress me as I describe</h2>
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">Saligue AI</span>
                </div>
                <form onSubmit={handleDescribe} className="space-y-3">
                  <Textarea
                    value={outfitText}
                    onChange={(e) => setOutfitText(e.target.value)}
                    placeholder="e.g. a navy blue suit with a white shirt and brown leather shoes"
                    className="min-h-20"
                  />
                  <Button type="submit" disabled={outfitBusy || !outfitText.trim()}>
                    {outfitBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                    {outfitBusy ? 'Saligue AI is dressing you…' : 'Dress me'}
                  </Button>
                </form>
                {outfitUrl && (
                  <div className="space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={outfitUrl} alt="You in the described outfit" className="mx-auto max-h-[70vh] rounded-lg border object-contain" />
                    <div className="flex justify-center gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <a href={outfitUrl} download="saligue-outfit.jpg"><Download className="mr-2 h-4 w-4" /> Save</a>
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => { setText(outfitText); runSearch({ text: outfitText, category: '' }); }}>
                        <Search className="mr-2 h-4 w-4" /> Find similar items to buy
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

      </div>
    </div>
  );
}

export default function MirrorPage() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-10"><Skeleton className="h-96 w-full" /></div>}>
      <Mirror />
    </Suspense>
  );
}
