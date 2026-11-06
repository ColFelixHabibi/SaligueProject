// Launch numbers (Admin → Launch): is the first release working, and is it time to switch on the next step?
// Each number has a target. With too few people to tell, it says so instead of guessing.
// Step 1 (short videos, creators, verification): are creators posting, do people come back, does discovery work?
// Step 2 (shops and checkout): do views turn into orders, are orders delivered, do creators earn?
import { db, now } from './db.mjs';

const DAY = 86_400_000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const dayAgo = (days) => ago(days).slice(0, 10);
const MIN_SAMPLE = 20;

// Who used Saligue today: one row per person per day, written once (kept in memory until the day changes).
let seenDay = '';
const seen = new Set();
export function markActive(userId) {
  const day = now().slice(0, 10);
  if (day !== seenDay) {
    seenDay = day;
    seen.clear();
  }
  if (seen.has(userId)) return;
  seen.add(userId);
  db.prepare('insert or ignore into active_days (user_id, day) values (?, ?)').run(userId, day);
}

const one = (sql, ...args) => db.prepare(sql).get(...args);
const n = (sql, ...args) => Number(Object.values(one(sql, ...args) ?? { n: 0 })[0] ?? 0);
const ratio = (part, whole) => (whole ? part / whole : null);

/** A number with its target: status good | warn | bad, or none when there are too few people to tell. */
function metric(key, label, value, { unit = 'n', good, warn, higher = true, sample = Infinity, target, note } = {}) {
  let status = 'none';
  if (value !== null && sample >= MIN_SAMPLE && good !== undefined) {
    if (higher) status = value >= good ? 'good' : value > warn ? 'warn' : 'bad';
    else status = value <= good ? 'good' : value < warn ? 'warn' : 'bad';
  }
  return { key, label, value: value === null ? null : Math.round(value * 10000) / 10000, unit, status, target, note, sample: Number.isFinite(sample) ? sample : null };
}

/** Of the people who joined since tracking began and are at least `days` old, how many came back on that day. */
function retention(days) {
  const start = one('select min(day) as d from active_days')?.d;
  if (!start) return { value: null, sample: 0 };
  const rows = db.prepare(`select u.id, substr(u.created_at, 1, 10) as joined from users u
    where substr(u.created_at, 1, 10) >= ? and u.created_at <= ? and u.created_at >= ?`).all(start, ago(days), ago(days + 60));
  let back = 0;
  for (const r of rows) {
    const target = new Date(Date.parse(r.joined) + days * DAY).toISOString().slice(0, 10);
    if (one('select 1 as x from active_days where user_id = ? and day = ?', r.id, target)) back++;
  }
  return { value: ratio(back, rows.length), sample: rows.length };
}

