'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, Check, X } from 'lucide-react';
import { ask } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/orders';

type Waiting = { id: string; userId: string; name: string; email: string; amount: number; momoNumber: string; momoName: string; createdAt: string; blocked: string | null; why: string | null };
type Data = { payout: { open: boolean; message: string | null }; minimum: number; local: { currency: string; rate: number }; waiting: Waiting[] };

/**
 * Admin → Money: withdrawals people asked for from their Saligue balance (server/wallet.mjs). Send the Mobile Money,
 * then mark it sent with its reference — or refuse it, and the amount goes back to their balance.
 */
export function WithdrawalsAdmin() {
  const { toast } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const load = useCallback(() => void api<Data>('/admin/withdrawals').then(setData).catch(() => {}), []);
  useEffect(() => load(), [load]);
  if (!data) return null;
  const local = (usd: number) => (data.local.currency !== 'USD' && data.local.rate > 0 ? ` (≈ ${Math.floor(usd * data.local.rate).toLocaleString()} ${data.local.currency})` : '');
  const decide = async (w: Waiting, decision: 'paid' | 'reject') => {
    const answer = decision === 'paid'
      ? await ask({ title: `Mark ${formatPrice(w.amount)} as sent?`, description: `To ${w.momoNumber} (${w.momoName})${local(w.amount)}.`, confirm: 'Sent', input: { label: 'Mobile Money reference' } })
      : await ask({ title: 'Refuse this withdrawal?', description: 'The amount goes back to their balance.', confirm: 'Refuse', destructive: true, input: { label: 'Why (shown to them)', value: 'The Mobile Money number or name is not right.' } });
    if (answer === null) return;
    try {
      await api(`/admin/withdrawals/${w.id}`, { body: decision === 'paid' ? { decision, reference: answer } : { decision, note: answer } });
      toast({ title: decision === 'paid' ? 'Marked as sent' : 'Refused, money returned' });
      load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) });
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ArrowDownToLine className="h-5 w-5 text-primary" /> Withdrawals to send {data.waiting.length > 0 && <Badge>{data.waiting.length}</Badge>}</CardTitle>
        <CardDescription>People withdraw from their Saligue balance (minimum {formatPrice(data.minimum)}). Send the Mobile Money, then mark it sent.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!data.payout.open && data.payout.message && <p className="rounded-lg bg-muted p-2 text-xs">{data.payout.message}</p>}
        {data.waiting.length === 0 && <p className="text-muted-foreground">Nothing waiting.</p>}
        {data.waiting.map((w) => (
          <div key={w.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{w.name} · {formatPrice(w.amount)}<span className="font-normal text-muted-foreground">{local(w.amount)}</span></p>
              <p className="text-xs text-muted-foreground">MoMo {w.momoNumber} ({w.momoName}) · {new Date(w.createdAt).toLocaleString()}</p>
              {w.why && <p className="text-xs text-destructive">{w.why}</p>}
            </div>
            <Button size="sm" disabled={!!w.blocked} onClick={() => decide(w, 'paid')}><Check className="mr-1 h-4 w-4" /> Sent</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => decide(w, 'reject')}><X className="mr-1 h-4 w-4" /> Refuse</Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
