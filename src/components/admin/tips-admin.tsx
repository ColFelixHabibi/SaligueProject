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

type Payout = { open: boolean; mode: string; payer: string | null; message: string | null };
type Data = { payout: Payout; waiting: { id: string; reference: string; amount: number; from: string; to: string }[]; due: { userId: string; name: string; amount: number; tips: number; momoNumber: string | null; momoName: string | null; blocked: string | null; why: string | null }[] };

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
        {data?.payout && !data.payout.open && (
          <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {data.payout.message ?? 'Payouts are stopped until a licensed payer is recorded.'}{' '}
            <a href="/admin?tab=rules" className="underline">Rules &amp; policies → Who moves users&apos; money</a>
          </p>
        )}
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
            {d.blocked ? <span className="text-xs font-medium text-amber-900 dark:text-amber-200">{d.why ?? 'Payout stopped'}</span> : <Button size="sm" disabled={!d.momoNumber} onClick={() => act(`/admin/tips/payout/${d.userId}`, {}, 'Marked as paid')}>Mark paid</Button>}
          </div>
        ))}
        {data && !data.waiting.length && !data.due.length && <p className="text-muted-foreground">Nothing waiting.</p>}
      </CardContent>
    </Card>
  );
}

type CoinOrder = { id: string; reference: string; coins: number; amount: number; name: string; email: string; createdAt: string };

/** Coins bought by Mobile Money: check the reference arrived, then confirm (the coins are added at once). */
export function CoinsAdmin() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<CoinOrder[]>([]);
  const load = useCallback(() => api<CoinOrder[]>('/admin/coins').then(setOrders).catch(() => {}), []);
  useEffect(() => void load(), [load]);
  const decide = (id: string, decision: 'confirm' | 'cancel') =>
    api(`/admin/coins/${id}`, { body: { decision } }).then(() => { toast({ title: decision === 'confirm' ? 'Coins added' : 'Cancelled' }); void load(); })
      .catch((e) => toast({ variant: 'destructive', title: 'Not done', description: friendlyError(e) }));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Coins className="h-5 w-5 text-amber-500" /> Coins waiting for payment {orders.length > 0 && <Badge>{orders.length}</Badge>}</CardTitle>
        <CardDescription>Shoppers buying coins by Mobile Money. Confirm once the money with that reference has arrived.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {orders.length === 0 && <p className="text-muted-foreground">Nothing waiting.</p>}
        {orders.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
            <span className="min-w-0 flex-1 break-words"><b>{o.name || o.email}</b> · {o.coins.toLocaleString()} coins · {formatPrice(o.amount)} · ref <b className="select-all">{o.reference}</b></span>
            <Button size="sm" onClick={() => decide(o.id, 'confirm')}>Payment received</Button>
            <Button size="sm" variant="ghost" onClick={() => decide(o.id, 'cancel')}>Cancel</Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

type ShareDue = { userId: string; name: string; amount: number; sales: number; momoNumber: string | null; momoName: string | null; blocked: string | null; why: string | null };
type ShareReview = { id: string; item: string; sale: number; amount: number; paymentMethod: string; receivedBy: string | null; orderedAt: string; sharer: string; buyer: string; shop: string; buyerAgeDays: number; sharerAgeDays: number; shopSales: number };

const PAID: Record<string, string> = { cash_on_delivery: 'cash on delivery', mobile_money: 'Mobile Money to the shop', pickup: 'paid at pickup' };

/**
 * Share & earn: rewards for delivered sales from people's shared links (Saligue pays them, not the shop).
 * Sales not paid online are checked here first; then send what is due by Mobile Money and mark it paid.
 */
export function SharesAdmin() {
  const { toast } = useToast();
  const [data, setData] = useState<{ payout: Payout; review: ShareReview[]; due: ShareDue[] } | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const load = useCallback(() => api<{ payout: Payout; review: ShareReview[]; due: ShareDue[] }>('/admin/shares').then(setData).catch(() => {}), []);
  useEffect(() => void load(), [load]);
  const act = (path: string, body: object, done: string) =>
    api(path, { body })
      .then(() => { toast({ title: done }); void load(); })
      .catch((e) => toast({ variant: 'destructive', title: 'Not done', description: friendlyError(e) }));
  const count = (data?.review.length ?? 0) + (data?.due.length ?? 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Coins className="h-5 w-5 text-primary" /> Share & earn {count > 0 && <Badge>{count}</Badge>}</CardTitle>
        <CardDescription>Rewards for delivered sales that came from people’s shared links (Saligue pays them, not the shop). Sales not paid online are checked first: no money reached Saligue, so make sure the sale looks real (new accounts, a shop with few sales, the same people again and again). Then send what is due by Mobile Money and mark it paid.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {data && !data.payout.open && (
          <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {data.payout.message ?? 'Payouts are stopped until a licensed payer is recorded.'}{' '}
            <a href="/admin?tab=rules" className="underline">Rules &amp; policies → Who moves users&apos; money</a>
          </p>
        )}
        {data && !count && <p className="text-muted-foreground">Nothing waiting.</p>}
        {!!data?.review.length && <p className="font-semibold">To check</p>}
        {data?.review.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
            <span className="min-w-0 flex-1">
              <b>{r.sharer}</b> ({r.sharerAgeDays} days on Saligue) shared <b>{r.item}</b> · {formatPrice(r.sale)} → reward {formatPrice(r.amount)}
              <span className="block text-xs text-muted-foreground">Bought by {r.buyer} ({r.buyerAgeDays} days on Saligue) from {r.shop} ({r.shopSales} delivered sales) · {PAID[r.paymentMethod] ?? r.paymentMethod} · {r.receivedBy === 'code' ? 'handover code' : r.receivedBy === 'buyer' ? 'buyer confirmed' : 'delivered'} · {new Date(r.orderedAt).toLocaleDateString()}</span>
            </span>
            <Button size="sm" variant="outline" onClick={() => act(`/admin/shares/review/${r.id}`, { decision: 'approve' }, 'Approved')}>Looks real</Button>
            <Button size="sm" variant="ghost" onClick={() => act(`/admin/shares/review/${r.id}`, { decision: 'reject' }, 'Rejected')}>Reject</Button>
          </div>
        ))}
        {!!data?.due.length && <p className="pt-2 font-semibold">To pay</p>}
        {data?.due.map((d) => (
          <div key={d.userId} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-3">
            <span className="min-w-0 flex-1"><b>{d.name}</b> · {formatPrice(d.amount)} ({d.sales} sale{d.sales === 1 ? '' : 's'}) → MoMo {d.momoNumber ?? 'not set yet'} {d.momoName && `(${d.momoName})`}</span>
            <input className="h-9 w-28 rounded-md border bg-background px-2" placeholder="Reference" value={refs[d.userId] ?? ''} onChange={(e) => setRefs({ ...refs, [d.userId]: e.target.value })} aria-label="Mobile Money reference" />
            {d.blocked ? <span className="text-xs font-medium text-amber-900 dark:text-amber-200">{d.why ?? 'Payout stopped'}</span> : <Button size="sm" disabled={!d.momoNumber} onClick={() => act(`/admin/shares/payout/${d.userId}`, { reference: refs[d.userId] ?? '' }, `Marked as paid: ${formatPrice(d.amount)}`)}>Mark paid</Button>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
