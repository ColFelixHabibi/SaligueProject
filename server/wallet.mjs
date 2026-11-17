// The Saligue balance: what a person has earned, kept in their account in dollars, withdrawn whenever they want once
// it reaches the minimum (50 dollars unless an admin changes it).
//
// Money enters the balance once it is final, and only once (each entry has a unique `ref`):
//   tip:<id>      a tip that was paid (the receiver's share)
//   share:<id>    a Share & earn reward whose sale is delivered and paid
//   payout:<id>   a closed month: a monetized creator's share, or a teacher's share of Learning ads
// and leaves it when the person asks to withdraw (withdraw:<id>, negative). An admin then sends the money by Mobile
// Money and marks it sent, or refuses it and the amount comes back (withdraw-back:<id>). Payout rules
// (compliance.mjs: payouts open, identity, monthly limit) are checked when asking and again when sending; only money
// really sent counts towards the monthly limit, as a row in `payouts`.
import { randomUUID } from 'node:crypto';
import { db, json, now, parse, transaction } from './db.mjs';
import { earnedRewards } from './shares.mjs';

db.exec(`
  create table if not exists wallet_entries (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    amount real not null,               -- dollars: + earned, - withdrawn
    kind text not null,                 -- tip | share | creator | teacher | withdrawal | refund
    ref text not null unique,
    note text not null default '',
    created_at text not null
  );
  create index if not exists wallet_entries_user on wallet_entries(user_id, created_at desc);
  create table if not exists withdrawals (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    amount real not null,
    momo_number text not null,
    momo_name text not null,
    status text not null default 'requested' check (status in ('requested', 'paid', 'rejected')),
    reference text,
    note text,
    created_at text not null,
    decided_at text,
    decided_by text
  );
  create index if not exists withdrawals_status on withdrawals(status, created_at);
`);

const r2 = (n) => Math.round(n * 100) / 100;

export function walletRules() {
  const saved = parse(db.prepare("select value from app_config where key = 'wallet'").get()?.value) ?? {};
  return { minimum: Number(saved.minimum ?? 50), currency: 'USD' };
}

