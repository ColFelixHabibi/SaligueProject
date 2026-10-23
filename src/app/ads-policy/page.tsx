import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Ads Policy · Saligue' };

export default function AdsPolicyPage() {
  return (
    <LegalPage policy="ads" />
  );
}
