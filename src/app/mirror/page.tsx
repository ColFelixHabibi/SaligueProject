
'use client';

import { SaveImageButton } from '@/components/save-image-button';
import { friendlyError } from '@/lib/errors';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, Download, Loader2, RefreshCw, Search, Wand2, X } from 'lucide-react';
import { PageIntro } from '@/components/layout/page-intro';
import { dressAsDescribed, getRealistic, getStudio, isUnlimited } from '@/lib/ai/studio';
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
import type { Product } from '@/lib/types';
import { describeForm, formSearch, type WearForm } from '@/lib/search';
import { DescribeForm, hasWearForm } from '@/components/mirror/describe-form';
import { categoryLabel } from '@/lib/categories';
import { LocateSellerDialog } from '@/components/mirror/locate-seller';
import { context2d, createCanvas, fileToImage, fitWithin, loadImage, trimTransparent } from '@/lib/ai/canvas';
import { detectPose } from '@/lib/ai/pose';
import { embedImage, warmUpSearch } from '@/lib/ai/embed';
import { cn } from '@/lib/utils';

const checkerboard =
  'bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]';

// How many search results the realistic AI dresses the shopper in automatically: all of them with the paid
// try-on (no limit), otherwise the first few (the free AI has a daily limit).
const autoRealistic = () => (isUnlimited() ? Infinity : 4);
const PAGE = 10;
/** Keeps the ranking but alternates shops: the best item of each shop first, then each shop's second best… */
function byShops(list: Product[]) {
  const queues = new Map<string, Product[]>();
  for (const p of list) queues.set(p.sellerId ?? p.seller, [...(queues.get(p.sellerId ?? p.seller) ?? []), p]);
  const out: Product[] = [];
  while (out.length < list.length) for (const q of queues.values()) if (q.length) out.push(q.shift()!);
  return out;
}

