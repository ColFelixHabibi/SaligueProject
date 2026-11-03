// Share & earn: anyone with an account earns when people buy from the links they share.
//
// Every Saligue link someone shares carries ?via=<their id>. When a shopper opens an item (or a look full of
// items) from it, the visit is kept for `days` days; the latest sharer wins. If the shopper then orders that
// item, the sharer is owed `rate` of the item's price, fixed on the order. Saligue pays it, not the shop, and only
// once the order is delivered with no open problem. Cancelled or refunded orders earn nothing.
// No follower minimum: this is how a new creator earns from the first week.
// Against fake sales: each reward is capped (`cap` dollars), and an order not paid online (no money reached
// Saligue) earns only after an admin approved it (Admin → Money → Share & earn).
import { randomUUID } from 'node:crypto';
import { db, now, parse } from './db.mjs';

export function shareRules() {
  const saved = parse(db.prepare("select value from app_config where key = 'shares'").get()?.value) ?? {};
  return { rate: Number(saved.rate ?? 0.03), days: Number(saved.days ?? 7), cap: Number(saved.cap ?? 5) };
}

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Someone opened a shared link. `productIds`: the item opened, or every item in the shared look.
 * Returns how many items were credited to the sharer. Never credits a sharer for their own shop's items or visit.
 */
export function recordShareVisit(userId, sharerId, productIds) {
  if (!userId || !sharerId || userId === sharerId) return 0;
  const sharer = db.prepare('select id from users where id = ? and is_guest = 0 and suspended = 0').get(sharerId);
  if (!sharer) return 0;
  const put = db.prepare(`insert into share_visits (user_id, product_id, sharer_id, created_at) values (?, ?, ?, ?)
    on conflict(user_id, product_id) do update set sharer_id = excluded.sharer_id, created_at = excluded.created_at`);
  let n = 0;
  for (const id of [...new Set(productIds)].slice(0, 60)) {
    const p = db.prepare("select seller_id from products where id = ? and status != 'deleted'").get(String(id));
    if (!p || p.seller_id === sharerId || p.seller_id === userId) continue;
    put.run(userId, String(id), sharerId, now());
    n++;
  }
  return n;
}

/** After an order is placed: the rewards owed for items bought from a shared link (once per order and item). */
export function recordShareRewards(order) {
  const { rate, days, cap } = shareRules();
  if (!(rate > 0)) return 0;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  let n = 0;
  for (const item of parse(order.items) ?? []) {
    const visit = db.prepare('select sharer_id from share_visits where user_id = ? and product_id = ? and created_at > ?').get(order.buyer_id, item.productId, since);
    if (!visit || visit.sharer_id === order.seller_id || visit.sharer_id === order.buyer_id) continue;
    const sale = r2(item.price * item.quantity);
    const amount = r2(Math.min(sale * rate, cap));
    if (amount <= 0) continue;
    n += db.prepare('insert or ignore into share_rewards (id, order_id, product_id, sharer_id, sale, amount, created_at) values (?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), order.id, item.productId, visit.sharer_id, sale, amount, now()).changes;
  }
  return n;
}

// A reward's state comes from its order: earned once delivered (no open problem) and either paid online or
// approved by an admin; 'review' while waiting for that approval; void if cancelled, refunded or rejected.
const STATE = `case when o.status = 'cancelled' or r.rejected_at is not null then 'void'
  when o.status != 'delivered' or coalesce(o.problem_status, '') = 'open' then 'pending'
  when (o.payment_method = 'online' and o.payment_status = 'paid') or r.approved_at is not null then 'earned'
  else 'review' end`;

/** One person's rewards: totals and the latest. */
export function sharesOf(userId) {
  const rows = db.prepare(`select r.*, ${STATE} as state, o.items from share_rewards r join orders o on o.id = r.order_id where r.sharer_id = ? order by r.created_at desc`).all(userId);
  const sum = (f) => r2(rows.filter(f).reduce((s, r) => s + r.amount, 0));
  return {
    ...shareRules(),
    pending: sum((r) => r.state === 'pending' || r.state === 'review'),
    ready: sum((r) => r.state === 'earned' && !r.payout_id),
    paid: sum((r) => !!r.payout_id),
    sales: rows.filter((r) => r.state !== 'void').length,
    rewards: rows.slice(0, 100).map((r) => {
      const item = (parse(r.items) ?? []).find((i) => i.productId === r.product_id);
      return { id: r.id, productId: r.product_id, name: item?.name ?? 'Item', image: item?.image ?? null, sale: r.sale, amount: r.amount, state: r.payout_id ? 'paid' : r.state, createdAt: r.created_at };
    }),
  };
}

/** Rewards on delivered orders paid to the shop directly, waiting for an admin (oldest first). */
export function sharesToReview() {
  return db.prepare(`select r.*, o.buyer_id, o.seller_id, o.payment_method, o.received_by, o.created_at as ordered_at, o.items from share_rewards r join orders o on o.id = r.order_id
    where r.payout_id is null and ${STATE} = 'review' order by r.created_at limit 100`).all()
    .map((r) => ({ id: r.id, orderId: r.order_id, sharerId: r.sharer_id, buyerId: r.buyer_id, sellerId: r.seller_id, item: (parse(r.items) ?? []).find((i) => i.productId === r.product_id)?.name ?? 'Item', sale: r.sale, amount: r.amount, paymentMethod: r.payment_method, receivedBy: r.received_by, orderedAt: r.ordered_at }));
}

/** An admin approves or rejects a reward that is waiting for review. Returns false if it isn't waiting. */
export function decideShare(id, approve) {
  const r = db.prepare(`select r.id from share_rewards r join orders o on o.id = r.order_id where r.id = ? and ${STATE} = 'review'`).get(id);
  if (!r) return false;
  db.prepare(`update share_rewards set ${approve ? 'approved_at' : 'rejected_at'} = ? where id = ?`).run(now(), id);
  return true;
}

/** Earned rewards not paid yet, per sharer (Admin → Money). */
export function sharesDue() {
  return db.prepare(`select r.sharer_id, sum(r.amount) as amount, count(*) as n from share_rewards r join orders o on o.id = r.order_id
    where r.payout_id is null and ${STATE} = 'earned' group by r.sharer_id order by amount desc`).all()
    .map((d) => ({ userId: d.sharer_id, amount: r2(d.amount), sales: d.n }));
}

/** Marks one sharer's earned rewards as paid by `payoutId`. Returns { ids, amount }. */
export function earnedUnpaid(userId) {
  const rows = db.prepare(`select r.id, r.amount from share_rewards r join orders o on o.id = r.order_id where r.sharer_id = ? and r.payout_id is null and ${STATE} = 'earned'`).all(userId);
  return { ids: rows.map((r) => r.id), amount: r2(rows.reduce((s, r) => s + r.amount, 0)) };
}