const credit = (userId, amount, kind, ref, note) =>
  db.prepare('insert or ignore into wallet_entries (id, user_id, amount, kind, ref, note, created_at) values (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), userId, r2(amount), kind, ref, String(note).slice(0, 200), now()).changes > 0;

/** Moves every earning that became final into its owner's balance. Safe to run any time, as often as wanted. */
export function syncWallets() {
  transaction(() => {
    for (const t of db.prepare("select id, to_user, share from tips where status = 'paid' and payout_id is null").all()) {
      credit(t.to_user, t.share, 'tip', `tip:${t.id}`, 'Tip');
      db.prepare("update tips set payout_id = 'wallet' where id = ?").run(t.id);
    }
    for (const r of earnedRewards()) {
      credit(r.sharer_id, r.amount, 'share', `share:${r.id}`, 'Share & earn: a sale from your link');
      db.prepare("update share_rewards set payout_id = 'wallet' where id = ?").run(r.id);
    }
    // Closed months (creators "YYYY-MM", teachers "YYYY-MM-learn"). paid_at stays empty: nothing was sent yet,
    // so the monthly payout limit is not used up by money that only moved into the balance.
    for (const p of db.prepare("select * from payouts where status = 'pending' and (period glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]' or period like '%-learn')").all()) {
      const teacher = p.period.endsWith('-learn');
      credit(p.user_id, p.amount, teacher ? 'teacher' : 'creator', `payout:${p.id}`, teacher ? `Learning ads, ${p.period.slice(0, 7)}` : `Monetization, ${p.period}`);
      db.prepare("update payouts set status = 'paid', reference = 'wallet' where id = ?").run(p.id);
    }
  });
}

export const balanceOf = (userId) => r2(db.prepare('select coalesce(sum(amount), 0) as n from wallet_entries where user_id = ?').get(userId).n);

const KIND = { tip: 'Tip', share: 'Share & earn', creator: 'Monetization', teacher: 'Learning ads', withdrawal: 'Withdrawal', refund: 'Withdrawal returned' };
const withdrawalOut = (w) => ({ id: w.id, amount: w.amount, status: w.status, momoNumber: w.momo_number, momoName: w.momo_name, reference: w.reference, note: w.note, createdAt: w.created_at, decidedAt: w.decided_at });

/** A person's balance, its lines and their withdrawals. */
export function walletOf(userId) {
  syncWallets();
  const balance = balanceOf(userId);
  const { minimum, currency } = walletRules();
  const earned = r2(db.prepare("select coalesce(sum(amount), 0) as n from wallet_entries where user_id = ? and amount > 0 and kind != 'refund'").get(userId).n);
  const withdrawals = db.prepare('select * from withdrawals where user_id = ? order by created_at desc limit 50').all(userId).map(withdrawalOut);
  const open = withdrawals.find((w) => w.status === 'requested') ?? null;
  return {
    balance, minimum, currency, earned,
    canWithdraw: balance >= minimum && !open,
    open,
    entries: db.prepare('select amount, kind, note, created_at from wallet_entries where user_id = ? order by created_at desc limit 100').all(userId)
      .map((e) => ({ amount: e.amount, kind: e.kind, label: KIND[e.kind] ?? e.kind, note: e.note, at: e.created_at })),
    withdrawals,
  };
}

/**
 * Asks for `amount` (the whole balance when not given) to be sent by Mobile Money. `refused` is compliance.mjs's
 * payoutRefused. Throws an Error carrying { status, code }.
 */
export function requestWithdrawal(userId, amount, momo, refused) {
  syncWallets();
  const refuse = (status, code, message) => Object.assign(new Error(message), { status, code });
  const balance = balanceOf(userId);
  const { minimum } = walletRules();
  const want = r2(amount == null || amount === '' ? balance : Number(amount));
  if (db.prepare("select 1 from withdrawals where user_id = ? and status = 'requested'").get(userId)) throw refuse(400, 'open', 'Your last withdrawal is still being sent. You can ask again once it arrives.');
  if (!(want >= minimum)) throw refuse(400, 'minimum', `The minimum withdrawal is $${minimum.toFixed(2)}.`);
  if (want > balance + 0.001) throw refuse(400, 'balance', `Your balance is $${balance.toFixed(2)}.`);
  if (!momo?.number || String(momo.number).replace(/\D/g, '').length < 9 || !momo.name) throw refuse(400, 'no_momo', 'Add the Mobile Money number and the name on it.');
  const why = refused(userId, want);
  if (why) throw refuse(400, why.code, why.message.replace(/ Nothing was paid\.?/, ''));
  const id = randomUUID();
  transaction(() => {
    db.prepare('insert into withdrawals (id, user_id, amount, momo_number, momo_name, created_at) values (?, ?, ?, ?, ?, ?)').run(id, userId, want, String(momo.number).slice(0, 30), String(momo.name).slice(0, 80), now());
    credit(userId, -want, 'withdrawal', `withdraw:${id}`, `To ${momo.number}`);
  });
  return withdrawalOut(db.prepare('select * from withdrawals where id = ?').get(id));
}

/** Withdrawals waiting to be sent, oldest first (Admin → Money). */
export const withdrawalsWaiting = () =>
  db.prepare("select w.*, u.display_name, u.email from withdrawals w join users u on u.id = w.user_id where w.status = 'requested' order by w.created_at").all()
    .map((w) => ({ ...withdrawalOut(w), userId: w.user_id, name: w.display_name || w.email, email: w.email }));

/** An admin sent the money (`paid`, with the Mobile Money reference) or refused it (the amount goes back). */
export function decideWithdrawal(id, decision, { reference = null, note = null, by }) {
  const w = db.prepare("select * from withdrawals where id = ? and status = 'requested'").get(id);
  if (!w) return null;
  transaction(() => {
    db.prepare('update withdrawals set status = ?, reference = ?, note = ?, decided_at = ?, decided_by = ? where id = ?').run(decision, reference, note, now(), by, id);
    if (decision === 'paid') {
      // The money really left: it counts towards this month's payout limit like any payout.
      db.prepare("insert into payouts (id, user_id, period, amount, breakdown, status, reference, paid_at, created_at) values (?, ?, ?, ?, ?, 'paid', ?, ?, ?)")
        .run(randomUUID(), w.user_id, `withdrawal-${w.id}`, w.amount, json({ kind: 'withdrawal' }), reference, now(), now());
    } else {
      credit(w.user_id, w.amount, 'refund', `withdraw-back:${w.id}`, note || 'Withdrawal not sent');
    }
  });
  return { ...withdrawalOut(db.prepare('select * from withdrawals where id = ?').get(id)), userId: w.user_id };
}
