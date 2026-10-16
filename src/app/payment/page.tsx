'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/components/auth/auth-provider';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { payOnline } from '@/lib/orders';

type Status = 'checking' | 'paid' | 'pending' | 'failed' | 'error';

// Flutterwave sends the shopper back here (?status=…&tx_ref=…&transaction_id=…).
// The server checks the payment with Flutterwave itself before marking any order paid.
function PaymentResult() {
  const params = useSearchParams();
  const { authUid } = useAuth();
  const txRef = params.get('tx_ref');
  const transactionId = params.get('transaction_id');
  const cancelled = params.get('status') === 'cancelled';
  const [status, setStatus] = useState<Status>('checking');
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const tries = useRef(0);

  useEffect(() => {
    if (!authUid || !txRef) return;
    let stop = false;
    const check = async () => {
      try {
        const result = await api<{ status: 'paid' | 'pending' | 'failed'; orderIds: string[] }>('/payments/verify', { body: { txRef, transactionId } });
        if (stop) return;
        setOrderIds(result.orderIds ?? []);
        if (result.status === 'pending' && !cancelled && tries.current++ < 6) {
          setStatus('pending');
          setTimeout(check, 4000);
          return;
        }
        setStatus(cancelled && result.status !== 'paid' ? 'failed' : result.status);
      } catch (e) {
        if (!stop) {
          setStatus('error');
          setError(friendlyError(e));
        }
      }
    };
    void check();
    return () => {
      stop = true;
    };
  }, [authUid, txRef, transactionId, cancelled]);

  const retry = async () => {
    try {
      await payOnline(orderIds);
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  if (!txRef) {
    return <p className="py-20 text-center text-muted-foreground">No payment to check. <Link href="/orders" className="text-primary underline">My orders</Link></p>;
  }

  const view = {
    checking: { icon: Loader2, spin: true, tone: 'text-primary', title: 'Checking your payment…', text: 'This takes a few seconds.' },
    pending: { icon: Clock, spin: false, tone: 'text-amber-600', title: 'Waiting for confirmation', text: 'Approve the payment on your phone if Mobile Money asked you to. This page updates by itself.' },
    paid: { icon: CheckCircle2, spin: false, tone: 'text-emerald-600', title: 'Payment received. Thank you!', text: 'The shop has your paid order and will confirm it soon. We sent you a receipt by email.' },
    failed: { icon: XCircle, spin: false, tone: 'text-destructive', title: cancelled ? 'Payment cancelled' : 'Payment did not go through', text: 'No money was taken. Your order stays reserved for 24 hours: try again or choose another way to pay.' },
    error: { icon: XCircle, spin: false, tone: 'text-destructive', title: 'We could not check the payment', text: error ?? 'Please look at My orders in a moment.' },
  }[status];

  return (
    <div className="container mx-auto max-w-lg px-4 py-16">
      <Card className="rounded-2xl">
        <CardContent className="space-y-4 p-8 text-center">
          <view.icon className={`mx-auto h-16 w-16 ${view.tone} ${view.spin ? 'animate-spin' : ''}`} />
          <h1 className="text-2xl font-extrabold">{view.title}</h1>
          <p className="text-muted-foreground">{view.text}</p>
          <div className="flex flex-col gap-2 pt-2">
            {status === 'failed' && orderIds.length > 0 && <Button size="lg" onClick={retry}>Try paying again</Button>}
            <Button size="lg" variant={status === 'paid' ? 'default' : 'outline'} asChild><Link href="/orders">View my orders</Link></Button>
            {status === 'paid' && <Button variant="ghost" asChild><Link href="/search">Continue shopping</Link></Button>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PaymentPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" /></div>}>
      <PaymentResult />
    </Suspense>
  );
}
