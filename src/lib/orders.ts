'use client';

import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { DeliveryAddress, Order, OrderStatus, PaymentMethod, Product } from './types';

export const PAYMENT_METHODS: { value: PaymentMethod; label: string; description: string }[] = [
  { value: 'mobile_money', label: 'Mobile Money', description: "Pay the shop's MoMo / Airtel Money number after placing the order." },
  { value: 'cash_on_delivery', label: 'Cash on delivery', description: 'Pay when the item reaches you.' },
  { value: 'pickup', label: 'Pick up at the shop', description: 'Collect and pay at the shop address.' },
];

export const ORDER_STATUSES: { value: OrderStatus; label: string }[] = [
  { value: 'placed', label: 'Placed' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'shipped', label: 'On the way' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const formatPrice = (amount: number) => `$${amount.toFixed(2)}`;
export const shortOrderId = (id: string) => id.slice(0, 6).toUpperCase();

/** Creates one order per shop from the cart items. Returns the new order IDs. */
export async function placeOrders(
  items: (Product & { quantity: number })[],
  delivery: DeliveryAddress,
  paymentMethod: PaymentMethod
): Promise<string[]> {
  const user = auth.currentUser;
  if (!user) throw new Error('Please log in to place an order.');

  const bySeller = new Map<string, (Product & { quantity: number })[]>();
  for (const item of items) {
    if (!item.sellerId) continue;
    bySeller.set(item.sellerId, [...(bySeller.get(item.sellerId) ?? []), item]);
  }

  const cleanDelivery = Object.fromEntries(
    Object.entries(delivery).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v)
  ) as DeliveryAddress;

  const batch = writeBatch(db);
  const ids: string[] = [];
  bySeller.forEach((sellerItems, sellerId) => {
    const ref = doc(collection(db, 'orders'));
    ids.push(ref.id);
    const lines = sellerItems.map((i) => ({ productId: i.id, name: i.name, price: Number(i.price), quantity: i.quantity }));
    batch.set(ref, {
      buyerId: user.uid,
      buyerName: user.displayName || delivery.fullName,
      buyerEmail: user.email || '',
      sellerId,
      shop: sellerItems[0].shop ?? null,
      items: lines,
      total: lines.reduce((sum: number, l) => sum + l.price * l.quantity, 0),
      delivery: cleanDelivery,
      paymentMethod,
      paymentStatus: 'unpaid',
      status: 'placed',
      createdAt: serverTimestamp(),
    });
  });
  await batch.commit();
  return ids;
}

export function updateOrder(id: string, changes: Partial<Pick<Order, 'status' | 'paymentStatus'>>) {
  return updateDoc(doc(db, 'orders', id), changes);
}

/** Live list of the signed-in user's orders, as buyer or as seller, newest first. */
export function useOrders(as: 'buyer' | 'seller') {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);

  useEffect(() => auth.onAuthStateChanged((u) => setUid(u?.uid ?? null)), []);

  useEffect(() => {
    if (!uid) {
      setOrders([]);
      return;
    }
    const q = query(collection(db, 'orders'), where(as === 'buyer' ? 'buyerId' : 'sellerId', '==', uid));
    return onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({ ...(d.data() as Omit<Order, 'id'>), id: d.id }));
        // Orders just placed have no server time yet; treat them as newest.
        const time = (o: Order) => o.createdAt?.seconds ?? Date.now() / 1000;
        list.sort((a, b) => time(b) - time(a));
        setOrders(list);
      },
      (error) => {
        console.error('Failed to load orders:', error);
        setOrders([]);
      }
    );
  }, [as, uid]);

  return orders;
}
