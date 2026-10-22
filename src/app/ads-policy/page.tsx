import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Ads Policy · Saligue' };

export default function AdsPolicyPage() {
  return (
    <LegalPage
      title="Ads Policy"
      updated="22 October 2026"
      intro="Saligue Ads let shops show their fashion items to more shoppers. Every ad is reviewed before it runs, so shoppers can trust what they see. These rules apply to every ad."
      sections={[
        {
          heading: 'How ads work',
          paragraphs: [
            'You choose one of your items on sale, a budget (from the minimum shown in Seller Center) and a number of days. Your ad appears as “Sponsored” in For You and Explore.',
            'You pay once, up front. Each view of your ad uses a small part of the budget (the price per 1,000 views shown when you create the ad). The ad stops when the budget is used or the days are over. You can pause it at any time.',
            'A view is counted only when your ad is actually on the shopper’s screen, at most three times a day per shopper. Views by your own account are not counted.',
          ],
        },
        {
          heading: 'What may be advertised',
          paragraphs: [
            'Only fashion items that you have in stock and that follow the Terms of Service: clothes, shoes, bags and accessories.',
            'The photo, name, price and description must be honest and must match what the buyer receives.',
          ],
        },
        {
          heading: 'Not allowed',
          paragraphs: [
            'Counterfeit or fake branded items, and items you have no right to sell.',
            'Misleading prices or claims, “bait” prices, and photos of a different item.',
            'Nudity or sexual content, hate, violence, discrimination, or content aimed at children in an inappropriate way.',
            'Anything that is not fashion, and anything illegal in Rwanda.',
          ],
        },
        {
          heading: 'Review, refusal and refunds',
          paragraphs: [
            'INDECIANA reviews each ad after payment, usually within one working day. If an ad is refused before it runs, the full budget is refunded. If an ad is stopped while running because it breaks this policy, the unused budget is refunded, unless the ad was clearly fraudulent.',
            'Shops that repeatedly break this policy may lose the right to advertise and to be monetized.',
          ],
        },
      ]}
    />
  );
}
