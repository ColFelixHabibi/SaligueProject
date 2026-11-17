'use client';

import { TipsView } from '@/components/tips-view';
import { WalletCard } from '@/components/wallet-card';

/** My Saligue → Wallet: the balance, withdrawals, every line of it, and the tips behind it. All money in one place. */
export default function MyWallet() {
  return (
    <div className="grid gap-5">
      <WalletCard full />
      <TipsView />
    </div>
  );
}
