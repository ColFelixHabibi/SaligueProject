
'use client';

import { friendlyError } from '@/lib/errors';

import { useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { CATEGORIES } from '@/lib/categories';
import { prepareItemPhoto, type PreparedItemPhoto } from '@/lib/image';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const checkerboard =
  'bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]';

interface ItemPhotoFieldProps {
  photo: Partial<PreparedItemPhoto> | null;
  onPhotoChange: (photo: PreparedItemPhoto) => void;
  onBusyChange?: (busy: boolean) => void;
}

/** Upload for an item photo. Removes the background and computes the AI fingerprint on the device. */
export function ItemPhotoField({ photo, onPhotoChange, onBusyChange }: ItemPhotoFieldProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('Preparing photo…');
    onBusyChange?.(true);
    try {
      const prepared = await prepareItemPhoto(file, setBusy);
      // Saligue is fashion-only: the server's AI looks at the photo before the seller fills in the rest.
      setBusy('Checking it is a fashion item…');
      const check = await api<{ fashion: boolean; looksLike: string | null }>('/ai/fashion-check', { body: { image: prepared.cutout || prepared.image } })
        .catch(() => ({ fashion: true, looksLike: null }));
      if (!check.fashion) {
        toast({
          variant: 'destructive',
          title: 'Only fashion can be sold on Saligue',
          description: `This photo looks like ${check.looksLike}. Add a photo of clothes, shoes, a bag or an accessory.`,
        });
        return;
      }
      onPhotoChange(prepared);
    } catch (error: any) {
      console.error('Preparing item photo failed:', error);
      toast({ variant: 'destructive', title: 'Image Error', description: friendlyError(error) });
    } finally {
      setBusy(null);
      onBusyChange?.(false);
    }
  };

  const preview = photo?.cutout || photo?.image;

  return (
    <div className="space-y-2">
      <Label htmlFor="image-upload" className="text-lg font-medium">Product Image</Label>
      <label
        htmlFor="image-upload"
        className={cn(
          'relative flex h-80 w-full cursor-pointer items-center justify-center rounded-lg border-2 border-dashed text-muted-foreground transition-colors hover:border-primary',
          photo?.cutout ? checkerboard : 'bg-muted/20'
        )}
      >
        {busy ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <span>{busy}</span>
          </div>
        ) : preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Preview" className="absolute inset-0 h-full w-full object-contain p-2" />
        ) : (
          <div className="flex flex-col items-center text-center">
            <Upload className="mb-2 h-12 w-12" />
            <span>Click to upload a photo of the item</span>
            <span className="text-sm">AI removes the background so buyers can wear it in their outfit</span>
            <span className="mt-1 text-xs">Fashion only: clothes, shoes, bags and accessories</span>
          </div>
        )}
      </label>
      <input id="image-upload" type="file" className="sr-only" accept="image/*" onChange={handleFile} disabled={!!busy} />
      {photo?.cutout && !busy && (
        <p className="text-sm text-muted-foreground">Background removed. Buyers will see this item on themselves.</p>
      )}
    </div>
  );
}

export function CategoryField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="category" className="text-lg font-medium">Category</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="category" className="h-12 text-base">
          <SelectValue placeholder="What kind of item is it?" />
        </SelectTrigger>
        <SelectContent>
          {CATEGORIES.map((c) => (
            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
