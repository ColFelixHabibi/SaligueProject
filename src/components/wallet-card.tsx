'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, Clock, Loader2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

type Withdrawal = { id: string; amount: number; status: 'requested' | 'paid' | 'rejected'; momoNumber: string; reference: string | null; note: string | null; createdAt: string; decidedAt: string | null };
export type WalletData = {
  balance: number; minimum: number; earned: number; canWithdraw: boolean; open: Withdrawal | null;
  entries: { amount: number; kind: string; label: string; note: string; at: string }[];
  withdrawals: Withdrawal[];
  coming: { monetization: number; teaching: number; shares: number };
  momo: { number: string; name: string } | null;
  payout: { open: boolean; message: string | null };
  local: { currency: string; rate: number };
};

/**
 * The Saligue balance (server/wallet.mjs): everything earned — tips, Share & earn, monetization, Learning ads —
 * in dollars, kept in the account and withdrawn by Mobile Money whenever the person wants, from the minimum ($50).
 */
export function WalletCard({ full }: { full?: boolean }) {
  const t = useT();
  const { toast } = useToast();
  const [data, setData] = useState<WalletData | null>(null);
  const [amount, setAmount] = useState('');
  const [momo, setMomo] = useState({ number: '', name: '' });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => void api<WalletData>('/me/wallet').then((d) => {
    setData(d);
    if (d.momo) setMomo(d.momo);
  }).catch(() => {}), []);
  useEffect(() => load(), [load]);
  if (!data) return null;

  const local = (usd: number) => (data.local.currency !== 'USD' && data.local.rate > 0 ? ` ≈ ${Math.floor(usd * data.local.rate).toLocaleString()} ${data.local.currency}` : '');
  const coming = data.coming.monetization + data.coming.teaching + data.coming.shares;
  const short = Math.max(0, data.minimum - data.balance);
  const withdraw = async () => {
    setBusy(true);
    try {
      const d = await api<WalletData>('/me/wallet/withdraw', { body: { amount: amount || undefined, momoNumber: momo.number, momoName: momo.name } });
      setData((old) => (old ? { ...old, ...d } : old));
      setAsking(false);
      setAmount('');
      toast({ title: t('Withdrawal asked'), description: t('Saligue sends it to your Mobile Money and tells you when it is done.') });
      load();
    } catch (error) {
      toast({ variant: 'destructive', title: t('Not asked'), description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-5 w-5 text-primary" /> {t('My balance')}</CardTitle>
        <CardDescription>{t('Everything you earn on Saligue, in dollars. Withdraw any time from')} {formatPrice(data.minimum)}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="rounded-2xl bg-primary p-4 text-primary-foreground">
          <p className="text-4xl font-extrabold">{formatPrice(data.balance)}</p>
          <p className="text-xs opacity-80">{local(data.balance) || t('Available')}</p>
          {coming > 0 && <p className="mt-2 flex items-center gap-1 text-xs opacity-90"><Clock className="h-3.5 w-3.5" /> {formatPrice(coming)} {t('still on its way (this month, sales not delivered yet)')}</p>}
        </div>

        {data.open ? (
          <p className="rounded-xl bg-muted p-3">{t('Being sent to')} {data.open.momoNumber}: <b>{formatPrice(data.open.amount)}</b></p>
        ) : !data.payout.open && data.payout.message ? (
          <p className="rounded-xl bg-muted p-3 text-muted-foreground">{data.payout.message}</p>
        ) : asking ? (
          <div className="space-y-2 rounded-xl border p-3">
            <Input type="number" inputMode="decimal" min={data.minimum} max={data.balance} step="0.01" placeholder={`${t('Amount')} (${formatPrice(data.balance)})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Input placeholder={t('Mobile Money number')} inputMode="tel" value={momo.number} onChange={(e) => setMomo({ ...momo, number: e.target.value })} />
            <Input placeholder={t('Name on the account')} value={momo.name} onChange={(e) => setMomo({ ...momo, name: e.target.value })} />
            <div className="flex gap-2">
              <Button className="flex-1" onClick={withdraw} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {t('Withdraw')} {formatPrice(Number(amount) || data.balance)}</Button>
              <Button variant="ghost" onClick={() => setAsking(false)}>{t('Cancel')}</Button>
            </div>
          </div>
        ) : (
          <Button className="h-12 w-full rounded-full" disabled={!data.canWithdraw} onClick={() => setAsking(true)}>
            <ArrowDownToLine className="mr-2 h-5 w-5" /> {data.canWithdraw ? t('Withdraw') : `${formatPrice(short)} ${t('more to withdraw')}`}
          </Button>
        )}

        {full && (
          <>
            {data.withdrawals.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-semibold">{t('Withdrawals')}</p>
                {data.withdrawals.map((w) => (
                  <div key={w.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-xs">
                    <span>{new Date(w.createdAt).toLocaleDateString()} · {w.momoNumber}</span>
                    <span className={cn('font-semibold', w.status === 'paid' ? 'text-emerald-600' : w.status === 'rejected' ? 'text-destructive' : 'text-muted-foreground')}>
                      {formatPrice(w.amount)} · {t(w.status === 'paid' ? 'Sent' : w.status === 'rejected' ? 'Not sent' : 'Being sent')}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              <p className="font-semibold">{t('History')}</p>
              {data.entries.length === 0 && <p className="text-muted-foreground">{t('Nothing yet. Tips, Share & earn, monetization and lessons all add to it.')}</p>}
              {data.entries.map((e, i) => (
                <div key={i} className="flex items-center justify-between gap-2 border-b py-1.5 text-xs last:border-0">
                  <span className="min-w-0 truncate"><b>{t(e.label)}</b> · {e.note} · {new Date(e.at).toLocaleDateString()}</span>
                  <span className={cn('shrink-0 font-semibold', e.amount > 0 ? 'text-emerald-600' : '')}>{e.amount > 0 ? '+' : ''}{formatPrice(e.amount)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
