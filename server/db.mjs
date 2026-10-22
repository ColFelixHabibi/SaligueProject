// Saligue's own database: one SQLite file (data/saligue.db). Uses Node's built-in SQLite, no installs.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DATA_DIR = resolve(process.env.SALIGUE_DATA || 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'saligue.db'));

db.exec(`
  pragma journal_mode = wal;
  pragma foreign_keys = on;

  create table if not exists users (
    id text primary key,
    email text unique collate nocase,
    password_hash text,
    display_name text,
    role text not null default 'buyer' check (role in ('buyer', 'seller')),
    official integer not null default 0,
    shop text,                          -- JSON: shop name and full address
    is_guest integer not null default 0,
    created_at text not null
  );

  create table if not exists sessions (
    token text primary key,
    user_id text not null references users(id) on delete cascade,
    created_at text not null
  );

  create table if not exists products (
    id text primary key,
    name text not null,
    price real not null check (price >= 0),
    image text not null,                -- photo (data URL)
    cutout text,                        -- photo without background (data URL)
    embedding text,                     -- JSON: AI search fingerprint
    category text not null,
    seller text not null,
    seller_id text not null references users(id) on delete cascade,
    seller_email text,
    status text not null default 'active' check (status in ('active', 'archived', 'draft')),
    description text, size text, color text, brand text, condition text, contact text,
    shop text,                          -- JSON copy of the seller's shop
    official integer not null default 0,
    like_count integer not null default 0,
    sound text,                         -- JSON: { name, duration } when the item has a sound
    created_at text not null
  );
  create index if not exists products_created on products(created_at desc);
  create index if not exists products_seller on products(seller_id);

  create table if not exists likes (
    product_id text not null references products(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    created_at text not null,
    primary key (product_id, user_id)
  );
  create index if not exists likes_user on likes(user_id);

  create table if not exists comments (
    id text primary key,
    product_id text not null references products(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    name text not null,
    text text not null,
    created_at text not null
  );
  create index if not exists comments_product on comments(product_id, created_at desc);

  create table if not exists cart_items (
    user_id text not null references users(id) on delete cascade,
    product_id text not null references products(id) on delete cascade,
    quantity integer not null check (quantity between 1 and 99),
    primary key (user_id, product_id)
  );

  create table if not exists wishlists (
    user_id text not null references users(id) on delete cascade,
    product_id text not null references products(id) on delete cascade,
    added_at text not null,
    primary key (user_id, product_id)
  );

  create table if not exists product_audio (
    product_id text primary key references products(id) on delete cascade,
    data text not null,                 -- MP3 (data URL)
    name text not null,
    duration real not null
  );

  create table if not exists orders (
    id text primary key,
    buyer_id text not null references users(id),
    buyer_name text not null,
    buyer_email text not null default '',
    seller_id text not null references users(id),
    shop text,
    items text not null,                -- JSON
    total real not null,
    delivery text not null,             -- JSON
    payment_method text not null,
    payment_status text not null default 'unpaid',
    status text not null default 'placed',
    created_at text not null
  );
  create index if not exists orders_buyer on orders(buyer_id, created_at desc);
  create index if not exists orders_seller on orders(seller_id, created_at desc);

  create table if not exists support_requests (
    id text primary key,
    user_id text references users(id) on delete set null,
    name text, email text, contact text,
    subject text not null,
    message text not null,
    source text,
    created_at text not null
  );

  create table if not exists notifications (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    type text not null,                 -- sale | order | message | account | product
    title text not null,
    body text not null default '',
    link text,
    read integer not null default 0,
    created_at text not null
  );
  create index if not exists notifications_user on notifications(user_id, created_at desc);

  create table if not exists password_resets (
    token_hash text primary key,        -- SHA-256 of the token sent by email
    user_id text not null references users(id) on delete cascade,
    expires_at text not null
  );

  create table if not exists reports (
    product_id text not null references products(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    reason text not null,               -- not_fashion | fake | offensive | other
    created_at text not null,
    primary key (product_id, user_id)
  );

  create table if not exists learned_examples (
    embedding text not null,            -- JSON: AI fingerprint of a reviewed photo
    label text not null,                -- fashion | not_fashion
    source text,                        -- e.g. the product it came from
    created_at text not null
  );

  create table if not exists app_config (
    key text primary key,
    value text not null                 -- JSON
  );

  -- Direct chat between a buyer and a seller: one conversation per pair, messages may point at an item or order.
  create table if not exists conversations (
    id text primary key,
    buyer_id text not null references users(id) on delete cascade,
    seller_id text not null references users(id) on delete cascade,
    last_message_at text not null,
    buyer_read_at text,
    seller_read_at text,
    buyer_emailed_at text,              -- last "new message" email, so a busy chat sends one email, not fifty
    seller_emailed_at text,
    created_at text not null,
    unique (buyer_id, seller_id)
  );
  create index if not exists conversations_buyer on conversations(buyer_id, last_message_at desc);
  create index if not exists conversations_seller on conversations(seller_id, last_message_at desc);

  create table if not exists messages (
    id text primary key,
    conversation_id text not null references conversations(id) on delete cascade,
    sender_id text not null references users(id) on delete cascade,
    text text not null,
    product_id text references products(id) on delete set null,
    order_id text references orders(id) on delete set null,
    created_at text not null
  );
  create index if not exists messages_conversation on messages(conversation_id, created_at);

  -- Star ratings from buyers whose order with the item was delivered.
  create table if not exists reviews (
    id text primary key,
    product_id text not null references products(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    name text not null,
    rating integer not null check (rating between 1 and 5),
    text text not null default '',
    created_at text not null,
    unique (product_id, user_id)
  );
  create index if not exists reviews_product on reviews(product_id, created_at desc);

  -- Online payments (card / Mobile Money through Flutterwave). One payment may cover orders from several shops.
  create table if not exists payments (
    id text primary key,                -- tx_ref sent to the payment provider
    user_id text not null references users(id) on delete cascade,
    order_ids text not null,            -- JSON
    amount real not null,
    currency text not null,
    status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
    provider_ref text,                  -- the provider's transaction id
    created_at text not null
  );

  -- Saligue Live: sellers stream video (LiveKit, see live.mjs) with chat, hearts, featured items and guests.
  create table if not exists lives (
    id text primary key,                -- also the LiveKit room name
    seller_id text not null references users(id) on delete cascade,
    title text not null,
    description text not null default '',
    status text not null default 'live' check (status in ('live', 'ended')),
    product_ids text not null default '[]', -- JSON: featured items
    pinned_product_id text,
    pinned_comment_id text,
    like_count integer not null default 0,
    peak_viewers integer not null default 0,
    muted text not null default '[]',   -- JSON: user ids who may not comment
    started_at text not null,
    ended_at text
  );
  create index if not exists lives_status on lives(status, started_at desc);

  create table if not exists live_comments (
    id text primary key,
    live_id text not null references lives(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    name text not null,
    text text not null,
    kind text not null default 'comment' check (kind in ('comment', 'question', 'join')),
    created_at text not null
  );
  create index if not exists live_comments_live on live_comments(live_id, created_at);

  -- Viewers asking to join the live on camera, and the host's answer.
  create table if not exists live_guests (
    live_id text not null references lives(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    status text not null check (status in ('requested', 'accepted', 'declined')),
    created_at text not null,
    primary key (live_id, user_id)
  );

  -- Community lessons: anyone with an account teaches fashion in a short video (up to 4 min 30 s).
  create table if not exists lessons (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    title text not null,
    description text not null default '',
    topic text not null,
    language text not null default 'en',
    video text,                          -- set once the upload is converted (video.mjs)
    poster text,
    duration integer,
    like_count integer not null default 0,
    view_count integer not null default 0,
    hidden integer not null default 0,   -- after reports, until reviewed
    created_at text not null
  );
  create index if not exists lessons_new on lessons(created_at);
  create table if not exists lesson_likes (
    lesson_id text not null references lessons(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    primary key (lesson_id, user_id)
  );
  create table if not exists lesson_reports (
    lesson_id text not null references lessons(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    reason text not null,
    created_at text not null,
    primary key (lesson_id, user_id)
  );

  -- What shoppers do with items (opened, watched, tried on, skipped…), for the For You feed (recommend.mjs).
  -- Recorded only when the shopper allowed personalisation in the cookie banner.
  create table if not exists interactions (
    user_id text not null references users(id) on delete cascade,
    product_id text not null references products(id) on delete cascade,
    kind text not null,                 -- view | dwell | wear | cart | message | share | skip
    weight real not null,
    created_at text not null
  );
  create index if not exists interactions_user on interactions(user_id, created_at desc);
  create index if not exists interactions_time on interactions(created_at);

  -- Shoppers following shops (counts toward creator monetization).
  create table if not exists follows (
    follower_id text not null references users(id) on delete cascade,
    seller_id text not null references users(id) on delete cascade,
    created_at text not null,
    primary key (follower_id, seller_id)
  );
  create index if not exists follows_seller on follows(seller_id, created_at);

  -- Saligue Ads: sellers promote an item for a budget; shown as "Sponsored" and billed per 1,000 views (ads.mjs).
  create table if not exists ad_campaigns (
    id text primary key,
    seller_id text not null references users(id) on delete cascade,
    product_id text not null references products(id) on delete cascade,
    headline text not null default '',
    budget real not null,               -- dollars
    spent real not null default 0,
    cpm real not null,                  -- dollars per 1,000 views, fixed when created
    days integer not null,
    placements text not null default '["feed","explore"]',
    status text not null default 'pending_payment'
      check (status in ('pending_payment', 'in_review', 'active', 'paused', 'completed', 'rejected')),
    payment_ref text,
    review_note text,
    impressions integer not null default 0,
    clicks integer not null default 0,
    starts_at text,
    ends_at text,
    created_at text not null
  );
  create index if not exists ad_campaigns_status on ad_campaigns(status);

  create table if not exists ad_stats (
    campaign_id text not null references ad_campaigns(id) on delete cascade,
    day text not null,
    impressions integer not null default 0,
    clicks integer not null default 0,
    spent real not null default 0,
    primary key (campaign_id, day)
  );

  -- Creator monetization: applications, and monthly earnings paid by Mobile Money.
  create table if not exists creators (
    user_id text primary key references users(id) on delete cascade,
    status text not null check (status in ('applied', 'approved', 'rejected', 'suspended')),
    momo_number text not null,
    momo_name text not null,
    note text,
    applied_at text not null,
    decided_at text
  );

  create table if not exists payouts (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    period text not null,               -- YYYY-MM
    amount real not null,               -- dollars
    breakdown text not null,            -- JSON: views, sales, followers, points, pool
    status text not null default 'pending' check (status in ('pending', 'paid')),
    reference text,
    paid_at text,
    created_at text not null,
    unique (user_id, period)
  );

  -- How often each item is opened per day, for the seller's dashboard.
  create table if not exists product_views (
    product_id text not null references products(id) on delete cascade,
    day text not null,                  -- YYYY-MM-DD
    views integer not null default 0,
    primary key (product_id, day)
  );
`);

