'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { DeliveryAddress, Order, OrderStatus, PaymentMethod, Product } from './types';

export const PAYMENT_METHODS: { value: PaymentMethod; label: string; description: string }[] = [
  { value: 'mobile_money', label: 'Mobile Money', description: "Pay the shop's MoMo / Airtel Money number after placing the order." },
  { value: 'cash_on_delivery', label: 'Cash on delivery', description: 'Pay when the item reaches you.' },
  { value: 'pickup', label: 'Pick up at the shop', description: 'Collect and pay at the shop address.' },
];
export const ORDER_STATUSES: { value: OrderStatus; label: string }[] = [
  { value: 'placed', label: 'Placed' }, { value: 'confirmed', label: 'Confirmed' },
  { value: 'shipped', label: 'On the way' }, { value: 'delivered', label: 'Delivered' }, { value: 'cancelled', label: 'Cancelled' },
];

export const formatPrice = (amount: number) => `$${amount.toFixed(2)}`;
export const shortOrderId = (id: string) => id.slice(0, 6).toUpperCase();

export async function placeOrders(items: (Product & { quantity: number })[], delivery: DeliveryAddress, paymentMethod: PaymentMethod): Promise<string[]> {
  const cleanDelivery = Object.fromEntries(Object.entries(delivery)
    .map(([key, value]) => [key, String(value ?? '').trim()]).filter(([, value]) => value));
  const { data, error } = await supabase.rpc('place_orders', {
    p_items: items.map((item) => ({ productId: item.id, quantity: item.quantity })),
    p_delivery: cleanDelivery,
    p_payment_method: paymentMethod,
  });
  if (error) throw error;
  return data ?? [];
}

export function updateOrder(id: string, changes: Partial<Pick<Order, 'status' | 'paymentStatus'>>) {
  const update = {
    ...(changes.status ? { status: changes.status } : {}),
    ...(changes.paymentStatus ? { payment_status: changes.paymentStatus } : {}),
  };
  return supabase.from('orders').update(update).eq('id', id).then(({ error }) => { if (error) throw error; });
}

export function useOrders(as: 'buyer' | 'seller') {
  const [orders, setOrders] = useState<Order[] | null>(null);
  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const load = async (uid: string) => {
      const field = as === 'buyer' ? 'buyer_id' : 'seller_id';
      const { data, error } = await supabase.from('orders').select('*').eq(field, uid).order('created_at', { ascending: false });
      if (!active) return;
      if (error) { console.error('Failed to load orders:', error); setOrders([]); return; }
      setOrders((data ?? []).map((row) => ({
        id: row.id, buyerId: row.buyer_id, buyerName: row.buyer_name, buyerEmail: row.buyer_email,
        sellerId: row.seller_id, shop: row.shop, items: row.items, total: Number(row.total),
        delivery: row.delivery, paymentMethod: row.payment_method, paymentStatus: row.payment_status,
        status: row.status, createdAt: row.created_at,
      })) as Order[]);
    };
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!active) return;
      if (!user) { setOrders([]); return; }
      void load(user.id);
      const field = as === 'buyer' ? 'buyer_id' : 'seller_id';
      channel = supabase.channel(`orders-${as}-${user.id}-${crypto.randomUUID()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `${field}=eq.${user.id}` }, () => { void load(user.id); })
        .subscribe();
    });
    return () => { active = false; if (channel) void supabase.removeChannel(channel); };
  }, [as]);
  return orders;
}
