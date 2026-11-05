import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Notice and Takedown Policy · Saligue' };

export default function TakedownPolicyPage() {
  return (
    <LegalPage policy="takedown" />
  );
}
