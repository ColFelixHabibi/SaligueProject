'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Eye, Loader2, Megaphone, MousePointerClick, Pause, Play, Plus, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/auth-provider';
import { useProductStore } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { api, mediaUrl } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

type Campaign = {
  id: string;
  product: { id: string; name: string; image: string; price: number } | null;
  headline: string;
  budget: number;
  spent: number;
  cpm: number;
  days: number;
  placements: string[];
  status: 'pending_payment' | 'in_review' | 'active' | 'paused' | 'completed' | 'rejected';
  reviewNote: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  estimatedViews: number;
  endsAt: string | null;
};
type Settings = { cpm: number; minBudget: number; maxDays: number; onlinePayment: boolean; currency: string; rate: number; momoNumber: string | null; momoName: string };

const STATUS: Record<Campaign['status'], { label: string; tone: string }> = {
  pending_payment: { label: 'Waiting for payment', tone: 'border-amber-500 text-amber-600' },
  in_review: { label: 'In review', tone: 'border-sky-500 text-sky-600' },
  active: { label: 'Running', tone: 'border-emerald-500 text-emerald-600' },
  paused: { label: 'Paused', tone: 'border-muted-foreground text-muted-foreground' },
  completed: { label: 'Finished', tone: 'border-muted-foreground text-muted-foreground' },
  rejected: { label: 'Not approved', tone: 'border-destructive text-destructive' },
};
const BUDGETS = [5, 10, 25, 50, 100];
const DAYS = [3, 7, 14, 30];

