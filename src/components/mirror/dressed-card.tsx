
'use client';

import { friendlyError } from '@/lib/errors';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Columns2, Download, Loader2, MapPin, RefreshCw, Shirt, Store } from 'lucide-react';
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
import type { Parsing } from '@/lib/ai/parse';
import { enqueue, itemCutout } from '@/lib/ai/cutout';
import { REALISTIC_CATEGORIES, realisticTryOn } from '@/lib/ai/studio';
import { productHref } from '@/lib/links';
import { BeforeAfter } from './before-after';

// Items that replace what the person is wearing (see dressOutfit's fabric swap).
const CLOTHES = new Set(['top', 'outerwear', 'dress', 'bottom']);

interface DressedCardProps {
  // What the shopper is wearing in the photo, so it can be taken off before dressing.
  // undefined while the photo is still being analysed: clothes then wait, so they're never pasted on top.
  parsing?: Parsing | null;
  product: Product;
  person: HTMLCanvasElement;
  landmarks: Point[] | null;
  // The shopper's photo as a data URL, used for realistic try-on on Saligue AI Studio.
  personUrl: string;
  // The photo as taken, with background: what the realistic AI dresses (falls back to personUrl).
  photoUrl?: string | null;
  // True when Saligue AI Studio is reachable.
  studio: boolean;
  // Called with the look image when the shopper picks this look.
  onChoose?: (image: string) => void;
  // Adds the item to the full outfit; `worn` is true when it is already part of it.
  onWear?: () => void;
  worn?: boolean;
  // Redraw the look with the realistic AI straight away (clothes only), instead of waiting for a tap.
  auto?: boolean;
  // Adds this look to (or removes it from) the comparison area.
  onCompare?: (image: string | null) => void;
  compared?: boolean;
}

export function DressedCard({ product, person, landmarks, parsing, personUrl, photoUrl, studio, onChoose, onWear, worn, auto, onCompare, compared }: DressedCardProps) {
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
      setRealisticUrl(await realisticTryOn(photoUrl ?? personUrl, product.image, product.category, [product.color, product.type ?? product.name].filter(Boolean).join(' ')));
    } catch (error: any) {
      setRealisticError(friendlyError(error));
    } finally {
      setRealisticBusy(false);
    }
  };
  useEffect(() => {
    if (auto && canBeRealistic) makeRealistic();
    // Once per item and photo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, canBeRealistic, product, personUrl, photoUrl]);

  // Clothes are only shown once the AI has really dressed the person in them: never pasted over what they
  // already wear. The pasted-on preview is used only when no realistic AI is reachable at all.
  // Shoes, hats, glasses and bags are placed on the device.
  const waitingForAi = canBeRealistic && !realisticUrl && (realisticBusy || (auto && !realisticError));
  const realBase = photoUrl ?? personUrl;
  const shownUrl = canBeRealistic ? realisticUrl ?? realBase : dressedUrl;
  // Compare against the photo as it was (before the item was put on).
  const afterUrl = canBeRealistic ? realisticUrl : dressedUrl;
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
      if (parsing === undefined && CLOTHES.has(category)) return;
      const result = dressPerson(person, landmarks, item, category, parsing);
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
  }, [product, person, landmarks, parsing]);

  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="relative aspect-[3/4] bg-gradient-to-b from-muted to-background">
        {afterUrl && !waitingForAi ? (
          <BeforeAfter before={canBeRealistic ? realBase : personUrl} after={afterUrl} className="absolute inset-0" />
        ) : shownUrl ? (
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
        {waitingForAi && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 p-4 text-center text-sm font-medium backdrop-blur-[2px]">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            {realisticBusy ? 'Saligue AI is dressing you in it…' : 'Waiting for Saligue AI…'}
            <span className="text-xs font-normal text-muted-foreground">About 20 seconds per look</span>
          </div>
        )}
        {canBeRealistic && realisticError && !realisticUrl && !realisticBusy && (
          <div className="absolute inset-x-2 top-1/3 flex flex-col items-center gap-2 rounded-xl bg-background/95 p-3 text-center text-sm shadow">
            <span>{realisticError ?? 'Saligue AI couldn’t dress you in it this time.'}</span>
            <Button size="sm" onClick={makeRealistic}><RefreshCw className="mr-1.5 h-4 w-4" /> Try again</Button>
          </div>
        )}
        {!canBeRealistic && dressedUrl && CLOTHES.has(product.category) && (
          <span className="absolute left-2 bottom-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium text-muted-foreground shadow">Quick preview</span>
        )}
        {note && dressedUrl && !realisticUrl && !waitingForAi && (
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
        {canBeRealistic && !realisticUrl && !waitingForAi && !realisticError && (
          <Button size="sm" className="w-full" onClick={makeRealistic} disabled={realisticBusy}>
            <Shirt className="mr-2 h-4 w-4" /> Dress me in it
          </Button>
        )}

        {onCompare && afterUrl && !waitingForAi && (
          <Button size="sm" variant={compared ? 'secondary' : 'outline'} className="w-full" onClick={() => onCompare(compared ? null : afterUrl)}>
            {compared ? <Check className="mr-2 h-4 w-4" /> : <Columns2 className="mr-2 h-4 w-4" />}
            {compared ? 'In comparison' : 'Compare'}
          </Button>
        )}
        {onWear && (
          <Button size="sm" variant={worn ? 'secondary' : 'default'} className="w-full" onClick={onWear} disabled={worn}>
            {worn ? <Check className="mr-2 h-4 w-4" /> : <Shirt className="mr-2 h-4 w-4" />}
            {worn ? 'In your outfit' : 'Wear it with my outfit'}
          </Button>
        )}
        <div className="mt-auto flex gap-2 pt-1">
          {onChoose ? (
            <Button size="sm" variant="outline" className="flex-1" onClick={() => shownUrl && onChoose(shownUrl)} disabled={!shownUrl}>
              <MapPin className="mr-1.5 h-4 w-4" /> Choose & find seller
            </Button>
          ) : (
            <Button variant="secondary" size="sm" className="flex-1" asChild>
              <Link href={productHref(product)}>View item</Link>
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
    </Card>
  );
}
