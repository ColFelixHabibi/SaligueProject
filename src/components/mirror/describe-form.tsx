'use client';

import { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CATEGORIES, typesOf } from '@/lib/categories';
import type { WearForm } from '@/lib/search';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const SHOE_SIZES = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'];
const SIZED = new Set(['top', 'outerwear', 'dress', 'bottom', 'shoes']);
const CONDITIONS = ['New', 'Like new', 'Used'];
const ANY = '__any__';

// Colour swatches (name → CSS colour).
const COLORS: [string, string][] = [
  ['Black', '#111111'], ['White', '#ffffff'], ['Grey', '#9ca3af'], ['Beige', '#e8d8b9'], ['Brown', '#7b4a2a'],
  ['Red', '#dc2626'], ['Pink', '#ec4899'], ['Orange', '#f97316'], ['Yellow', '#facc15'], ['Green', '#16a34a'],
  ['Blue', '#2563eb'], ['Navy', '#1e3a8a'], ['Purple', '#7c3aed'], ['Gold', '#d4a017'], ['Silver', '#c0c0c0'],
];

const chip = (active: boolean) =>
  cn('shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition', active ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary hover:text-primary');

/** "What do you want to wear?" as separate fields: kind, type, size, colour, brand, budget, condition. */
export function DescribeForm({ value, onChange, products, compact }: { value: WearForm; onChange: (value: WearForm) => void; products: Product[]; compact?: boolean }) {
  const set = (changes: Partial<WearForm>) => onChange({ ...value, ...changes });
  const types = typesOf(value.category ?? '');
  const sizes = value.category === 'shoes' ? SHOE_SIZES : CLOTHING_SIZES;
  const brands = useMemo(
    () => [...new Set(products.filter((p) => p.status === 'active' && (!value.category || p.category === value.category)).map((p) => p.brand?.trim()).filter(Boolean) as string[])].sort(),
    [products, value.category]
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="font-semibold">What kind of item?</Label>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {CATEGORIES.map((c) => (
            <button key={c.value} type="button" className={chip(value.category === c.value)}
              onClick={() => onChange({ ...value, category: value.category === c.value ? undefined : c.value, type: undefined, size: undefined, brand: undefined })}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {types.length > 0 && (
        <div className="space-y-2">
          <Label className="font-semibold">Type</Label>
          <div className="flex flex-wrap gap-2">
            {types.map((t) => (
              <button key={t} type="button" className={chip(value.type === t)} onClick={() => set({ type: value.type === t ? undefined : t })}>{t}</button>
            ))}
          </div>
        </div>
      )}

      {(!value.category || SIZED.has(value.category)) && (
        <div className="space-y-2">
          <Label className="font-semibold">Size</Label>
          <div className="flex flex-wrap gap-2">
            {sizes.map((s) => (
              <button key={s} type="button" className={cn(chip(value.size === s), 'min-w-11')} onClick={() => set({ size: value.size === s ? undefined : s })}>{s}</button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label className="font-semibold">Colour{value.color && <span className="ml-1 font-normal text-muted-foreground">· {value.color}</span>}</Label>
        <div className="flex flex-wrap gap-2">
          {COLORS.map(([name, css]) => (
            <button
              key={name}
              type="button"
              title={name}
              aria-label={name}
              aria-pressed={value.color === name}
              onClick={() => set({ color: value.color === name ? undefined : name })}
              className={cn('h-8 w-8 rounded-full border-2 shadow-sm transition', value.color === name ? 'scale-110 border-primary ring-2 ring-primary ring-offset-2' : 'border-border hover:scale-105')}
              style={{ background: css }}
            />
          ))}
        </div>
      </div>

      <div className={cn('grid gap-4', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
        <div className="space-y-2">
          <Label className="font-semibold">Brand</Label>
          <Select value={value.brand ?? ANY} onValueChange={(v) => set({ brand: v === ANY ? undefined : v })}>
            <SelectTrigger><SelectValue placeholder="Any brand" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any brand</SelectItem>
              {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="wear-budget" className="font-semibold">Budget (max $)</Label>
          <Input id="wear-budget" type="number" min="1" step="1" inputMode="numeric" placeholder="Any price"
            value={value.maxPrice ?? ''} onChange={(e) => set({ maxPrice: e.target.value ? Math.max(1, Number(e.target.value)) : undefined })} />
        </div>
        <div className="space-y-2">
          <Label className="font-semibold">Condition</Label>
          <Select value={value.condition ?? ANY} onValueChange={(v) => set({ condition: v === ANY ? undefined : v })}>
            <SelectTrigger><SelectValue placeholder="Any condition" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any condition</SelectItem>
              {CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="wear-details" className="font-semibold">Anything else? <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <Input id="wear-details" maxLength={80} placeholder="e.g. slim fit, cotton, long sleeves" value={value.details ?? ''} onChange={(e) => set({ details: e.target.value || undefined })} />
      </div>
    </div>
  );
}

/** Whether the form has anything to search for. */
export const hasWearForm = (f: WearForm) => Object.values(f).some((v) => v !== undefined && v !== '');
