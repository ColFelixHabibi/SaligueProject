// The Saligue balance: what a person has earned, kept in their account in dollars.
//   - earnings become final and enter the balance (each exactly once, by its unique `ref`):
//       tip:<id> a paid tip · share:<id> a delivered, paid Share & earn sale · payout:<id> a closed month
//       (a monetized creator's share, or a teacher's part of Learning ads; months close on the 1st);
//   - the person asks to withdraw whenever they like, choosing the amount: at least the minimum ($50), at most their
//     balance. The amount is set aside at once (withdraw:<id>) and can be cancelled until payday;
//   - payday is the 15th of each month (Admin → Money → Payday can move it). Every withdrawal asked before it is paid
//     that day — nobody approves anything (runPayday). One that a payout rule stops (compliance.mjs: payouts open,
//     identity, monthly limit) or whose account is suspended waits for the next payday instead;
//   - with automatic sending on, the money goes out through the payment partner by itself; otherwise whoever sends
//     Mobile Money only records what was sent. A payment that fails (wrong number) comes back to the balance.
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
// A payment carries the payday it belongs to, and the partner's transfer id once sent automatically.
for (const [column, type] of [['run', 'text'], ['transfer_id', 'text']]) {
  if (!db.prepare('pragma table_info(withdrawals)').all().some((c) => c.name === column)) db.exec(`alter table withdrawals add column ${column} ${type}`);
}

const r2 = (n) => Math.round(n * 100) / 100;

export function walletRules() {
  const saved = parse(db.prepare("select value from app_config where key = 'wallet'").get()?.value) ?? {};
  return {
    minimum: Number(saved.minimum ?? 50),
    payday: Math.min(28, Math.max(1, Math.floor(Number(saved.payday ?? 15)))),
    // Money goes out through the payment partner by itself (payments.mjs → sendMobileMoney) when switched on.
    autoSend: saved.autoSend === true,
    currency: 'USD',
  };
}

export function saveWalletRules(body = {}) {
  const before = walletRules();
  const next = {
    minimum: body.minimum === undefined ? before.minimum : Math.max(1, Math.round(Number(body.minimum) * 100) / 100 || before.minimum),
    payday: body.payday === undefined ? before.payday : Math.min(28, Math.max(1, Math.floor(Number(body.payday) || before.payday))),
    autoSend: body.autoSend === undefined ? before.autoSend : body.autoSend === true,
  };
  db.prepare("insert into app_config (key, value) values ('wallet', ?) on conflict(key) do update set value = excluded.value").run(json(next));
  return walletRules();
}

const month = (d = new Date()) => d.toISOString().slice(0, 7);
const lastRun = () => db.prepare("select value from app_config where key = 'wallet_last_run'").get()?.value ?? null;

/** The next payday: this month's if it has not run yet, else next month's (YYYY-MM-DD). */
export function nextPayday(today = new Date()) {
  const { payday } = walletRules();
  const done = lastRun() === month(today);
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + (done ? 1 : 0), payday));
  return d.toISOString().slice(0, 10);
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

const KIND = { tip: 'Tip', share: 'Share & earn', creator: 'Monetization', teacher: 'Learning ads', withdrawal: 'Payment', refund: 'Payment returned' };
const withdrawalOut = (w) => ({ id: w.id, amount: w.amount, status: w.status, scheduled: w.status === 'requested' && !w.run, momoNumber: w.momo_number, momoName: w.momo_name, reference: w.reference, note: w.note, createdAt: w.created_at, decidedAt: w.decided_at });

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
    nextPayday: nextPayday(),
    canWithdraw: balance >= minimum && !open,
    open,
    entries: db.prepare('select amount, kind, note, created_at from wallet_entries where user_id = ? order by created_at desc limit 100').all(userId)
      .map((e) => ({ amount: e.amount, kind: e.kind, label: KIND[e.kind] ?? e.kind, note: e.note, at: e.created_at })),
    withdrawals,
  };
}

/** Why a withdrawal of this account would wait past payday, or null. `refused` is compliance.mjs's payoutRefused. */
export function heldBecause(userId, amount, refused) {
  const u = db.prepare('select suspended from users where id = ?').get(userId);
  if (!u) return { code: 'gone', message: 'This account no longer exists.' };
  if (u.suspended) return { code: 'suspended', message: 'Payments wait while the account is suspended.' };
  const why = refused(userId, amount);
  return why ? { code: why.code, message: why.message.replace(/ Nothing was paid\.?/, '') } : null;
}

const refuse = (status, code, message) => Object.assign(new Error(message), { status, code });

/**
 * Asks to withdraw `amount` (dollars) to a Mobile Money number, paid on the next payday. The amount leaves the
 * balance at once, so it cannot be spent twice. Throws an Error carrying { status, code }.
 */
