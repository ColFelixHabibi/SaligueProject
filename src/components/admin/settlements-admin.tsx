'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, HandCoins, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ask } from '@/components/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/orders';

type Shop = { sellerId: string; shop: string; momoNumber: string | null; momoName: string | null; orders: number; onlineSales: number; directSales: number; fees: number; balance: number };
type Data = { commission: { rate: number; freeDays: number }; shops: Shop[]; recent: { id: string; shop: string; amount: number; orders: number; reference: string | null; createdAt: string }[] };

/** Admin → Money: delivered sales to settle with each shop (Saligue pays out online sales minus its fee, or collects its fee). */
export function SettlementsAdmin() {
  const { toast } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const load = useCallback(() => api<Data>('/admin/settlements').then(setData).catch(() => {}), []);
  useEffect(() => void load(), [load]);

  const settle = async (s: Shop) => {
    const what = s.balance >= 0 ? `Send ${formatPrice(s.balance)} to ${s.shop}` : `${s.shop} pays Saligue ${formatPrice(-s.balance)}`;
    if (!(await ask({ title: `${what}?`, description: `Do it by Mobile Money first, then record it here. ${s.orders} delivered order(s) will be marked settled.`, confirm: 'Record' }))) return;
    try {
      await api(`/admin/settlements/${s.sellerId}`, { body: { reference: refs[s.sellerId] ?? '' } });
      toast({ title: 'Settled' });
      void load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><HandCoins className="h-5 w-5 text-primary" /> Shop sales</CardTitle>
        <CardDescription>
          {data ? `Fee ${Math.round(data.commission.rate * 1000) / 10}% per sale, free for a shop’s first ${data.commission.freeDays} days. ` : ''}
          Online payments: Saligue sends the shop its sales minus the fee. Paid to the shop directly: the shop sends Saligue the fee.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!data && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}
        {data?.shops.length === 0 && <p className="text-sm text-muted-foreground">Nothing to settle.</p>}
        {data?.shops.map((s) => (
          <div key={s.sellerId} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold">{s.shop}</p>
              <p className="text-xs text-muted-foreground">{s.orders} orders · online {formatPrice(s.onlineSales)} · direct {formatPrice(s.directSales)} · fees {formatPrice(s.fees)}</p>
              <p className="text-xs text-muted-foreground">{s.momoNumber ? `MoMo ${s.momoNumber}${s.momoName ? ` (${s.momoName})` : ''}` : 'No Mobile Money number yet'}</p>
            </div>
            <p className={`flex items-center gap-1 font-bold ${s.balance >= 0 ? 'text-primary' : 'text-emerald-600'}`}>
              {s.balance >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}
              {formatPrice(Math.abs(s.balance))}
            </p>
            <Input className="h-9 sm:w-36" placeholder="MoMo reference" value={refs[s.sellerId] ?? ''} onChange={(e) => setRefs((r) => ({ ...r, [s.sellerId]: e.target.value }))} />
            <Button size="sm" onClick={() => settle(s)}>Settled</Button>
          </div>
        ))}
        {!!data?.recent.length && (
          <div className="space-y-1 pt-2">
            <p className="text-sm font-semibold">Recent</p>
            {data.recent.map((r) => (
              <p key={r.id} className="flex justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">{new Date(r.createdAt).toLocaleDateString()} · {r.shop} · {r.orders} orders{r.reference ? ` · ${r.reference}` : ''}</span>
                <span className="shrink-0 font-semibold">{r.amount >= 0 ? '→ ' : '← '}{formatPrice(Math.abs(r.amount))}</span>
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type Problem = { id: string; shopName: string; buyerName: string; total: number; paymentMethod: string; problem: { text: string; at: string } };

/** Admin → Money: problems buyers reported on orders (the shop's payment is held). Release, or refund the buyer. */
export function OrderProblemsAdmin() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Problem[] | null>(null);
  const load = useCallback(() => api<Problem[]>('/admin/order-problems').then(setRows).catch(() => setRows([])), []);
  useEffect(() => void load(), [load]);
  const decide = async (p: Problem, decision: 'release' | 'refund') => {
    if (decision === 'refund' && !(await ask({ title: `Refund ${formatPrice(p.total)} to ${p.buyerName}?`, description: 'Send the money back by Mobile Money first, then confirm here. The shop is not paid for this order.', confirm: 'Refunded' }))) return;
    try {
      await api(`/admin/order-problems/${p.id}`, { body: { decision } });
      toast({ title: decision === 'refund' ? 'Marked as refunded' : 'Payment released' });
      void load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) });
    }
  };
  if (!rows?.length) return null;
  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" /> Order problems</CardTitle>
        <CardDescription>The shop’s payment for these orders is held. Talk with both sides, then release it or refund the buyer.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((p) => (
          <div key={p.id} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold">#{p.id.slice(0, 6).toUpperCase()} · {p.shopName} · {formatPrice(p.total)} ({p.paymentMethod.replace(/_/g, ' ')})</p>
              <p className="text-xs text-muted-foreground">{p.buyerName} · {new Date(p.problem.at).toLocaleDateString()}</p>
              <p className="mt-1">“{p.problem.text}”</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => decide(p, 'release')}>Release</Button>
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => decide(p, 'refund')}>Refund</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
