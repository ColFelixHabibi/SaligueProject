'use client';

import { GoTo } from '@/components/go-to';

/** Moved: tips and the balance are one page now, My Saligue → Wallet. */
export default function Moved() {
  return <GoTo to="/my-account/wallet" />;
}
