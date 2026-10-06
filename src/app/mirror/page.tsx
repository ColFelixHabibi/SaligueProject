
'use client';

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
import { useProductStore } from '@/hooks/use-product-store';
import { useMirrorStore } from '@/hooks/use-mirror-store';
import { useToast } from '@/hooks/use-toast';
import { CATEGORIES } from '@/lib/categories';
import type { Product } from '@/lib/types';
import { aiSearch, keywordSearch } from '@/lib/search';
import { context2d, createCanvas, fileToImage, fitWithin, loadImage, trimTransparent } from '@/lib/ai/canvas';
import { removeBackground } from '@/lib/ai/segment';
import { detectPose } from '@/lib/ai/pose';
import { embedImage, warmUpSearch } from '@/lib/ai/embed';
import { cn } from '@/lib/utils';

const DEFAULT_LOOKS = 8;

const checkerboard =
  'bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]';

function PhotoInputs({ onFile, disabled }: { onFile: (file: File) => void; disabled?: boolean }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onFile(file);
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button type="button" onClick={() => cameraRef.current?.click()} disabled={disabled}>
        <Camera className="mr-2 h-4 w-4" /> Take photo
      </Button>
      <Button type="button" variant="outline" onClick={() => galleryRef.current?.click()} disabled={disabled}>
        <ImageUp className="mr-2 h-4 w-4" /> Upload
      </Button>
      <input ref={cameraRef} type="file" accept="image/*" capture="user" className="sr-only" onChange={handle} />
      <input ref={galleryRef} type="file" accept="image/*" className="sr-only" onChange={handle} />
    </div>
  );
}

