'use client';

import { SaveImageButton } from '@/components/save-image-button';
import { friendlyError } from '@/lib/errors';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BadgeCheck, Camera, Check, Download, Footprints, Glasses, GraduationCap, ImageUp, Loader2, Shirt,
  ShoppingBag, Sparkles, Trash2, Wand2, Watch, X, type LucideIcon,
} from 'lucide-react';
import { BeforeAfter } from './before-after';
import { Button } from '@/components/ui/button';
import { useOutfitStore } from '@/hooks/use-outfit-store';
import { useCart } from '@/hooks/use-cart-store';
import { useToast } from '@/hooks/use-toast';
import type { Product } from '@/lib/types';
import type { Point } from '@/lib/ai/pose';
import type { Category } from '@/lib/categories';
import { missingSlots, outfitSlot, rankForSlot } from '@/lib/outfit';
import { dressOutfit } from '@/lib/ai/dress';
import type { Parsing } from '@/lib/ai/parse';
import { categoryLabel } from '@/lib/categories';
import { enqueue, itemCutout } from '@/lib/ai/cutout';
import { context2d, createCanvas, loadImage } from '@/lib/ai/canvas';
import { REALISTIC_CATEGORIES, realisticTryOn } from '@/lib/ai/studio';
import { productHref } from '@/lib/links';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

// The body, head to feet: one button per slot around the mirror.
const SLOTS: { category: Category; label: string; icon: LucideIcon }[] = [
  { category: 'hat', label: 'Hat', icon: GraduationCap },
  { category: 'eyewear', label: 'Glasses', icon: Glasses },
  { category: 'outerwear', label: 'Jacket', icon: Shirt },
  { category: 'top', label: 'Top', icon: Shirt },
  { category: 'dress', label: 'Dress', icon: Shirt },
  { category: 'bottom', label: 'Bottom', icon: Shirt },
  { category: 'shoes', label: 'Shoes', icon: Footprints },
  { category: 'bag', label: 'Bag', icon: ShoppingBag },
  { category: 'accessory', label: 'Extras', icon: Watch },
];
// The realistic redraw dresses the body in this order, so jackets end up over tops.
const REDRAW_ORDER = ['bottom', 'dress', 'top', 'outerwear'];

export function PhotoInputs({ onFile, disabled, compact }: { onFile: (file: File) => void; disabled?: boolean; compact?: boolean }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onFile(file);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {/* Compact (a photo is already there): two round icons, retake or change. */}
      <Button type="button" size={compact ? 'icon' : 'lg'} className={cn(compact && 'h-9 w-9 rounded-full')} onClick={() => cameraRef.current?.click()} disabled={disabled} aria-label="Retake photo" title="Retake photo">
        <Camera className={cn('h-4 w-4', !compact && 'mr-2')} /> {!compact && 'Camera'}
      </Button>
      <Button type="button" size={compact ? 'icon' : 'lg'} className={cn(compact && 'h-9 w-9 rounded-full')} variant="secondary" onClick={() => galleryRef.current?.click()} disabled={disabled} aria-label="Change photo" title="Change photo">
        <ImageUp className={cn('h-4 w-4', !compact && 'mr-2')} /> {!compact && 'Gallery'}
      </Button>
      <input ref={cameraRef} type="file" accept="image/*" capture="user" className="sr-only" onChange={handle} />
      <input ref={galleryRef} type="file" accept="image/*" className="sr-only" onChange={handle} />
    </div>
  );
}

interface OutfitStudioProps {
  products: Product[];
  person: HTMLCanvasElement | null;
  landmarks: Point[] | null;
  personUrl: string | null;
  // The photo as taken (with background): what the realistic AI dresses.
  photoUrl?: string | null;
  // True when Saligue AI Studio is reachable.
  studio: boolean;
  // Progress message while the shopper's photo is being prepared.
  photoBusy: string | null;
  onPhoto: (file: File) => void;
  onRemovePhoto: () => void;
  // What the shopper is wearing in the photo, so it can be taken off (null while unknown).
  parsing: Parsing | null | undefined;
}

/**
 * The fitting room: the shopper in a full-size mirror wearing the whole outfit, with a button for each
 * part of the body. Picking a part shows matching items in stock; tapping one puts it on.
 */
