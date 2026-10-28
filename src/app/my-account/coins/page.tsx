'use client';

import { useCallback, useEffect, useState } from 'react';
import { Coins, Loader2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { buyCoins, getCoins, type Coins as CoinsInfo } from '@/lib/live';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

/** Coins: what you have, buying more (100 coins = $1), and every coin in and out. */
export default function MyCoins() {
  const { toast } = useToast();
  const [info, setInfo] = useState<CoinsInfo | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [manual, setManual] = useState<{ reference: string; amount: number; momoNumber?: string | null; momoName?: string } | null>(null);
  const load = useCallback(() => getCoins().then(setInfo).catch(() => {}), []);
  useEffect(() => void load(), [load]);
  const buy = async (coins: number) => {
    setBusy(coins);
    try {
      const r = await buyCoins(coins);
      if (r.link) window.location.href = r.link;
      else {
        setManual(r);
        void load();
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not started', description: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-amber-400 to-pink-500 p-5 text-white shadow">
        <Coins className="h-10 w-10 shrink-0" />
        <div>
          <p className="text-3xl font-extrabold tabular-nums">{info ? info.balance.toLocaleString() : '…'}</p>
          <p className="text-sm text-white/90">coins · send gifts to shops when they’re live</p>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Get coins</CardTitle><CardDescription>100 coins = $1. {info?.onlinePayment ? 'Pay online.' : 'Pay by Mobile Money with the reference shown.'}</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(info?.packs ?? []).map((p) => (
            <button key={p.coins} type="button" onClick={() => buy(p.coins)} disabled={busy != null} className="flex flex-col items-center gap-1 rounded-2xl border p-3 transition hover:border-primary disabled:opacity-60">
              <span className="flex items-center gap-1 text-lg font-extrabold"><Coins className="h-5 w-5 text-amber-500" /> {p.coins.toLocaleString()}</span>
              <span className="text-sm font-semibold text-primary">{busy === p.coins ? <Loader2 className="h-4 w-4 animate-spin" /> : formatPrice(p.price)}</span>
            </button>
          ))}
          {!!info?.pending.length && <p className="col-span-full text-xs text-muted-foreground">Waiting for payment: {info.pending.map((o) => `${o.coins} coins (${o.reference})`).join(', ')}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
        <CardContent className="divide-y text-sm">
          {!info?.history?.length && <p className="text-muted-foreground">Nothing yet.</p>}
          {info?.history?.map((h, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0"><span className="block truncate">{h.reason}</span><span className="text-xs text-muted-foreground">{new Date(h.createdAt).toLocaleDateString()}</span></span>
              <b className={cn('shrink-0 tabular-nums', h.amount > 0 ? 'text-emerald-600' : 'text-foreground')}>{h.amount > 0 ? '+' : '−'}{Math.abs(h.amount).toLocaleString()}</b>
            </div>
          ))}
        </CardContent>
      </Card>
      <Sheet open={!!manual} onOpenChange={(v) => !v && setManual(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          {manual && (
            <div className="mx-auto max-w-md space-y-3 py-2 text-center">
              <Wallet className="mx-auto h-10 w-10 text-primary" />
              {manual.momoNumber ? (
                <>
                  <p>Send <b>{formatPrice(manual.amount)}</b> by Mobile Money to <b className="select-all">{manual.momoNumber}</b> ({manual.momoName})</p>
                  <p>Reference: <b className="select-all rounded bg-muted px-2 py-1">{manual.reference}</b></p>
                  <p className="text-sm text-muted-foreground">Your coins arrive as soon as Saligue confirms the payment.</p>
                </>
              ) : <p className="text-muted-foreground">Buying coins opens soon.</p>}
              <Button className="w-full" onClick={() => setManual(null)}>OK</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
