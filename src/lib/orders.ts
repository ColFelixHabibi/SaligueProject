'use client';

import { useEffect, useState } from 'react';
import { api, onServerEvent } from './api';
import type { DeliveryAddress, Order, OrderStatus, PaymentDetails, PaymentMethod, Product, Shop } from './types';

/** The details a buyer must give to pay by hand: one form per way of sending the money. */
export type PayForm = 'mtn' | 'airtel' | 'paypal' | 'bank' | 'money';

/**
 * The ways to pay, in the order they are shown. `form` is what the buyer fills in for a payment made by hand (the
 * number or address the money comes from, plus the transaction ID); the shop's own details (Shop.momoNumber,
 * paypalEmail, bankAccountNumber…) say where the money goes, and Shop.pay says which of these it takes. Which of
 * them a bag of shopping is offered is decided by checkoutMethods() below.
 */
export const PAYMENT_METHODS: { value: PaymentMethod; label: string; description: string; form?: PayForm }[] = [
  { value: 'online', label: 'Pay online now', description: 'Card or Mobile Money (MTN / Airtel) on a secure payment page. Confirmed instantly.' },
  { value: 'mtn_momo', label: 'MTN MoMo', description: "Send the money to the shop's MTN MoMo number, then add the transaction ID.", form: 'mtn' },
  { value: 'airtel_money', label: 'Airtel Money', description: "Send the money to the shop's Airtel Money number, then add the transaction ID.", form: 'airtel' },
  { value: 'paypal', label: 'PayPal', description: "Pay the shop's PayPal address, from any country, then add the transaction ID.", form: 'paypal' },
  { value: 'bank_transfer', label: 'Bank transfer', description: "Transfer to the shop's bank account (Ecobank or any bank, local or international), then add the reference.", form: 'bank' },
  // Shops that have not added a MoMo or Airtel number keep the plain Mobile Money they had before.
  { value: 'mobile_money', label: 'Mobile Money to the shop', description: "Send the money to the shop's own number after ordering, with the order number as the reason.", form: 'money' },
  { value: 'cash_on_delivery', label: 'Cash on delivery', description: 'Pay when the item reaches you.' },
  { value: 'pickup', label: 'Pick up at the shop', description: 'Collect and pay at the shop address.' },
];

/** The questions asked for each way of paying by hand, in the order they are shown. */
const PAYMENT_FORMS: Record<PayForm, { id: 'from' | 'senderName' | 'bank' | 'reference'; label: string; placeholder: string; required?: boolean }[]> = {
  mtn: [
    { id: 'from', label: 'The MTN number you pay from', placeholder: '0788 000 000', required: true },
    { id: 'senderName', label: 'Name on that number', placeholder: 'The name MTN shows', required: true },
    { id: 'reference', label: 'MTN transaction ID', placeholder: 'MP240… (after you pay)' },
  ],
  airtel: [
    { id: 'from', label: 'The Airtel number you pay from', placeholder: '0730 000 000', required: true },
    { id: 'senderName', label: 'Name on that number', placeholder: 'The name Airtel shows', required: true },
    { id: 'reference', label: 'Airtel Money transaction ID', placeholder: 'After you pay' },
  ],
  paypal: [
    { id: 'from', label: 'Your PayPal email', placeholder: 'you@example.com', required: true },
    { id: 'senderName', label: 'Name on your PayPal account', placeholder: 'Your name', required: true },
    { id: 'reference', label: 'PayPal transaction ID', placeholder: 'After you pay' },
  ],
  bank: [
    { id: 'senderName', label: 'Name on the account you pay from', placeholder: 'Your name', required: true },
    { id: 'bank', label: 'Your bank', placeholder: 'Bank of Kigali, Ecobank…', required: true },
    { id: 'reference', label: 'Transfer reference or slip number', placeholder: 'After you transfer' },
  ],
  money: [
    { id: 'from', label: 'The number you pay from', placeholder: '0788 000 000', required: true },
    { id: 'senderName', label: 'Name on that number', placeholder: 'The name shown when you pay', required: true },
    { id: 'reference', label: 'Transaction ID', placeholder: 'After you pay' },
  ],
};

/** A payment the buyer makes by hand (everything but paying online or at the door). */
export const isManualPayment = (method: PaymentMethod) => PAYMENT_METHODS.find((m) => m.value === method)?.form !== undefined;

/** The questions for a way of paying: `needReference` makes the transaction ID compulsory (used once the money is on its way). */
export function paymentFormFields(form: PayForm | undefined, needReference = false) {
  const fields = form ? PAYMENT_FORMS[form] : [];
  return needReference ? fields.map((f) => (f.id === 'reference' ? { ...f, required: true } : f)) : fields;
}

/** The first required answer that is still empty, or null when the form is complete. */
export function paymentDetailMissing(form: PayForm | undefined, details: PaymentDetails, needReference = false): string | null {
  return paymentFormFields(form, needReference).find((f) => f.required && !String(details[f.id] ?? '').trim())?.label ?? null;
}

/**
 * Just the answers this way of paying asks for: switching to another way never carries the first one's answers
 * along, so an MTN MoMo order is not shown a bank line the buyer typed before changing their mind.
 */
