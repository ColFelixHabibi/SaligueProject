
'use client';

import { friendlyError } from '@/lib/errors';

import { useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { CATEGORIES, typesOf } from '@/lib/categories';
import { prepareItemPhoto, type PreparedItemPhoto } from '@/lib/image';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';


export type FashionSuggestion = { category: string; type: string | null; from: number };

interface ItemPhotoFieldProps {
  photo: Partial<PreparedItemPhoto> | null;
  // The item alone, or someone wearing it.
  photoType?: 'item' | 'worn';
  onPhotoTypeChange?: (type: 'item' | 'worn') => void;
  onPhotoChange: (photo: PreparedItemPhoto) => void;
  onBusyChange?: (busy: boolean) => void;
  // What the AI thinks the item is, learned from similar items in the shop.
  onSuggestion?: (suggestion: FashionSuggestion) => void;
}

/** Upload for an item photo, kept as taken (the item alone, or someone wearing it). */
export function ItemPhotoField({ photo, photoType = 'item', onPhotoTypeChange, onPhotoChange, onBusyChange, onSuggestion }: ItemPhotoFieldProps) {
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
      const check = await api<{ fashion: boolean; looksLike: string | null; suggestion: FashionSuggestion | null }>('/ai/fashion-check', {
        body: { image: prepared.image },
      }).catch(() => ({ fashion: true, looksLike: null, suggestion: null }));
      if (!check.fashion) {
        toast({
          variant: 'destructive',
          title: 'Only fashion can be sold on Saligue',
          description: `This photo looks like ${check.looksLike}. Add a photo of clothes, shoes, a bag or an accessory.`,
        });
        return;
      }
      onPhotoChange(prepared);
      if (check.suggestion) onSuggestion?.(check.suggestion);
    } catch (error: any) {
      console.error('Preparing item photo failed:', error);
      toast({ variant: 'destructive', title: 'Image Error', description: friendlyError(error) });
    } finally {
      setBusy(null);
      onBusyChange?.(false);
    }
  };

  const preview = photo?.image;

  return (
    <div className="space-y-2">
      <Label htmlFor="image-upload" className="text-lg font-medium">Photo *</Label>
      <label
        htmlFor="image-upload"
        className={cn(
          'relative flex h-80 w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed bg-muted/20 text-muted-foreground transition-colors hover:border-primary'
        )}
      >
        {busy ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <span>{busy}</span>
          </div>
        ) : preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Preview" className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <div className="flex flex-col items-center text-center">
            <Upload className="mb-2 h-12 w-12" />
            <span>Add a photo</span>
            <span className="text-sm">The item, or someone wearing it</span>
          </div>
        )}
      </label>
      <input id="image-upload" type="file" className="sr-only" accept="image/*" onChange={handleFile} disabled={!!busy} />
      {onPhotoTypeChange && (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What the photo shows">
          {([['item', 'Item only'], ['worn', 'Worn by someone']] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={photoType === value} onClick={() => onPhotoTypeChange(value)}
              className={cn('h-11 rounded-full border text-sm font-semibold', photoType === value ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground')}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface CategoryFieldProps {
  value: string;
  onChange: (value: string) => void;
  type: string;
  onTypeChange: (type: string) => void;
  // Shown under the fields when the AI filled them in from the photo.
  hint?: string | null;
}

/** Category and exact type of fashion item: both required. */
export function CategoryField({ value, onChange, type, onTypeChange, hint }: CategoryFieldProps) {
  const types = typesOf(value);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="category" className="text-lg font-medium">Category *</Label>
        <Select
          value={value}
          onValueChange={(next) => {
            // The dropdown also reports values set by the app (e.g. the AI's suggestion); only real changes count.
            if (next === value) return;
            onChange(next);
            if (!typesOf(next).includes(type)) onTypeChange('');
          }}
        >
          <SelectTrigger id="category" className="h-12 text-base">
            <SelectValue placeholder="Clothes, shoes, bag, accessory…" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="item-type" className="text-lg font-medium">Type *</Label>
        <Select value={type} onValueChange={(next) => next !== type && onTypeChange(next)} disabled={!types.length}>
          <SelectTrigger id="item-type" className="h-12 text-base">
            <SelectValue placeholder={types.length ? 'Exact type of item' : 'Choose a category first'} />
          </SelectTrigger>
          <SelectContent>
            {types.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {hint && <p className="text-xs text-primary sm:col-span-2">✨ {hint}</p>}
    </div>
  );
}
