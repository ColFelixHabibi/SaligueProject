// The For You feed, learned from how everyone uses Saligue:
//  - each shopper's own signals: likes, saves, bag, orders, comments, and what they open, watch, try on or skip
//    (interactions, recorded with their consent), fading over about three weeks;
//  - "shoppers who liked this also liked…": item-to-item similarity learned from all shoppers together,
//    retrained every few minutes as people use the app;
//  - how items look (AI image fingerprints), so new items with no history can still match a taste;
//  - what is trending and fresh, with a little daily variety and no long runs of one kind of item.
import { db, parse } from './db.mjs';

const HALF_LIFE_DAYS = 21;
export const INTERACTION_WEIGHTS = { view: 1, dwell: 0.6, wear: 2.5, cart: 3, message: 3, share: 2, skip: -0.5 };
const RETRAIN_MS = 5 * 60_000;

const decay = (iso) => Math.pow(0.5, (Date.now() - Date.parse(iso)) / (HALF_LIFE_DAYS * 86_400_000));

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Every shopper's interest in every item they touched: Map(user → Map(item → weight)). */
function allSignals(onlyUser = null) {
  const users = new Map();
  const add = (u, p, w) => {
    if (!users.has(u)) users.set(u, new Map());
    const m = users.get(u);
    m.set(p, (m.get(p) ?? 0) + w);
  };
  const where = onlyUser ? ' where user_id = ?' : '';
  const args = onlyUser ? [onlyUser] : [];
  for (const r of db.prepare(`select user_id, product_id, created_at from likes${where}`).all(...args)) add(r.user_id, r.product_id, 3 * decay(r.created_at));
  for (const r of db.prepare(`select user_id, product_id, added_at from wishlists${where}`).all(...args)) add(r.user_id, r.product_id, 3 * decay(r.added_at));
  for (const r of db.prepare(`select user_id, product_id from cart_items${where}`).all(...args)) add(r.user_id, r.product_id, 3);
  for (const r of db.prepare(`select user_id, product_id, created_at from comments${where}`).all(...args)) add(r.user_id, r.product_id, 2 * decay(r.created_at));
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  for (const r of db.prepare(`select user_id, product_id, weight, created_at from interactions where created_at > ?${onlyUser ? ' and user_id = ?' : ''}`).all(since, ...args)) {
    add(r.user_id, r.product_id, r.weight * decay(r.created_at));
  }
  for (const o of db.prepare(`select buyer_id, items, created_at from orders where status != 'cancelled'${onlyUser ? ' and buyer_id = ?' : ''}`).all(...args)) {
    for (const i of parse(o.items) ?? []) add(o.buyer_id, i.productId, 5 * decay(o.created_at));
  }
  return users;
}

// The learned model: item → [[similar item, strength]], plus what is trending.
let model = { similar: new Map(), trending: new Map(), trainedAt: 0, shoppers: 0 };

/** Learns "liked this, also liked that" from all shoppers (item-item cosine over shoppers' positive signals). */
export function train() {
  const users = allSignals();
  const itemUsers = new Map(); // item → Map(user → weight)
  for (const [u, items] of users) {
    for (const [p, w] of items) {
      if (w <= 0.2) continue;
      if (!itemUsers.has(p)) itemUsers.set(p, new Map());
      itemUsers.get(p).set(u, Math.min(w, 10));
    }
  }
  const norm = new Map([...itemUsers].map(([p, m]) => [p, Math.sqrt([...m.values()].reduce((s, w) => s + w * w, 0))]));
  const pairs = new Map();
  for (const [, items] of users) {
    const positive = [...items].filter(([, w]) => w > 0.2).slice(0, 200);
    for (let i = 0; i < positive.length; i++) {
      for (let j = i + 1; j < positive.length; j++) {
        const [a, wa] = positive[i], [b, wb] = positive[j];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        pairs.set(key, (pairs.get(key) ?? 0) + Math.min(wa, 10) * Math.min(wb, 10));
      }
    }
  }
  const similar = new Map();
  for (const [key, dot] of pairs) {
    const [a, b] = key.split('|');
    const s = dot / ((norm.get(a) || 1) * (norm.get(b) || 1));
    if (s < 0.05) continue;
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!similar.has(x)) similar.set(x, []);
      similar.get(x).push([y, s]);
    }
  }
  for (const list of similar.values()) list.sort((p, q) => q[1] - p[1]).splice(30);

  // Trending: engagement over the last 7 days, from everyone.
  const trending = new Map();
  const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
  for (const r of db.prepare('select product_id, sum(weight) as w from interactions where created_at > ? and weight > 0 group by product_id').all(week)) trending.set(r.product_id, r.w);
  for (const r of db.prepare('select product_id, count(*) as n from likes where created_at > ? group by product_id').all(week)) trending.set(r.product_id, (trending.get(r.product_id) ?? 0) + r.n * 3);
  model = { similar, trending, trainedAt: Date.now(), shoppers: users.size };
  return model;
}