export function launchNumbers() {
  const since7 = ago(7);
  const since30 = ago(30);

  // --- Creators (supply) ---
  const posts7 = db.prepare(`select user_id, count(*) as n from (
      select seller_id as user_id from products where created_at > ? and status != 'deleted'
      union all select user_id from lessons where created_at > ?) group by user_id`).all(since7, since7);
  const creators7 = posts7.length;
  const postCount7 = posts7.reduce((s, r) => s + r.n, 0);
  const firstPosts = db.prepare(`select user_id, min(at) as first from (
      select seller_id as user_id, created_at as at from products where status != 'deleted'
      union all select user_id, created_at from lessons) group by user_id`).all();
  const cohort = firstPosts.filter((r) => r.first <= ago(28) && r.first > ago(56)).map((r) => r.user_id);
  const stillPosting = new Set(posts7.map((r) => r.user_id));
  const creatorRet = ratio(cohort.filter((id) => stillPosting.has(id)).length, cohort.length);
  const verified = posts7.filter((r) => one('select verified from users where id = ?', r.user_id)?.verified).length;

  // Views from people who don't follow the shop: the feed finds new audiences, not only followers.
  const views = one(`select count(*) as total, coalesce(sum(case when f.follower_id is null then 1 else 0 end), 0) as outside
    from interactions i join products p on p.id = i.product_id left join follows f on f.follower_id = i.user_id and f.seller_id = p.seller_id
    where i.created_at > ? and i.kind in ('view', 'dwell', 'complete') and i.user_id != p.seller_id`, since7);
  const watched = n(`select count(*) as n from interactions i join products p on p.id = i.product_id
    where i.created_at > ? and i.kind in ('dwell', 'skip') and p.video is not null`, since7);
  const completes = n("select count(*) as n from interactions where created_at > ? and kind = 'complete'", since7);

  // --- People (demand) ---
  const today = now().slice(0, 10);
  const dau = n('select count(*) as n from active_days where day = ?', today);
  const mau = n('select count(distinct user_id) as n from active_days where day > ?', dayAgo(30));
  const avgDau7 = n('select count(*) as n from active_days where day > ? and day < ?', dayAgo(8), today) / 7;
  const d1 = retention(1);
  const d7 = retention(7);
  const d30 = retention(30);
  const saves7 = n('select count(*) as n from wishlists where added_at > ?', since7);
  const carts7 = n('select count(*) as n from cart_history where added_at > ?', since7);

  // --- Shops and checkout (step 2) ---
  const views30 = n('select coalesce(sum(views), 0) as n from product_views where day > ?', dayAgo(30));
  const ordered30 = n("select coalesce(sum(json_extract(i.value, '$.quantity')), 0) as n from orders o, json_each(o.items) i where o.created_at > ? and o.status != 'cancelled'", since30);
  const orders30 = n('select count(*) as n from orders where created_at > ?', since30);
  const delivered30 = db.prepare("select created_at, received_at from orders where created_at > ? and status = 'delivered'").all(since30);
  const onTime = delivered30.filter((o) => o.received_at && Date.parse(o.received_at) - Date.parse(o.created_at) <= 7 * DAY).length;
  const cancelled30 = n("select count(*) as n from orders where created_at > ? and status = 'cancelled'", since30);
  const problems30 = n('select count(*) as n from orders where created_at > ? and problem_status is not null', since30);
  const items = n("select count(*) as n from products where status = 'active'");
  const reports30 = n('select count(*) as n from reports where created_at > ?', since30);
  // What creators took home in 30 days: shops' delivered sales after Saligue's fee, tips, share rewards, ad income share.
  const shopSales = db.prepare("select seller_id, sum(total - fee) as amount from orders where created_at > ? and status = 'delivered' group by seller_id").all(since30);
  const paidOut = db.prepare("select user_id, sum(amount) as amount from payouts where created_at > ? group by user_id").all(since30);
  const earners = new Map();
  for (const r of [...shopSales.map((x) => ({ id: x.seller_id, amount: x.amount })), ...paidOut.map((x) => ({ id: x.user_id, amount: x.amount }))]) earners.set(r.id, (earners.get(r.id) ?? 0) + r.amount);
  const avgEarned = earners.size ? [...earners.values()].reduce((s, v) => s + v, 0) / earners.size : null;

  const groups = [
    {
      title: 'Creators: are they showing up?',
      metrics: [
        metric('creators', 'Creators who posted this week', creators7, { good: 100, warn: 30, target: '100–300 in your first market' }),
        metric('postsPerCreator', 'Posts per creator this week', ratio(postCount7, creators7), { good: 2, warn: 1, sample: creators7, target: '2–3 a week' }),
        metric('creatorRetention', 'Creators still posting after 4 weeks', creatorRet, { unit: '%', good: 0.4, warn: 0.25, sample: cohort.length, target: '40% or more', note: 'Of creators whose first post was 4 to 8 weeks ago, the share who posted this week.' }),
        metric('verified', 'Active creators verified', ratio(verified, creators7), { unit: '%', sample: creators7, target: 'Rising week by week' }),
        metric('outOfNetwork', 'Views from people who don’t follow the shop', ratio(views.outside, views.total), { unit: '%', good: 0.5, warn: 0.3, sample: views.total, target: 'Most views', note: 'Shows the For You feed brings creators new audiences, not only their followers.' }),
      ],
    },
    {
      title: 'People: do they come back?',
      metrics: [
        metric('d1', 'Back the next day', d1.value, { unit: '%', good: 0.4, warn: 0.25, sample: d1.sample, target: '40% or more' }),
        metric('d7', 'Back on day 7', d7.value, { unit: '%', good: 0.3, warn: 0.15, sample: d7.sample, target: '30% healthy, 15% or less is a warning' }),
        metric('d30', 'Back on day 30', d30.value, { unit: '%', good: 0.15, warn: 0.08, sample: d30.sample, target: '15% or more' }),
        metric('stickiness', 'Daily users ÷ monthly users', ratio(avgDau7, mau), { unit: '%', good: 0.2, warn: 0.1, sample: mau, target: '20–30%', note: 'Average daily users over the last 7 days, divided by everyone who came in 30 days.' }),
        metric('dau', 'People today', dau, { target: 'Growing' }),
        metric('mau', 'People in the last 30 days', mau, { target: 'Growing' }),
        metric('completion', 'Videos watched to the end', ratio(completes, watched + completes), { unit: '%', good: 0.3, warn: 0.15, sample: watched + completes, target: 'A good share', note: 'Of feed videos people stopped on or swiped past this week.' }),
        metric('intent', 'Items saved or added to the bag this week', saves7 + carts7, { target: 'People want to buy before checkout opens' }),
      ],
    },
    {
      title: 'Shops and checkout (step 2)',
      metrics: [
        metric('conversion', 'Item views that became an order', ratio(ordered30, views30), { unit: '%', good: 0.01, warn: 0.005, sample: views30, target: '1–3%', note: 'Last 30 days.' }),
        metric('onTime', 'Orders delivered within 7 days', ratio(onTime, delivered30.length), { unit: '%', good: 0.9, warn: 0.75, sample: delivered30.length, target: '90% or more' }),
        metric('cancelled', 'Orders cancelled', ratio(cancelled30, orders30), { unit: '%', good: 0.1, warn: 0.2, higher: false, sample: orders30, target: '10% or less' }),
        metric('problems', 'Orders with a reported problem', ratio(problems30, orders30), { unit: '%', good: 0.03, warn: 0.08, higher: false, sample: orders30, target: '3% or less' }),
        metric('reports', 'Item reports per 1,000 items', ratio(reports30 * 1000, items), { good: 5, warn: 15, higher: false, sample: items, target: 'Low, and resolved fast' }),
        metric('earned', 'Average a creator earned (30 days)', avgEarned, { unit: '$', sample: earners.size, target: 'Visibly more than elsewhere', note: 'Delivered sales after fees, tips, share rewards and ad income, per person who earned anything.' }),
      ],
    },
  ];
  const by = Object.fromEntries(groups.flatMap((g) => g.metrics).map((m) => [m.key, m]));
  // The rule for opening step 2: most of these good (hold them for 4–6 weeks before switching on the next step).
  const ready = [
    { label: 'People come back on day 7 (30%+)', met: by.d7.status === 'good' },
    { label: 'Creators keep posting after 4 weeks (40%+)', met: by.creatorRetention.status === 'good' },
    { label: 'Daily ÷ monthly users at 20%+', met: by.stickiness.status === 'good' },
    { label: 'People save items or add them to the bag', met: saves7 + carts7 >= MIN_SAMPLE },
  ];
  return { trackingSince: one('select min(day) as d from active_days')?.d ?? null, groups, ready, funnel: funnel(since30) };
}

