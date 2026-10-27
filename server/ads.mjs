// Saligue Ads and Creator Monetization.
//
// Ads: a seller promotes one of their items with a budget (dollars) for a number of days. After payment and
// INDECIANA's review against the Ads Policy, the item is shown as "Sponsored" in For You and Explore and each
// view costs cpm/1000 of the budget. The campaign stops when the budget is spent or the days are over.
//
// Monetization: approved creators share `creatorShare` of each month's ad income, split by points:
//   points = item views + 50 × delivered items sold + 5 × new followers   (all in that month)
// Eligibility (strict, like X and Meta): 1,000 followers and 50,000 item views in 90 days, plus the basics (see eligibility()).
import { randomUUID } from 'node:crypto';
import { db, json, now, parse, transaction } from './db.mjs';

export function adSettings() {
  const saved = parse(db.prepare("select value from app_config where key = 'ads'").get()?.value) ?? {};
  return {
    cpm: Number(saved.cpm ?? 2), // dollars per 1,000 views
    minBudget: Number(saved.minBudget ?? 5),
    maxDays: 60,
    creatorShare: Number(saved.creatorShare ?? 0.5),
    // Where sellers send ad money when online payment is off (shown to them).
    momoNumber: saved.momoNumber ?? null,
    momoName: saved.momoName ?? 'INDECIANA',
  };
}

export const REQUIREMENTS = { followers: 10000, views90: 5000000, accountDays: 120 };
/** Monetization requirements, as set by admins (Admin → Policies & rules), else the defaults above. */
export function requirements() {
  const saved = parse(db.prepare("select value from app_config where key = 'monetization'").get()?.value) ?? {};
  return {
    followers: Number(saved.followers ?? REQUIREMENTS.followers),
    views90: Number(saved.views90 ?? REQUIREMENTS.views90),
    accountDays: Number(saved.accountDays ?? REQUIREMENTS.accountDays),
  };
}
// Limits on billed views, kept in the database (a restart changes nothing):
const FREQUENCY_CAP = 3; // per person, per ad, per day
const NETWORK_CAP = 6; // per network address, per ad, per day: many accounts on one phone or Wi-Fi can't drain a budget
const MIN_VIEW_MS = 1000; // on screen at least a second (a quick scroll past is not a view)
const SERVE_HOURS = 2; // a code from /api/ads is valid this long
const CLICK_DAYS = 7; // an order within 7 days of clicking the ad counts as a sale from the ad
const VIEW_DAYS = 1; // or within a day of seeing it

const day = () => now().slice(0, 10);
const billedToday = (campaignId, column, value) =>
  db.prepare(`select count(*) as n from ad_serves where campaign_id = ? and ${column} = ? and billed = 1 and viewed_at >= ?`).get(campaignId, value, day()).n;

