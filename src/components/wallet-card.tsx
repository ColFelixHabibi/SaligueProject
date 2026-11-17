'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, CalendarClock, Clock, Loader2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

type Withdrawal = { id: string; amount: number; status: 'requested' | 'paid' | 'rejected'; scheduled?: boolean; momoNumber: string; reference: string | null; note: string | null; createdAt: string; decidedAt: string | null };
export type WalletData = {
  balance: number; minimum: number; earned: number; nextPayday: string; canWithdraw: boolean; open: Withdrawal | null;
  held: { code: string; message: string } | null;
  entries: { amount: number; kind: string; label: string; note: string; at: string }[];
  withdrawals: Withdrawal[];
  coming: { monetization: number; teaching: number; shares: number };
  momo: { number: string; name: string } | null;
  local: { currency: string; rate: number };
};

/**
 * The Saligue balance (server/wallet.mjs): everything earned — tips, Share & earn, monetization, Learning ads —
 * in dollars. The person withdraws the amount they want (from $50) whenever they like; it is paid on payday, the 15th,
 * without anyone approving it, and can be cancelled until then.
 */
export function WalletCard({ full }: { full?: boolean }) {
  const t = useT();
  const { toast } = useToast();
  const [data, setData] = useState<WalletData | null>(null);
  const [momo, setMomo] = useState({ number: '', name: '' });
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
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
  const payday = new Date(`${data.nextPayday}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  const saveMomo = async () => {
    setBusy(true);
    try {
      await api('/me/wallet/momo', { method: 'PUT', body: { momoNumber: momo.number, momoName: momo.name } });
      setEditing(false);
      load();
    } catch (error) {
      toast({ variant: 'destructive', title: t('Not saved'), description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    try {
      await api('/me/wallet/withdraw', { body: { amount: Number(amount), momoNumber: momo.number, momoName: momo.name } });
      setAmount('');
      toast({ title: t('Withdrawal asked'), description: `${t('Paid on')} ${payday}.` });
      load();
    } catch (error) {
      toast({ variant: 'destructive', title: t('Not asked'), description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (id: string) => {
    setBusy(true);
    try {
      await api(`/me/wallet/withdraw/${id}`, { method: 'DELETE' });
      load();
    } catch (error) {
      toast({ variant: 'destructive', title: t('Not done'), description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-5 w-5 text-primary" /> {t('My balance')}
          {/* Shown in Seller Center → Earnings too: it is the same Wallet, which opens from here. */}
          {!full && <Link href="/my-account/wallet" className="ml-auto text-xs font-semibold text-primary hover:underline">{t('Open Wallet')}</Link>}
        </CardTitle>
        <CardDescription>{t('Everything you earn on Saligue, in dollars. Withdraw from')} {formatPrice(data.minimum)}; {t('withdrawals are paid on the 15th of each month.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="rounded-2xl bg-primary p-4 text-primary-foreground">
          <p className="text-4xl font-extrabold">{formatPrice(data.balance)}</p>
          <p className="text-xs opacity-80">{local(data.balance) || t('Available')}</p>
          {coming > 0 && <p className="mt-2 flex items-center gap-1 text-xs opacity-90"><Clock className="h-3.5 w-3.5" /> {formatPrice(coming)} {t('still on its way (this month, sales not delivered yet)')}</p>}
        </div>

        {/* A withdrawal asked for: paid on payday, cancellable until then. Otherwise the form to ask for one. */}
        {data.open ? (
          <div className="flex gap-3 rounded-xl bg-muted p-3">
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{formatPrice(data.open.amount)} → {data.open.momoNumber}</p>
              <p className="text-muted-foreground">{data.open.scheduled ? `${t('Paid on')} ${payday}.` : t('Being sent now.')}{data.held ? ` ${data.held.message}` : ''}</p>
            </div>
            {data.open.scheduled && <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancel(data.open!.id)}>{t('Cancel')}</Button>}
          </div>
        ) : data.canWithdraw ? (
          <div className="space-y-2 rounded-xl border p-3">
            <p className="text-xs font-semibold">{t('How much do you want to withdraw?')}</p>
            <div className="flex gap-2">
              <Input type="number" inputMode="decimal" min={data.minimum} max={data.balance} step="0.01" placeholder={`${formatPrice(data.minimum)} – ${formatPrice(data.balance)}`} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Button type="button" variant="outline" onClick={() => setAmount(String(data.balance))}>{t('All')}</Button>
            </div>
            {Number(amount) > 0 && <p className="text-xs text-muted-foreground">{local(Number(amount)).trim()}</p>}
            <Button className="h-11 w-full rounded-full" disabled={busy || !(Number(amount) >= data.minimum && Number(amount) <= data.balance) || (!data.momo && momo.number.replace(/\D/g, '').length < 9)} onClick={withdraw}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowDownToLine className="mr-2 h-4 w-4" />} {t('Withdraw')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('Paid on')} {payday}{data.held ? ` · ${data.held.message}` : ''}</p>
          </div>
        ) : (
          <p className="flex gap-3 rounded-xl bg-muted p-3 text-muted-foreground">
            <CalendarClock className="h-5 w-5 shrink-0 text-primary" /> {formatPrice(short)} {t('more and you can withdraw. Withdrawals are paid on the 15th.')}
          </p>
        )}

        {/* Where the money goes. */}
        {editing || !data.momo ? (
          <div className="space-y-2 rounded-xl border p-3">
            <p className="text-xs font-semibold">{t('Where should we send your money?')}</p>
            <Input placeholder={t('Mobile Money number')} inputMode="tel" value={momo.number} onChange={(e) => setMomo({ ...momo, number: e.target.value })} />
            <Input placeholder={t('Name on the account')} value={momo.name} onChange={(e) => setMomo({ ...momo, name: e.target.value })} />
            <Button size="sm" onClick={saveMomo} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {t('Save')}</Button>
          </div>
        ) : (
          <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t('Paid to')} {data.momo.number} ({data.momo.name})</span>
            <button type="button" className="font-semibold text-primary" onClick={() => setEditing(true)}>{t('Change')}</button>
          </p>
        )}

        {full && (
          <>
            {data.withdrawals.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-semibold">{t('Payments')}</p>
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
