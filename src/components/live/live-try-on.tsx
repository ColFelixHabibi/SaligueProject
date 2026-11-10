'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, RefreshCw, ShoppingBag, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { BeforeAfter } from '@/components/mirror/before-after';
import { PhotoInputs } from '@/components/mirror/outfit-studio';
import { useMirrorStore } from '@/hooks/use-mirror-store';
import { fileToImage, fitWithin } from '@/lib/ai/canvas';
import { REALISTIC_CATEGORIES, getRealistic, keepLook, realisticTryOn } from '@/lib/ai/studio';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { formatPrice } from '@/lib/orders';
import { outfitSlot } from '@/lib/outfit';
import type { Product } from '@/lib/types';

/**
 * Try on during a live: the item shown is drawn on the viewer's own photo (the Fitting Room one, or a new one
 * taken here), in a panel over the live — the live keeps playing and nobody leaves it.
 */
export function LiveTryOn({ product, price, onClose, onBuy }: { product: Product | null; price?: number; onClose: () => void; onBuy: (id: string) => void }) {
  const t = useT();
  const { personUrl, photoUrl, restore, setPerson } = useMirrorStore();
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => restore(), [restore]);
  useEffect(() => {
    void getRealistic().then(setReady);
  }, []);
  const photo = photoUrl ?? personUrl;
  const slot = product ? outfitSlot(product) : null;
  const drawable = !!slot && REALISTIC_CATEGORIES.includes(slot);

  const run = async () => {
    if (!product || !photo || !slot) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await realisticTryOn(photo, product.image, slot, [product.color, product.type ?? product.name].filter(Boolean).join(' ')));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (product && photo && drawable && ready) void run();
    // Once per item and photo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, photo, drawable, ready]);

  const usePhoto = async (file: File) => {
    // Used as it is (no cut-out needed for the realistic AI) and kept for the Fitting Room.
    const canvas = fitWithin(await fileToImage(file), 1400);
    setPerson(canvas, null, canvas);
  };

  return (
    <Sheet open={!!product} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="mx-auto flex max-h-[92dvh] max-w-md flex-col rounded-t-3xl px-4 min-[360px]:px-6">
        <SheetHeader><SheetTitle className="flex items-center gap-2 text-left"><Wand2 className="h-5 w-5 text-primary" /> {t('Try it on')}</SheetTitle></SheetHeader>
        {product && (
          <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pb-2">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={product.cutout || product.image} alt="" className="h-14 w-14 rounded-xl bg-muted object-contain p-1" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{product.name}</p>
                <p className="text-sm font-bold text-primary">{formatPrice(price ?? Number(product.price))}</p>
              </div>
            </div>
            {!photo ? (
              <div className="space-y-2 rounded-2xl border-2 border-dashed border-primary/40 p-4 text-center">
                <p className="text-sm font-semibold">{t('A photo of you, head to feet')}</p>
                <p className="text-xs text-muted-foreground">{t('Kept on this phone for the Fitting Room too.')}</p>
                <div className="flex justify-center"><PhotoInputs onFile={(f) => void usePhoto(f)} /></div>
              </div>
            ) : !drawable || ready === false ? (
              <p className="rounded-xl bg-muted p-3 text-sm">{t('This item is tried on in the Fitting Room.')} <Link href={`/mirror?item=${product.id}`} className="font-semibold text-primary underline">{t('Open it')}</Link></p>
            ) : busy || ready === null ? (
              <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 rounded-2xl bg-muted text-sm text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-primary" /> {t('Saligue AI is dressing you…')}
              </div>
            ) : result ? (
              <BeforeAfter before={photo} after={result} labels={[t('You now'), t('Wearing it')]} className="aspect-[3/4] w-full rounded-2xl" />
            ) : error ? (
              <div className="space-y-2 rounded-xl bg-muted p-3 text-sm">
                <p>{error}</p>
                <Button size="icon" variant="outline" onClick={run} aria-label={t('Try again')} title={t('Try again')}><RefreshCw className="h-4 w-4" /></Button>
              </div>
            ) : null}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Button className="h-12" disabled={product.stock === 0} onClick={() => {
                // Buying what the AI drew is the strongest vote for the AI that drew it (src/lib/ai/studio.ts).
                if (result && slot) keepLook(product.image, slot);
                onBuy(product.id);
                onClose();
              }}><ShoppingBag className="mr-2 h-5 w-5" /> {t('Buy')}</Button>
              {photo && <PhotoInputs onFile={(f) => void usePhoto(f)} compact />}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
