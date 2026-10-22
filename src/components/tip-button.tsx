'use client';

import { useEffect, useState } from 'react';
import { Coins, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/components/auth/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

type Settings = { amounts: number[]; share: number; onlinePayment: boolean; momoNumber: string | null; momoName: string };
type Manual = { reference: string; amount: number; momoNumber: string | null; momoName: string };

/** 💰 Support a teacher or shop directly: pick an amount, pay online or by Mobile Money. */
export function TipButton({ toUserId, toName, lessonId, className, children }: { toUserId: string; toName: string; lessonId?: string; className?: string; children?: React.ReactNode }) {
  const { toast } = useToast();
  const { user, authUid } = useAuth();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [amount, setAmount] = useState(2);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<Manual | null>(null);
  useEffect(() => {
    if (open && !settings) api<Settings>('/tips/settings').then(setSettings).catch(() => {});
  }, [open, settings]);
  if (toUserId === authUid) return null;

  const send = async () => {
    setBusy(true);
    try {
      const r = await api<{ link?: string; manual?: boolean } & Manual>('/tips', { body: { toUserId, lessonId, amount, message } });
      if (r.link) window.location.href = r.link;
      else setManual(r);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not sent', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => (user ? setOpen(true) : toast({ title: 'Log in to send a tip' }))} className={className} aria-label={`Tip ${toName}`} title="Tip">
        {children ?? <Coins className="h-5 w-5" />}
      </button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setManual(null); }}>
        <DialogContent className="w-[92vw] max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Coins className="h-5 w-5 text-primary" /> Tip {toName}</DialogTitle>
            <DialogDescription>{settings ? `${Math.round(settings.share * 100)}% goes to ${toName}, paid to their Mobile Money.` : ' '}</DialogDescription>
          </DialogHeader>
          {manual ? (
            <div className="space-y-3 text-sm">
              <p>Send <b>{formatPrice(manual.amount)}</b> by Mobile Money to <b>{manual.momoNumber ?? 'Saligue'}</b> ({manual.momoName}) with this reference:</p>
              <p className="select-all rounded-xl bg-muted p-3 text-center text-xl font-extrabold tracking-widest">{manual.reference}</p>
              <p className="text-muted-foreground">Saligue confirms it and tells {toName}. Thank you for supporting creators!</p>
              <Button className="w-full" onClick={() => setOpen(false)}>Done</Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-5 gap-2">
                {(settings?.amounts ?? [1, 2, 5, 10, 20]).map((a) => (
                  <button key={a} type="button" onClick={() => setAmount(a)} aria-pressed={amount === a}
                    className={cn('rounded-xl border py-3 text-sm font-bold', amount === a ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>${a}</button>
                ))}
              </div>
              <Input maxLength={200} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Say thank you (optional)" />
              <Button className="h-12 w-full" onClick={send} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send {formatPrice(amount)}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
