// The default text of each policy page. Admins can replace any of them (Admin → Rules & policies); the
// edited version is stored on the server and shown instead (components/legal-page.tsx).
import type { LegalSection } from '@/components/legal-page';

export type Policy = { title: string; updated: string; intro: string; sections: LegalSection[] };
export type PolicyKey = 'monetization' | 'ads' | 'verification' | 'terms' | 'privacy' | 'cookies';

export const DEFAULT_POLICIES: Record<PolicyKey, Policy> = {
  monetization: {
        title: "Monetization Policy",
        updated: "23 October 2026",
        intro: "Saligue shares its advertising income with the shops that make Saligue worth visiting. Like the creator programs of the biggest platforms, it is open only to established shops and comes with clear rules.",
        sections: [
          {
            heading: 'Who can join',
            paragraphs: [
              'A seller account with a profile photo and full shop address, active for at least 4 months (120 days).',
              'At least 10,000 clients (people who follow your shop).',
              'At least 5,000,000 views of your items in the last 90 days.',
              'No items removed for breaking Saligue’s rules in the last 90 days.',
              'When you meet every requirement, apply in Seller Center → Earnings. INDECIANA reviews each application and may refuse shops that seem to have bought clients or views.',
            ],
          },
          {
            heading: 'Tips (open to everyone)',
            paragraphs: [
              'Anyone with an account can receive tips: shops and Community teachers, with no minimum number of clients or views.',
              'Gifts in lives: viewers buy coins in packs (100 coins = $1, online or by Mobile Money) and send gifts while a shop is live. Each gift counts as a tip to the shop, with the same share and the same payouts. Coins can’t be turned back into money and don’t expire.',
              'Supporters choose $1, $2, $5, $10 or $20. You receive 90%; Saligue keeps 10% to run the service.',
              'Add your Mobile Money number in Me → My tips. Saligue sends what you are owed to it, and you see every tip and payout there.',
              'Asking for tips in exchange for fake reviews, follows or views is not allowed and leads to removal from Saligue.',
            ],
          },
          {
            heading: 'How much you earn',
            paragraphs: [
              'Each month, 50% of Saligue’s advertising income is shared among all monetized shops.',
              'Your share depends on points you earn that month: 1 point per item view, 50 points per item sold and delivered, and 5 points per new client. Your earnings = the creators’ pool × your points ÷ all creators’ points.',
              'Example: in March Saligue earns $10,000 from ads, so the creators’ pool is $5,000. Shop A has 400,000 views, 300 items sold and 2,000 new clients: 400,000 + 15,000 + 10,000 = 425,000 points. All monetized shops together have 1,700,000 points. Shop A receives $5,000 × 425,000 ÷ 1,700,000 = $1,250.',
              'Why two shops receive different amounts: each is paid for its own share of the month’s points. A shop that sells more, is viewed more or gains more clients earns more points, so a bigger part of the same pool. The pool itself changes each month with Saligue’s ad income.',
              'Only real activity counts: one view per shopper per item per day, and only orders that were delivered (not cancelled or returned).',
              'Seller Center → Earnings shows your points, everyone’s points and your estimate during the month. The final amount is calculated after the month ends.',
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
              'Buying or faking clients, views, likes or orders, using several accounts, or asking others to click your items in exchange for money or favours.',
              'Selling counterfeit or misleading items, or breaking the Terms of Service or the Ads Policy.',
              'Breaking these rules can lead to the loss of unpaid earnings, suspension from monetization, or closing of the account.',
            ],
          },
          {
            heading: 'Changes',
            paragraphs: ['Saligue may change the requirements, the share or the points, and will announce changes in the app at least 30 days before they apply to your earnings.'],
          },
        ]},
  verification: {
    title: 'Verification Policy',
    updated: '23 October 2026',
    intro: 'The blue check (✓) next to a name means Saligue checked who is behind the account: a person with an ID card or passport, or a business with its registration. Verification is optional — you can sell, go live, teach and earn without it. It exists for trust.',
    sections: [
      { heading: 'Who can ask', paragraphs: ['Anyone with a Saligue account: shoppers, shops and Community teachers.', 'A person sends an ID card (front and back) or a passport photo page, and a photo of themselves holding it. A business sends its registration certificate (e.g. RDB), the owner’s ID or passport and a photo of the owner holding it.'] },
      { heading: 'Price', paragraphs: ['The badge costs $2.53 per month, paid online or by Mobile Money with a reference. Your documents are checked once; each payment keeps the badge for 30 days.', 'Saligue reminds you 3 days before the month ends. If you don’t renew, the badge disappears at the end of the month; renew any time to get it back without sending documents again.', 'If Saligue cannot approve your first request, you can send new photos within 30 days without paying again. Months already paid are not refunded.'] },
      { heading: 'How we protect your documents', paragraphs: ['Your document photos are stored privately on Saligue’s own server, never on public links, and only Saligue admins with the right to check accounts can open them.', 'They are deleted as soon as the check is finished, approved or not. Saligue keeps only the result, the type of document, the country and the last 4 characters of the number.'] },
      { heading: 'What the badge means — and what it does not', paragraphs: ['It means the name and documents matched when they were checked. It does not mean Saligue recommends the shop or guarantees its items; reviews, the Terms of Service and the Ads Policy still apply.'] },
      { heading: 'Losing the badge', paragraphs: ['Saligue removes the badge if the documents turn out to be false, if the account is sold or given to someone else, or after serious breaks of the Terms of Service. Using false documents leads to closing of the account.'] },
    ],
  },
  ads: {
        title: "Ads Policy",
        updated: "22 October 2026",
        intro: "Saligue Ads let shops show their fashion items to more shoppers. Every ad is reviewed before it runs, so shoppers can trust what they see. These rules apply to every ad.",
        sections: [
          {
            heading: 'How ads work',
            paragraphs: [
              'You choose one of your items on sale, a budget (from the minimum shown in Seller Center) and a number of days. Your ad appears as “Sponsored” in For You and Explore.',
              'You pay once, up front. Each view of your ad uses a small part of the budget (the price per 1,000 views shown when you create the ad). The ad stops when the budget is used or the days are over. You can pause it at any time.',
              'A view is counted only when your ad stays on the shopper’s screen for at least one second (half of it in Explore, most of the screen in For You). Each ad shown carries a one-time code checked by Saligue’s server, so views can’t be repeated or made up. At most three views a day per shopper and six per network (phone or Wi-Fi) are counted, so many accounts on one device can’t use up your budget. Views by your own account are never counted.',
              'Money your ad does not use when its days are over goes back to your ad balance automatically, and pays for your next ad. Seller Center → Ads shows your balance and every line of it.',
              'Seller Center → Ads shows, day by day, the views, clicks, orders and sales from each ad, and what it cost: spent = views × the price per view. An order counts as coming from your ad when the buyer clicked it in the last 7 days, or saw it in the last day; cancelled orders are left out.',
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
              'INDECIANA reviews each ad after payment, usually within one working day. If an ad is refused before it runs, the full budget goes back to your ad balance at once. If an ad is stopped while running because it breaks this policy, the unused budget goes back to your ad balance. To have your balance paid back by Mobile Money instead, ask through Help & Support.',
              'Shops that repeatedly break this policy may lose the right to advertise and to be monetized.',
            ],
          },
        ]},
  terms: {
        title: "Terms of Service",
        updated: "7 October 2026",
        intro: "These terms apply when you use Saligue, the fashion marketplace by INDECIANA, on the web or in the app. By creating an account or using Saligue you accept them. If you do not agree, please do not use Saligue.",
        sections: [
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
        ]},
  privacy: {
        title: "Privacy Policy",
        updated: "16 October 2026",
        intro: "This policy explains what information Saligue by INDECIANA collects, why, and the choices you have. We collect only what Saligue needs to work, and we never sell your personal information.",
        sections: [
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
              'Your country: worked out on Saligue’s own server from your internet address (IP Geolocation by DB-IP, db-ip.com), never sent to anyone else. It decides which features are available where you are, and helps show you lives and shops close to you first. Your city comes only from addresses you gave us (a delivery address or your shop). It is not shown to anyone.',
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
        ]},
  cookies: {
        title: "Cookie Policy",
        updated: "20 October 2026",
        intro: "Saligue uses a small number of cookies and on-device storage to keep you signed in, remember your choices and, if you allow it, personalise your For You feed. We do not use advertising cookies, and we never sell or share this data with advertisers.",
        sections: [
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
        ]},
};
