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
const FREQUENCY_CAP = 3; // views of one ad per person per day

const day = () => now().slice(0, 10);

/** Ends campaigns whose days are over. */
export function expireCampaigns() {
  db.prepare("update ad_campaigns set status = 'completed' where status in ('active', 'paused') and ends_at is not null and ends_at < ?").run(now());
}

// Who has seen which ad today (in memory: resets daily and on restart, which only loosens the cap a little).
const seen = new Map();
function seenToday(userId, campaignId) {
  const key = `${day()}|${userId}|${campaignId}`;
  return seen.get(key) ?? 0;
}

/** Up to `count` ads to show this person, never their own items, each at most 3 times a day. */
export function pickAds(userId, count, placement) {
  expireCampaigns();
  const rows = db.prepare(`select c.*, p.status as product_status, p.hidden from ad_campaigns c join products p on p.id = c.product_id
    where c.status = 'active' and c.spent < c.budget and p.status = 'active' and p.hidden = 0`).all();
  const eligible = rows.filter((c) => c.seller_id !== userId && (parse(c.placements) ?? []).includes(placement) && seenToday(userId ?? 'anon', c.id) < FREQUENCY_CAP);
  // Campaigns with more budget left are shown a little more often.
  const weighted = eligible.map((c) => ({ c, w: Math.random() * Math.sqrt(Math.max(0.01, c.budget - c.spent)) })).sort((a, b) => b.w - a.w);
  return weighted.slice(0, count).map(({ c }) => ({ campaignId: c.id, productId: c.product_id, headline: c.headline }));
}

/** Counts views (billing them) and clicks. Views from the advertiser themselves are free. */
export function recordAdEvents(userId, events) {
  const today = day();
  let recorded = 0;
  transaction(() => {
    for (const e of events.slice(0, 50)) {
      const c = db.prepare('select * from ad_campaigns where id = ?').get(String(e.campaignId ?? ''));
      if (!c || c.status !== 'active' || c.seller_id === userId) continue;
      if (e.kind === 'impression') {
        const key = `${today}|${userId ?? 'anon'}|${c.id}`;
        const n = seen.get(key) ?? 0;
        if (n >= FREQUENCY_CAP) continue;
        seen.set(key, n + 1);
        const cost = Math.min(c.cpm / 1000, Math.max(0, c.budget - c.spent));
        db.prepare('update ad_campaigns set impressions = impressions + 1, spent = spent + ? where id = ?').run(cost, c.id);
        db.prepare('insert into ad_stats (campaign_id, day, impressions, spent) values (?, ?, 1, ?) on conflict(campaign_id, day) do update set impressions = impressions + 1, spent = spent + excluded.spent')
          .run(c.id, today, cost);
        if (c.spent + cost >= c.budget - 1e-9) db.prepare("update ad_campaigns set status = 'completed' where id = ?").run(c.id);
        recorded++;
      } else if (e.kind === 'click') {
        db.prepare('update ad_campaigns set clicks = clicks + 1 where id = ?').run(c.id);
        db.prepare('insert into ad_stats (campaign_id, day, clicks) values (?, ?, 1) on conflict(campaign_id, day) do update set clicks = clicks + 1').run(c.id, today);
        recorded++;
      }
    }
  });
  if (seen.size > 300_000) seen.clear();
  return recorded;
}

export function campaignOut(c) {
  const product = db.prepare('select id, name, image, cutout, price from products where id = ?').get(c.product_id);
  return {
    id: c.id,
    product: product ? { id: product.id, name: product.name, image: product.cutout || product.image, price: product.price } : null,
    headline: c.headline,
    budget: c.budget,
    spent: Math.round(c.spent * 100) / 100,
    cpm: c.cpm,
    days: c.days,
    placements: parse(c.placements) ?? [],
    status: c.status,
    reviewNote: c.review_note,
    impressions: c.impressions,
    clicks: c.clicks,
    ctr: c.impressions ? Math.round((c.clicks / c.impressions) * 1000) / 10 : 0,
    estimatedViews: Math.floor((c.budget / c.cpm) * 1000),
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
