// The Saligue balance: what a person has earned, kept in their account in dollars and paid out the way YouTube pays
// its creators — on a set day, to everyone who is due, with nobody asking and nobody approving:
//   - earnings become final and enter the balance (each exactly once, by its unique `ref`):
//       tip:<id> a paid tip · share:<id> a delivered, paid Share & earn sale · payout:<id> a closed month
//       (a monetized creator's share, or a teacher's part of Learning ads; months close on the 1st);
//   - on payday (the 21st unless an admin changes it) every account whose balance has reached the minimum ($50) is
//     paid all of it to the Mobile Money number on its account (runPayday). Below the minimum, it carries over;
//   - a payment is held, never lost, while something is missing: no Mobile Money number, a suspended account, or a
//     payout rule (compliance.mjs: payouts open, identity checked, monthly limit). It goes out on the next payday;
//   - with automatic sending on, the money goes out through the payment partner by itself; otherwise the list waits
//     for whoever sends Mobile Money, who only records what was sent. A payment that fails (wrong number) comes back
//     to the balance and is tried again next payday.
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
    payday: Math.min(28, Math.max(1, Math.floor(Number(saved.payday ?? 21)))),
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
    nextPayday: nextPayday(),
    open,
    entries: db.prepare('select amount, kind, note, created_at from wallet_entries where user_id = ? order by created_at desc limit 100').all(userId)
      .map((e) => ({ amount: e.amount, kind: e.kind, label: KIND[e.kind] ?? e.kind, note: e.note, at: e.created_at })),
    withdrawals,
  };
}

/**
 * Why this account would not be paid on payday, or null. `refused` is compliance.mjs's payoutRefused; `momoOf` finds
 * the Mobile Money number on the account.
 */
export function heldBecause(userId, amount, { refused, momoOf }) {
  const u = db.prepare('select suspended from users where id = ?').get(userId);
  if (!u) return { code: 'gone', message: 'This account no longer exists.' };
  if (u.suspended) return { code: 'suspended', message: 'Payments are held while the account is suspended.' };
  if (!momoOf(userId)) return { code: 'no_momo', message: 'Add your Mobile Money number to be paid.' };
  const why = refused(userId, amount);
  return why ? { code: why.code, message: why.message.replace(/ Nothing was paid\.?/, '') } : null;
}

/**
 * Payday: once a month, on or after the payday, every balance that reached the minimum is paid in full. Returns
 * { ran, paid: [...], held: [...] }. Safe to call every hour; it runs once per month.
 */
export function runPayday({ refused, momoOf, today = new Date() }) {
  const { payday, minimum } = walletRules();
  const run = month(today);
  if (today.getUTCDate() < payday || lastRun() === run) return { ran: false, paid: [], held: [] };
  syncWallets();
  const paid = [], held = [];
  const due = db.prepare('select user_id, sum(amount) as balance from wallet_entries group by user_id having sum(amount) >= ?').all(minimum - 0.001);
  transaction(() => {
    for (const { user_id: userId, balance: raw } of due) {
      const amount = r2(raw);
      if (db.prepare("select 1 from withdrawals where user_id = ? and status = 'requested'").get(userId)) continue;
      const why = heldBecause(userId, amount, { refused, momoOf });
      if (why) {
        held.push({ userId, amount, ...why });
        continue;
      }
      const momo = momoOf(userId);
      const id = randomUUID();
      db.prepare('insert into withdrawals (id, user_id, amount, momo_number, momo_name, run, created_at) values (?, ?, ?, ?, ?, ?, ?)').run(id, userId, amount, String(momo.number).slice(0, 30), String(momo.name).slice(0, 80), run, now());
      credit(userId, -amount, 'withdrawal', `withdraw:${id}`, `Payday ${run}, to ${momo.number}`);
      paid.push({ id, userId, amount, momoNumber: momo.number });
    }
    db.prepare("insert into app_config (key, value) values ('wallet_last_run', ?) on conflict(key) do update set value = excluded.value").run(run);
  });
  return { ran: true, paid, held };
}

/** Payments of this payday not sent automatically yet. */
export const waitingToSend = () => db.prepare("select * from withdrawals where status = 'requested' and transfer_id is null order by created_at").all();
/** Payments handed to the partner, waiting for its answer. */
export const beingSent = () => db.prepare("select * from withdrawals where status = 'requested' and transfer_id is not null").all();
export const markSending = (id, transferId) => db.prepare('update withdrawals set transfer_id = ? where id = ?').run(String(transferId), id);

/** Withdrawals waiting to be sent, oldest first (Admin → Money). */
export const withdrawalsWaiting = () =>
  db.prepare("select w.*, u.display_name, u.email from withdrawals w join users u on u.id = w.user_id where w.status = 'requested' order by w.created_at").all()
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
