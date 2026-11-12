'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pencil, Tag } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/orders';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The owner's tools on their own item, wherever it is shown: Edit (the whole item) and Discount (a % off, set in
 * place). Nothing is shown to anyone else. The usual price is the one before any discount, so a sale never stacks.
 */
export function OwnerItemActions({ product, className, tone = 'outline' }: { product: Product; className?: string; tone?: 'outline' | 'ghost' }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user || product.sellerId !== user.uid) return null;

  const usual = Number(product.discount?.was ?? product.price);
  const typed = percent === '' ? 0 : Math.round(Number(percent));
  const valid = Number.isFinite(typed) && typed >= 0 && typed <= 90;

  const save = async (value: number) => {
    setBusy(true);
    try {
      await api(`/products/${product.id}`, { method: 'PATCH', body: { discountPercent: value || null } });
      toast({ title: value ? `${value}% off is on` : 'Discount removed' });
      setOpen(false);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not saved', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5', className)}>
      <Button asChild size="icon" variant={tone} className="h-9 w-9 rounded-full">
        <Link href={`/edit-product?id=${product.id}`} aria-label="Edit item" title="Edit item"><Pencil className="h-4 w-4" /></Link>
      </Button>
      <Button size="icon" variant={tone} className={cn('h-9 w-9 rounded-full', product.discount && 'border-rose-300 text-rose-600')}
        onClick={() => { setPercent(product.discount ? String(product.discount.percent) : ''); setOpen(true); }}
        aria-label="Discount" title="Discount">
        <Tag className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Discount</DialogTitle>
            <DialogDescription>{product.name} · usual price {formatPrice(usual)}</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid) void save(typed); }}>
            <div className="relative">
              <Input autoFocus inputMode="numeric" type="number" min={0} max={90} step={1} value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="e.g. 20" aria-label="Percent off" className="pr-10 text-lg" />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[10, 20, 30, 50].map((n) => (
                <Button key={n} type="button" size="sm" variant={typed === n ? 'default' : 'outline'} className="rounded-full" onClick={() => setPercent(String(n))}>−{n}%</Button>
              ))}
            </div>
            {/* What shoppers will see, before saving. */}
            <p className="rounded-lg bg-muted p-3 text-sm">
              {valid && typed > 0 ? (
                <>Shoppers see <b>{formatPrice(Math.round(usual * (100 - typed)) / 100)}</b> <s className="text-muted-foreground">{formatPrice(usual)}</s> <span className="rounded-full bg-rose-600 px-1.5 text-xs font-bold text-white">−{typed}%</span></>
              ) : valid ? <>No discount: shoppers see {formatPrice(usual)}.</> : <span className="text-destructive">Choose 0 to 90%.</span>}
            </p>
            <DialogFooter className="gap-2 sm:gap-0">
              {product.discount && <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(0)}>Remove</Button>}
              <Button type="submit" disabled={busy || !valid}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </span>
  );
}
