'use client';

import { friendlyError } from '@/lib/errors';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BadgeCheck, Camera, Check, Download, Footprints, Glasses, GraduationCap, ImageUp, Loader2, Shirt,
  ShoppingBag, Sparkles, Trash2, Wand2, Watch, X, type LucideIcon,
} from 'lucide-react';
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
import { removeBackground } from '@/lib/ai/segment';
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
    <div className="flex gap-2">
      <Button type="button" size={compact ? 'sm' : 'lg'} onClick={() => cameraRef.current?.click()} disabled={disabled}>
        <Camera className="mr-2 h-4 w-4" /> {compact ? 'Retake' : 'Take photo'}
      </Button>
      <Button type="button" size={compact ? 'sm' : 'lg'} variant="secondary" onClick={() => galleryRef.current?.click()} disabled={disabled}>
        <ImageUp className="mr-2 h-4 w-4" /> Upload
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
  // True when Saligue AI Studio is reachable.
  studio: boolean;
  // Progress message while the shopper's photo is being prepared.
  photoBusy: string | null;
  onPhoto: (file: File) => void;
  onRemovePhoto: () => void;
  // What the shopper is wearing in the photo, so it can be taken off (null while unknown).
  parsing: Parsing | null;
}

/**
 * The fitting room: the shopper in a full-size mirror wearing the whole outfit, with a button for each
 * part of the body. Picking a part shows matching items in stock; tapping one puts it on.
 */
