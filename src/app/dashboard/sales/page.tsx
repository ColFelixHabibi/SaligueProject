'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Gift, HandCoins, Loader2, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/orders';

type Sales = {
  rate: number;
  freeUntil: string | null;
  official: boolean;
  open: { orders: number; onlineSales: number; directSales: number; fees: number; balance: number };
  thisMonth: { orders: number; total: number; fees: number };
  momo: { number: string; name: string } | null;
  saligueMomo: { number: string | null; name: string };
  settlements: { id: string; amount: number; orders: number; reference: string | null; createdAt: string }[];
};

/** Seller Center → Sales: what the shop sold, Saligue's fee, and money to receive or send. */
export default function SalesPage() {
  const { toast } = useToast();
  const [data, setData] = useState<Sales | null>(null);
  const [momo, setMomo] = useState({ number: '', name: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<Sales>('/seller/sales').then((d) => {
    setData(d);
    if (d.momo) setMomo(d.momo);
  }).catch(() => {}), []);
  useEffect(() => void load(), [load]);
  if (!data) return <Skeleton className="h-96 rounded-2xl" />;

  const free = data.official || (data.freeUntil && data.freeUntil > new Date().toISOString());
  const pct = `${Math.round(data.rate * 1000) / 10}%`;
  const b = data.open.balance;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><HandCoins className="h-5 w-5 text-primary" /> Sales</CardTitle>
          <CardDescription>
            {data.official ? 'No fee for Saligue’s own shop.' : free
              ? <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700"><Gift className="h-4 w-4" /> No fee until {new Date(data.freeUntil!).toLocaleDateString()}, then {pct} per delivered sale.</span>
              : `Saligue’s fee: ${pct} of each sale. No monthly charge, no listing fee.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-muted p-3"><p className="text-xl font-extrabold">{data.thisMonth.orders}</p><p className="text-xs text-muted-foreground">Delivered this month</p></div>
          <div className="rounded-xl bg-muted p-3"><p className="text-xl font-extrabold">{formatPrice(data.thisMonth.total)}</p><p className="text-xs text-muted-foreground">Sales</p></div>
          <div className="rounded-xl bg-muted p-3"><p className="text-xl font-extrabold">{formatPrice(data.thisMonth.fees)}</p><p className="text-xs text-muted-foreground">Fees</p></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">To settle</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {data.open.orders === 0 ? <p className="text-muted-foreground">Nothing yet. Delivered orders appear here.</p> : (
            <>
              <p className="text-muted-foreground">{data.open.orders} delivered orders · paid online {formatPrice(data.open.onlineSales)} · paid to you {formatPrice(data.open.directSales)} · fees {formatPrice(data.open.fees)}</p>
              <div className={`flex items-center gap-3 rounded-2xl p-4 ${b >= 0 ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100'}`}>
                {b >= 0 ? <ArrowDownLeft className="h-6 w-6 shrink-0" /> : <ArrowUpRight className="h-6 w-6 shrink-0" />}
                <div>
                  <p className="text-2xl font-extrabold">{formatPrice(Math.abs(b))}</p>
                  <p>{b >= 0 ? 'Saligue sends you this by Mobile Money.' : `Send this to Saligue${data.saligueMomo.number ? ` on Mobile Money ${data.saligueMomo.number} (${data.saligueMomo.name})` : ''}, with your shop name as the reference.`}</p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Smartphone className="h-5 w-5 text-primary" /> Where you receive money</CardTitle>
          <CardDescription>Your Mobile Money number for online sales and tips.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api('/me/tips/account', { method: 'PUT', body: { momoNumber: momo.number, momoName: momo.name } });
              toast({ title: 'Saved' });
              void load();
            } catch (error) {
              toast({ variant: 'destructive', title: 'Not saved', description: friendlyError(error) });
            } finally {
              setBusy(false);
            }
          }}>
            <Input value={momo.number} onChange={(e) => setMomo({ ...momo, number: e.target.value })} placeholder="07…" inputMode="tel" required />
            <Input value={momo.name} onChange={(e) => setMomo({ ...momo, name: e.target.value })} placeholder="Name on the account" required />
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save</Button>
          </form>
        </CardContent>
      </Card>

      {data.settlements.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">History</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.settlements.map((s) => (
              <p key={s.id} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{new Date(s.createdAt).toLocaleDateString()} · {s.orders} orders{s.reference ? ` · ${s.reference}` : ''}</span>
                <span className="font-semibold">{s.amount >= 0 ? `+${formatPrice(s.amount)}` : `−${formatPrice(-s.amount)}`}</span>
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
