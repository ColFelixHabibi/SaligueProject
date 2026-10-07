
'use client';

import { friendlyError } from '@/lib/errors';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clapperboard, Download, Loader2, Sparkles, Store } from 'lucide-react';
import { VideoMaker } from '@/components/social/video-maker';
import { formatPrice } from '@/lib/orders';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ContactButtons } from '@/components/contact-buttons';
import { ShopAddress } from '@/components/shop-address';
import type { Product } from '@/lib/types';
import type { Point } from '@/lib/ai/pose';
import { categoryLabel, isCategory } from '@/lib/categories';
import { dressPerson } from '@/lib/ai/dress';
import { context2d, createCanvas, loadImage, trimTransparent } from '@/lib/ai/canvas';
import { removeBackground } from '@/lib/ai/segment';
import { REALISTIC_CATEGORIES, realisticTryOn } from '@/lib/ai/studio';
import { productHref } from '@/lib/links';

// Dressing is CPU heavy; run one at a time so the page stays responsive.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

const itemCutouts = new Map<string, Promise<HTMLCanvasElement>>();

function toCanvas(img: HTMLImageElement) {
  const canvas = createCanvas(img.naturalWidth, img.naturalHeight);
  context2d(canvas).drawImage(img, 0, 0);
  return canvas;
}

// The item without background: stored by the seller, or computed here for older listings.
function itemCutout(product: Product) {
  let cutout = itemCutouts.get(product.id);
  if (!cutout) {
    cutout = product.cutout
      ? loadImage(product.cutout).then(toCanvas)
      : loadImage(product.image).then(async (img) => trimTransparent(await removeBackground(img, 'item')));
    cutout.catch(() => itemCutouts.delete(product.id));
    itemCutouts.set(product.id, cutout);
  }
  return cutout;
}

interface DressedCardProps {
  product: Product;
  person: HTMLCanvasElement;
  landmarks: Point[] | null;
  // The shopper's photo as a data URL, used for realistic try-on on Saligue AI Studio.
  personUrl: string;
  // True when Saligue AI Studio is reachable.
  studio: boolean;
}

export function DressedCard({ product, person, landmarks, personUrl, studio }: DressedCardProps) {
  const [dressedUrl, setDressedUrl] = useState<string | null>(null);
  const [realisticUrl, setRealisticUrl] = useState<string | null>(null);
  const [realisticBusy, setRealisticBusy] = useState(false);
  const [realisticError, setRealisticError] = useState<string | null>(null);
  const canBeRealistic = studio && REALISTIC_CATEGORIES.includes(product.category);

  useEffect(() => {
    setRealisticUrl(null);
    setRealisticError(null);
  }, [product, personUrl]);

  const makeRealistic = async () => {
    setRealisticBusy(true);
    setRealisticError(null);
    try {
      setRealisticUrl(await realisticTryOn(personUrl, product.image, product.category));
    } catch (error: any) {
      setRealisticError(friendlyError(error));
    } finally {
      setRealisticBusy(false);
    }
  };
  const shownUrl = realisticUrl ?? dressedUrl;
  const [videoOpen, setVideoOpen] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDressedUrl(null);
    setFailed(false);
    enqueue(async () => {
      if (cancelled) return;
      const item = await itemCutout(product);
      if (cancelled) return;
      const category = isCategory(product.category) ? product.category : 'top';
      const result = dressPerson(person, landmarks, item, category);
      if (cancelled) return;
      setDressedUrl(result.canvas.toDataURL('image/png'));
      setNote(result.note);
    }).catch((error) => {
      console.error('Dressing failed:', error);
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [product, person, landmarks]);

  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="relative aspect-[3/4] bg-gradient-to-b from-muted to-background">
        {shownUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shownUrl} alt={`You wearing ${product.name}`} className="absolute inset-0 h-full w-full object-contain p-2" />
        ) : failed ? (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">
            Could not prepare this look.
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6">
            <Skeleton className="h-full w-2/3" />
            <span className="text-xs text-muted-foreground">Dressing you…</span>
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.cutout || product.image}
          alt={product.name}
          className="absolute bottom-2 right-2 h-16 w-16 rounded-md border bg-background/90 object-contain p-1 shadow"
        />
        {realisticBusy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 text-sm font-medium">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            Saligue AI is redrawing the outfit…
          </div>
        )}
        {realisticUrl && (
          <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">AI realistic</span>
        )}
        {note && dressedUrl && !realisticUrl && (
          <p className="absolute left-2 right-20 bottom-2 rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground">{note}</p>
        )}
      </div>
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <Link href={productHref(product)} className="font-semibold leading-tight hover:underline">
            {product.name}
          </Link>
          <span className="shrink-0 font-bold text-primary">${Number(product.price).toFixed(2)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">{categoryLabel(product.category)}</Badge>
          {product.size && <span>Size {product.size}</span>}
          {product.color && <span>· {product.color}</span>}
        </div>
        {product.shop ? (
          <ShopAddress shop={product.shop} email={product.sellerEmail} compact />
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm">
              <Store className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{product.seller}</span>
            </div>
            <ContactButtons contact={product.contact} email={product.sellerEmail} />
          </>
        )}
        {canBeRealistic && (
          <div className="space-y-1">
            {realisticUrl ? (
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setRealisticUrl(null)}>
                Show quick preview
              </Button>
            ) : (
              <Button size="sm" className="w-full" onClick={makeRealistic} disabled={realisticBusy || !dressedUrl}>
                <Sparkles className="mr-2 h-4 w-4" /> Make it realistic
              </Button>
            )}
            {realisticError && <p className="text-xs text-destructive">{realisticError}</p>}
          </div>
        )}
        <div className="mt-auto flex gap-2 pt-1">
          <Button variant="secondary" size="sm" className="flex-1" asChild>
            <Link href={productHref(product)}>View item</Link>
          </Button>
          {shownUrl && (
            <Button variant="outline" size="sm" onClick={() => setVideoOpen(true)} aria-label="Make a video">
              <Clapperboard className="h-4 w-4" />
            </Button>
          )}
          {shownUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={shownUrl} download={`saligue-${product.name.replace(/\W+/g, '-').toLowerCase()}.png`}>
                <Download className="h-4 w-4" />
                <span className="sr-only">Save image</span>
              </a>
            </Button>
          )}
        </div>
      </CardContent>
      {shownUrl && (
        <VideoMaker
          open={videoOpen}
          onOpenChange={setVideoOpen}
          imageUrl={shownUrl}
          title={product.name}
          subtitle={[formatPrice(Number(product.price)), product.shop?.name].filter(Boolean).join(' · ')}
        />
      )}
    </Card>
  );
}
