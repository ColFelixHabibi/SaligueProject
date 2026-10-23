import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Verification Policy · Saligue' };

export default function VerificationPolicyPage() {
  return <LegalPage policy="verification" />;
}
