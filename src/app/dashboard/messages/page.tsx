'use client';

import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Inbox } from '@/components/messages/inbox';

/** A shop's messages with its customers, inside Seller Center. */
export default function DashboardMessagesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
      <Inbox base="/dashboard/messages" embedded />
    </Suspense>
  );
}