const ensureModel = () => (Date.now() - model.trainedAt > RETRAIN_MS ? train() : model);

function dailyNoise(id) {
  const day = new Date().toISOString().slice(0, 10);
  let h = 2166136261;
  for (const c of `${day}:${id}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * The feed for one shopper: [{ id, reason }] best first. `reason` says why it was picked
 * ("Because you liked …", "Shoppers like you also liked …", "Trending", "New").
 */
export function feedFor(userId, products) {
  const m = ensureModel();
  const mine = userId ? allSignals(userId).get(userId) ?? new Map() : new Map();
  const byId = new Map(products.map((p) => [p.id, p]));
  const bought = new Set(userId ? db.prepare("select items from orders where buyer_id = ? and status != 'cancelled'").all(userId).flatMap((o) => (parse(o.items) ?? []).map((i) => i.productId)) : []);
  const positive = [...mine].filter(([id, w]) => w > 0.3 && byId.has(id));
  const negative = [...mine].filter(([id, w]) => w < 0 && byId.has(id));
  const strength = positive.reduce((s, [, w]) => s + w, 0);
  const confidence = Math.min(1, strength / 12);

  // Taste fingerprint: the weighted look of what they like.
  const withEmbedding = positive.map(([id, w]) => [parse(byId.get(id).embedding), w]).filter(([e]) => e?.length);
  const dims = withEmbedding[0]?.[0].length ?? 0;
  const centroid = dims ? new Array(dims).fill(0) : null;
  if (centroid) for (const [e, w] of withEmbedding) if (e.length === dims) e.forEach((x, i) => (centroid[i] += x * w));
  const dislikes = negative.map(([id]) => parse(byId.get(id).embedding)).filter((e) => e?.length === dims);

  // "Shoppers who liked what you like also liked…"
  const collaborative = new Map();
  const because = new Map();
  for (const [id, w] of positive) {
    for (const [other, s] of m.similar.get(id) ?? []) {
      const v = w * s;
      collaborative.set(other, (collaborative.get(other) ?? 0) + v);
      if (!because.has(other) || because.get(other).v < v) because.set(other, { v, id });
    }
  }
  const maxCollab = Math.max(1e-9, ...collaborative.values());
  const maxTrend = Math.max(1e-9, ...m.trending.values());

  const category = new Map();
  for (const [id, w] of positive) category.set(byId.get(id).category, (category.get(byId.get(id).category) ?? 0) + w);

  const scored = products
    .filter((p) => p.status === 'active' && !p.hidden && !bought.has(p.id))
    .map((p) => {
      const emb = parse(p.embedding);
      const look = centroid && emb?.length === dims ? cosine(centroid, emb) : 0;
      const dislike = dislikes.length && emb?.length === dims ? Math.max(...dislikes.map((d) => cosine(d, emb))) * 0.35 : 0;
      const cf = (collaborative.get(p.id) ?? 0) / maxCollab;
      const kind = strength ? (category.get(p.category) ?? 0) / strength : 0;
      const trend = (m.trending.get(p.id) ?? 0) / maxTrend;
      const ageDays = (Date.now() - Date.parse(p.created_at)) / 86_400_000;
      const fresh = Math.exp(-ageDays / 14);
      const popular = Math.log1p(p.like_count) / 5;
      const seen = (mine.get(p.id) ?? 0) > 2 ? 0.35 : 0;
      const score = confidence * (0.9 * look + 0.8 * cf + 0.35 * kind - dislike)
        + (1 - confidence * 0.5) * (0.35 * trend + 0.3 * fresh + popular)
        + dailyNoise(p.id) * (0.22 - confidence * 0.12)
        - seen - (p.stock === 0 ? 0.6 : 0);
      let reason = null;
      const b = because.get(p.id);
      if (b && cf > 0.3) reason = `Shoppers who liked ${byId.get(b.id)?.name ?? 'your picks'} also liked this`;
      else if (look > 0.8 && positive.length) reason = 'Matches your style';
      else if (trend > 0.5) reason = 'Trending on Saligue';
      else if (ageDays < 3) reason = 'New';
      return { p, score, reason };
    })
    .sort((a, b) => b.score - a.score);

  // No more than two of one kind in a row; INDECIANA items every fourth slot.
  const varied = [];
  const pool = [...scored];
  while (pool.length) {
    const recent = varied.slice(-2).map((x) => x.p.category);
    const i = recent.length === 2 && recent[0] === recent[1] ? Math.max(0, pool.findIndex((x) => x.p.category !== recent[0])) : 0;
    varied.push(pool.splice(i, 1)[0]);
  }
  const official = varied.filter((x) => x.p.official);
  const others = varied.filter((x) => !x.p.official);
  const feed = [];
  while (official.length || others.length) {
    if (official.length && (feed.length % 4 === 1 || !others.length)) feed.push(official.shift());
    else feed.push(others.shift());
  }
  return { items: feed.map((x) => ({ id: x.p.id, reason: x.reason })), personal: confidence, shoppers: m.shoppers };
}