/**
 * Where buyers drop off, last 30 days: how many different people reached each step.
 * People, not events (one person viewing 40 items counts once). Try-on is optional on the way to an order,
 * so each step's share is of the people who saw an item, plus the share of the step just before.
 * Views and try-ons come from interactions, which only people who accepted personalisation send.
 */
function funnel(since) {
  const people = (sql) => n(sql, since);
  const steps = [
    { key: 'saw', label: 'Saw an item', value: people("select count(distinct user_id) as n from interactions where created_at > ? and kind in ('view', 'dwell', 'complete')") },
    { key: 'tried', label: 'Tried it on', value: people("select count(distinct user_id) as n from interactions where created_at > ? and kind = 'wear'") },
    { key: 'bag', label: 'Added to the bag', value: people('select count(distinct user_id) as n from cart_history where added_at > ?') },
    { key: 'ordered', label: 'Ordered', value: people("select count(distinct buyer_id) as n from orders where created_at > ? and status != 'cancelled'") },
    { key: 'delivered', label: 'Got it delivered', value: people("select count(distinct buyer_id) as n from orders where created_at > ? and status = 'delivered'") },
  ];
  const top = steps[0].value;
  return steps.map((step, i) => ({
    ...step,
    ofTop: top ? step.value / top : null,
    ofPrevious: i && steps[i - 1].value ? step.value / steps[i - 1].value : null,
  }));
}
