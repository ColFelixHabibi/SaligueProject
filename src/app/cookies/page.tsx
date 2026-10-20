import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Cookie Policy · Saligue' };

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      updated="20 October 2026"
      intro="Saligue uses a small number of cookies and on-device storage to keep you signed in, remember your choices and, if you allow it, personalise your For You feed. We do not use advertising cookies, and we never sell or share this data with advertisers."
      sections={[
        {
          heading: 'Essential cookie',
          paragraphs: [
            'saligue_session: keeps you signed in (also as a guest, so your bag, saves and orders stay with you). It is HttpOnly, so scripts on the page cannot read it, sent only over a secure connection on the live site, and expires after 60 days or when you log out.',
            'This cookie is needed for Saligue to work, so it does not need your consent. Blocking it in your browser signs you out each time you close the app.',
          ],
        },
        {
          heading: 'Personalisation (For You)',
          paragraphs: [
            'saligue_consent: remembers your choice in the cookie banner ("all" or "essential"), for one year.',
            'With "OK, personalise", Saligue records which items you open, how long you watch them in the feed, what you try on, add to your bag, message shops about or skip quickly, linked to your account. Together with likes, saves and orders, and with what shoppers with similar taste enjoy, this decides the order of your For You feed. It is kept for up to 6 months.',
            'With "Essential only" nothing of this is recorded. You can switch it off or clear what was learned any time in Settings → For You.',
          ],
        },
        {
          heading: 'Storage on your device',
          paragraphs: [
            'Saligue also keeps a few things in your browser’s local storage: your session key, your last delivery address (to fill checkout faster), your Fitting Room photo and outfit, and your cookie choice. They never leave your device unless you use them (for example, placing an order sends the delivery address to the shop).',
            'The AI models used for search and try-on are saved in your browser’s cache after the first download, so they load faster next time.',
          ],
        },
        {
          heading: 'Other services',
          paragraphs: [
            'When you pay online, you are sent to Flutterwave’s secure payment page, which sets its own cookies under its own policy. When you sign in with Google, Google sets its own cookies.',
            'Fonts are loaded from Google Fonts, which receives your IP address to deliver them.',
          ],
        },
        {
          heading: 'Your choices',
          paragraphs: [
            'You can delete cookies and site data at any time in your browser settings; this signs you out and clears the items saved on this device.',
            'You can change your choice in the cookie banner by clearing this site’s data, which shows the banner again.',
          ],
        },
      ]}
    />
  );
}
