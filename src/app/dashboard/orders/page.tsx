'use client';

import { ask } from '@/components/confirm-dialog';
import { friendlyError } from '@/lib/errors';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';
import { Check, CircleDollarSign, Download, MapPin, Phone, Search, Truck, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MessageSellerButton } from '@/components/message-seller-button';
import { useToast } from '@/hooks/use-toast';
import { ORDER_STATUSES, PAYMENT_METHODS, formatPrice, shortOrderId, updateOrder, useOrders } from '@/lib/orders';
import { downloadCsv } from '@/lib/seller';
import type { Order, OrderStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const FLOW: OrderStatus[] = ['placed', 'confirmed', 'shipped', 'delivered'];
const NEXT: Partial<Record<OrderStatus, { status: OrderStatus; label: string; icon: typeof Check }>> = {
  placed: { status: 'confirmed', label: 'Confirm order', icon: Check },
  confirmed: { status: 'shipped', label: 'Mark as on the way', icon: Truck },
  shipped: { status: 'delivered', label: 'Mark as delivered', icon: Check },
};
const statusLabel = (s: string) => ORDER_STATUSES.find((x) => x.value === s)?.label ?? s;
const STATUS_STYLE: Record<OrderStatus, string> = {
  placed: 'bg-primary text-primary-foreground',
  confirmed: 'bg-foreground text-background',
  shipped: 'bg-sky-600 text-white',
  delivered: 'bg-emerald-600 text-white',
  cancelled: 'bg-muted text-muted-foreground line-through',
};

function OrderDetails({ order, onClose }: { order: Order; onClose: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const next = NEXT[order.status];
  const payment = PAYMENT_METHODS.find((m) => m.value === order.paymentMethod);
  const step = FLOW.indexOf(order.status);

  const change = async (changes: Parameters<typeof updateOrder>[1], done: string) => {
    setSaving(true);
    try {
      await updateOrder(order.id, changes);
      toast({ title: done, description: 'The customer has been notified.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not update order', description: friendlyError(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
      <SheetHeader className="text-left">
        <SheetTitle className="flex items-center gap-2">Order #{shortOrderId(order.id)} <Badge className={STATUS_STYLE[order.status]}>{statusLabel(order.status)}</Badge></SheetTitle>
        <SheetDescription>{order.createdAt ? format(new Date(order.createdAt), "d MMMM yyyy 'at' HH:mm") : ''}</SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-6">
        {order.status !== 'cancelled' && (
          <ol className="grid grid-cols-4 gap-1 text-center text-[11px] font-medium">
            {FLOW.map((s, i) => (
              <li key={s} className="space-y-1">
                <span className={cn('mx-auto block h-1.5 rounded-full', i <= step ? 'bg-primary' : 'bg-muted')} />
                <span className={i <= step ? 'text-foreground' : 'text-muted-foreground'}>{statusLabel(s)}</span>
              </li>
            ))}
          </ol>
        )}

        {order.status !== 'cancelled' && (
          <div className="grid gap-2">
            {next && (
              <Button size="lg" className="h-12 text-base" disabled={saving} onClick={() => change({ status: next.status }, `Order ${statusLabel(next.status).toLowerCase()}`)}>
                <next.icon className="mr-2 h-5 w-5" /> {next.label}
              </Button>
            )}
            {order.paymentStatus !== 'paid' && order.paymentMethod !== 'online' && (
              <Button size="lg" variant="outline" className="h-12 text-base" disabled={saving} onClick={() => change({ paymentStatus: 'paid' }, 'Marked as paid')}>
                <CircleDollarSign className="mr-2 h-5 w-5" /> I received the payment
              </Button>
            )}
            <MessageSellerButton orderId={order.id} label="Message the customer" variant="secondary" className="h-12 w-full text-base" />
          </div>
        )}

        <section className="space-y-2 rounded-xl border p-4">
          <h3 className="font-semibold">Customer</h3>
          <p className="font-medium">{order.delivery.fullName}</p>
          <a href={`tel:${order.delivery.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-2 text-sm text-primary hover:underline"><Phone className="h-4 w-4" /> {order.delivery.phone}</a>
          {order.buyerEmail && <p className="text-sm text-muted-foreground">{order.buyerEmail}</p>}
          {order.paymentMethod !== 'pickup' ? (
            <p className="flex items-start gap-2 text-sm"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              {[order.delivery.street, order.delivery.landmark && `near ${order.delivery.landmark}`, order.delivery.district, order.delivery.city, order.delivery.country].filter(Boolean).join(', ')}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Picks up at your shop.</p>
          )}
          {order.delivery.notes && <p className="rounded-lg bg-muted p-2 text-sm italic">“{order.delivery.notes}”</p>}
        </section>

        <section className="space-y-2 rounded-xl border p-4">
          <h3 className="font-semibold">Items</h3>
          {order.items.map((i) => (
            <div key={i.productId} className="flex items-center gap-3 text-sm">
              {i.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={i.image} alt="" className="h-10 w-10 rounded-md border bg-muted object-contain p-0.5" />
              )}
              <Link href={`/product?id=${i.productId}`} className="min-w-0 flex-1 truncate hover:underline">{i.quantity} × {i.name}</Link>
              <span className="font-medium">{formatPrice(i.price * i.quantity)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-2 font-bold"><span>Total</span><span className="text-primary">{formatPrice(order.total)}</span></div>
        </section>

        <section className="space-y-1 rounded-xl border p-4 text-sm">
          <h3 className="mb-1 font-semibold">Payment</h3>
          <p>{payment?.label}</p>
          <p className={order.paymentStatus === 'paid' ? 'font-semibold text-emerald-600' : 'text-amber-600'}>
            {order.paymentStatus === 'paid' ? `Paid${order.paidAt ? ` · ${format(new Date(order.paidAt), 'd MMM HH:mm')}` : ''}` : order.paymentMethod === 'online' ? 'Waiting for the customer to pay online — don’t send it yet' : 'Not paid yet'}
          </p>
          {order.paymentStatus === 'paid' && order.paymentMethod !== 'online' && order.status !== 'cancelled' && (
            <button type="button" className="text-xs text-muted-foreground underline" disabled={saving} onClick={() => change({ paymentStatus: 'unpaid' }, 'Marked as not paid')}>Mark as not paid</button>
          )}
        </section>

        {order.status !== 'cancelled' && order.status !== 'delivered' && (
          <Button variant="ghost" className="w-full text-destructive hover:text-destructive" disabled={saving}
            onClick={async () => (await ask({ title: 'Cancel this order?', description: 'The items go back in stock and the customer is told.', confirm: 'Cancel order', destructive: true })) && change({ status: 'cancelled' }, 'Order cancelled').then(onClose)}>
            <XCircle className="mr-2 h-4 w-4" /> Cancel order
          </Button>
        )}
      </div>
    </SheetContent>
  );
}

function OrdersManager() {
  const router = useRouter();
  const params = useSearchParams();
  const orders = useOrders('seller');
  const [status, setStatus] = useState<OrderStatus | 'all'>((params.get('status') as OrderStatus) || 'all');
  const [unpaidOnly, setUnpaidOnly] = useState(params.get('payment') === 'unpaid');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(params.get('open'));
  useEffect(() => setOpenId(params.get('open')), [params]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders?.length ?? 0 };
    for (const o of orders ?? []) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (orders ?? []).filter((o) =>
      (status === 'all' || o.status === status) &&
      (!unpaidOnly || (o.paymentStatus !== 'paid' && o.status !== 'cancelled')) &&
      (!q || [shortOrderId(o.id), o.delivery.fullName, o.delivery.phone, ...o.items.map((i) => i.name)].join(' ').toLowerCase().includes(q))
    );
  }, [orders, status, unpaidOnly, query]);

  const open = orders?.find((o) => o.id === openId) ?? null;
  const setOpen = (id: string | null) => {
    setOpenId(id);
    router.replace(id ? `/dashboard/orders?open=${id}` : '/dashboard/orders', { scroll: false });
  };

  const exportCsv = () =>
    downloadCsv('saligue-orders.csv', [
      ['Order', 'Date', 'Customer', 'Phone', 'City', 'Items', 'Total', 'Payment method', 'Payment', 'Status'],
      ...shown.map((o) => [shortOrderId(o.id), o.createdAt?.slice(0, 16).replace('T', ' '), o.delivery.fullName, o.delivery.phone, o.delivery.city,
        o.items.map((i) => `${i.quantity} x ${i.name}`).join('; '), o.total, PAYMENT_METHODS.find((m) => m.value === o.paymentMethod)?.label, o.paymentStatus, statusLabel(o.status)]),
    ]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="hidden text-2xl font-bold tracking-tight md:block">Orders</h2>
          <p className="text-sm text-muted-foreground">Confirm, send and deliver orders. Customers are told at every step.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!shown.length}><Download className="mr-2 h-4 w-4" /> Export</Button>
      </div>

      <Card className="overflow-hidden rounded-2xl">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="flex gap-1 overflow-x-auto">
            {(['all', ...ORDER_STATUSES.map((s) => s.value)] as const).map((s) => (
              <button key={s} type="button" onClick={() => setStatus(s)}
                className={cn('flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition', status === s ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                {s === 'all' ? 'All' : statusLabel(s)} <span className={cn('rounded-full px-1.5 text-xs', status === s ? 'bg-white/25' : 'bg-muted')}>{counts[s] ?? 0}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setUnpaidOnly((v) => !v)} className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', unpaidOnly ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}>
            Not paid only
          </button>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Order #, customer, phone, item" className="h-9 pl-8" />
          </div>
        </div>
        <CardContent className="overflow-x-auto p-0">
          {!orders ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : shown.length === 0 ? (
            <p className="py-16 text-center text-muted-foreground">{orders.length ? 'No orders match.' : 'No orders yet. They appear here the moment a shopper orders.'}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead className="hidden md:table-cell">Items</TableHead>
                  <TableHead>Total</TableHead><TableHead className="hidden sm:table-cell">Payment</TableHead><TableHead>Status</TableHead><TableHead className="w-28"><span className="sr-only">Action</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((o) => {
                  const next = NEXT[o.status];
                  return (
                    <TableRow key={o.id} className="cursor-pointer" onClick={() => setOpen(o.id)}>
                      <TableCell>
                        <span className="font-semibold">#{shortOrderId(o.id)}</span>
                        <span className="block text-xs text-muted-foreground">{o.createdAt ? formatDistanceToNow(new Date(o.createdAt), { addSuffix: true }) : ''}</span>
                      </TableCell>
                      <TableCell><span className="block max-w-[9rem] truncate font-medium">{o.delivery.fullName}</span><span className="block text-xs text-muted-foreground">{o.delivery.city}</span></TableCell>
                      <TableCell className="hidden max-w-[14rem] truncate text-sm md:table-cell">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</TableCell>
                      <TableCell className="font-semibold">{formatPrice(o.total)}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="outline" className={o.paymentStatus === 'paid' ? 'border-emerald-500 text-emerald-600' : 'border-amber-500 text-amber-600'}>{o.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}</Badge>
                      </TableCell>
                      <TableCell><Badge className={STATUS_STYLE[o.status]}>{statusLabel(o.status)}</Badge></TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {next && (
                          <Button size="sm" variant="outline" className="h-8 whitespace-nowrap" onClick={() => updateOrder(o.id, { status: next.status })}>
                            {next.label.replace('Mark as ', '')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        {open && <OrderDetails order={open} onClose={() => setOpen(null)} />}
      </Sheet>
    </>
  );
}

export default function SellerOrdersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
      <OrdersManager />
    </Suspense>
  );
}