export function paymentDetailForm(form: PayForm | undefined, details: PaymentDetails): PaymentDetails {
  const kept: PaymentDetails = {};
  for (const field of paymentFormFields(form)) {
    const value = String(details[field.id] ?? '').trim();
    if (value) kept[field.id] = value;
  }
  return kept;
}

/** A buyer's answers, ready to show the shop (only the ones they filled in). */
export function paymentDetailLines(details?: PaymentDetails | null) {
  const names: Record<'from' | 'senderName' | 'bank' | 'reference', string> = {
    from: 'Paid from', senderName: 'Name on it', bank: 'Bank', reference: 'Transaction ID / reference',
  };
  return (Object.keys(names) as (keyof typeof names)[])
    .map((id) => ({ label: names[id], value: String(details?.[id] ?? '').trim() }))
    .filter((line) => line.value);
}

/**
 * Where a buyer sends the money for this order (the shop's own number, PayPal address or bank account), or null
 * when the shop has not added the details for that way of paying yet.
 */
export function shopPaysTo(shop: Shop | null | undefined, method: PaymentMethod): { title: string; lines: { label: string; value: string }[] } | null {
  if (!shop) return null;
  const line = (label: string, value?: string | null) => ({ label, value: String(value ?? '').trim() });
  const kept = (lines: { label: string; value: string }[]) => lines.filter((l) => l.value);
  if (method === 'mtn_momo') {
    const lines = shop.momoNumber ? kept([line('Number', shop.momoNumber), line('Name', shop.momoName || shop.name)]) : [];
    return lines[0] ? { title: 'MTN MoMo', lines } : null;
  }
  if (method === 'mobile_money') {
    // The plain Mobile Money of shops that have not added an MTN or Airtel number: their phone, as before.
    const number = shop.whatsapp || shop.phone;
    return number ? { title: 'Mobile Money', lines: kept([line('Number', number), line('Name', shop.name)]) } : null;
  }
  if (method === 'airtel_money') {
    const lines = shop.airtelNumber ? kept([line('Number', shop.airtelNumber), line('Name', shop.airtelName || shop.name)]) : [];
    return lines[0] ? { title: 'Airtel Money', lines } : null;
  }
  if (method === 'paypal') {
    return shop.paypalEmail ? { title: 'PayPal', lines: [line('PayPal address', shop.paypalEmail), line('Name', shop.name)] } : null;
  }
  if (method === 'bank_transfer') {
    const lines = kept([line('Bank', shop.bankName || 'Bank transfer'), line('Account name', shop.bankAccountName), line('Account number / IBAN', shop.bankAccountNumber), line('SWIFT / BIC', shop.bankSwift)]);
    // An account number and the name on it are the least a transfer needs.
    return lines.length > 1 && shop.bankAccountNumber ? { title: shop.bankName || 'Bank transfer', lines } : null;
  }
  return null;
}

/**
 * Whether a shop takes a way of paying by hand: the list that travels with its items (Shop.pay), or — on a copy
 * saved before the catalogue carried that list — the details themselves.
 */
const accepts = (shop: Shop, method: PaymentMethod) => (shop.pay ? shop.pay.includes(method) : !!shopPaysTo(shop, method));

/**
 * The ways to pay this bag of shopping: online when it is switched on, then each way of paying by hand that every
 * shop in the bag has published details for. A shop that has added no MoMo or Airtel number keeps the plain Mobile
 * Money to its own number, so an item can always be bought.
 */
export function checkoutMethods(shops: (Shop | null | undefined)[], onlineEnabled: boolean) {
  const every = (method: PaymentMethod) => shops.length > 0 && shops.every((s) => !!s && accepts(s, method));
  const allowed = new Set<PaymentMethod>();
  if (onlineEnabled) allowed.add('online');
  for (const method of ['mtn_momo', 'airtel_money', 'paypal', 'bank_transfer'] as const) if (every(method)) allowed.add(method);
  if (shops.some((s) => !s || (!accepts(s, 'mtn_momo') && !accepts(s, 'airtel_money')))) allowed.add('mobile_money');
  allowed.add('cash_on_delivery');
  allowed.add('pickup');
  return PAYMENT_METHODS.filter((m) => allowed.has(m.value));
}

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

export async function placeOrders(items: (Product & { quantity: number })[], delivery: DeliveryAddress, paymentMethod: PaymentMethod, paymentDetails?: PaymentDetails): Promise<string[]> {
  const cleanDelivery = Object.fromEntries(Object.entries(delivery)
    .map(([key, value]) => [key, String(value ?? '').trim()]).filter(([, value]) => value));
  // The server groups items by shop and takes prices from the products themselves.
  const { ids } = await api<{ ids: string[] }>('/orders', {
    body: { items: items.map((item) => ({ productId: item.id, quantity: item.quantity })), delivery: cleanDelivery, paymentMethod, paymentDetails },
  });
  return ids;
}

export async function updateOrder(id: string, changes: Partial<Pick<Order, 'status' | 'paymentStatus' | 'paymentDetails'>> & { received?: true }) {
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
