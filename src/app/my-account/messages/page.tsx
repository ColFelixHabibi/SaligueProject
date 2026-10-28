'use client';

import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Inbox } from '@/components/messages/inbox';

/** A shopper's conversations with shops, inside My Saligue. */
export default function MyMessages() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
      <Inbox base="/my-account/messages" embedded />
    </Suspense>
  );
}
