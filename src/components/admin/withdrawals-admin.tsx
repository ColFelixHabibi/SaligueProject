'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, Loader2, X } from 'lucide-react';
import { ask } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/orders';

const nth = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

type Waiting = { id: string; userId: string; name: string; email: string; amount: number; momoNumber: string; momoName: string; createdAt: string; sending: boolean };
type Data = {
  rules: { minimum: number; payday: number; autoSend: boolean };
  nextPayday: string; transfersReady: boolean;
  payout: { open: boolean; message: string | null };
  local: { currency: string; rate: number };
  waiting: Waiting[];
};

/**
 * Admin → Money → Payday (server/wallet.mjs). Like YouTube: on payday everyone whose balance reached the minimum is
 * paid in full, with nobody approving. With automatic sending the payment partner sends the money; without it, this
 * list is what to send by Mobile Money, and each one is recorded as sent or as failed (the money goes back).
 */
export function WithdrawalsAdmin() {
  const { toast } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => void api<Data>('/admin/withdrawals').then(setData).catch(() => {}), []);
  useEffect(() => load(), [load]);
  if (!data) return null;
  const local = (usd: number) => (data.local.currency !== 'USD' && data.local.rate > 0 ? ` (≈ ${Math.floor(usd * data.local.rate).toLocaleString()} ${data.local.currency})` : '');
  const save = async (body: Partial<Data['rules']>) => {
    setBusy(true);
    try {
      await api('/admin/wallet', { method: 'PUT', body });
      toast({ title: 'Payday settings saved' });
      load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not saved', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };
  const record = async (w: Waiting, decision: 'paid' | 'failed') => {
    const answer = decision === 'paid'
      ? await ask({ title: `${formatPrice(w.amount)} sent?`, description: `To ${w.momoNumber} (${w.momoName})${local(w.amount)}.`, confirm: 'Sent', input: { label: 'Mobile Money reference' } })
      : await ask({ title: 'This payment could not be sent?', description: 'The money goes back to their balance and is paid on the next payday.', confirm: 'Could not send', destructive: true, input: { label: 'Why (shown to them)', value: 'The Mobile Money number or name is not right.' } });
    if (answer === null) return;
    try {
      await api(`/admin/withdrawals/${w.id}`, { body: decision === 'paid' ? { decision, reference: answer } : { decision, note: answer } });
      load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) });
    }
  };
  const payday = new Date(`${data.nextPayday}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" /> Payday {data.waiting.length > 0 && <Badge>{data.waiting.length}</Badge>}</CardTitle>
        <CardDescription>
          Every month on the {nth(data.rules.payday)}, everyone whose balance reached {formatPrice(data.rules.minimum)} is paid all of it to their Mobile Money — nobody asks, nobody approves. Next: <b>{payday}</b>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!data.payout.open && data.payout.message && <p className="rounded-lg bg-amber-400/10 p-2 text-xs">{data.payout.message} Until then, payments are held and carried over.</p>}
        <div className="flex flex-wrap items-end gap-3 rounded-xl border p-3">
          <label className="space-y-1 text-xs">Payday (day of month)
            <Input type="number" min={1} max={28} defaultValue={data.rules.payday} className="h-9 w-20" onBlur={(e) => Number(e.target.value) !== data.rules.payday && save({ payday: Number(e.target.value) })} />
          </label>
          <label className="space-y-1 text-xs">Minimum ($)
            <Input type="number" min={1} defaultValue={data.rules.minimum} className="h-9 w-24" onBlur={(e) => Number(e.target.value) !== data.rules.minimum && save({ minimum: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={data.rules.autoSend} disabled={busy || (!data.transfersReady && !data.rules.autoSend)} onCheckedChange={(v) => save({ autoSend: v })} />
            Send automatically through Flutterwave
          </label>
          {busy && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        </div>
        {!data.transfersReady && <p className="text-xs text-muted-foreground">Automatic sending needs the Flutterwave key and exchange rate (Platform → Payments). Until then, send the list below by Mobile Money and record each one.</p>}
        {data.waiting.length === 0 && <p className="text-muted-foreground">Nothing to send.</p>}
        {data.waiting.map((w) => (
          <div key={w.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{w.name} · {formatPrice(w.amount)}<span className="font-normal text-muted-foreground">{local(w.amount)}</span></p>
              <p className="text-xs text-muted-foreground">MoMo {w.momoNumber} ({w.momoName}){w.sending ? ' · sending through Flutterwave…' : ''}</p>
            </div>
            {!w.sending && (
              <>
                <Button size="sm" onClick={() => record(w, 'paid')}><Check className="mr-1 h-4 w-4" /> Sent</Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => record(w, 'failed')}><X className="mr-1 h-4 w-4" /> Could not send</Button>
              </>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
