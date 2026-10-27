'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/auth-provider';
import { Inbox } from '@/components/messages/inbox';

/** Shoppers' messages. Shops read theirs inside Seller Center (/dashboard/messages), so links here lead there. */
function Messages() {
  const { role, isAuthLoading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    if (!isAuthLoading && role === 'seller') router.replace(`/dashboard/messages${params.toString() ? `?${params}` : ''}`);
  }, [isAuthLoading, role, params, router]);
  if (isAuthLoading || role === 'seller') return <div className="p-8"><Skeleton className="h-96 w-full" /></div>;
  return <Inbox />;
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="p-8"><Skeleton className="h-96 w-full" /></div>}>
      <Messages />
    </Suspense>
  );
}