/** A shop's ad balance (unused budget that came back, minus what paid for later ads). */
export const adBalance = (userId) => Math.round((db.prepare('select coalesce(sum(amount), 0) as n from ad_credits where user_id = ?').get(userId).n) * 100) / 100;
export function addCredit(userId, amount, reason, campaignId = null) {
  if (!amount) return;
  db.prepare('insert into ad_credits (id, user_id, campaign_id, amount, reason, created_at) values (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), userId, campaignId, Math.round(amount * 100) / 100, reason, now());
}

/**
 * A finished or stopped campaign that was paid gives back what it didn't use, once, to the shop's ad balance.
 * Returns the amount credited.
 */
export function creditUnused(c, reason) {
  const paid = c.payment_ref || c.credit_used > 0;
  if (!paid || c.credited != null) return 0;
  const unused = Math.max(0, Math.round((c.budget - c.spent) * 100) / 100);
  transaction(() => {
    db.prepare('update ad_campaigns set credited = ? where id = ? and credited is null').run(unused, c.id);
    if (unused > 0) addCredit(c.seller_id, unused, reason, c.id);
  });
  return unused;
}

let onCredited = () => {};
/** Lets the server tell the shop (notification) when unused money comes back. */
export const whenCredited = (fn) => { onCredited = fn; };

/** Ends campaigns whose days are over, and gives back what they didn't use. */
export function expireCampaigns() {
  const over = db.prepare("select * from ad_campaigns where status in ('active', 'paused') and ends_at is not null and ends_at < ?").all(now());
  for (const c of over) {
    db.prepare("update ad_campaigns set status = 'completed' where id = ?").run(c.id);
    const unused = creditUnused(c, 'Unused budget of a finished ad');
    if (unused > 0) onCredited(c, unused);
  }
  // Codes no longer needed (sales are counted for 7 days; stats are kept in ad_stats).
  db.prepare('delete from ad_serves where created_at < ?').run(new Date(Date.now() - 30 * 86_400_000).toISOString());
}

/**
 * Up to `count` ads for this viewer, never their own items, within the daily limits. Each comes with a one-time
 * code (serveId); only that code can turn into a billed view.
 */
export function pickAds(viewer, ip, sellerId, count, placement) {
  expireCampaigns();
  const rows = db.prepare(`select c.* from ad_campaigns c join products p on p.id = c.product_id
    where c.status = 'active' and c.spent < c.budget and p.status = 'active' and p.hidden = 0`).all();
  const eligible = rows.filter((c) => c.seller_id !== sellerId && (parse(c.placements) ?? []).includes(placement)
    && billedToday(c.id, 'viewer', viewer) < FREQUENCY_CAP && billedToday(c.id, 'ip', ip) < NETWORK_CAP);
  // Campaigns with more budget left are shown a little more often.
  const weighted = eligible.map((c) => ({ c, w: Math.random() * Math.sqrt(Math.max(0.01, c.budget - c.spent)) })).sort((a, b) => b.w - a.w);
  return weighted.slice(0, count).map(({ c }) => {
    const serveId = randomUUID();
    db.prepare('insert into ad_serves (id, campaign_id, viewer, ip, placement, created_at) values (?, ?, ?, ?, ?, ?)').run(serveId, c.id, viewer, ip, placement, now());
    return { serveId, campaignId: c.id, productId: c.product_id, headline: c.headline };
  });
}

/**
 * Views and clicks, by one-time code. A view is billed only if: the code is real and recent, comes back from the
 * same person (or network), the ad was on screen at least a second, it's the first view for this code, the viewer
 * isn't the shop, and the person and network are under today's limits. Clicks count once per real view.
 */
export function recordAdEvents(viewer, ip, sellerId, events) {
  const today = day();
  let recorded = 0;
  const since = new Date(Date.now() - SERVE_HOURS * 3_600_000).toISOString();
  transaction(() => {
    for (const e of events.slice(0, 50)) {
      const serve = db.prepare('select * from ad_serves where id = ? and created_at >= ?').get(String(e.serveId ?? ''), since);
      if (!serve || (serve.viewer !== viewer && serve.ip !== ip)) continue;
      const c = db.prepare('select * from ad_campaigns where id = ?').get(serve.campaign_id);
      if (!c || c.seller_id === sellerId) continue;
      if (e.kind === 'impression') {
        const shownFor = Number(e.ms) || 0;
        const sinceServe = Date.now() - Date.parse(serve.created_at);
        if (serve.viewed_at || shownFor < MIN_VIEW_MS || sinceServe < MIN_VIEW_MS) continue;
        const billable = c.status === 'active' && c.spent < c.budget
          && billedToday(c.id, 'viewer', serve.viewer) < FREQUENCY_CAP && billedToday(c.id, 'ip', serve.ip) < NETWORK_CAP;
        db.prepare('update ad_serves set viewed_at = ?, billed = ? where id = ?').run(now(), billable ? 1 : 0, serve.id);
        if (!billable) continue;
        const cost = Math.min(c.cpm / 1000, Math.max(0, c.budget - c.spent));
        db.prepare('update ad_campaigns set impressions = impressions + 1, spent = spent + ? where id = ?').run(cost, c.id);
        db.prepare('insert into ad_stats (campaign_id, day, impressions, spent) values (?, ?, 1, ?) on conflict(campaign_id, day) do update set impressions = impressions + 1, spent = spent + excluded.spent')
          .run(c.id, today, cost);
        if (c.spent + cost >= c.budget - 1e-9) db.prepare("update ad_campaigns set status = 'completed', credited = coalesce(credited, 0) where id = ?").run(c.id);
        recorded++;
      } else if (e.kind === 'click') {
        if (!serve.viewed_at || serve.clicked_at) continue;
        db.prepare('update ad_serves set clicked_at = ? where id = ?').run(now(), serve.id);
        db.prepare('update ad_campaigns set clicks = clicks + 1 where id = ?').run(c.id);
        db.prepare('insert into ad_stats (campaign_id, day, clicks) values (?, ?, 1) on conflict(campaign_id, day) do update set clicks = clicks + 1').run(c.id, today);
        recorded++;
      }
    }
  });
  return recorded;
}

/**
 * Sales from ads: each item of a new order that the buyer clicked in an ad (last 7 days) or saw in one (last day)
 * is counted for that ad. Cancelled orders stop counting (see adSales).
 */
export function recordConversions(order, buyerId) {
  const clickSince = new Date(Date.now() - CLICK_DAYS * 86_400_000).toISOString();
  const viewSince = new Date(Date.now() - VIEW_DAYS * 86_400_000).toISOString();
  for (const item of parse(order.items) ?? []) {
    const hit = db.prepare(`select s.campaign_id, s.clicked_at from ad_serves s join ad_campaigns c on c.id = s.campaign_id
      where s.viewer = ? and c.product_id = ? and ((s.clicked_at is not null and s.clicked_at >= ?) or (s.viewed_at is not null and s.viewed_at >= ?))
      order by (s.clicked_at is not null) desc, coalesce(s.clicked_at, s.viewed_at) desc limit 1`).get(buyerId, item.productId, clickSince, viewSince);
    if (!hit) continue;
    db.prepare('insert or ignore into ad_conversions (campaign_id, order_id, quantity, amount, via, created_at) values (?, ?, ?, ?, ?, ?)')
      .run(hit.campaign_id, order.id, item.quantity, Math.round(item.price * item.quantity * 100) / 100, hit.clicked_at ? 'click' : 'view', now());
  }
}

/** Orders and money from an ad (cancelled orders left out), in total and per day. */
export function adSales(campaignId) {
  const rows = db.prepare(`select substr(a.created_at, 1, 10) as day, count(*) as orders, sum(a.quantity) as items, sum(a.amount) as sales
    from ad_conversions a join orders o on o.id = a.order_id where a.campaign_id = ? and o.status != 'cancelled' group by day order by day`).all(campaignId);
  const total = rows.reduce((t, r) => ({ orders: t.orders + r.orders, items: t.items + r.items, sales: t.sales + r.sales }), { orders: 0, items: 0, sales: 0 });
  return { ...total, sales: Math.round(total.sales * 100) / 100, days: rows };
}

export function campaignOut(c) {
  const product = db.prepare('select id, name, image, cutout, price from products where id = ?').get(c.product_id);
  const sales = adSales(c.id);
  const spent = Math.round(c.spent * 100) / 100;
  return {
    id: c.id,
    product: product ? { id: product.id, name: product.name, image: product.cutout || product.image, price: product.price } : null,
    headline: c.headline,
    budget: c.budget,
    spent,
    cpm: c.cpm,
    days: c.days,
    placements: parse(c.placements) ?? [],
    status: c.status,
    reviewNote: c.review_note,
    impressions: c.impressions,
    clicks: c.clicks,
    ctr: c.impressions ? Math.round((c.clicks / c.impressions) * 1000) / 10 : 0,
    estimatedViews: Math.floor((c.budget / c.cpm) * 1000),
    // Every billed view cost exactly cpm/1000: anyone can check spent = views × price.
    costPerView: c.cpm / 1000,
    orders: sales.orders,
    itemsSold: sales.items,
    sales: sales.sales,
    // Paid from the ad balance, and what came back to it when the ad ended.
    creditUsed: c.credit_used ?? 0,
    toPay: Math.round((c.budget - (c.credit_used ?? 0)) * 100) / 100,
    credited: c.credited ?? null,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    createdAt: c.created_at,
  };
}

/** Starts a paid, reviewed campaign: it runs for its number of days from now. */
export function startCampaign(id) {
  const c = db.prepare('select * from ad_campaigns where id = ?').get(id);
  if (!c) return;
  db.prepare("update ad_campaigns set status = 'active', starts_at = ?, ends_at = ? where id = ?")
    .run(now(), new Date(Date.now() + c.days * 86_400_000).toISOString(), id);
}

// ---------------------------------------------------------------------------
// Creator monetization
// ---------------------------------------------------------------------------

/** Where a seller stands against each requirement. */
export function eligibility(userId) {
  const user = db.prepare('select * from users where id = ?').get(userId);
  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const followers = db.prepare('select count(*) as n from follows where seller_id = ?').get(userId).n;
  const views90 = db.prepare('select coalesce(sum(v.views), 0) as n from product_views v join products p on p.id = v.product_id where p.seller_id = ? and v.day >= ?').get(userId, since90).n;
  const accountDays = Math.floor((Date.now() - Date.parse(user.created_at)) / 86_400_000);
  const strikes = db.prepare("select count(*) as n from notifications where user_id = ? and type = 'product' and title like '%was removed%' and created_at > ?")
    .get(userId, new Date(Date.now() - 90 * 86_400_000).toISOString()).n;
  const req = requirements();
  const checks = [
    { key: 'followers', label: 'Clients', value: followers, target: req.followers },
    { key: 'views', label: 'Item views (last 90 days)', value: views90, target: req.views90 },
    { key: 'age', label: 'Days since joining', value: accountDays, target: req.accountDays },
    { key: 'profile', label: 'Profile photo and shop address', value: user.avatar && parse(user.shop)?.name ? 1 : 0, target: 1 },
    { key: 'strikes', label: 'No items removed for breaking rules (90 days)', value: strikes ? 0 : 1, target: 1 },
  ].map((c) => ({ ...c, met: c.value >= c.target }));
  return { checks, eligible: checks.every((c) => c.met) };
}

/** Ad income collected in a month (YYYY-MM): what paid campaigns spent. */
export function adIncome(period) {
  return db.prepare("select coalesce(sum(spent), 0) as n from ad_stats where substr(day, 1, 7) = ?").get(period).n;
}

/** Each approved creator's share of the month's pool (an estimate until the month is over). */
export function earnings(period) {
  const pool = adIncome(period) * adSettings().creatorShare;
  const creators = db.prepare("select user_id from creators where status = 'approved'").all();
  const rows = creators.map(({ user_id }) => {
    const views = db.prepare('select coalesce(sum(v.views), 0) as n from product_views v join products p on p.id = v.product_id where p.seller_id = ? and substr(v.day, 1, 7) = ?').get(user_id, period).n;
    const sales = db.prepare("select coalesce(sum(json_extract(i.value, '$.quantity')), 0) as n from orders o, json_each(o.items) i where o.seller_id = ? and o.status = 'delivered' and substr(o.created_at, 1, 7) = ?").get(user_id, period).n;
    const followers = db.prepare('select count(*) as n from follows where seller_id = ? and substr(created_at, 1, 7) = ?').get(user_id, period).n;
    return { userId: user_id, views, sales, followers, points: views + 50 * sales + 5 * followers };
  });
  const total = rows.reduce((s, r) => s + r.points, 0);
  return { pool: Math.round(pool * 100) / 100, totalPoints: total, rows: rows.map((r) => ({ ...r, amount: total ? Math.floor((pool * r.points) / total * 100) / 100 : 0 })) };
}

/** Writes the payouts for a finished month (once). Returns how many were created. */
export function closeMonth(period) {
  const { pool, totalPoints, rows } = earnings(period);
  let created = 0;
  for (const r of rows) {
    if (r.amount <= 0) continue;
    const done = db.prepare('insert or ignore into payouts (id, user_id, period, amount, breakdown, created_at) values (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), r.userId, period, r.amount, json({ views: r.views, sales: r.sales, followers: r.followers, points: r.points, totalPoints, pool }), now());
    created += done.changes;
  }
  return created;
}
