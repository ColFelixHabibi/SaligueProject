import type { Metadata } from 'next';
import { ComplianceCard } from '@/components/compliance-card';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Data Protection · Saligue' };

/**
 * The one page a regulator, a shop or a shopper can open to check Saligue's data protection: who is
 * responsible and whether it is registered, what is processed and for how long (generated from
 * server/compliance.mjs, not typed here), the assessment made before the AI try-on was built, and who
 * actually moves a user's money.
 */
export default function DataProtectionPage() {
  return (
    <>
      <ComplianceCard />
      <LegalPage policy="dataprotection" />
    </>
  );
}