export default function AdsPage() {
  const { toast } = useToast();
  const { authUid } = useAuth();
  const { products } = useProductStore();
  const mine = useMemo(() => products.filter((p) => p.sellerId === authUid && p.status === 'active'), [products, authUid]);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ productId: '', budget: 10, days: 7, headline: '', feed: true, explore: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState<{ reference: string; amount: number; momoNumber: string | null; momoName: string } | null>(null);

  const load = useCallback(() => api<Campaign[]>('/ads/campaigns').then(setCampaigns).catch(() => setCampaigns([])), []);
  useEffect(() => {
    void load();
    api<Settings>('/ads/settings').then(setSettings).catch(() => {});
  }, [load]);

  const pay = async (id: string) => {
    setBusy(id);
    try {
      const result = await api<{ link?: string; manual?: boolean; reference: string; amount: number; momoNumber: string | null; momoName: string }>(`/ads/campaigns/${id}/pay`, { body: {} });
      if (result.link) window.location.href = result.link;
      else setManual(result as never);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Payment not started', description: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('create');
    try {
      const placements = [form.feed && 'feed', form.explore && 'explore'].filter(Boolean);
      const campaign = await api<Campaign>('/ads/campaigns', { body: { productId: form.productId, budget: form.budget, days: form.days, headline: form.headline, placements } });
      setCreating(false);
      await load();
      await pay(campaign.id);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Ad not created', description: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (c: Campaign) => {
    try {
      await api(`/ads/campaigns/${c.id}/${c.status === 'active' ? 'pause' : 'resume'}`, { body: {} });
      await load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not changed', description: friendlyError(error) });
    }
  };

  const local = (usd: number) => (settings && settings.currency !== 'USD' && settings.rate > 0 ? ` (≈ ${Math.ceil(usd * settings.rate).toLocaleString()} ${settings.currency})` : '');
  const estimate = settings ? Math.floor((form.budget / settings.cpm) * 1000) : 0;
  const totals = (campaigns ?? []).reduce((t, c) => ({ views: t.views + c.impressions, clicks: t.clicks + c.clicks, spent: t.spent + c.spent }), { views: 0, clicks: 0, spent: 0 });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Megaphone className="h-6 w-6 text-primary" /> Ads</h2>
          <p className="text-sm text-muted-foreground">Show your items to more shoppers in For You and Explore.</p>
        </div>
        <Button onClick={() => { setForm((f) => ({ ...f, productId: f.productId || mine[0]?.id || '' })); setCreating(true); }} disabled={!mine.length}>
          <Plus className="mr-2 h-4 w-4" /> New ad
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[[Eye, 'Views', totals.views.toLocaleString()], [MousePointerClick, 'Clicks', totals.clicks.toLocaleString()], [Wallet, 'Spent', formatPrice(totals.spent)]].map(([Icon, label, value]) => {
          const I = Icon as typeof Eye;
          return (
            <Card key={label as string} className="rounded-2xl"><CardContent className="p-4">
              <I className="mb-1 h-5 w-5 text-primary" />
              <p className="text-xl font-bold md:text-2xl">{value as string}</p>
              <p className="text-xs text-muted-foreground">{label as string}</p>
            </CardContent></Card>
          );
        })}
      </div>

      {!campaigns ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : campaigns.length === 0 ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="space-y-3 py-12 text-center">
            <Megaphone className="mx-auto h-10 w-10 text-primary" />
            <p className="font-semibold">No ads yet</p>
            <p className="text-sm text-muted-foreground">From {settings ? formatPrice(settings.minBudget) : '$5'}. You pay {settings ? formatPrice(settings.cpm) : '$2'} per 1,000 views.</p>
            {!mine.length && <p className="text-sm"><Link href="/sell" className="text-primary underline">Add an item</Link> to advertise it.</p>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {campaigns.map((c) => (
            <Card key={c.id} className="rounded-2xl">
              <CardContent className="flex flex-wrap items-center gap-4 p-4">
                {c.product && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaUrl(c.product.image)} alt="" className="h-16 w-16 shrink-0 rounded-xl bg-muted object-contain p-1" />
                )}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-semibold">{c.product?.name ?? 'Item removed'}</p>
                    <Badge variant="outline" className={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                  </div>
                  <Progress value={(c.spent / c.budget) * 100} className="h-2" />
                  <p className="text-xs text-muted-foreground">
                    {formatPrice(c.spent)} of {formatPrice(c.budget)} · {c.impressions.toLocaleString()} views · {c.clicks} clicks ({c.ctr}%)
                    {c.status === 'active' && c.endsAt && ` · until ${new Date(c.endsAt).toLocaleDateString()}`}
                  </p>
                  {c.status === 'rejected' && c.reviewNote && <p className="text-xs text-destructive">{c.reviewNote}</p>}
                </div>
                <div className="flex gap-2">
                  {c.status === 'pending_payment' && <Button size="sm" onClick={() => pay(c.id)} disabled={busy === c.id}>{busy === c.id && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Pay</Button>}
                  {(c.status === 'active' || c.status === 'paused') && (
                    <Button size="sm" variant="outline" onClick={() => toggle(c)} aria-label={c.status === 'active' ? 'Pause' : 'Resume'}>
                      {c.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">Ads are reviewed before they run. <Link href="/ads-policy" className="text-primary underline">Ads Policy</Link></p>

      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader><SheetTitle>New ad</SheetTitle></SheetHeader>
          <form onSubmit={create} className="mt-6 space-y-6">
            <div className="space-y-2">
              <Label className="font-semibold">Item</Label>
              <div className="grid grid-cols-3 gap-2">
                {mine.map((p) => (
                  <button key={p.id} type="button" onClick={() => setForm({ ...form, productId: p.id })}
                    className={cn('rounded-xl border-2 bg-muted p-1 text-left', form.productId === p.id ? 'border-primary' : 'border-transparent')}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.cutout || p.image} alt="" className="aspect-square w-full object-contain" />
                    <span className="block truncate px-1 text-[11px] font-medium">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="font-semibold">Budget</Label>
              <div className="flex flex-wrap gap-2">
                {BUDGETS.filter((b) => !settings || b >= settings.minBudget).map((b) => (
                  <button key={b} type="button" onClick={() => setForm({ ...form, budget: b })} className={cn('h-10 rounded-full border px-4 text-sm font-semibold', form.budget === b ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>{formatPrice(b)}</button>
                ))}
                <Input type="number" min={settings?.minBudget ?? 5} step="1" value={form.budget} onChange={(e) => setForm({ ...form, budget: Number(e.target.value) })} className="h-10 w-24 rounded-full" aria-label="Other budget" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="font-semibold">Days</Label>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => (
                  <button key={d} type="button" onClick={() => setForm({ ...form, days: d })} className={cn('h-10 rounded-full border px-4 text-sm font-semibold', form.days === d ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}>{d}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="font-semibold">Where</Label>
              <div className="flex gap-2">
                {([['feed', 'For You'], ['explore', 'Explore']] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setForm({ ...form, [k]: !form[k] })} className={cn('h-10 rounded-full border px-4 text-sm font-semibold', form[k] ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground')}>{form[k] ? '✓ ' : ''}{label}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ad-headline" className="font-semibold">Headline <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="ad-headline" maxLength={80} value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} placeholder="e.g. New season, free delivery in Kigali" />
            </div>
            <div className="rounded-2xl bg-primary/5 p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold"><Eye className="h-4 w-4 text-primary" /> About {estimate.toLocaleString()} views</p>
              <p className="mt-1 text-muted-foreground">You pay {formatPrice(form.budget)}{local(form.budget)} once. It stops after {form.days} days or when the budget is used.</p>
            </div>
            <Button type="submit" size="lg" className="h-12 w-full" disabled={busy === 'create' || !form.productId || (!form.feed && !form.explore)}>
              {busy === 'create' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Continue to payment
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={!!manual} onOpenChange={(v) => !v && setManual(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          {manual && (
            <div className="mx-auto max-w-md space-y-4 py-2 text-center">
              <Wallet className="mx-auto h-10 w-10 text-primary" />
              <h3 className="text-xl font-bold">Pay by Mobile Money</h3>
              {manual.momoNumber ? (
                <>
                  <p>Send <b>{formatPrice(manual.amount)}{local(manual.amount)}</b> to <b className="select-all">{manual.momoNumber}</b> ({manual.momoName})</p>
                  <p>Reference: <b className="select-all rounded bg-muted px-2 py-1">{manual.reference}</b></p>
                  <p className="text-sm text-muted-foreground">Your ad starts after Saligue confirms the payment and reviews it.</p>
                </>
              ) : (
                <p className="text-muted-foreground">Payments for ads open soon. Your ad is saved.</p>
              )}
              <Button className="w-full" onClick={() => setManual(null)}>OK</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