export function requestWithdrawal(userId, amount, momo) {
  syncWallets();
  const balance = balanceOf(userId);
  const { minimum } = walletRules();
  const want = r2(Number(amount));
  if (db.prepare("select 1 from withdrawals where user_id = ? and status = 'requested'").get(userId)) throw refuse(400, 'open', 'You already asked for a withdrawal. It is paid on payday; cancel it first to change the amount.');
  if (!(want >= minimum)) throw refuse(400, 'minimum', `The minimum withdrawal is $${minimum.toFixed(2)}.`);
  if (want > balance + 0.001) throw refuse(400, 'balance', `Your balance is $${balance.toFixed(2)}.`);
  if (!momo?.number || String(momo.number).replace(/\D/g, '').length < 9 || !momo.name) throw refuse(400, 'no_momo', 'Add the Mobile Money number and the name on it.');
  const id = randomUUID();
  transaction(() => {
    db.prepare('insert into withdrawals (id, user_id, amount, momo_number, momo_name, created_at) values (?, ?, ?, ?, ?, ?)').run(id, userId, want, String(momo.number).slice(0, 30), String(momo.name).slice(0, 80), now());
    credit(userId, -want, 'withdrawal', `withdraw:${id}`, `To ${momo.number}`);
  });
  return withdrawalOut(db.prepare('select * from withdrawals where id = ?').get(id));
}

/** Cancels a withdrawal that payday has not taken yet: the amount comes back to the balance. */
export function cancelWithdrawal(userId, id) {
  const w = db.prepare("select * from withdrawals where id = ? and user_id = ? and status = 'requested' and run is null").get(id, userId);
  if (!w) throw refuse(400, 'too_late', 'This withdrawal is already being paid.');
  transaction(() => {
    db.prepare("update withdrawals set status = 'rejected', note = 'Cancelled by you', decided_at = ?, decided_by = ? where id = ?").run(now(), userId, id);
    credit(userId, w.amount, 'refund', `withdraw-back:${w.id}`, 'Withdrawal cancelled');
  });
}

/**
 * Payday: once a month, on or after the payday, every withdrawal asked for before it is paid — nobody approves.
 * Returns { ran, paid, held }. Safe to call every hour; it runs once per month.
 */
export function runPayday({ refused, today = new Date() }) {
  const { payday } = walletRules();
  const run = month(today);
  if (today.getUTCDate() < payday || lastRun() === run) return { ran: false, paid: [], held: [] };
  const paid = [], held = [];
  transaction(() => {
    for (const w of db.prepare("select * from withdrawals where status = 'requested' and run is null order by created_at").all()) {
      const why = heldBecause(w.user_id, w.amount, refused);
      if (why) {
        held.push({ id: w.id, userId: w.user_id, amount: w.amount, ...why });
        continue;
      }
      db.prepare('update withdrawals set run = ? where id = ?').run(run, w.id);
      paid.push({ id: w.id, userId: w.user_id, amount: w.amount, momoNumber: w.momo_number });
    }
    db.prepare("insert into app_config (key, value) values ('wallet_last_run', ?) on conflict(key) do update set value = excluded.value").run(run);
  });
  return { ran: true, paid, held };
}

/** This payday's payments not handed to the partner yet. */
export const waitingToSend = () => db.prepare("select * from withdrawals where status = 'requested' and run is not null and transfer_id is null order by created_at").all();
/** Payments handed to the partner, waiting for its answer. */
export const beingSent = () => db.prepare("select * from withdrawals where status = 'requested' and transfer_id is not null").all();
export const markSending = (id, transferId) => db.prepare('update withdrawals set transfer_id = ? where id = ?').run(String(transferId), id);
/** Withdrawals asked for and waiting for the next payday. */
export const queuedForPayday = () => db.prepare("select count(*) as n, coalesce(sum(amount), 0) as amount from withdrawals where status = 'requested' and run is null").get();

/** Withdrawals waiting to be sent, oldest first (Admin → Money). */
export const withdrawalsWaiting = () =>
  db.prepare("select w.*, u.display_name, u.email from withdrawals w join users u on u.id = w.user_id where w.status = 'requested' and w.run is not null order by w.created_at").all()
    .map((w) => ({ ...withdrawalOut(w), userId: w.user_id, name: w.display_name || w.email, email: w.email }));

/** The money arrived (`paid`, with its reference), or it could not be sent (`rejected`: it comes back to the balance). */
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
      credit(w.user_id, w.amount, 'refund', `withdraw-back:${w.id}`, note || 'Payment could not be sent');
    }
  });
  return { ...withdrawalOut(db.prepare('select * from withdrawals where id = ?').get(id)), userId: w.user_id };
}
