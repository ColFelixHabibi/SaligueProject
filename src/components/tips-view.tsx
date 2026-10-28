'use client';

import { cn } from '@/lib/utils';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, Coins, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/orders';

type Tips = { share: number; total: number; waiting: number; momo: { number: string; name: string } | null; tips: { id: string; from: string; amount: number; message: string; lessonId: string | null; paidAt: string; paidOut: boolean }[] };

/** Tips I received from supporters, and the Mobile Money number they're paid to. */
/** Tips I received; `embedded` inside My Saligue (no page frame or title there). */
export function TipsView({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast();
  const { user, isAuthLoading } = useAuth();
  const [data, setData] = useState<Tips | null>(null);
  const [momo, setMomo] = useState({ number: '', name: '' });
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => api<Tips>('/me/tips').then((d) => { setData(d); if (d.momo) setMomo(d.momo); }).catch(() => {}), []);
  useEffect(() => { if (user) void load(); }, [user, load]);

  if (!isAuthLoading && !user) return <p className="p-10 text-center text-muted-foreground">Log in to see your tips. <Link href="/login" className="text-primary underline">Log in</Link></p>;
  if (!data) return <Skeleton className="mx-auto mt-6 h-96 max-w-2xl rounded-2xl" />;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/me/tips/account', { method: 'PUT', body: { momoNumber: momo.number, momoName: momo.name } });
      toast({ title: 'Saved' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not saved', description: friendlyError(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn('grid gap-5', !embedded && 'mx-auto max-w-2xl p-4 pb-24 md:p-8')}>
      {!embedded && <h1 className="flex items-center gap-2 text-2xl font-extrabold"><Coins className="h-6 w-6 text-primary" /> My tips</h1>}
      <div className="grid grid-cols-2 gap-3">
        <Card className="rounded-2xl bg-primary text-primary-foreground"><CardContent className="p-4"><p className="text-2xl font-extrabold">{formatPrice(data.waiting)}</p><p className="text-xs opacity-80">Waiting to be paid to you</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-2xl font-extrabold">{formatPrice(data.total)}</p><p className="text-xs text-muted-foreground">All tips received</p></CardContent></Card>
      </div>
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-base">Mobile Money for tips</CardTitle>
          <CardDescription>You receive {Math.round(data.share * 100)}% of every tip. Saligue sends it to this number.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="tip-momo">Number</Label><Input id="tip-momo" inputMode="tel" required value={momo.number} onChange={(e) => setMomo({ ...momo, number: e.target.value })} placeholder="+250 78…" /></div>
            <div className="space-y-1.5"><Label htmlFor="tip-name">Name on it</Label><Input id="tip-name" required value={momo.name} onChange={(e) => setMomo({ ...momo, name: e.target.value })} /></div>
            <Button type="submit" className="sm:col-span-2" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save</Button>
          </form>
        </CardContent>
      </Card>
      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">Received</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {data.tips.length === 0 && <p className="text-sm text-muted-foreground">No tips yet. Teach a lesson — viewers can tip you from it.</p>}
          {data.tips.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
              {t.paidOut ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <Clock className="h-4 w-4 shrink-0 text-amber-600" />}
              <span className="min-w-0 flex-1"><b>{t.from}</b>{t.message && <span className="text-muted-foreground"> · “{t.message}”</span>}</span>
              <b>{formatPrice(t.amount)}</b>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