export function OutfitStudio({ products, person, landmarks, personUrl, studio, photoBusy, onPhoto, onRemovePhoto, parsing }: OutfitStudioProps) {
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
    enqueue(async () => {
      if (cancelled) return;
      const pieces = await Promise.all(outfit.map(async (p) => ({ canvas: await itemCutout(p), category: outfitSlot(p) })));
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
  useEffect(() => setRealisticUrl(null), [outfitKey, personUrl]);
  const redrawable = outfit.filter((p) => REALISTIC_CATEGORIES.includes(outfitSlot(p)));
  const makeRealistic = async () => {
    if (!personUrl || !person) return;
    try {
      let current = personUrl;
      const clothes = [...redrawable].sort((a, b) => REDRAW_ORDER.indexOf(outfitSlot(a)) - REDRAW_ORDER.indexOf(outfitSlot(b)));
      for (const [i, item] of clothes.entries()) {
        setRealisticBusy(`Saligue AI is dressing you (${i + 1}/${clothes.length})…`);
        current = await realisticTryOn(current, item.image, outfitSlot(item));
      }
      const others = outfit.filter((p) => !redrawable.includes(p));
      if (others.length) {
        setRealisticBusy('Adding shoes and accessories…');
        const cutout = await removeBackground(await loadImage(current), 'person');
        // The redrawn photo keeps the pose; scale the landmarks to its size.
        const sx = cutout.width / person.width, sy = cutout.height / person.height;
        const scaled = landmarks?.map((p) => ({ x: p.x * sx, y: p.y * sy, visibility: p.visibility })) ?? null;
        const pieces = await Promise.all(others.map(async (p) => ({ canvas: await itemCutout(p), category: outfitSlot(p) })));
        const flat = dressOutfit(cutout, scaled, pieces).canvas;
        const out = createCanvas(flat.width, flat.height);
        const ctx = context2d(out);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(flat, 0, 0);
        current = out.toDataURL('image/jpeg', 0.92);
      }
      setRealisticUrl(current);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Could not make it realistic', description: friendlyError(error) });
    } finally {
      setRealisticBusy(null);
    }
  };

  // One tap: wear the best match for every essential piece still missing (top, trousers, shoes).
  const completeAutomatically = () => {
    const picks = missingSlots(outfit).essential.flatMap((c) => rankForSlot(products, outfit, c, 1));
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

  const shownUrl = realisticUrl ?? lookUrl ?? personUrl;
  const busy = photoBusy ?? realisticBusy ?? (dressing && person ? 'Dressing you…' : null);

  const slotButton = ({ category, label, icon: Icon }: (typeof SLOTS)[number]) => {
    const item = wornIn(category);
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
          {item ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.cutout || item.image} alt="" className="h-full w-full object-contain p-0.5" />
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
        <div className="order-2 flex gap-2 overflow-x-auto border-t border-border p-3 md:order-1 md:flex-col md:overflow-y-auto md:border-r md:border-t-0">
          {slotButtons.map(slotButton)}
        </div>

        {/* The mirror */}
        <div className="relative order-1 aspect-[3/4] max-h-[78vh] w-full bg-[radial-gradient(ellipse_at_center,_#ffffff_0%,_#fde7f1_100%)] md:order-2 md:aspect-auto md:min-h-[560px]">
          {shownUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shownUrl} alt={outfit.length ? 'You wearing your outfit' : 'You'} className="absolute inset-0 h-full w-full object-contain p-3" />
          ) : !photoBusy ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-primary/40">
                <Camera className="h-9 w-9 text-primary" />
              </div>
              <div>
                <p className="text-xl font-bold">Step into the mirror</p>
                <p className="mt-1 text-sm text-muted-foreground">A full-body photo, head to feet, standing straight. It stays on your device.</p>
              </div>
              <PhotoInputs onFile={onPhoto} />
            </div>
          ) : null}

          {busy && (
            <div className="absolute inset-x-0 top-3 mx-auto flex w-fit items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium shadow backdrop-blur">
              <Loader2 className="h-4 w-4 animate-spin text-primary" /> {busy}
            </div>
          )}
          {realisticUrl && (
            <span className="absolute left-3 top-3 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">AI realistic</span>
          )}
          {missing.length > 0 && lookUrl && !realisticUrl && (
            <p className="absolute bottom-16 left-3 right-3 rounded-lg bg-background/90 px-2 py-1.5 text-center text-xs text-muted-foreground shadow">
              Not in your photo, so not shown: <b className="text-foreground">{missing.map(categoryLabel).join(', ')}</b>. Use a head-to-feet photo to wear them.
            </p>
          )}
          {personUrl && !photoBusy && (
            <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2">
              <PhotoInputs onFile={onPhoto} compact />
              <div className="flex gap-1">
                {shownUrl && (
                  <Button size="icon" variant="secondary" className="h-9 w-9" asChild>
                    <a href={shownUrl} download="saligue-outfit.png" aria-label="Save image"><Download className="h-4 w-4" /></a>
                  </Button>
                )}
                <Button size="icon" variant="secondary" className="h-9 w-9" onClick={onRemovePhoto} aria-label="Remove my photo">
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
          {outfit.length === 0 ? (
            <p className="text-sm text-muted-foreground">Pick a part of your body and tap an item to put it on — or let AI dress you.</p>
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
          <div className="mt-auto space-y-2 pt-2">
            {outfit.length > 0 && (
              <div className="flex items-baseline justify-between border-t border-border pt-2">
                <span className="text-sm text-muted-foreground">Whole outfit</span>
                <span className="text-xl font-extrabold text-primary">{formatPrice(total)}</span>
              </div>
            )}
            {missingSlots(outfit).essential.some((c) => inStock.has(c)) && (
              <Button className="w-full" variant="secondary" onClick={completeAutomatically}>
                <Wand2 className="mr-2 h-4 w-4" /> {outfit.length ? 'Complete my look' : 'Dress me in a full look'}
              </Button>
            )}
            {outfit.length > 0 && (
              <Button className="w-full" onClick={addOutfitToCart}>
                <ShoppingBag className="mr-2 h-4 w-4" /> Add whole outfit to bag
              </Button>
            )}
            {studio && person && redrawable.length > 0 && (realisticUrl ? (
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setRealisticUrl(null)}>
                Show quick preview
              </Button>
            ) : (
              <div className="space-y-1">
                <Button className="w-full bg-gradient-to-r from-primary to-accent" onClick={makeRealistic} disabled={!!realisticBusy || !lookUrl}>
                  <Sparkles className="mr-2 h-4 w-4" /> Make it realistic
                </Button>
                <p className="text-center text-[11px] text-muted-foreground">
                  AI redraws you wearing the clothes (about 20 s per piece). Sends your photo to Saligue&apos;s AI.
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* In-stock items for the chosen part of the body */}
      {activeSlot && (
        <div className="border-t border-border bg-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold">
              {SLOTS.find((s) => s.category === activeSlot)?.label} · <span className="font-normal text-muted-foreground">in stock, matched to your outfit by AI</span>
            </h3>
            {wornIn(activeSlot) && (
              <button type="button" onClick={() => takeOff(activeSlot)} className="text-xs text-muted-foreground hover:text-foreground">Take off</button>
            )}
          </div>
          {choices.length === 0 ? (
            <p className="px-1 py-4 text-sm text-muted-foreground">Nothing else in stock for this yet.</p>
          ) : (
            <div className="flex snap-x gap-3 overflow-x-auto pb-1">
              {choices.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => wear(p)}
                  className="group flex w-28 shrink-0 snap-start flex-col overflow-hidden rounded-xl border bg-background text-left ring-primary transition hover:ring-2"
                >
                  <span className="relative block aspect-square bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.cutout || p.image} alt={p.name} loading="lazy" className="h-full w-full object-contain p-1.5" />
                    {p.official && <BadgeCheck className="absolute left-1 top-1 h-4 w-4 text-foreground" aria-label="INDECIANA" />}
                    <span className="absolute inset-x-1 bottom-1 rounded-full bg-primary py-0.5 text-center text-[10px] font-bold text-primary-foreground opacity-0 transition group-hover:opacity-100">
                      Wear it
                    </span>
                  </span>
                  <span className="truncate px-2 pt-1 text-xs font-medium">{p.name}</span>
                  <span className="px-2 pb-1.5 text-xs font-bold text-primary">{formatPrice(Number(p.price))}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
