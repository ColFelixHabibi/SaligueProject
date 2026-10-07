
'use client';

import { OrderList } from '@/components/order-list';

// Purchases of the current visitor (guests included); a seller's sales are under /dashboard/orders.
export default function MyOrdersPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-4 px-4 py-6 md:py-10">
      <h1 className="text-2xl font-bold">My orders</h1>
      <OrderList as="buyer" />
    </div>
  );
}
