'use client';

import { useRef, useState } from 'react';
import { ChevronLeft, ImagePlus, Loader2, X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { compressImage } from '@/lib/image';
import { cn } from '@/lib/utils';

/** An item holds up to 10 pictures and videos: 10 photos, or 9 photos and a video (as the server checks). */
export const ITEM_MEDIA_MAX = 10;

/** How many more photos fit after the first photo, given whether the item has a video. */
export const morePhotosRoom = (hasVideo: boolean) => ITEM_MEDIA_MAX - 1 - (hasVideo ? 1 : 0);

/** A photo after the first: one already on the item (a /media/ link) or one just chosen (a data URL). */
export type MorePhoto = string;
const isNew = (p: MorePhoto) => p.startsWith('data:');
// The app shows photos at a full address (https://…/media/x.jpg); the server knows them by their /media/ link.
const link = (p: string) => (isNew(p) || !p.includes('/media/') ? p : p.slice(p.indexOf('/media/')));

/**
 * Saves an item's more photos in the order shown: photos taken off go first (so they free their place), new ones
 * are sent one by one (each is too big to send together), then the order is set.
 */
export async function saveMorePhotos(productId: string, wanted: MorePhoto[], had: string[] = [], onProgress?: (done: number, total: number) => void) {
  wanted = wanted.map(link);
  had = had.map(link);
  const kept = wanted.filter((p) => !isNew(p));
  if (kept.length !== had.length || kept.some((p, i) => p !== had[i])) {
    await api(`/products/${productId}/photos`, { method: 'PUT', body: { photos: kept } });
  }
  const fresh = wanted.filter(isNew);
  if (!fresh.length) return;
  const links = new Map<string, string>();
  let done = 0;
  onProgress?.(done, fresh.length);
  for (const photo of fresh) {
    const { photos } = await api<{ photos: string[] }>(`/products/${productId}/photos`, { method: 'POST', body: { image: photo } });
    links.set(photo, photos[photos.length - 1]);
    onProgress?.(++done, fresh.length);
  }
  // New photos were added at the end: put them back where the shop placed them.
  const order = wanted.map((p) => links.get(p) ?? p);
  const now = [...kept, ...fresh.map((p) => links.get(p)!)];
  if (order.some((p, i) => p !== now[i])) {
    await api(`/products/${productId}/photos`, { method: 'PUT', body: { photos: order } });
  }
}

/** "More photos": up to 9 after the first (8 with a video), in a row the shop can reorder, like a photo post. */
export function MorePhotosField({ photos, onChange, hasVideo, busy }: {
  photos: MorePhoto[];
  onChange: (photos: MorePhoto[]) => void;
  hasVideo: boolean;
  // Sending progress while saving ("2 / 5").
  busy?: string | null;
}) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const room = morePhotosRoom(hasVideo);
  const left = room - photos.length;

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    const picked = [...files].filter((f) => !f.type || f.type.startsWith('image/'));
    const taken = picked.slice(0, Math.max(0, left));
    if (picked.length > taken.length) {
      toast({ title: `${taken.length ? `Only ${taken.length} added` : 'No more photos fit'}`, description: `An item has up to ${ITEM_MEDIA_MAX} photos and videos: ${ITEM_MEDIA_MAX} photos, or ${ITEM_MEDIA_MAX - 1} and a video.` });
    }
    if (!taken.length) return;
    setPreparing(true);
    try {
      const ready = await Promise.all(taken.map((f) => compressImage(f)));
      onChange([...photos, ...ready.filter((p, i, all) => !photos.includes(p) && all.indexOf(p) === i)]);
    } catch {
      toast({ variant: 'destructive', title: 'Photo not added', description: 'This photo could not be read. Try another one.' });
    } finally {
      setPreparing(false);
      if (input.current) input.current.value = '';
    }
  };
  const move = (i: number) => {
    if (i <= 0) return;
    const next = [...photos];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-lg font-medium">More photos <span className="text-sm font-normal text-muted-foreground">(optional, up to {room})</span></Label>
        <span className="text-xs font-semibold text-muted-foreground">{busy ?? `${photos.length + 1 + (hasVideo ? 1 : 0)} / ${ITEM_MEDIA_MAX}`}</span>
      </div>
      <p className="text-sm text-muted-foreground">Other sides, details, the label, someone wearing it. Shoppers swipe through them; the first photo stays the cover.</p>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {photos.map((p, i) => (
          <div key={p.slice(-40) + i} className="group relative aspect-[3/4] overflow-hidden rounded-lg border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p} alt={`Photo ${i + 2}`} className="h-full w-full object-cover" />
            <span className="absolute left-1 top-1 rounded bg-black/55 px-1.5 text-[10px] font-bold text-white">{i + 2}</span>
            <button type="button" onClick={() => onChange(photos.filter((_, j) => j !== i))} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white" aria-label="Remove photo"><X className="h-3.5 w-3.5" /></button>
            {i > 0 && (
              <button type="button" onClick={() => move(i)} className="absolute bottom-1 left-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white" aria-label="Move earlier" title="Move earlier"><ChevronLeft className="h-4 w-4" /></button>
            )}
          </div>
        ))}
        {left > 0 && (
          <button type="button" onClick={() => input.current?.click()} disabled={preparing}
            className={cn('flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-xs font-semibold text-muted-foreground transition hover:border-primary hover:text-primary', preparing && 'opacity-60')}>
            {preparing ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
            <span>{preparing ? 'Preparing…' : `Add (${left} left)`}</span>
          </button>
        )}
      </div>
      {hasVideo && photos.length >= room && <p className="text-xs text-muted-foreground">With a video, an item has up to {room} more photos. Remove the video for one more.</p>}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
    </div>
  );
}