export function OutfitStudio({ products, person, landmarks, personUrl, photoUrl, studio, photoBusy, onPhoto, onRemovePhoto, parsing }: OutfitStudioProps) {
  const { toast } = useToast();
  const { addToCart } = useCart();
  const { slots, wear, takeOff, clear } = useOutfitStore();

  const outfit = useMemo(
    () => Object.values(slots).flatMap((id) => products.filter((p) => p.id === id && p.status === 'active')),
    [slots, products]
  );
  const wornIn = (category: Category) => outfit.find((p) => outfitSlot(p) === category);
  const total = outfit.reduce((sum, p) => sum + Number(p.price), 0);
  const outfitKey = outfit.map((p) => p.id).sort().join(',');

  // Slots that have something in stock (or are worn) get a button.
  const inStock = useMemo(
    () => new Set(products.filter((p) => p.status === 'active').map(outfitSlot)),
    [products]
  );
  const slotButtons = SLOTS.filter((s) => inStock.has(s.category) || wornIn(s.category));

  // The open slot: its matching items are shown under the mirror. Starts at the first missing essential.
  const [openSlot, setOpenSlot] = useState<Category | null>(null);
  const activeSlot = openSlot ?? missingSlots(outfit).essential.find((c) => inStock.has(c)) ?? slotButtons[0]?.category ?? null;
  const choices = useMemo(
    () => (activeSlot ? rankForSlot(products, outfit, activeSlot, 16) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, outfitKey, activeSlot]
  );

  // Quick on-device preview of the whole outfit.
  const [lookUrl, setLookUrl] = useState<string | null>(null);
  // Outfit items whose part of the body isn't in the photo.
  const [missing, setMissing] = useState<Category[]>([]);
  const [dressing, setDressing] = useState(false);
  useEffect(() => {
    if (!person || !outfit.length) {
      setLookUrl(null);
      return;
    }
    let cancelled = false;
    setDressing(true);
    // Only shoes, hats, glasses, bags and accessories are placed on the device. Clothes are never painted onto
    // the photo: only the realistic AI draws them, so they look worn instead of pasted on top.
    // Photos of someone wearing the item can't be cut out cleanly, so those items aren't placed on the device.
    const placeable = outfit.filter((p) => !REALISTIC_CATEGORIES.includes(outfitSlot(p)) && p.photoType !== 'worn');
    if (!placeable.length) {
      setLookUrl(null);
      setMissing([]);
      setDressing(false);
      return;
    }
    enqueue(async () => {
      if (cancelled) return;
      const pieces = await Promise.all(placeable.map(async (p) => ({ canvas: await itemCutout(p), category: outfitSlot(p) })));
      if (cancelled) return;
      const result = dressOutfit(person, landmarks, pieces, { parsing, showMissing: false });
      if (cancelled) return;
      // Keep showing the previous look until the new one is ready, so changing one item doesn't flash.
      setLookUrl(result.canvas.toDataURL('image/png'));
      setMissing(result.missing);
    })
      .catch((error) => {
        console.error('Dressing the outfit failed:', error);
        if (!cancelled) toast({ variant: 'destructive', title: 'Could not dress you', description: friendlyError(error) });
      })
      .finally(() => !cancelled && setDressing(false));
    return () => {
      cancelled = true;
    };
    // outfitKey stands for the outfit's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, landmarks, parsing, outfitKey]);

  // Realistic redraw on Saligue AI Studio: clothes are redrawn one after another,
  // then shoes, hats, glasses and bags are put on the redrawn photo on the device.
  const [realisticUrl, setRealisticUrl] = useState<string | null>(null);
  const [realisticBusy, setRealisticBusy] = useState<string | null>(null);
  const [realisticFailed, setRealisticFailed] = useState(false);
  const [realisticError, setRealisticError] = useState<string | null>(null);
  const runId = useRef(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  // What the photo shows: trousers need the legs, shoes the feet (pose landmarks: knees 25/26, ankles 27/28).
  const seen = (ids: number[]) => !landmarks || ids.some((i) => { const p = landmarks[i]; return !!p && (p.visibility ?? 1) > 0.5 && p.y > 0 && p.y < (person?.height ?? Infinity); });
  const legsVisible = seen([25, 26]);
  const feetVisible = seen([27, 28]);
  const fitsPhoto = (slot: Category) => (slot === 'bottom' ? legsVisible : slot === 'shoes' ? feetVisible : true);
  const redrawable = outfit.filter((p) => REALISTIC_CATEGORIES.includes(outfitSlot(p)) && fitsPhoto(outfitSlot(p)));
  // The AI only needs the photo: it never waits for the on-device cut-out (a slow first download on phones).
  const makeRealistic = async () => {
    if (!personUrl) return;
    const id = ++runId.current;
    const stale = () => id !== runId.current;
    setRealisticFailed(false);
    setSkipped(outfit.filter((p) => !fitsPhoto(outfitSlot(p))).map((p) => `${categoryLabel(outfitSlot(p))} (not in your photo)`));
    try {
      let current = photoUrl ?? personUrl;
      let drawn = 0;
      let lastError: unknown = null;
      const clothes = [...redrawable].sort((a, b) => REDRAW_ORDER.indexOf(outfitSlot(a)) - REDRAW_ORDER.indexOf(outfitSlot(b)));
      // Each piece on its own: one that can't be drawn cleanly is skipped (and said), the others still show.
      for (const [i, item] of clothes.entries()) {
        setRealisticBusy(`Saligue AI is dressing you (${i + 1}/${clothes.length})…`);
        try {
          current = await realisticTryOn(current, item.image, outfitSlot(item), [item.color, item.type ?? item.name].filter(Boolean).join(' '));
          drawn++;
        } catch (error) {
          lastError = error;
          if (/daily limit|back at/i.test(String((error as Error)?.message))) throw error;
          if (!stale()) setSkipped((s) => [...s, categoryLabel(outfitSlot(item))]);
        }
        if (stale()) return;
      }
      if (clothes.length && !drawn) throw lastError ?? new Error('The realistic AI could not dress you this time.');
      const others = outfit.filter((p) => !REALISTIC_CATEGORIES.includes(outfitSlot(p)) && fitsPhoto(outfitSlot(p)));
      if (others.length && person) {
        setRealisticBusy('Adding shoes and accessories…');
        // On the photo itself (no cut-out); the redrawn photo keeps the pose, so the landmarks are scaled to it.
        const base = await loadImage(current);
        const canvas = createCanvas(base.naturalWidth, base.naturalHeight);
        context2d(canvas).drawImage(base, 0, 0);
        const sx = canvas.width / person.width, sy = canvas.height / person.height;
        const scaled = landmarks?.map((p) => ({ x: p.x * sx, y: p.y * sy, visibility: p.visibility })) ?? null;
        const pieces = await Promise.all(others.map(async (p) => ({ canvas: await itemCutout(p), category: outfitSlot(p) })));
        current = dressOutfit(canvas, scaled, pieces).canvas.toDataURL('image/jpeg', 0.92);
      }
      if (!stale()) setRealisticUrl(current);
    } catch (error: any) {
      if (stale()) return;
      setRealisticFailed(true);
      setRealisticError(friendlyError(error));
    } finally {
      if (!stale()) setRealisticBusy(null);
    }
  };

  // Whenever the outfit or photo changes, the AI dresses the person in the clothes (after a short pause,
  // so picking several items in a row makes one look, not many).
  useEffect(() => {
    setRealisticUrl(null);
    setRealisticFailed(false);
    runId.current++;
    setRealisticBusy(null);
    if (!studio || !personUrl || !redrawable.length) return;
    const timer = setTimeout(makeRealistic, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outfitKey, personUrl, studio]);

  // One tap: wear the best match for every essential piece still missing (top, trousers, shoes).
  const completeAutomatically = () => {
    // Only what the photo shows: no trousers on a head-and-shoulders photo, no shoes without feet.
    const slots = missingSlots(outfit).essential.filter(fitsPhoto);
    const left = missingSlots(outfit).essential.filter((c) => !fitsPhoto(c));
    if (left.length) toast({ title: 'Your photo shows part of you', description: `For ${left.map(categoryLabel).join(' and ').toLowerCase()}, add a photo from head to feet.` });
    const picks = slots.flatMap((c) => rankForSlot(products, outfit, c, 1));
    if (!picks.length) {
      toast({ title: 'Nothing to add', description: 'There are no matching items in stock for the missing pieces yet.' });
      return;
    }
    picks.forEach((p) => wear(p));
    setOpenSlot(null);
  };

  const addOutfitToCart = async () => {
    try {
      for (const item of outfit) await addToCart(item);
      toast({ title: 'Outfit added to your bag', description: `${outfit.length} items · ${formatPrice(total)}` });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Could not add to bag', description: friendlyError(error) });
    }
  };

  // Clothes are only ever shown drawn by the AI: while it works, or if it fails, the shopper sees their own
  // photo (and a message), never clothes pasted on top. The on-device look is only for shoes, hats and bags.
  const waitingForAi = studio && redrawable.length > 0 && !realisticUrl && !realisticFailed;
  const shownUrl = realisticUrl ?? (studio && redrawable.length > 0 ? photoUrl ?? personUrl : lookUrl ?? personUrl);
  const busy = photoBusy ?? realisticBusy ?? (waitingForAi ? 'Saligue AI is getting ready to dress you…' : dressing && person ? 'Dressing you…' : null);

  // A real item from the shop pictures each part of the body (faded until something is worn there).
  const slotCovers = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products) if (p.status === 'active' && !map.has(outfitSlot(p))) map.set(outfitSlot(p), p.cutout || p.image);
    return map;
  }, [products]);

  const slotButton = ({ category, label, icon: Icon }: (typeof SLOTS)[number]) => {
    const item = wornIn(category);
    const cover = slotCovers.get(category);
    const active = activeSlot === category;
    return (
      <button
        key={category}
        type="button"
        onClick={() => setOpenSlot(category)}
        className={cn(
          'relative flex w-16 shrink-0 flex-col items-center gap-1 rounded-xl border p-1.5 text-[11px] font-medium transition',
          active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'
        )}
        aria-pressed={active}
      >
        <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg bg-muted">
          {item || cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item ? item.cutout || item.image : cover} alt="" className={cn('h-full w-full object-contain p-0.5', !item && 'opacity-40 grayscale')} />
          ) : (
            <Icon className="h-5 w-5 text-muted-foreground" />
          )}
        </span>
        {label}
        {item && <Check className="absolute right-1 top-1 h-3.5 w-3.5 rounded-full bg-primary p-0.5 text-primary-foreground" />}
      </button>
    );
  };

  return (
    <section className="overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xl">
      <div className="grid md:grid-cols-[88px_1fr_300px]">
        {/* Body slots: a column beside the mirror on wide screens, a row under it on phones. */}
        <div className="order-2 flex gap-2 overflow-x-auto border-t border-border p-3 md:order-1 md:flex-col md:overflow-visible md:border-r md:border-t-0">
          {slotButtons.map(slotButton)}
        </div>

        {/* The mirror, with its buttons underneath (never on top of the picture). */}
        <div className="order-1 flex min-w-0 flex-col md:order-2">
        <div className="relative aspect-[3/4] max-h-[78vh] w-full bg-[radial-gradient(ellipse_at_center,_#ffffff_0%,_#fde7f1_100%)] md:aspect-auto md:min-h-[560px] md:flex-1">
          {realisticUrl && personUrl ? (
            <BeforeAfter before={photoUrl ?? personUrl} after={realisticUrl} labels={['You now', 'In this outfit']} className="absolute inset-0 bg-transparent" />
          ) : shownUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shownUrl} alt={outfit.length ? 'You wearing your outfit' : 'You'} className="absolute inset-0 h-full w-full object-contain p-3" />
          ) : !photoBusy ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-primary/40">
                <Camera className="h-7 w-7 text-primary" />
              </div>
              <p className="text-sm font-medium">Your photo appears here</p>
            </div>
          ) : null}

          {busy && (
            <div className="absolute inset-x-0 top-3 mx-auto flex w-fit items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium shadow backdrop-blur">
              <Loader2 className="h-4 w-4 animate-spin text-primary" /> {busy}
            </div>
          )}
          {realisticFailed && redrawable.length > 0 && !realisticBusy && (
            <div className="absolute inset-x-3 top-14 z-10 space-y-2 rounded-xl bg-background/95 p-3 text-center text-sm shadow-lg">
              <p className="font-semibold">Your clothes aren’t drawn yet</p>
              <p className="text-xs text-muted-foreground">{realisticError ?? 'The realistic AI could not dress you this time.'} Clothes are only shown once the AI draws them on you, never pasted on top.</p>
              <Button size="sm" onClick={makeRealistic}>Try again</Button>
            </div>
          )}
          {skipped.length > 0 && realisticUrl && !realisticBusy && (
            <p className="absolute bottom-3 left-3 right-3 z-10 rounded-lg bg-background/90 px-2 py-1.5 text-center text-xs text-muted-foreground shadow">
              Not drawn: <b className="text-foreground">{skipped.join(', ')}</b>. Tap a piece to try it again, or use a head-to-feet photo.
            </p>
          )}
          {missing.length > 0 && lookUrl && !realisticUrl && (
            <p className="absolute bottom-3 left-3 right-3 rounded-lg bg-background/90 px-2 py-1.5 text-center text-xs text-muted-foreground shadow">
              Not in your photo, so not shown: <b className="text-foreground">{missing.map(categoryLabel).join(', ')}</b>. Use a head-to-feet photo to wear them.
            </p>
          )}
        </div>
          {personUrl && !photoBusy && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background p-2.5">
              <PhotoInputs onFile={onPhoto} compact />
              <div className="flex gap-1.5">
                {(realisticUrl ?? shownUrl) && (
                  <SaveImageButton size="icon" variant="outline" className="h-9 w-9" url={(realisticUrl ?? shownUrl)!} name="saligue-outfit.jpg" aria-label="Save image">
                    <Download className="h-4 w-4" />
                  </SaveImageButton>
                )}
                <Button size="icon" variant="outline" className="h-9 w-9 text-destructive" onClick={onRemovePhoto} aria-label="Remove my photo">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* The outfit and what it costs */}
        <div className="order-3 flex flex-col gap-3 border-t border-border p-4 md:border-l md:border-t-0">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Your outfit</h2>
            {outfit.length > 0 && (
              <button type="button" onClick={clear} className="text-xs text-muted-foreground hover:text-foreground">Undress all</button>
            )}
          </div>
          <div className="space-y-2">
            {outfit.length > 0 && (
              <div className="flex items-baseline justify-between border-t border-border pt-2">
                <span className="text-sm text-muted-foreground">Whole outfit</span>
                <span className="text-xl font-extrabold text-primary">{formatPrice(total)}</span>
              </div>
            )}
            {missingSlots(outfit).essential.some((c) => inStock.has(c)) && (
              <Button size="lg" className="h-12 w-full text-base" variant={outfit.length ? 'secondary' : 'default'} onClick={completeAutomatically}>
                <Wand2 className="mr-2 h-4 w-4" /> {outfit.length ? 'Complete my look' : 'Dress me in a full look'}
              </Button>
            )}
            {outfit.length > 0 && (
              <Button size="lg" className="h-12 w-full text-base" onClick={addOutfitToCart}>
                <ShoppingBag className="mr-2 h-4 w-4" /> Add whole outfit to bag
              </Button>
            )}
            {studio && person && redrawable.length > 0 && realisticFailed && (
              <Button className="w-full bg-gradient-to-r from-primary to-accent" onClick={makeRealistic} disabled={!!realisticBusy}>
                <Sparkles className="mr-2 h-4 w-4" /> Try the realistic AI again
              </Button>
            )}
            {studio && person && redrawable.length > 0 && (
              <p className="text-center text-[11px] text-muted-foreground">
                About 20 s per item
              </p>
            )}
          </div>
          {outfit.length === 0 ? (
            null
          ) : (
            <ul className="space-y-2">
              {SLOTS.flatMap((s) => {
                const p = wornIn(s.category);
                return p ? [p] : [];
              }).map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-lg bg-muted p-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.cutout || p.image} alt="" className="h-11 w-11 shrink-0 rounded bg-background object-contain p-0.5" />
                  <div className="min-w-0 flex-1">
                    <Link href={productHref(p)} className="block truncate text-sm font-medium hover:underline">{p.name}</Link>
                    <span className="text-xs text-muted-foreground">{formatPrice(Number(p.price))}</span>
                  </div>
                  <button type="button" onClick={() => takeOff(outfitSlot(p))} className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground" aria-label={`Take off ${p.name}`}>
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* In-stock items for the chosen part of the body */}
      {activeSlot && (
        <div className="border-t border-border bg-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold">
              {SLOTS.find((s) => s.category === activeSlot)?.label}
            </h3>
            {wornIn(activeSlot) && (
              <button type="button" onClick={() => takeOff(activeSlot)} className="text-xs text-muted-foreground hover:text-foreground">Take off</button>
            )}
          </div>
          {choices.length === 0 ? (
            <p className="px-1 py-4 text-sm text-muted-foreground">Nothing else in stock for this yet.</p>
          ) : (
            <div className="flex snap-x gap-3 overflow-x-auto pb-1">
              {choices.map((p, i) => {
                return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => wear(p)}
                  className={cn('group flex w-32 shrink-0 snap-start flex-col overflow-hidden rounded-xl border bg-background text-left ring-primary transition hover:ring-2', wornIn(activeSlot)?.id === p.id && 'ring-2')}
                >
                  <span className="relative block aspect-square bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.cutout || p.image} alt={p.name} loading="lazy" className="h-full w-full object-contain p-1.5" />
                    {i === 0 && <span className="absolute left-1 top-1 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-black">Best match</span>}
                    {p.official && <BadgeCheck className={cn("absolute left-1 h-4 w-4 text-foreground", i === 0 ? "top-6" : "top-1")} aria-label="INDECIANA" />}
                    <span className="absolute inset-x-1 bottom-1 rounded-full bg-primary py-1 text-center text-[11px] font-bold text-primary-foreground shadow">
                      Wear it
                    </span>
                  </span>
                  <span className="truncate px-2 pt-1 text-xs font-medium">{p.name}</span>
                  <span className="px-2 pb-1.5 text-xs font-bold text-primary">{formatPrice(Number(p.price))}</span>
                </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
