'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, Loader2, Share2, ShoppingBag, Wallet, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { api, mediaUrl } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { formatPrice } from '@/lib/orders';

type Reward = { id: string; productId: string; name: string; image: string | null; sale: number; amount: number; state: 'pending' | 'review' | 'earned' | 'paid' | 'void'; createdAt: string };
type Shares = { on: boolean; rate: number; days: number; cap: number; pending: number; ready: number; paid: number; sales: number; rewards: Reward[]; momo: { number: string; name: string } | null; payout: { open: boolean; mode: string; payer: string | null; message: string | null } };

const STATE = {
  pending: { icon: Clock, tone: 'text-amber-600', label: 'On its way' },
  review: { icon: Clock, tone: 'text-amber-600', label: 'Delivered, being checked' },
  earned: { icon: Wallet, tone: 'text-primary', label: 'Ready to pay' },
  paid: { icon: CheckCircle2, tone: 'text-emerald-600', label: 'Paid' },
  void: { icon: XCircle, tone: 'text-muted-foreground', label: 'Cancelled' },
} as const;

/** Share & earn: what people bought from my links, and the Mobile Money number it is paid to. */
export default function ShareEarnPage() {
  const t = useT();
  const { toast } = useToast();
  const { user, isAuthLoading } = useAuth();
  const [data, setData] = useState<Shares | null>(null);
  const [momo, setMomo] = useState({ number: '', name: '' });
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => api<Shares>('/me/shares').then((d) => { setData(d); if (d.momo) setMomo(d.momo); }).catch(() => {}), []);
  useEffect(() => { if (user) void load(); }, [user, load]);

  if (!isAuthLoading && !user) return <p className="p-10 text-center text-muted-foreground">{t('Log in to see what your shares earned.')} <Link href="/login" className="text-primary underline">{t('Log in')}</Link></p>;
  if (!data) return <Skeleton className="mx-auto mt-6 h-96 max-w-xl rounded-2xl" />;
  const pct = `${Math.round(data.rate * 1000) / 10}%`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/me/tips/account', { method: 'PUT', body: { momoNumber: momo.number, momoName: momo.name } });
      toast({ title: t('Number saved') });
      void load();
    } catch (error) {
      toast({ variant: 'destructive', title: t('Not saved'), description: friendlyError(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-4 pb-24 md:py-10">
      <div className="rounded-3xl bg-gradient-to-br from-primary to-secondary p-5 text-primary-foreground shadow-lg">
        <p className="flex items-center gap-2 text-sm font-semibold opacity-90"><Share2 className="h-5 w-5" /> {t('Share & earn')}</p>
        <p className="mt-1 text-2xl font-extrabold leading-tight">{t('Earn')} {pct} {t('of every sale from your links')}</p>
        <p className="mt-1 text-sm opacity-90">{t('No followers needed. Share any item or look; when a friend buys it within')} {data.days} {t('days and it is delivered, Saligue pays you. The shop pays nothing extra.')}</p>
      </div>
      <p className="text-xs text-muted-foreground">{t('Up to')} {formatPrice(data.cap)} {t('per item. Sales paid in cash or straight to the shop are checked by Saligue before they count.')}</p>
      {!data.on && <p className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{t('Share & earn is paused for now. What you already earned is still paid.')}</p>}
      {data.on && data.payout && !data.payout.open && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {data.payout.message ?? t('Payouts are paused for now. What you earned stays yours and is paid as soon as they open again.')}
          {' '}<Link href="/data-protection" className="underline">{t('Who pays')}</Link>
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl border bg-card p-3"><p className="text-lg font-extrabold">{formatPrice(data.pending)}</p><p className="text-[11px] text-muted-foreground">{t('On its way')}</p></div>
        <div className="rounded-2xl bg-primary p-3 text-primary-foreground"><p className="text-lg font-extrabold">{formatPrice(data.ready)}</p><p className="text-[11px] opacity-80">{t('Ready to pay')}</p></div>
        <div className="rounded-2xl border bg-card p-3"><p className="text-lg font-extrabold">{formatPrice(data.paid)}</p><p className="text-[11px] text-muted-foreground">{t('Paid')}</p></div>
      </div>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-base">{t('Mobile Money for your rewards')}</CardTitle>
          <CardDescription>{data.momo ? t('Saligue sends what is ready to this number.') : t('Add your number so Saligue can pay you.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="share-momo">{t('Number')}</Label><Input id="share-momo" inputMode="tel" required value={momo.number} onChange={(e) => setMomo({ ...momo, number: e.target.value })} placeholder="+250 78…" /></div>
            <div className="space-y-1.5"><Label htmlFor="share-name">{t('Name on it')}</Label><Input id="share-name" required value={momo.name} onChange={(e) => setMomo({ ...momo, name: e.target.value })} /></div>
            <Button type="submit" className="sm:col-span-2" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {t('Save')}</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShoppingBag className="h-4 w-4" /> {t('Sales from your links')}</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {data.rewards.length === 0 && <p className="text-sm text-muted-foreground">{t('Nothing yet. Tap Share on an item or a look you love and send it to friends.')}</p>}
          {data.rewards.map((r) => {
            const s = STATE[r.state];
            return (
              <Link key={r.id} href={`/product?id=${r.productId}`} className="flex items-center gap-3 py-2.5 text-sm">
                {r.image ? <img src={mediaUrl(r.image)} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" /> : <span className="h-10 w-10 shrink-0 rounded-lg bg-muted" />}
                <span className="min-w-0 flex-1"><b className="block truncate">{r.name}</b><span className={`flex items-center gap-1 text-xs ${s.tone}`}><s.icon className="h-3.5 w-3.5" /> {t(s.label)}</span></span>
                <b className={r.state === 'void' ? 'text-muted-foreground line-through' : ''}>{formatPrice(r.amount)}</b>
              </Link>
            );
          })}
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">{t('Rules:')} <Link href="/monetization-policy" className="underline">{t('Monetization Policy')}</Link></p>
    </div>
  );
}
