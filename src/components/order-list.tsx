
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MapPin, Package, Phone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ShopAddress } from '@/components/shop-address';
import { useToast } from '@/hooks/use-toast';
import { ORDER_STATUSES, PAYMENT_METHODS, formatPrice, shortOrderId, updateOrder, useOrders } from '@/lib/orders';
import type { Order } from '@/lib/types';

function statusLabel(status: string) {
  return ORDER_STATUSES.find((s) => s.value === status)?.label ?? status;
}

function OrderCard({ order, as }: { order: Order; as: 'buyer' | 'seller' }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const payment = PAYMENT_METHODS.find((m) => m.value === order.paymentMethod);
  const when = order.createdAt ? new Date(order.createdAt.seconds * 1000).toLocaleString() : 'Just now';
  const momo = order.shop?.whatsapp || order.shop?.phone;

  const change = async (changes: Parameters<typeof updateOrder>[1]) => {
    setSaving(true);
    try {
      await updateOrder(order.id, changes);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Could not update order', description: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-lg">Order #{shortOrderId(order.id)}</CardTitle>
          <p className="text-sm text-muted-foreground">{when}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={order.status === 'cancelled' ? 'destructive' : 'default'}>{statusLabel(order.status)}</Badge>
          <Badge variant={order.paymentStatus === 'paid' ? 'default' : 'outline'}>{order.paymentStatus === 'paid' ? 'Paid' : 'Not paid yet'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 text-sm">
          {order.items.map((item) => (
            <div key={item.productId} className="flex justify-between gap-2">
              <Link href={`/product?id=${item.productId}`} className="truncate hover:underline">{item.quantity} × {item.name}</Link>
              <span className="shrink-0">{formatPrice(item.price * item.quantity)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1 font-semibold">
            <span>Total</span>
            <span>{formatPrice(order.total)}</span>
          </div>
        </div>

        <p className="text-sm"><span className="font-medium">Payment:</span> {payment?.label}</p>

        {as === 'buyer' ? (
          <>
            {order.paymentMethod === 'mobile_money' && order.paymentStatus === 'unpaid' && order.status !== 'cancelled' && momo && (
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
                Send <b>{formatPrice(order.total)}</b> by Mobile Money to <b>{momo}</b> ({order.shop?.name}) with reference <b>{shortOrderId(order.id)}</b>.
              </div>
            )}
            {order.shop && <ShopAddress shop={order.shop} compact={order.paymentMethod !== 'pickup'} />}
            {order.status === 'placed' && (
              <Button variant="outline" size="sm" disabled={saving} onClick={() => change({ status: 'cancelled' })}>
                Cancel order
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
              <p className="font-semibold">{order.delivery.fullName}</p>
              <a href={`tel:${order.delivery.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-2 hover:underline">
                <Phone className="h-4 w-4" /> {order.delivery.phone}
              </a>
              {order.paymentMethod !== 'pickup' && (
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  {[order.delivery.street, order.delivery.landmark && `near ${order.delivery.landmark}`, order.delivery.district, order.delivery.city, order.delivery.country].filter(Boolean).join(', ')}
                </p>
              )}
              {order.delivery.notes && <p className="italic text-muted-foreground">“{order.delivery.notes}”</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={order.status} onValueChange={(v) => change({ status: v as Order['status'] })} disabled={saving}>
                <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORDER_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                variant={order.paymentStatus === 'paid' ? 'outline' : 'default'}
                size="sm"
                className="h-9"
                disabled={saving}
                onClick={() => change({ paymentStatus: order.paymentStatus === 'paid' ? 'unpaid' : 'paid' })}
              >
                {order.paymentStatus === 'paid' ? 'Mark as not paid' : 'Mark as paid'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The signed-in user's orders, as buyer ("My orders") or seller ("Shop orders"). */
export function OrderList({ as }: { as: 'buyer' | 'seller' }) {
  const orders = useOrders(as);
  if (!orders) {
    return <div className="grid gap-4">{[0, 1].map((i) => <Skeleton key={i} className="h-48 w-full" />)}</div>;
  }
  if (orders.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed py-16 text-center text-muted-foreground">
        <Package className="mx-auto mb-3 h-10 w-10" />
        {as === 'buyer' ? 'You have no orders yet.' : 'No orders for your shop yet.'}
      </div>
    );
  }
  return <div className="grid gap-4">{orders.map((o) => <OrderCard key={o.id} order={o} as={as} />)}</div>;
}
