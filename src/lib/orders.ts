'use client';

import { useEffect, useState } from 'react';
import { api, onServerEvent } from './api';
import type { DeliveryAddress, Order, OrderStatus, PaymentMethod, Product } from './types';

export const PAYMENT_METHODS: { value: PaymentMethod; label: string; description: string }[] = [
  { value: 'online', label: 'Pay online now', description: 'Card or Mobile Money (MTN / Airtel) on a secure payment page. Confirmed instantly.' },
  { value: 'mobile_money', label: 'Mobile Money to the shop', description: "Send the money to the shop's MoMo / Airtel Money number after ordering." },
  { value: 'cash_on_delivery', label: 'Cash on delivery', description: 'Pay when the item reaches you.' },
  { value: 'pickup', label: 'Pick up at the shop', description: 'Collect and pay at the shop address.' },
];
export const ORDER_STATUSES: { value: OrderStatus; label: string }[] = [
  { value: 'placed', label: 'Placed' }, { value: 'confirmed', label: 'Confirmed' },
  { value: 'shipped', label: 'On the way' }, { value: 'delivered', label: 'Delivered' }, { value: 'cancelled', label: 'Cancelled' },
];

// The dollar sign is built from its character code: an edit tool here rewrites a literal "$" (dollar + template
// start) into a single one, which once silently dropped it from every price in the app.
const DOLLAR = String.fromCharCode(36);
export const formatPrice = (amount: number) => DOLLAR + amount.toFixed(2);
export const shortOrderId = (id: string) => id.slice(0, 6).toUpperCase();

/**
 * What shoppers pay after a % off — the same rounding the server uses (server/index.mjs, priceOf), so the
 * preview a shop sees while typing the discount is exactly the price that is charged.
 */
export function salePrice(price: number, percent: number) {
  const off = Math.min(90, Math.max(0, Math.floor(Number(percent) || 0)));
  return off ? Math.round(Number(price) * (1 - off / 100) * 100) / 100 : Number(price);
}

export async function placeOrders(items: (Product & { quantity: number })[], delivery: DeliveryAddress, paymentMethod: PaymentMethod): Promise<string[]> {
  const cleanDelivery = Object.fromEntries(Object.entries(delivery)
    .map(([key, value]) => [key, String(value ?? '').trim()]).filter(([, value]) => value));
  // The server groups items by shop and takes prices from the products themselves.
  const { ids } = await api<{ ids: string[] }>('/orders', {
    body: { items: items.map((item) => ({ productId: item.id, quantity: item.quantity })), delivery: cleanDelivery, paymentMethod },
  });
  return ids;
}

export async function updateOrder(id: string, changes: Partial<Pick<Order, 'status' | 'paymentStatus'>> & { received?: true }) {
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

export type PaymentConfig = { enabled: boolean; currency: string; rate: number; methods: string[] };

/** Whether online payment (card / Mobile Money) is switched on, and in which currency. */
export function usePaymentConfig() {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  useEffect(() => {
    api<PaymentConfig>('/payments/config').then(setConfig).catch(() => setConfig({ enabled: false, currency: 'USD', rate: 1, methods: [] }));
  }, []);
  return config;
}

/** Starts paying orders online and sends the browser to the secure payment page. */
export async function payOnline(orderIds: string[], email?: string) {
  const { link } = await api<{ link: string }>('/payments/start', { body: { orderIds, email } });
  window.location.href = link;
}
