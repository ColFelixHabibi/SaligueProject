'use client';

import { useEffect, useState } from 'react';
import { api, onServerEvent } from './api';
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
  // The server groups items by shop and takes prices from the products themselves.
  const { ids } = await api<{ ids: string[] }>('/orders', {
    body: { items: items.map((item) => ({ productId: item.id, quantity: item.quantity })), delivery: cleanDelivery, paymentMethod },
  });
  return ids;
}

export async function updateOrder(id: string, changes: Partial<Pick<Order, 'status' | 'paymentStatus'>>) {
  await api(`/orders/${id}`, { method: 'PATCH', body: changes });
}

/** Live list of the current account's orders, as buyer or as seller, newest first. */
export function useOrders(as: 'buyer' | 'seller') {
  const [orders, setOrders] = useState<Order[] | null>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      api<Order[]>(`/orders?as=${as}`)
        .then((list) => active && setOrders(list))
        .catch((error) => {
          console.error('Failed to load orders:', error);
          if (active) setOrders([]);
        });
    void load();
    const stop = onServerEvent('orders', () => void load());
    return () => {
      active = false;
      stop();
    };
  }, [as]);
  return orders;
}
