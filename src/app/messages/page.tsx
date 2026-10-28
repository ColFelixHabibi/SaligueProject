'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/auth-provider';
import { Inbox } from '@/components/messages/inbox';

/** Messages live inside each dashboard (My Saligue or Seller Center); links here lead there. */
function Messages() {
  const { user, role, isAuthLoading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    if (isAuthLoading || !user) return;
    router.replace(`${role === 'seller' ? '/dashboard/messages' : '/my-account/messages'}${params.toString() ? `?${params}` : ''}`);
  }, [isAuthLoading, user, role, params, router]);
  if (isAuthLoading || user) return <div className="p-8"><Skeleton className="h-96 w-full" /></div>;
  return <Inbox />;
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="p-8"><Skeleton className="h-96 w-full" /></div>}>
      <Messages />
    </Suspense>
  );
}
