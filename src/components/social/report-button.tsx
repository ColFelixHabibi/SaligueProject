'use client';

import { useState } from 'react';
import { Flag, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

const REASONS = [
  { value: 'not_fashion', label: 'Not a fashion item', hint: 'Saligue is only for clothes, shoes, bags and accessories.' },
  { value: 'fake', label: 'Fake or misleading', hint: 'Counterfeit, wrong photos, price or description.' },
  { value: 'offensive', label: 'Offensive', hint: 'Inappropriate photo or words.' },
  { value: 'other', label: 'Other problem', hint: '' },
];

/** "Report this item": after several reports an item is hidden until INDECIANA reviews it. */
export function ReportButton({ product, className, iconOnly }: { product: Product; className?: string; iconOnly?: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const report = async (reason: string) => {
    setBusy(true);
    try {
      await api(`/products/${product.id}/report`, { body: { reason } });
      setOpen(false);
      toast({ title: 'Thank you for reporting', description: 'Items reported by several people are hidden until they are checked.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not report', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground', iconOnly && 'rounded-full p-2 hover:bg-muted', className)} title="Report" aria-label="Report this item">
        <Flag className={iconOnly ? 'h-4 w-4' : 'h-3.5 w-3.5'} />{!iconOnly && ' Report'}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>What&apos;s wrong with this item?</DialogTitle>
            <DialogDescription>{product.name}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {REASONS.map((r) => (
              <Button key={r.value} variant="outline" className="h-auto flex-col items-start whitespace-normal py-3 text-left" disabled={busy} onClick={() => report(r.value)}>
                <span className="font-semibold">{r.label}</span>
                {r.hint && <span className="text-xs font-normal text-muted-foreground">{r.hint}</span>}
              </Button>
            ))}
          </div>
          {busy && <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />}
        </DialogContent>
      </Dialog>
    </>
  );
}
