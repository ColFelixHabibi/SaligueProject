import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Cookie Policy · Saligue' };

export default function CookiesPage() {
  return (
    <LegalPage policy="cookies" />
  );
}
