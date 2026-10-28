'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { RegisterDialog } from '@/components/auth/register-dialog';
import { onAccountChange } from '@/lib/auth-actions';

export default function RegisterPage() {
  const router = useRouter();
  // Signed in: the app already sends them to their dashboard, so closing must not go back.
  const signedIn = useRef(false);
  useEffect(() => onAccountChange((_, change) => {
    if (change === 'signed-in' || change === 'registered') signedIn.current = true;
  }), []);
  return <RegisterDialog open={true} onOpenChange={() => !signedIn.current && router.back()} />;
}
