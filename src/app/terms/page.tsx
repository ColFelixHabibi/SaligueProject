import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Terms of Service · Saligue' };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="7 October 2026"
      intro="These terms apply when you use Saligue, the fashion marketplace by INDECIANA, on the web or in the app. By creating an account or using Saligue you accept them. If you do not agree, please do not use Saligue."
      sections={[
        {
          heading: 'Who we are and what Saligue does',
          paragraphs: [
            'Saligue connects buyers with independent shops and with INDECIANA, our own fashion house. Shops list their items; buyers can see themselves wearing them in the Fitting Room, order them and contact the shop.',
            'Except for items sold by INDECIANA, the shop that lists an item is the seller. Saligue is not a party to the sale between a buyer and an independent shop.',
          ],
        },
        {
          heading: 'Your account',
          paragraphs: [
            'You must be at least 16 years old to create an account. Give true information and keep your password secret; you are responsible for what happens with your account.',
            'You can browse, like and add to your bag as a guest. Selling items requires a registered account.',
            'We may suspend or close accounts that break these terms, defraud others or harm Saligue or its users.',
          ],
        },
        {
          heading: 'Buying',
          paragraphs: [
            'Prices are set by each shop and shown in US dollars unless stated otherwise. When you check out, one order is created for each shop in your bag.',
            'Payment is made directly to the shop: by Mobile Money (MTN MoMo / Airtel Money) to the number of the shop, in cash on delivery, or at the shop when you pick the item up. Saligue does not hold or process your money.',
            'Delivery times, returns and refunds are agreed with the shop. If a shop does not deliver what you paid for, contact the shop first, then tell us through Help & Support and we will help resolve it.',
          ],
        },
        {
          heading: 'Selling',
          paragraphs: [
            'Shops must give a real name, phone number and full address, describe items honestly (size, colour, condition), use their own photos and keep their listings up to date.',
            'Shops must confirm or cancel orders promptly, deliver what was ordered and mark payments as received only when they have the money.',
            'Not allowed: counterfeit or stolen goods, items that are illegal to sell, misleading photos or prices, and asking buyers to pay outside the payment methods shown at checkout.',
          ],
        },
        {
          heading: 'The Fitting Room and AI features',
          paragraphs: [
            'The Fitting Room shows how items could look on you. It is a preview made by artificial intelligence, not a guarantee of fit, size or colour. Always check the size details of an item.',
            'Suggestions such as "Complete the look" are made automatically from the items in stock and may include items from INDECIANA.',
          ],
        },
        {
          heading: 'Your content',
          paragraphs: [
            'You keep the rights to the photos, comments and sounds you post. You allow Saligue to show them in the app and website so that Saligue can work.',
            'Do not post content that is unlawful, hateful, harassing, sexual, or that belongs to someone else. We may remove such content.',
          ],
        },
        {
          heading: 'Responsibility',
          paragraphs: [
            'We work to keep Saligue available and safe but cannot promise it will always be free of errors or interruptions.',
            'As far as the law allows, Saligue is not responsible for the products, delivery or behaviour of independent shops, or for indirect losses. Nothing in these terms limits rights you have under consumer protection law.',
          ],
        },
        {
          heading: 'Changes and contact',
          paragraphs: [
            'We may update these terms. If the changes are important we will tell you in the app or by email before they apply. Using Saligue after that means you accept the new terms.',
            'These terms are governed by the laws of the Republic of Rwanda.',
          ],
        },
      ]}
    />
  );
}
