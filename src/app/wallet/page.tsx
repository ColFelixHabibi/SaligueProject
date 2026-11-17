'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import { WalletCard } from '@/components/wallet-card';

/** The Saligue balance on its own page: what was earned, withdrawals and every line. */
export default function WalletPage() {
  const { user } = useAuth();
  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-6">
      {user ? (
        <WalletCard full />
      ) : (
        <div className="space-y-3 py-16 text-center">
          <p className="text-muted-foreground">Log in to see your balance.</p>
          <Button asChild><Link href="/login">Log in</Link></Button>
        </div>
      )}
    </div>
  );
}
