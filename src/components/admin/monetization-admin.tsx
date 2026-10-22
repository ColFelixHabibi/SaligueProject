'use client';

import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Check, Coins, Megaphone, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { api, mediaUrl } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/orders';

type AdRow = { id: string; shop: string; reference: string; status: string; budget: number; spent: number; days: number; impressions: number; product: { name: string; image: string } | null; headline: string };
type CreatorRow = { userId: string; shop: string; email: string; status: string; momoNumber: string; momoName: string; followers: number; eligible: boolean; checks: { key: string; label: string; value: number; target: number; met: boolean }[] };
type Payouts = { period: string; adIncome: number; estimate: { pool: number } | null; payouts: { id: string; shop: string; amount: number; status: string; momoNumber: string | null; momoName: string | null }[] };

const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

/** Admin side of Saligue Ads and Creator Monetization. */
export function MonetizationAdmin() {
  const { toast } = useToast();
  const [ads, setAds] = useState<AdRow[]>([]);
  const [creators, setCreators] = useState<CreatorRow[]>([]);
  const [payouts, setPayouts] = useState<Payouts | null>(null);
  const [period, setPeriod] = useState(lastMonth());
  const [prices, setPrices] = useState({ cpm: '2', minBudget: '5', creatorShare: '50', momoNumber: '', momoName: 'INDECIANA' });

  const load = useCallback(() => {
    api<AdRow[]>('/admin/ads').then(setAds).catch(() => {});
    api<CreatorRow[]>('/admin/creators').then(setCreators).catch(() => {});
    api<Payouts>(`/admin/payouts?period=${period}`).then(setPayouts).catch(() => {});
  }, [period]);
  useEffect(() => {
    load();
    api<{ cpm: number; minBudget: number; momoNumber: string | null; momoName: string }>('/ads/settings')
      .then((s) => setPrices((p) => ({ ...p, cpm: String(s.cpm), minBudget: String(s.minBudget), momoNumber: s.momoNumber ?? '', momoName: s.momoName })))
      .catch(() => {});
  }, [load]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast({ title: done });
      load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) });
    }
  };

  const toReview = ads.filter((a) => a.status === 'in_review' || a.status === 'pending_payment');
  const applications = creators.filter((c) => c.status === 'applied');

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary" /> Ads to review {toReview.length > 0 && <Badge>{toReview.length}</Badge>}</CardTitle>
          <CardDescription>Confirm Mobile Money payments (check the reference), then approve or refuse each ad against the Ads Policy.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {toReview.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting.</p>}
          {toReview.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
              {a.product && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(a.product.image)} alt="" className="h-14 w-14 rounded-lg bg-muted object-contain p-1" />
              )}
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">{a.product?.name ?? 'Item removed'} · {a.shop}</p>
                <p className="text-muted-foreground">{formatPrice(a.budget)} · {a.days} days · ref <b className="select-all text-foreground">{a.reference}</b></p>
                {a.headline && <p className="italic">“{a.headline}”</p>}
              </div>
              <div className="flex gap-2">
                {a.status === 'pending_payment' ? (
                  <Button size="sm" variant="outline" onClick={() => act(() => api(`/admin/ads/${a.id}`, { body: { decision: 'confirm_payment' } }), 'Payment confirmed')}>Payment received</Button>
                ) : (
                  <Button size="sm" onClick={() => act(() => api(`/admin/ads/${a.id}`, { body: { decision: 'approve' } }), 'Ad is live')}><Check className="mr-1 h-4 w-4" /> Approve</Button>
                )}
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => act(() => api(`/admin/ads/${a.id}`, { body: { decision: 'reject', note: 'Does not follow the Saligue Ads Policy.' } }), 'Ad refused')}><X className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BadgeCheck className="h-5 w-5 text-primary" /> Monetization applications {applications.length > 0 && <Badge>{applications.length}</Badge>}</CardTitle>
          <CardDescription>Shops that meet every requirement and asked to earn from Saligue.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {creators.length === 0 && <p className="text-sm text-muted-foreground">No applications yet.</p>}
          {creators.map((c) => (
            <div key={c.userId} className="flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{c.shop} <span className="font-normal text-muted-foreground">· {c.followers.toLocaleString()} followers</span></p>
                <p className="text-muted-foreground">MoMo {c.momoNumber} ({c.momoName}) · {c.eligible ? 'meets all requirements' : 'no longer meets every requirement'}</p>
              </div>
              <Badge variant="outline" className="capitalize">{c.status}</Badge>
              {c.status === 'applied' && <Button size="sm" onClick={() => act(() => api(`/admin/creators/${c.userId}`, { body: { decision: 'approve' } }), 'Creator approved')}>Approve</Button>}
              {c.status === 'applied' && <Button size="sm" variant="ghost" onClick={() => act(() => api(`/admin/creators/${c.userId}`, { body: { decision: 'reject' } }), 'Application refused')}>Refuse</Button>}
              {c.status === 'approved' && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => act(() => api(`/admin/creators/${c.userId}`, { body: { decision: 'suspend', note: 'Suspended for breaking the Monetization Policy.' } }), 'Monetization suspended')}>Suspend</Button>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Coins className="h-5 w-5 text-primary" /> Monthly payouts</CardTitle>
          <CardDescription>After a month ends, close it to calculate each creator’s share, send it by Mobile Money, then mark it paid.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5"><Label htmlFor="payout-month">Month</Label><Input id="payout-month" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-44" /></div>
            <Button variant="outline" onClick={() => act(() => api('/admin/payouts/close', { body: { period } }), 'Month closed')}>Close month</Button>
          </div>
          {payouts && (
            <p className="text-sm">Ad income: <b>{formatPrice(payouts.adIncome)}</b>{payouts.estimate && <> · creators’ share so far: <b>{formatPrice(payouts.estimate.pool)}</b></>}</p>
          )}
          {payouts?.payouts.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm">
              <span><b>{p.shop}</b> · {formatPrice(p.amount)} → MoMo {p.momoNumber ?? '—'} ({p.momoName ?? ''})</span>
              {p.status === 'paid' ? <Badge variant="outline" className="border-emerald-500 text-emerald-600">Paid</Badge> : (
                <Button size="sm" onClick={() => act(() => api(`/admin/payouts/${p.id}/paid`, { body: {} }), 'Marked as paid')}>Mark paid</Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ad prices and creator share</CardTitle>
          <CardDescription>Sellers pay per 1,000 views. The Mobile Money number is where sellers send ad payments while online payment is off.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
            e.preventDefault();
            void act(() => api('/admin/platform/ads', { method: 'PUT', body: { cpm: Number(prices.cpm), minBudget: Number(prices.minBudget), creatorShare: Number(prices.creatorShare) / 100, momoNumber: prices.momoNumber, momoName: prices.momoName } }), 'Saved');
          }}>
            <div className="space-y-1.5"><Label htmlFor="cpm">Price per 1,000 views ($)</Label><Input id="cpm" type="number" step="0.1" min="0.1" value={prices.cpm} onChange={(e) => setPrices({ ...prices, cpm: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="min-budget">Smallest budget ($)</Label><Input id="min-budget" type="number" step="1" min="1" value={prices.minBudget} onChange={(e) => setPrices({ ...prices, minBudget: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="share">Creators’ share of ad income (%)</Label><Input id="share" type="number" step="1" min="0" max="90" value={prices.creatorShare} onChange={(e) => setPrices({ ...prices, creatorShare: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="ad-momo">Saligue Mobile Money number</Label><Input id="ad-momo" value={prices.momoNumber} onChange={(e) => setPrices({ ...prices, momoNumber: e.target.value })} placeholder="+250 78…" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="ad-momo-name">Name on that number</Label><Input id="ad-momo-name" value={prices.momoName} onChange={(e) => setPrices({ ...prices, momoName: e.target.value })} /></div>
            <Button type="submit" className="sm:col-span-2">Save</Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
