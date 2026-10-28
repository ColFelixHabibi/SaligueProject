'use client';

import { TipsView } from '@/components/tips-view';
import { ToMySaligue } from '@/components/to-my-saligue';

/** Tips I received from supporters, and the Mobile Money number they're paid to. */
export default function TipsPage() {
  return (
    <>
      <ToMySaligue to="/my-account/tips" />
      <TipsView />
    </>
  );
}
