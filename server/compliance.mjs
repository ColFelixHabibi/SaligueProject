// Data protection and the movement of users' money.
//
// Two questions that are normally answered in a document nobody reads are answered here, in code:
//
// 1. WHO IS RESPONSIBLE FOR THE DATA, AND WHAT WAS WEIGHED BEFORE BUILDING IT.
//    Rwanda's Law No. 058/2021 asks a data controller to register, to keep a record of what it processes
//    (a "record of processing activities"), and to assess processing that is likely to be high risk before
//    doing it (a DPIA). The record and the assessment below are written against what this code actually does
//    — tables in db.mjs, the try-on modules in src/lib/ai, the retention timers — so the documents cannot
//    drift from the program. The registration number itself is issued by the authority; it is recorded in
//    Admin → Rules & policies → Data protection when it arrives, and only then is it published.
//
// 2. WHO ACTUALLY MOVES A USER'S MONEY.
//    Saligue holding a buyer's money until delivery is fine (it is the shop's money, paid once). Saligue
//    paying users from its own account — tips, share & earn, creator earnings — is money transmission: in
//    Rwanda that needs a licence from the central bank (or a licensed partner doing the paying). That is a
//    business decision, so it is a setting with three honest positions:
//      'partner' (default) a licensed mobile-money / payment partner sends the money. Nothing is paid until
//                the partner is recorded, because an unconfigured deployment is an unlicensed one.
//      'self'    Saligue's own account pays. Allowed only with the licence (or written authorisation)
//                reference recorded, so the claim is checkable.
//      'off'     nothing is paid out. Earnings keep counting and keep belonging to the person.
//    Every payout route asks payoutRefused() first, so this cannot be bypassed from an admin screen.
import { db, now, parse } from './db.mjs';

const r2 = (v) => Math.round(Number(v) * 100) / 100;
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const MODES = ['partner', 'self', 'off'];

// ---------------------------------------------------------------------------
// Payouts: who pays, and what stops a payout
// ---------------------------------------------------------------------------

export function payoutRules() {
  const saved = parse(db.prepare("select value from app_config where key = 'payouts'").get()?.value) ?? {};
  return {
    mode: MODES.includes(saved.mode) ? saved.mode : 'partner',
    partner: text(saved.partner, 80),
    licence: text(saved.licence, 80),
    monthlyCap: Math.max(0, Math.round(Number(saved.monthlyCap ?? 0) * 100) / 100),
    requireIdentity: saved.requireIdentity === true,
  };
}

export function savePayoutRules(body = {}) {
  const before = payoutRules();
  const next = {
    mode: MODES.includes(body.mode) ? body.mode : before.mode,
    partner: body.partner === undefined ? before.partner : text(body.partner, 80),
    licence: body.licence === undefined ? before.licence : text(body.licence, 80),
    monthlyCap: body.monthlyCap === undefined ? before.monthlyCap : Math.max(0, Math.min(100_000, r2(Number(body.monthlyCap) || 0))),
    requireIdentity: body.requireIdentity === undefined ? before.requireIdentity : body.requireIdentity === true,
  };
  db.prepare("insert into app_config (key, value) values ('payouts', ?) on conflict(key) do update set value = excluded.value").run(JSON.stringify(next));
  return next;
}

/** What the app and the policy page may say out loud. Never the licence number, never the partner's keys. */
export function payoutState() {
  const r = payoutRules();
  const open = r.mode === 'partner' ? !!r.partner : r.mode === 'self' ? !!r.licence : false;
  const message = open
    ? null
    : r.mode === 'off'
      ? 'Payouts are paused for now. What you earned stays yours and is paid when they open again.'
      : 'Payouts are waiting while Saligue finishes its payment setup. What you earned stays yours and is paid as soon as it is done.';
  return {
    open,
    mode: r.mode,
    payer: r.mode === 'partner' ? r.partner || null : r.mode === 'self' ? 'Saligue' : null,
    message,
    monthlyCap: r.monthlyCap,
  };
}

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

/** Everything already paid to this person since the 1st of this month. */
export function paidThisMonth(userId) {
  return r2(db.prepare('select coalesce(sum(amount), 0) as n from payouts where user_id = ? and paid_at >= ?').get(userId, monthStart()).n ?? 0);
}

/**
 * Why this payout may not go out now. `null` means it may.
 * `code` is for admins, `message` is written to be shown to whoever is affected.
 */
