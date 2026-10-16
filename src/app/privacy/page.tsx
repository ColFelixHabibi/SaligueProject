import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Privacy Policy · Saligue' };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="16 October 2026"
      intro="This policy explains what information Saligue by INDECIANA collects, why, and the choices you have. We collect only what Saligue needs to work, and we never sell your personal information."
      sections={[
        {
          heading: 'What we collect',
          paragraphs: [
            'Account: your name, email address, password (stored only as a secure hash) and whether you buy or sell. If you continue with Google, we receive your name and email address from Google.',
            'Shops: shop name, phone and WhatsApp number, address and opening hours, which are shown publicly with your items.',
            'Shopping: your bag, saved items, likes, comments, orders and the delivery address and phone number you enter at checkout.',
            'Messages: what you write to shops or customers in Saligue Messages, so both sides can read the conversation. The other person also gets an email that a message is waiting.',
            'Reviews: the stars and text you post about items you received, shown publicly with your first name.',
            'Payments: when you pay online, Flutterwave handles your card or Mobile Money details on its own secure page. Saligue receives only whether the payment succeeded, the amount and a reference — never your card number or PIN.',
            'Profile photo: sellers add a profile photo, shown publicly with their shop.',
            'Support: the messages you send us.',
          ],
        },
        {
          heading: 'Your photo in the Fitting Room',
          paragraphs: [
            'The photo you add in the Fitting Room is processed by AI on your own device and kept only on that device. It is not uploaded to Saligue.',
            'To show you really wearing clothes (tops, jackets, trousers, dresses), the Fitting Room sends your photo and the garment picture to the realistic try-on AI when you search or put clothes on. Until Saligue runs its own AI server, this uses the open Leffa and IDM-VTON models hosted on Hugging Face, which receive the two pictures only to create that image. Shoes, hats, glasses and bags are placed on your device without sending anything. Remove your photo at any time with the bin button.',
          ],
        },
        {
          heading: 'How we use it',
          paragraphs: [
            'To run your account, show your items, pass your order and delivery details to the shop you buy from, and let shops update you on your order.',
            'To send you notifications and emails about your account, orders, payments and password resets.',
            'To recommend items you may like, based on what you like, save and wear in the Fitting Room.',
            'To keep Saligue safe and to solve problems you report.',
          ],
        },
        {
          heading: 'Who sees it',
          paragraphs: [
            'Shops see the name, phone number, delivery address and items of orders placed with them. Comments and likes counts are public.',
            'We use service providers to send email and, if you choose it, Google to sign you in. They may use your information only to provide that service.',
            'We share information with authorities only when the law requires it.',
          ],
        },
        {
          heading: 'On your device',
          paragraphs: [
            'Saligue stores a sign-in key, your Fitting Room photo, your outfit and your last delivery address in your browser or app storage. Clearing the app data removes them.',
          ],
        },
        {
          heading: 'How long we keep it',
          paragraphs: [
            'We keep your account information while your account exists, and order records for as long as needed for the shops and the law. Password reset links expire after one hour.',
          ],
        },
        {
          heading: 'Your rights',
          paragraphs: [
            'You can see and change your details in your account settings. You can ask us for a copy of your information, to correct it, or to delete your account through Help & Support.',
          ],
        },
        {
          heading: 'Changes',
          paragraphs: ['If we change this policy in an important way, we will tell you in the app or by email first.'],
        },
      ]}
    />
  );
}