function Mirror() {
  const { toast } = useToast();
  const params = useSearchParams();
  const itemId = params.get('item');
  const { products, isInitialized } = useProductStore();
  const { personUrl, photoUrl, landmarks: normalizedLandmarks, restore, setPerson, clear } = useMirrorStore();

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
  // "Make it realistic" also works without it, through the Saligue server.
  const [realistic, setRealistic] = useState(false);
  useEffect(() => {
    getStudio().then((url) => setStudio(!!url));
    getRealistic().then(setRealistic);
  }, []);

  const [outfitForm, setOutfitForm] = useState<WearForm>({});
  const outfitText = describeForm(outfitForm);
  const [outfitBusy, setOutfitBusy] = useState(false);
  const [outfitUrl, setOutfitUrl] = useState<string | null>(null);
  const handleDescribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personUrl || !outfitText) return;
    setOutfitBusy(true);
    try {
      setOutfitUrl(await dressAsDescribed(personUrl, outfitText));
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
  // undefined while the photo is still being analysed; null if the analysis can't run on this device.
  const [parsing, setParsing] = useState<Parsing | null | undefined>(undefined);
  const [parseBusy, setParseBusy] = useState<string | null>(null);
  useEffect(() => {
    setParsing(undefined);
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
  const photoRun = useRef(0);
  const handlePersonFile = async (file: File) => {
    const run = ++photoRun.current;
    setPersonBusy('Reading your photo…');
    try {
      const working = fitWithin(await fileToImage(file), 1600);
      // The photo stays exactly as taken (no background removal), and is ready at once: the try-on AI only needs
      // the photo. Finding the body (for shoes, hats and bags) runs after, and its first download can be slow.
      setPerson(working, null, working);
      setPersonBusy(null);
      void detectPose(working)
        .then((pose) => {
          if (run !== photoRun.current) return; // a newer photo was chosen meanwhile
          if (pose) setPerson(working, pose, working);
          else toast({ title: 'Body not found', description: 'Clothes still work. For shoes and accessories, use a photo of you standing, facing the camera, in good light.' });
        })
        .catch((error) => console.error('Finding the body failed:', error));
    } catch (error: any) {
      console.error('Processing photo failed:', error);
      toast({ variant: 'destructive', title: 'Could not process photo', description: friendlyError(error) });
    } finally {
      setPersonBusy(null);
    }
  };

  // Search from the "What do you want to wear?" form.
  const [wearForm, setWearForm] = useState<WearForm>({});
  const [results, setResults] = useState<Product[] | null>(null);
  const [searchBusy, setSearchBusy] = useState<string | null>(null);
  const searchId = useRef(0);

  // Ten at a time, best matches first but taken in turn from different shops, so the shopper sees themselves in
  // choices from across Saligue (each one dressed on their photo) and picks what suits them best.
  const [pages, setPages] = useState(1);
  useEffect(() => setPages(1), [results]);
  const mixed = useMemo(() => byShops(results ?? []), [results]);
  const shown = mixed.slice(0, PAGE * pages);
  const [chosen, setChosen] = useState<{ product: Product; image: string } | null>(null);

  // Comparison area: the shopper's own photo next to the looks they picked (up to four).
  const [compare, setCompare] = useState<{ product: Product; image: string }[]>([]);
  const toggleCompare = (product: Product, image: string | null) =>
    setCompare((list) => {
      const rest = list.filter((c) => c.product.id !== product.id);
      return image ? [...rest, { product, image }].slice(-4) : rest;
    });
  useEffect(() => setCompare([]), [personUrl]);

  const runSearch = async (form: WearForm) => {
    const id = ++searchId.current;
    if (!hasWearForm(form)) {
      setResults(null);
      return;
    }
    setSearchBusy('AI is finding your choices…');
    try {
      const found = await formSearch(products, form, setSearchBusy);
      if (id === searchId.current) setResults(found);
    } catch (error) {
      console.error('Search failed:', error);
      if (id === searchId.current) setResults([]);
    } finally {
      if (id === searchId.current) setSearchBusy(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(wearForm);
  };

  const clearSearch = () => {
    searchId.current++;
    setWearForm({});
    setResults(null);
    setSearchBusy(null);
  };

  // What the shopper chose, as chips under the form.
  const chosenChips = [
    wearForm.type ?? (wearForm.category && categoryLabel(wearForm.category)),
    wearForm.size && `Size ${wearForm.size}`,
    wearForm.color,
    wearForm.brand,
    wearForm.maxPrice && `Up to $${wearForm.maxPrice}`,
    wearForm.condition,
  ].filter(Boolean) as string[];

  return (
    <div className="container mx-auto px-4 pb-6 pt-3 md:py-10">
      {chosen && <LocateSellerDialog product={chosen.product} image={chosen.image} onClose={() => setChosen(null)} />}
      <PageIntro icon={Wand2} title="Fitting Room" subtitle="See yourself wearing it before you buy." className="mb-6" />

      <div className="space-y-6">
          {/* Step 1: a standing photo, so the AI can dress the person as they really are. Once it is ready it shrinks
              to a small strip (the photo and two icons), so the page is about what to wear. */}
          {personUrl && photoUrl && !personBusy ? (
            <div className="flex w-fit items-center gap-3 rounded-full border bg-card py-1 pl-1 pr-2 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={personUrl} alt="Your photo" className="h-12 w-10 rounded-full border bg-muted object-cover" />
              <span className="flex items-center gap-1 text-sm font-semibold text-emerald-600"><Check className="h-4 w-4" /> Your photo</span>
              <PhotoInputs onFile={handlePersonFile} compact />
            </div>
          ) : (
          <Card className={cn(!personUrl && 'border-2 border-dashed border-primary/50')}>
            <CardContent className="flex flex-wrap items-center gap-3 p-3 min-[360px]:gap-4 min-[360px]:p-4">
              {personUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={personUrl} alt="Your photo" className="h-24 w-20 shrink-0 rounded-lg border bg-gradient-to-b from-muted to-background object-contain" />
              ) : (
                <span className="flex h-24 w-20 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Wand2 className="h-8 w-8" /></span>
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="text-lg font-semibold">1. Your photo {personUrl && <span className="ml-1 text-sm font-medium text-emerald-600">✓ Ready</span>}</h2>
                <p className="text-sm text-muted-foreground">
                  {personBusy ?? (personUrl
                    ? photoUrl ? 'Ready to dress you.' : 'Add your photo again for a cleaner result.'
                    : 'Head to feet · standing · good light')}
                </p>
              </div>
              {/* Phones: the buttons get their own row under the photo. */}
              <div className="flex w-full items-center gap-2 sm:w-auto">
                {personBusy ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : <PhotoInputs onFile={handlePersonFile} compact={!!personUrl} />}
              </div>
            </CardContent>
          </Card>
          )}

          <Card>
            <CardContent className="space-y-4 p-4">
              <h2 className="text-lg font-semibold">2. What to wear</h2>
              <form onSubmit={handleSubmit} onFocus={warmUpSearch} className="space-y-4">
                <DescribeForm value={wearForm} onChange={setWearForm} products={products} />
                <Button type="submit" className="w-full" size="lg" disabled={!!searchBusy || !hasWearForm(wearForm)}>
                  {searchBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                  Show me the choices on me
                </Button>
              </form>
              {results && chosenChips.length > 0 && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="text-muted-foreground">Looking for:</span>
                  {chosenChips.map((label) => (
                    <span key={label} className="rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-primary">{label}</span>
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
                  3. {results ? `${shown.length} of ${results.length} ${results.length === 1 ? 'choice' : 'choices'}` : 'Your choices'} on you
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
                    <p>Nothing matched every choice. Try another size, colour, brand or a higher budget.</p>
                    <Button variant="link" onClick={clearSearch}>
                      <RefreshCw className="mr-2 h-4 w-4" /> Start again
                    </Button>
                  </>
                ) : (
                  <p className="px-6">Looking for matching items…</p>
                )}
              </div>
            ) : person ? (
              <>
              {compare.length > 0 && personUrl && (
                <Card className="mb-4 border-primary/40">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold">Compare your looks</h3>
                      <Button variant="ghost" size="sm" onClick={() => setCompare([])}><X className="mr-1 h-4 w-4" /> Clear</Button>
                    </div>
                    <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
                      <figure className="w-40 shrink-0 snap-start sm:w-48">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photoUrl ?? personUrl} alt="You now" className="aspect-[3/4] w-full rounded-lg border bg-gradient-to-b from-muted to-background object-contain p-1" />
                        <figcaption className="mt-1 text-center text-xs font-semibold text-muted-foreground">You now</figcaption>
                      </figure>
                      {compare.map(({ product, image }) => (
                        <figure key={product.id} className="relative w-40 shrink-0 snap-start sm:w-48">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={image} alt={`You wearing ${product.name}`} className="aspect-[3/4] w-full rounded-lg border-2 border-primary/50 bg-gradient-to-b from-muted to-background object-contain p-1" />
                          <button type="button" onClick={() => toggleCompare(product, null)} className="absolute right-1.5 top-1.5 rounded-full bg-background/90 p-1 shadow" aria-label={`Remove ${product.name} from comparison`}>
                            <X className="h-3.5 w-3.5" />
                          </button>
                          <figcaption className="mt-1 space-y-1 text-center text-xs">
                            <span className="block truncate font-semibold">{product.name}</span>
                            <span className="block font-bold text-primary">${Number(product.price).toFixed(2)}</span>
                            <Button size="sm" className="h-7 w-full text-xs" onClick={() => setChosen({ product, image })}>Choose this</Button>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((product, index) => (
                  <DressedCard key={product.id} auto={index < autoRealistic()} product={product} person={person} landmarks={landmarks} parsing={parsing} personUrl={personUrl!} photoUrl={photoUrl} studio={realistic} onChoose={(image) => setChosen({ product, image })} onWear={() => wear(product)} worn={wornIds.has(product.id)} onCompare={(image) => toggleCompare(product, image)} compared={compare.some((c) => c.product.id === product.id)} />
                ))}
              </div>
              {shown.length < mixed.length && (
                <Button variant="outline" className="mt-4 w-full" onClick={() => setPages((n) => n + 1)}>
                  <Wand2 className="mr-2 h-4 w-4" /> Show {Math.min(PAGE, mixed.length - shown.length)} more on me
                </Button>
              )}
              </>
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
            <h2 className="mb-3 text-xl font-semibold">Your full outfit</h2>
            <OutfitStudio
              products={products}
              person={person}
              landmarks={landmarks}
              personUrl={personUrl}
              photoUrl={photoUrl}
              studio={realistic}
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
                <form onSubmit={handleDescribe} className="space-y-4">
                  <DescribeForm value={outfitForm} onChange={setOutfitForm} products={products} compact />
                  <Button type="submit" disabled={outfitBusy || !outfitText}>
                    {outfitBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                    {outfitBusy ? 'Saligue AI is dressing you…' : 'Dress me'}
                  </Button>
                </form>
                {outfitUrl && (
                  <div className="space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={outfitUrl} alt="You in the described outfit" className="mx-auto max-h-[70vh] rounded-lg border object-contain" />
                    <div className="flex justify-center gap-2">
                      <SaveImageButton variant="outline" size="sm" url={outfitUrl} name="saligue-outfit.jpg"><Download className="mr-2 h-4 w-4" /> Save</SaveImageButton>
                      <Button variant="outline" size="sm" onClick={() => { setWearForm(outfitForm); runSearch(outfitForm); }}>
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
