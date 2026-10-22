import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Monetization Policy · Saligue' };

export default function MonetizationPolicyPage() {
  return (
    <LegalPage
      title="Monetization Policy"
      updated="22 October 2026"
      intro="Saligue shares its advertising income with the shops that make Saligue worth visiting. Like the creator programs of the biggest platforms, it is open only to established shops and comes with clear rules."
      sections={[
        {
          heading: 'Who can join',
          paragraphs: [
            'A seller account with a profile photo and full shop address, at least 30 days old.',
            'At least 1,000 followers.',
            'At least 50,000 views of your items in the last 90 days.',
            'No items removed for breaking Saligue’s rules in the last 90 days.',
            'When you meet every requirement, apply in Seller Center → Earnings. INDECIANA reviews each application and may refuse shops that seem to have bought followers or views.',
          ],
        },
        {
          heading: 'How much you earn',
          paragraphs: [
            'Each month, 50% of Saligue’s advertising income is shared among all monetized shops.',
            'Your share depends on points you earn that month: 1 point per item view, 50 points per item sold and delivered, and 5 points per new follower. Your earnings = the creators’ pool × your points ÷ all creators’ points.',
            'Seller Center shows an estimate during the month. The final amount is calculated after the month ends.',
          ],
        },
        {
          heading: 'Payouts',
          paragraphs: [
            'Payouts are sent by Mobile Money to the number you give, in the first days of the following month. Make sure the number and name are correct; Saligue is not responsible for money sent to a number you entered wrongly.',
            'You are responsible for any taxes on your earnings.',
          ],
        },
        {
          heading: 'Not allowed',
          paragraphs: [
            'Buying or faking followers, views, likes or orders, using several accounts, or asking others to click your items in exchange for money or favours.',
            'Selling counterfeit or misleading items, or breaking the Terms of Service or the Ads Policy.',
            'Breaking these rules can lead to the loss of unpaid earnings, suspension from monetization, or closing of the account.',
          ],
        },
        {
          heading: 'Changes',
          paragraphs: ['Saligue may change the requirements, the share or the points, and will announce changes in the app at least 30 days before they apply to your earnings.'],
        },
      ]}
    />
  );
}
