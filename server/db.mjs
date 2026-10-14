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
`);

// Columns added after the first release.
for (const [table, column, type] of [['users', 'terms_accepted_at', 'text'], ['products', 'hidden', 'integer not null default 0'], ['products', 'type', 'text']]) {
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
