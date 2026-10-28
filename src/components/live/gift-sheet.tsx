'use client';

import { useEffect, useState } from 'react';
import { Coins, Loader2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { buyCoins, getCoins, sendGift, type Coins as CoinsInfo } from '@/lib/live';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

/**
 * Gifts in a live, like TikTok: coins are bought once (a pack), then each gift is instant. The host receives the
 * gift as a tip (100 coins = $1, minus Saligue's share), paid out with their tips.
 */
export function GiftSheet({ liveId, open, onOpenChange, signedIn }: { liveId: string; open: boolean; onOpenChange: (v: boolean) => void; signedIn: boolean }) {
  const { toast } = useToast();
  const [info, setInfo] = useState<CoinsInfo | null>(null);
  const [buying, setBuying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState<{ reference: string; amount: number; momoNumber?: string | null; momoName?: string } | null>(null);
  useEffect(() => {
    if (open) {
      setManual(null);
      getCoins().then(setInfo).catch(() => {});
    }
  }, [open]);

  const give = async (giftId: string, cost: number) => {
    if (!signedIn) return toast({ title: 'Create an account first', description: 'Gifts need a Saligue account.' });
    if (info && info.balance < cost) return setBuying(true);
    setBusy(giftId);
    try {
      const r = await sendGift(liveId, giftId);
      setInfo((i) => (i ? { ...i, balance: r.balance } : i));
      onOpenChange(false);
    } catch (error) {
      if ((error as { code?: string })?.code === 'not_enough_coins') setBuying(true);
      else toast({ variant: 'destructive', title: 'Gift not sent', description: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };

  const buy = async (coins: number) => {
    if (!signedIn) return toast({ title: 'Create an account first' });
    setBusy(`pack-${coins}`);
    try {
      const r = await buyCoins(coins);
      if (r.link) window.location.href = r.link;
      else setManual(r);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not started', description: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setBuying(false); }}>
      <SheetContent side="bottom" className="mx-auto max-h-[85vh] max-w-lg overflow-y-auto rounded-t-3xl px-4 min-[360px]:px-6">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between gap-3">
            <span>{buying ? 'Get coins' : 'Send a gift'}</span>
            <span className="flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-800"><Coins className="h-4 w-4" /> {info ? info.balance.toLocaleString() : '…'}</span>
          </SheetTitle>
        </SheetHeader>

        {manual ? (
          <div className="mt-4 space-y-3 text-center">
            <Wallet className="mx-auto h-10 w-10 text-primary" />
            {manual.momoNumber ? (
              <>
                <p>Send <b>{formatPrice(manual.amount)}</b> by Mobile Money to <b className="select-all">{manual.momoNumber}</b> ({manual.momoName})</p>
                <p>Reference: <b className="select-all rounded bg-muted px-2 py-1">{manual.reference}</b></p>
                <p className="text-sm text-muted-foreground">Your coins arrive as soon as Saligue confirms the payment. You’ll get a notification.</p>
              </>
            ) : <p className="text-muted-foreground">Buying coins opens soon.</p>}
            <Button className="w-full" onClick={() => onOpenChange(false)}>OK</Button>
          </div>
        ) : buying ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">100 coins = $1. Gifts go to the shop as tips.</p>
            <div className="grid grid-cols-2 gap-2">
              {(info?.packs ?? []).map((p) => (
                <button key={p.coins} type="button" onClick={() => buy(p.coins)} disabled={!!busy}
                  className="flex flex-col items-center gap-1 rounded-2xl border p-3 transition hover:border-primary disabled:opacity-60">
                  <span className="flex items-center gap-1 text-lg font-extrabold"><Coins className="h-5 w-5 text-amber-500" /> {p.coins.toLocaleString()}</span>
                  <span className="text-sm font-semibold text-primary">{busy === `pack-${p.coins}` ? <Loader2 className="h-4 w-4 animate-spin" /> : formatPrice(p.price)}</span>
                </button>
              ))}
            </div>
            {!!info?.pending.length && <p className="text-xs text-muted-foreground">Waiting for payment: {info.pending.map((o) => `${o.coins} coins (${o.reference})`).join(', ')}</p>}
            <Button variant="ghost" className="w-full" onClick={() => setBuying(false)}>Back to gifts</Button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {(info?.gifts ?? []).map((g) => (
                <button key={g.id} type="button" onClick={() => give(g.id, g.coins)} disabled={!!busy}
                  className={cn('flex flex-col items-center gap-0.5 rounded-2xl border p-2.5 transition hover:border-primary active:scale-95 disabled:opacity-60', info && info.balance < g.coins && 'opacity-60')}>
                  <span className="text-3xl">{busy === g.id ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : g.emoji}</span>
                  <span className="text-xs font-semibold">{g.name}</span>
                  <span className="flex items-center gap-0.5 text-[11px] font-bold text-amber-600"><Coins className="h-3 w-3" /> {g.coins}</span>
                </button>
              ))}
            </div>
            <Button variant="outline" className="w-full" onClick={() => setBuying(true)}><Coins className="mr-2 h-4 w-4 text-amber-500" /> Get coins</Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
