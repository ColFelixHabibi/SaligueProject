'use client';

import { useCallback, useEffect, useState } from 'react';
import { Coins } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/orders';

type Data = { waiting: { id: string; reference: string; amount: number; from: string; to: string }[]; due: { userId: string; name: string; amount: number; tips: number; momoNumber: string | null; momoName: string | null }[] };

/** Admin: confirm Mobile Money tips by reference, then pay what each receiver is owed. */
export function TipsAdmin() {
  const { toast } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const load = useCallback(() => api<Data>('/admin/tips').then(setData).catch(() => {}), []);
  useEffect(() => void load(), [load]);
  const act = async (path: string, body: object, done: string) => {
    try {
      await api(path, { body });
      toast({ title: done });
      void load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) });
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Coins className="h-5 w-5 text-primary" /> Tips {!!data?.waiting.length && <Badge>{data.waiting.length}</Badge>}</CardTitle>
        <CardDescription>Confirm Mobile Money tips by their reference, then send each receiver their share and mark it paid.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {data?.waiting.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
            <span className="min-w-0 flex-1">{t.from} → <b>{t.to}</b> · {formatPrice(t.amount)} · ref <b className="select-all">{t.reference}</b></span>
            <Button size="sm" variant="outline" onClick={() => act(`/admin/tips/${t.id}`, { decision: 'confirm' }, 'Tip confirmed')}>Payment received</Button>
            <Button size="sm" variant="ghost" onClick={() => act(`/admin/tips/${t.id}`, { decision: 'cancel' }, 'Cancelled')}>Cancel</Button>
          </div>
        ))}
        {data?.due.map((d) => (
          <div key={d.userId} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-3">
            <span className="min-w-0 flex-1"><b>{d.name}</b> · {formatPrice(d.amount)} ({d.tips} tips) → MoMo {d.momoNumber ?? 'not set yet'} {d.momoName && `(${d.momoName})`}</span>
            <Button size="sm" disabled={!d.momoNumber} onClick={() => act(`/admin/tips/payout/${d.userId}`, {}, 'Marked as paid')}>Mark paid</Button>
          </div>
        ))}
        {data && !data.waiting.length && !data.due.length && <p className="text-muted-foreground">Nothing waiting.</p>}
      </CardContent>
    </Card>
  );
}
