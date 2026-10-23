import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Monetization Policy · Saligue' };

export default function MonetizationPolicyPage() {
  return (
    <LegalPage policy="monetization" />
  );
}
