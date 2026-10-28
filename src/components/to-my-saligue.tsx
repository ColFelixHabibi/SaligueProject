'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';

/** Signed-in shoppers read this page inside My Saligue (its menu stays); old links keep working. */
export function ToMySaligue({ to }: { to: string }) {
  const { user, role, isAuthLoading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!isAuthLoading && user && role === 'buyer') router.replace(`${to}${window.location.search}`);
  }, [isAuthLoading, user, role, to, router]);
  return null;
}