export function payoutRefused(userId, amount) {
  const r = payoutRules();
  if (r.mode === 'off') {
    return { code: 'payouts_closed', message: 'Payouts are paused, so nothing was sent. Earnings are kept and paid when payouts open again.' };
  }
  if (r.mode === 'partner' && !r.partner) {
    return { code: 'partner_missing', message: 'No licensed payment partner is recorded yet (Admin → Rules & policies → Payouts), so Saligue cannot send money. Nothing was paid.' };
  }
  if (r.mode === 'self' && !r.licence) {
    return { code: 'licence_missing', message: 'Paying from Saligue’s own account needs the licence or written authorisation reference recorded first (Admin → Rules & policies → Payouts). Nothing was paid.' };
  }
  if (r.requireIdentity) {
    const u = db.prepare('select identity_checked from users where id = ?').get(userId);
    if (!u) return { code: 'not_found', message: 'This account no longer exists.' };
    if (!u.identity_checked) {
      return { code: 'identity_required', message: 'This person’s identity has not been checked yet. Ask them to finish Get verified before they are paid (Verification Policy). Nothing was paid.' };
    }
  }
  const cap = r.monthlyCap;
  if (cap > 0) {
    const already = paidThisMonth(userId);
    if (already + amount > cap + 0.001) {
      return { code: 'monthly_cap', message: `This person has already been paid $${already.toFixed(2)} this month and the monthly payout limit is $${cap.toFixed(2)}. Nothing was paid; the rest waits until next month or until a main admin raises the limit.` };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Data protection: controller, record of processing, and the DPIA
// ---------------------------------------------------------------------------

export function controller() {
  const saved = parse(db.prepare("select value from app_config where key = 'controller'").get()?.value) ?? {};
  const registrationNumber = text(saved.registrationNumber, 60) || null;
  return {
    name: text(saved.name, 120) || 'INDECIANA Ltd (Saligue)',
    country: text(saved.country, 60) || 'Rwanda',
    address: text(saved.address, 200) || 'Kigali, Rwanda',
    registrationNumber,
    registeredAt: text(saved.registeredAt, 20) || null,
    dpoName: text(saved.dpoName, 120),
    dpoEmail: text(saved.dpoEmail, 160),
    dpoPhone: text(saved.phone, 40),
    lastReview: text(saved.lastReview, 20) || null,
    // Registration is a legal step taken with the authority, not something this code can do. The public page
    // mentions it only once a number is recorded here.
    registered: !!registrationNumber,
  };
}

export function saveController(body = {}) {
  const before = controller();
  const email = text(body.dpoEmail, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'invalid_email' };
  const date = (v) => (text(v, 20) && /^\d{4}-\d{2}-\d{2}$/.test(text(v, 20)) ? text(v, 20) : '');
  const next = {
    name: body.name === undefined ? before.name : text(body.name, 120),
    country: body.country === undefined ? before.country : text(body.country, 60),
    address: body.address === undefined ? before.address : text(body.address, 200),
    registrationNumber: body.registrationNumber === undefined ? before.registrationNumber ?? '' : text(body.registrationNumber, 60),
    registeredAt: body.registeredAt === undefined ? before.registeredAt ?? '' : date(body.registeredAt),
    dpoName: body.dpoName === undefined ? before.dpoName : text(body.dpoName, 120),
    dpoEmail: body.dpoEmail === undefined ? before.dpoEmail : email,
    phone: body.phone === undefined ? before.dpoPhone : text(body.phone, 40),
    lastReview: body.lastReview === undefined ? before.lastReview ?? '' : date(body.lastReview),
  };
  if (!next.name) return { error: 'invalid_name' };
  db.prepare("insert into app_config (key, value) values ('controller', ?) on conflict(key) do update set value = excluded.value").run(JSON.stringify(next));
  return { controller: controller() };
}

/**
 * The record of processing activities. Each row is what the code really does: the `where` column names the
 * tables and modules, so a reviewer can check the claim instead of trusting it.
 */
export function processingRecord() {
  return [
    {
      what: 'Account and sign-in',
      why: 'To create the account, sign the person in and let them recover it',
      data: 'Name, email, password (stored only as a hash), photo, chosen language, Terms version accepted',
      basis: 'Contract',
      kept: 'Until the account is deleted (Data download and Delete account in Settings work today)',
      who: 'Nobody outside Saligue; email goes through the mail account an admin connected',
      where: 'users, sessions (db.mjs)',
    },
    {
      what: 'Shops and items',
      why: 'To show what is for sale and let buyers find it',
      data: 'Shop name, shop phone, item photos, prices, sizes, colours, description',
      basis: 'Contract',
      kept: 'Until the item or the shop is deleted',
      who: 'Public — an item page is visible to anyone with the link',
      where: 'products, users.shop',
    },
    {
      what: 'Orders and delivery',
      why: 'To take the order, deliver it and prove who received it',
      data: 'Name, phone, delivery address, the items, the handover code, order status',
      basis: 'Contract',
      kept: 'With the order until the account is deleted',
      who: 'The shop (its own order only) and the payment provider for online payment',
      where: 'orders, order events',
    },
    {
      what: 'Money',
      why: 'To pay tips, share & earn rewards, creator earnings and shop sales',
      data: 'Amounts, Mobile Money number and the name on it, payout reference',
      basis: 'Contract, and keeping records of payments',
      kept: 'With the account, because a payment can be disputed long after it is made',
      who: 'The licensed payment partner and the mobile-money operator; never other users',
      where: 'tips, share_rewards, payouts, tip_accounts, creators',
    },
    {
      what: 'Trying clothes on a shopper’s own photo',
      why: 'To show how an item would look on the shopper before they buy',
      data: 'The photo the shopper chooses, 33 body points and a clothing map worked out on the phone, the item’s cut-out, the look produced',
      basis: 'Explicit consent, asked once per device, and required by the server on every request',
      kept: 'The photo never leaves the phone for the on-device look. A look made by the realistic engine is cached on Saligue’s server for 24 hours, then deleted',
      who: 'The AI engine only when the realistic engine is used; no look is ever published, sold or used to train anything',
      where: 'src/lib/ai/{consent,pose,parse,dress,composite,studio}.ts, server/tryon.mjs',
    },
    {
      what: 'What the feed learns',
      why: 'To order For You so it shows clothes the shopper is likely to want',
      data: 'Views, dwell time, wears, skips, "show me less", searches, shares',
      basis: 'Legitimate interest, with an off switch and a delete button that work today',
      kept: 'While the account exists; old signals fade (half-life 21 days)',
      who: 'Nobody outside Saligue; it is a score on this server, not a profile sold to anyone',
      where: 'interactions, server/recommend.mjs, src/lib/taste.ts',
    },
    {
      what: 'Messages and support',
      why: 'To let a buyer and a shop agree on a delivery, and to answer support requests',
      data: 'The text and any photo sent, who sent it, when',
      basis: 'Contract',
      kept: 'With the conversation until the account is deleted',
      who: 'The two people in the conversation; support when the person asks for help',
      where: 'messages, support tickets',
    },
    {
      what: 'Security',
      why: 'To stop attacks, fake orders, stolen accounts and payout fraud',
      data: 'IP address, what was requested, blocked addresses, admin actions',
      basis: 'Legitimate interest (security) and legal obligations',
      kept: 'Security events for 90 days, then deleted; a blocked address while it stays blocked',
      who: 'Saligue’s admins; the main admins are notified of admin changes',
      where: 'security_events, blocked_ips, admin_log, server/security.mjs',
    },
    {
      what: 'Moderation and notices',
      why: 'To hide items that break the rules and to answer rights-holders',
      data: 'Reports, the decision taken, the notice and the claimant’s contact',
      basis: 'Legitimate interest, and legal obligations for illegal content',
      kept: 'With the account, so a decision can be explained later',
      who: 'Admins; the person reported is told an item was hidden, not who reported it',
      where: 'reports, takedowns, admin_log',
    },
  ];
}

/**
 * The DPIA for the try-on, which is the one genuinely high-risk thing Saligue does. Written as a list of
 * risks with the measure that answers each one and the module that implements it, so a reviewer can open
 * the file and check that the measure exists.
 */
export function dpia() {
  return {
    title: 'Wearing an item on your own photo (AI try-on)',
    version: 2,
    reviewedAt: controller().lastReview,
    owner: controller().dpoName || 'INDECIANA',
    scope: 'Every look made from a shopper’s photo: the on-device look in the Fitting Room, and the realistic look from an AI engine (Saligue AI Studio, fal.ai FASHN, or the free Leffa demo).',
    necessity:
      'The purpose is one thing: the shopper sees how an item would look on their own body before paying, which is the question that stops most online clothes sales. Size charts answer it badly and shop photos answer it for someone else’s body. Nothing else is done with the photo: it is not published, not shown to the shop, not used to train a model, and not used for advertising. The default path never sends it off the phone at all.',
    risks: [
      {
        risk: 'Somebody tries clothes on another person’s body, or on a child',
        level: 'High',
        measures: [
          'Consent is asked once per device and can be refused; the server refuses any look without it (src/lib/ai/consent.ts, server/index.mjs POST /api/ai/tryon)',
          'The default look is made on the phone, so a shopper who wants nothing sent anywhere can still use it (src/lib/ai/dress.ts)',
          'A new account cannot be made without a real date of birth, with email or with Google: the server refuses a missing or impossible date (birth_date_required, invalid_birth_date) and refuses anyone under 16 (too_young, MIN_AGE in server/index.mjs). It is asked once, when the account is created, and never again on sign-in. The date is kept on the account with the day it was checked (users.birth_date, users.age_checked_at), and is never shown on a profile, a listing or a live',
          'The one box "I am at least 16 and I accept the Terms" must also be ticked before Create Account will submit, and the version accepted is recorded on the account (register-dialog.tsx, POST /api/auth/register, users.terms_version). Signing in with Google shows the same Terms statement and records the version',
          'A photo of someone else can be reported and taken down through the notice route (POST /api/takedowns)',
        ],
        residual: 'Medium — the age is declared, not proven, and a determined adult can upload any photo they hold.',
      },
      {
        risk: 'The photo reaches a third-party AI engine without the shopper realising',
        level: 'High',
        measures: [
          'The realistic engine is used only after consent, and only for the categories where it helps; shoes, hats, glasses and bags are drawn on the phone (REALISTIC_CATEGORIES, src/lib/ai/studio.ts)',
          'Saligue can run its own engine (ai-server/), so a deployment that wants nothing to leave its own servers can switch the third party off entirely',
          'Which engine produced a look is recorded in the cache key, so a look made by a free public demo is never passed off as a private one (server/tryon.mjs)',
          'An admin can close try-on for a whole country when the law there asks (feature switch + country rules)',
        ],
        residual: 'Low.',
      },
      {
        risk: 'The engine draws something that is not the item — a look that sells clothes by deception',
        level: 'Medium',
        measures: [
          'The picture is re-examined before it is shown: if the garment is not really drawn, or other clothes changed by more than 4% of the body, the look is refused and retried once (src/lib/ai/composite.ts keepOnlyChanged)',
          'Face, hair, hat, glasses, shoes and bag always come from the shopper’s own photo, so the person in the picture stays the person',
          'Free public engines always pass through that check, because their output is never final',
        ],
        residual: 'Low.',
      },
      {
        risk: 'Body photos stay on the server longer than needed',
        level: 'Medium',
        measures: [
          'The photo itself stays in the browser; the server keeps only the look it produced, for 24 hours, with an hourly sweep and a 3,000-file cap (server/tryon.mjs)',
          'Data download and Delete account work today and are covered by tests (GET /api/me/data, DELETE /api/me)',
        ],
        residual: 'Low.',
      },
      {
        risk: 'A photo is uploaded to humiliate or harass the person in it',
        level: 'Medium',
        measures: [
          'An uploaded photo is only used in that person’s own session; it is never posted, never shown to a shop and never attached to a listing',
          'Reports hide an item at three weighted reports from two different people; notices hide it at once (reportsOn, POST /api/takedowns)',
          'A shop or account doing it can be suspended, which signs it out everywhere',
        ],
        residual: 'Medium — the harm is fast, and hiding an item after the fact cannot undo it.',
      },
      {
        risk: 'The model re-identifies the shopper from the data it keeps',
        level: 'Low',
        measures: [
          'Body points and the clothing map are computed on the phone and are never sent to the server (src/lib/ai/pose.ts, parse.ts)',
          'A look is stored under a hash of its inputs, not under a name, and deleted after 24 hours',
        ],
        residual: 'Low.',
      },
    ],
    measures: [
      'Try-on is a feature switch with per-country rules, so a regulator’s request is one toggle, not a release',
      'Consent, retention and the safety check are enforced, not just described — each has a test or a code path named above',
      'The record of processing activities above is published with this assessment, so a person can see exactly what is kept and for how long',
      'Reviews: this assessment is reviewed when the engine changes, when a new engine is added, or once a year — whichever comes first',
    ],
    review: 'Next review due one year after the review date, or immediately if the AI engine, the categories it is used for, or the retention changes.',
  };
}
