'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, CheckCircle2, CircleDashed, Clock, Coins, Loader2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

type Creator = {
  status: 'applied' | 'approved' | 'rejected' | 'suspended' | null;
  note: string | null;
  momo: { number: string; name: string } | null;
  checks: { key: string; label: string; value: number; target: number; met: boolean }[];
  eligible: boolean;
  followers: number;
  thisMonth: { period: string; pool: number; mine: { views: number; sales: number; followers: number; points: number; amount: number } | null };
  share: number;
  payouts: { id: string; period: string; amount: number; status: 'pending' | 'paid'; paidAt: string | null }[];
};

const monthName = (period: string) => new Date(`${period}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

export default function EarningsPage() {
  const { toast } = useToast();
  const [data, setData] = useState<Creator | null>(null);
  const [momo, setMomo] = useState({ number: '', name: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<Creator>('/creator').then((d) => {
    setData(d);
    if (d.momo) setMomo({ number: d.momo.number, name: d.momo.name });
  }).catch(() => {}), []);
  useEffect(() => void load(), [load]);

  const apply = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ status: string }>('/creator/apply', { body: { momoNumber: momo.number, momoName: momo.name } });
      toast({ title: r.status === 'approved' ? 'Payout details saved' : 'Application sent', description: r.status === 'approved' ? undefined : 'Saligue reviews it within a few days.' });
      await load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not sent', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Skeleton className="h-96 rounded-2xl" />;
  const approved = data.status === 'approved';

  return (
    <div className="grid gap-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Coins className="h-6 w-6 text-primary" /> Earnings</h2>
        <p className="text-sm text-muted-foreground">Monetized shops share {Math.round(data.share * 100)}% of Saligue’s ad income every month.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="rounded-2xl"><CardContent className="p-4"><Users className="mb-1 h-5 w-5 text-primary" /><p className="text-2xl font-bold">{data.followers.toLocaleString()}</p><p className="text-xs text-muted-foreground">Followers</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4">
          {approved ? <BadgeCheck className="mb-1 h-5 w-5 text-emerald-600" /> : data.status === 'applied' ? <Clock className="mb-1 h-5 w-5 text-sky-600" /> : <CircleDashed className="mb-1 h-5 w-5 text-muted-foreground" />}
          <p className="text-lg font-bold">{approved ? 'Monetized' : data.status === 'applied' ? 'In review' : data.status === 'suspended' ? 'Suspended' : 'Not yet'}</p>
          <p className="text-xs text-muted-foreground">Status</p>
        </CardContent></Card>
        <Card className="col-span-2 rounded-2xl bg-primary text-primary-foreground"><CardContent className="p-4">
          <Coins className="mb-1 h-5 w-5" />
          <p className="text-2xl font-bold">{approved && data.thisMonth.mine ? formatPrice(data.thisMonth.mine.amount) : formatPrice(0)}</p>
          <p className="text-xs opacity-80">Estimated for {monthName(data.thisMonth.period)} · final at month end</p>
        </CardContent></Card>
      </div>

      {approved && data.thisMonth.mine && (
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base">This month</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 text-center">
            {[['Views', data.thisMonth.mine.views], ['Items sold', data.thisMonth.mine.sales], ['New followers', data.thisMonth.mine.followers]].map(([k, v]) => (
              <div key={k as string} className="rounded-xl bg-muted p-3"><p className="text-xl font-bold">{(v as number).toLocaleString()}</p><p className="text-xs text-muted-foreground">{k as string}</p></div>
            ))}
          </CardContent>
        </Card>
      )}

      {!approved && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base">Requirements</CardTitle>
            <CardDescription>All of them, then apply.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.checks.map((c) => (
              <div key={c.key} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">{c.met ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <CircleDashed className="h-4 w-4 text-muted-foreground" />}{c.label}</span>
                  {c.target > 1 && <span className="font-semibold">{c.value.toLocaleString()} / {c.target.toLocaleString()}</span>}
                </div>
                {c.target > 1 && <Progress value={Math.min(100, (c.value / c.target) * 100)} className={cn('h-2', c.met && '[&>div]:bg-emerald-600')} />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data.status === 'rejected' && data.note && <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">{data.note}</p>}

      {(data.eligible || approved || data.status === 'applied') && data.status !== 'suspended' && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base">{approved ? 'Payout details' : data.status === 'applied' ? 'Application sent' : 'Apply for monetization'}</CardTitle>
            <CardDescription>Payouts are sent by Mobile Money in the first days of each month.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={apply} className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="momo-number">Mobile Money number</Label><Input id="momo-number" required inputMode="tel" value={momo.number} onChange={(e) => setMomo({ ...momo, number: e.target.value })} placeholder="+250 78…" /></div>
              <div className="space-y-1.5"><Label htmlFor="momo-name">Name on the account</Label><Input id="momo-name" required value={momo.name} onChange={(e) => setMomo({ ...momo, name: e.target.value })} /></div>
              <Button type="submit" className="sm:col-span-2" disabled={busy || data.status === 'applied'}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{approved ? 'Save' : data.status === 'applied' ? 'Waiting for review' : 'Apply'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {data.payouts.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base">Payouts</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {data.payouts.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                <span>{monthName(p.period)}</span>
                <span className="flex items-center gap-3"><b>{formatPrice(p.amount)}</b><span className={p.status === 'paid' ? 'text-emerald-600' : 'text-amber-600'}>{p.status === 'paid' ? 'Paid' : 'Pending'}</span></span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">How earnings work and the rules: <Link href="/monetization-policy" className="text-primary underline">Monetization Policy</Link></p>
    </div>
  );
}
