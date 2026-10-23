import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Terms of Service · Saligue' };

export default function TermsPage() {
  return (
    <LegalPage policy="terms" />
  );
}
