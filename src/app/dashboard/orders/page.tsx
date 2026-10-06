
'use client';

import { OrderList } from '@/components/order-list';

export default function ShopOrdersPage() {
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Shop orders</h1>
      <OrderList as="seller" />
    </div>
  );
}
