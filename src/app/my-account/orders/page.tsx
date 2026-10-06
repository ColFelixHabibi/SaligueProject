
'use client';

import { OrderList } from '@/components/order-list';

export default function MyOrdersPage() {
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">My orders</h1>
      <OrderList as="buyer" />
    </div>
  );
}