function Mirror() {
  const { toast } = useToast();
  const params = useSearchParams();
  const itemId = params.get('item');
  const { products, isInitialized } = useProductStore();
  const { personUrl, landmarks: normalizedLandmarks, restore, setPerson, clear } = useMirrorStore();

  useEffect(() => restore(), [restore]);

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
      toast({ variant: 'destructive', title: 'Could not create the outfit', description: error.message });
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
      toast({ variant: 'destructive', title: 'Could not process photo', description: error.message });
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

  const defaults = useMemo(() => {
    const active = products.filter((p) => p.status === 'active');
    const picked = itemId ? active.filter((p) => p.id === itemId) : [];
    const rest = active.filter((p) => p.id !== itemId).slice(0, DEFAULT_LOOKS - picked.length);
    return [...picked, ...rest];
  }, [products, itemId]);
  const shown = results ?? defaults;

  const runSearch = async (query: { text: string; category: string; imageEmbedding?: number[] }) => {
    const id = ++searchId.current;
    if (!query.text.trim() && !query.category && !query.imageEmbedding) {
      setResults(null);
      return;
    }
    if (!query.imageEmbedding) setResults(keywordSearch(products, query));
    setSearchBusy('AI is searching…');
    try {
      const found = await aiSearch(products, query, setSearchBusy);
      if (id === searchId.current) setResults(found);
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

  const handleItemPhoto = async (file: File) => {
    setSearchBusy('Reading item photo…');
    try {
      const img = await fileToImage(file);
      const cutout = trimTransparent(await removeBackground(img, 'item', setSearchBusy));
      setQueryPhoto(cutout.toDataURL('image/png'));
      const embedding = await embedImage(cutout, setSearchBusy);
      setText('');
      await runSearch({ text: '', category, imageEmbedding: embedding });
    } catch (error: any) {
      console.error('Photo search failed:', error);
      toast({ variant: 'destructive', title: 'Photo search failed', description: error.message });
      setSearchBusy(null);
    }
  };

  const clearSearch = () => {
    searchId.current++;
    setText('');
    setCategory('');
    setQueryPhoto(null);
    setResults(null);
    setSearchBusy(null);
  };

  const itemPhotoRef = useRef<HTMLInputElement>(null);

  return (
    <div className="container mx-auto px-4 py-6 md:py-10">
      <div className="mb-6 text-center md:mb-10">
        <h1 className="bg-gradient-to-r from-primary to-accent bg-clip-text text-4xl font-extrabold tracking-tight text-transparent md:text-5xl">
          Mirror My-Self
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
          Add your photo, search for anything, and see yourself wearing it. The AI runs on your device — your photo is never uploaded.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[320px_1fr] lg:grid-cols-[360px_1fr]">
        {/* Your photo */}
        <div className="md:sticky md:top-24 md:self-start">
          <Card>
            <CardContent className="space-y-4 p-4">
              <h2 className="text-lg font-semibold">1. Your photo</h2>
              {personBusy ? (
                <div className="flex aspect-[3/4] flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 text-center">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">{personBusy}</p>
                </div>
              ) : personUrl ? (
                <>
                  <div className={cn('relative aspect-[3/4] overflow-hidden rounded-lg border', checkerboard)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={personUrl} alt="You, background removed" className="absolute inset-0 h-full w-full object-contain" />
                  </div>
                  <PhotoInputs onFile={handlePersonFile} />
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="ghost" size="sm" asChild>
                      <a href={personUrl} download="saligue-me.png">
                        <Download className="mr-2 h-4 w-4" /> Save
                      </a>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={clear}>
                      <Trash2 className="mr-2 h-4 w-4" /> Remove
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex aspect-[3/4] flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 text-center text-muted-foreground">
                    <Camera className="h-12 w-12" />
                    <p className="font-medium text-foreground">Add a full-body photo</p>
                    <ul className="space-y-1 text-sm">
                      <li>Stand straight, facing the camera</li>
                      <li>Head to feet in the picture</li>
                      <li>Good light, fitted clothes</li>
                    </ul>
                  </div>
                  <PhotoInputs onFile={handlePersonFile} />
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Search and looks */}
        <div className="min-w-0 space-y-6">
          <Card>
            <CardContent className="space-y-4 p-4">
              <h2 className="text-lg font-semibold">2. Search clothes, shoes, anything</h2>
              <form onSubmit={handleSubmit} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onFocus={warmUpSearch}
                    placeholder="e.g. red dress, white sneakers, denim jacket"
                    className="h-11 pl-10"
                    enterKeyHint="search"
                  />
                </div>
                <Button type="submit" className="h-11" disabled={!!searchBusy}>
                  {searchBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
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
                    onClick={() => handleCategory(c.value)}
                  >
                    {c.label}
                  </Button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="secondary" onClick={() => itemPhotoRef.current?.click()} disabled={!!searchBusy}>
                  <Sparkles className="mr-2 h-4 w-4" /> Search with a photo of an item
                </Button>
                <input
                  ref={itemPhotoRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) handleItemPhoto(file);
                  }}
                />
                {queryPhoto && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={queryPhoto} alt="Item you searched with" className={cn('h-12 w-12 rounded border object-contain', checkerboard)} />
                )}
                {(results || queryPhoto) && (
                  <Button type="button" variant="ghost" size="sm" onClick={clearSearch}>
                    <X className="mr-1 h-4 w-4" /> Clear
                  </Button>
                )}
                {searchBusy && <span className="text-sm text-muted-foreground">{searchBusy}</span>}
              </div>
            </CardContent>
          </Card>

          {studio && personUrl && (
            <Card className="border-primary/30">
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">3. Dress me as I describe</h2>
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

          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {results ? `${results.length} ${results.length === 1 ? 'look' : 'looks'} found` : personUrl ? 'Looks for you' : 'Latest items'}
              </h2>
              {!personUrl && shown.length > 0 && (
                <span className="text-sm text-muted-foreground">Add your photo to see yourself in them</span>
              )}
            </div>

            {!isInitialized ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[3/4] w-full" />
                ))}
              </div>
            ) : shown.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed py-16 text-center text-muted-foreground">
                {results ? (
                  <>
                    <p>Nothing matched. Try other words or another photo.</p>
                    <Button variant="link" onClick={clearSearch}>
                      <RefreshCw className="mr-2 h-4 w-4" /> Show all items
                    </Button>
                  </>
                ) : (
                  <p>No items listed yet.</p>
                )}
              </div>
            ) : person ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((product) => (
                  <DressedCard key={product.id} product={product} person={person} landmarks={landmarks} personUrl={personUrl!} studio={studio} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
          </div>
        </div>
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
