'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, EyeOff, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { api, mediaUrl, onServerEvent } from '@/lib/api';
import { categoryLabel } from '@/lib/categories';
import { friendlyError } from '@/lib/errors';
import { productHref } from '@/lib/links';
import { formatPrice } from '@/lib/orders';
import type { Product } from '@/lib/types';

type Reported = Product & { reportCount: number; reasons: string[]; lastReport: string };

const REASON_LABELS: Record<string, string> = { not_fashion: 'Not fashion', fake: 'Fake or misleading', offensive: 'Offensive', other: 'Other' };

/** INDECIANA reviews reported items. Every decision also teaches Saligue's AI which photos to refuse or allow. */
export default function ReviewsPage() {
  const { toast } = useToast();
  const official = useUserRoleStore((s) => s.official);
  const [items, setItems] = useState<Reported[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Reported[]>('/admin/reports')
      .then((rows) => setItems(rows.map((p) => ({ ...p, image: mediaUrl(p.image), cutout: mediaUrl(p.cutout) }))))
      .catch(() => setItems([]));
  }, []);
  useEffect(() => {
    if (!official) return;
    load();
    return onServerEvent('products', load);
  }, [official, load]);

  const decide = async (item: Reported, decision: 'remove' | 'keep') => {
    setBusy(item.id);
    try {
      await api(`/admin/reports/${item.id}`, { body: { decision } });
      toast({
        title: decision === 'remove' ? 'Item removed' : 'Item kept',
        description: decision === 'remove' ? 'Photos that look like it will now be refused.' : 'Photos that look like it will now be allowed.',
      });
      load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not save the decision', description: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };

  if (!official) {
    return <p className="text-muted-foreground">Only INDECIANA&apos;s official account can review reported items.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><ShieldCheck className="h-6 w-6 text-primary" /> Reviews</h1>
        <p className="text-muted-foreground">Items shoppers reported. Items with 3 or more reports are hidden until you decide. Each decision teaches Saligue&apos;s AI.</p>
      </div>
      {!items ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No reported items. Saligue is clean.</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((item) => (
            <Card key={item.id} className="overflow-hidden">
              <CardContent className="flex gap-4 p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.cutout || item.image} alt={item.name} className="h-28 w-28 shrink-0 rounded-md bg-muted object-contain p-1" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={productHref(item)} className="truncate font-semibold hover:underline">{item.name}</Link>
                    {item.hidden && <Badge variant="destructive"><EyeOff className="mr-1 h-3 w-3" /> Hidden</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {item.seller} · {categoryLabel(item.category)}{item.type ? ` · ${item.type}` : ''} · {formatPrice(Number(item.price))}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline">{item.reportCount} {item.reportCount === 1 ? 'report' : 'reports'}</Badge>
                    {item.reasons.map((r) => <Badge key={r} variant="secondary">{REASON_LABELS[r] ?? r}</Badge>)}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="destructive" disabled={busy === item.id} onClick={() => decide(item, 'remove')}>
                      {busy === item.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />} Remove (not fashion)
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy === item.id} onClick={() => decide(item, 'keep')}>
                      <Check className="mr-1 h-4 w-4" /> Keep, it&apos;s fine
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