// Columns added after the first release.
for (const [table, column, type] of [
  ['users', 'terms_accepted_at', 'text'], ['users', 'avatar', 'text'], ['users', 'bio', 'text'], ['users', 'admin', 'integer not null default 0'], ['products', 'hidden', 'integer not null default 0'], ['products', 'type', 'text'],
  // null stock = not tracked (always available)
  ['products', 'stock', 'integer'], ['products', 'rating_avg', 'real not null default 0'], ['products', 'rating_count', 'integer not null default 0'],
  ['orders', 'paid_at', 'text'], ['orders', 'payment_ref', 'text'], ['payments', 'campaign_id', 'text'], ['lives', 'chat_mode', "text not null default 'everyone'"], ['lives', 'slow_seconds', 'integer not null default 0'], ['lives', 'video_fit', "text not null default 'fit'"], ['lives', 'moderators', "text not null default '[]'"], ['lives', 'invited', "text not null default '[]'"],
  ['products', 'video', 'text'], ['products', 'video_poster', 'text'], ['products', 'video_duration', 'integer'], ['products', 'photo_type', "text not null default 'item'"],
]) {
  const exists = db.prepare(`select 1 from pragma_table_info('${table}') where name = ?`).get(column);
  if (!exists) db.exec(`alter table ${table} add column ${column} ${type}`);
}

export const now = () => new Date().toISOString();
export const json = (value) => (value === undefined || value === null ? null : JSON.stringify(value));
export const parse = (value) => (value ? JSON.parse(value) : null);

/** Runs several statements as one all-or-nothing change. */
export function transaction(fn) {
  db.exec('begin');
  try {
    const result = fn();
    db.exec('commit');
    return result;
  } catch (error) {
    db.exec('rollback');
    throw error;
  }
}
