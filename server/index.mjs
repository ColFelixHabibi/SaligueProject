// Saligue server: the app's own API and database (SQLite file), and the website itself, from one address.
//   npm run server          → http://localhost:8080
import http from 'node:http';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { db, json, now, parse, transaction } from './db.mjs';
import { sendEmail } from './mail.mjs';
import { REALISTIC_CATEGORIES, tryOn } from './tryon.mjs';
import { moveImagesToFiles, serveMedia, storeImage } from './media.mjs';

const PORT = Number(process.env.PORT || 8080);
const STATIC_DIR = resolve(process.env.SALIGUE_STATIC || 'out');
const MAX_BODY = 8 * 1024 * 1024; // product photos and sounds are sent inline

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => {
  throw new HttpError(status, code, message);
};

// ---------------------------------------------------------------------------
// Accounts and sessions
// ---------------------------------------------------------------------------

function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
}

function passwordMatches(password, stored) {
  if (!stored) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('insert into sessions (token, user_id, created_at) values (?, ?, ?)').run(token, userId, now());
  return token;
}

function tokenOf(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function userOf(req) {
  const token = tokenOf(req);
  if (!token) return null;
  return db.prepare('select u.* from sessions s join users u on u.id = s.user_id where s.token = ?').get(token) ?? null;
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    official: !!u.official,
    shop: parse(u.shop),
    isGuest: !!u.is_guest,
    createdAt: u.created_at,
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A guest who logs in to an existing account brings their cart, saves, likes and orders along.
function mergeGuestInto(guestId, accountId) {
  transaction(() => {
    db.prepare('update or ignore cart_items set user_id = ? where user_id = ?').run(accountId, guestId);
    db.prepare('update or ignore wishlists set user_id = ? where user_id = ?').run(accountId, guestId);
    db.prepare('update or ignore likes set user_id = ? where user_id = ?').run(accountId, guestId);
    // Likes the account already had: drop the guest's duplicate and its count.
    for (const { product_id } of db.prepare('select product_id from likes where user_id = ?').all(guestId)) {
      db.prepare('update products set like_count = max(0, like_count - 1) where id = ?').run(product_id);
    }
    db.prepare('update orders set buyer_id = ? where buyer_id = ?').run(accountId, guestId);
    db.prepare('update comments set user_id = ? where user_id = ?').run(accountId, guestId);
    db.prepare('delete from users where id = ? and is_guest = 1').run(guestId);
  });
}

// ---------------------------------------------------------------------------
// Live updates (Server-Sent Events): clients refresh what changed.
// ---------------------------------------------------------------------------

const listeners = new Set();
function broadcast(event, data = {}) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of listeners) res.write(message);
}

// ---------------------------------------------------------------------------
// Notifications: shown in the app (bell) and, when the account has an email, sent by email too.
// ---------------------------------------------------------------------------

const ORDER_STATUS_TEXT = {
  confirmed: 'was confirmed by the shop',
  shipped: 'is on its way',
  delivered: 'was delivered',
  cancelled: 'was cancelled',
};

function notify(userId, { type, title, body = '', link = null, email = true }) {
  if (!userId) return;
  db.prepare('insert into notifications (id, user_id, type, title, body, link, read, created_at) values (?, ?, ?, ?, ?, ?, 0, ?)')
    .run(randomUUID(), userId, type, title, body, link, now());
  // Clients refresh their own notifications; nothing about whose they are is sent to everyone.
  broadcast('notifications');
  if (!email) return;
  const account = db.prepare('select email, is_guest from users where id = ?').get(userId);
  if (account?.email && !account.is_guest) {
    sendEmail(account.email, { subject: title, lines: [body].filter(Boolean), button: link ? { label: 'Open Saligue', url: link } : undefined });
  }
}

const money = (n) => `$${Number(n).toFixed(2)}`;

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

function productOut(r) {
  const p = {
    id: r.id,
    name: r.name,
    price: r.price,
    image: r.image,
    cutout: r.cutout ?? undefined,
    embedding: parse(r.embedding) ?? undefined,
    category: r.category,
    seller: r.seller,
    sellerId: r.seller_id,
    sellerEmail: r.seller_email ?? undefined,
    status: r.status,
    description: r.description ?? undefined,
    size: r.size ?? undefined,
    color: r.color ?? undefined,
    brand: r.brand ?? undefined,
    condition: r.condition ?? undefined,
    contact: r.contact ?? undefined,
    shop: parse(r.shop) ?? undefined,
    official: !!r.official,
    likeCount: r.like_count,
    sound: parse(r.sound) ?? undefined,
    createdAt: r.created_at,
  };
  return p;
}

const PRODUCT_TEXT = ['name', 'image', 'cutout', 'category', 'seller', 'description', 'size', 'color', 'brand', 'condition', 'contact'];

function productFields(body) {
  const fields = {};
  for (const key of PRODUCT_TEXT) {
    if (body[key] !== undefined) fields[key] = body[key] === null ? null : String(body[key]);
  }
  if (body.sellerEmail !== undefined) fields.seller_email = body.sellerEmail;
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) fail(400, 'invalid_price', 'Enter a valid price.');
    fields.price = price;
  }
  if (body.status !== undefined) {
    if (!['active', 'archived', 'draft'].includes(body.status)) fail(400, 'invalid_status', 'Invalid status.');
    fields.status = body.status;
  }
  if (body.embedding !== undefined) fields.embedding = json(body.embedding);
  if (body.sound !== undefined) fields.sound = json(body.sound);
  if ((fields.image?.length ?? 0) > 1_500_000 || (fields.cutout?.length ?? 0) > 1_500_000) fail(413, 'too_large', 'This photo is too large.');
  // Photos are kept as files; the database stores their links.
  if (fields.image) fields.image = storeImage(fields.image);
  if (fields.cutout) fields.cutout = storeImage(fields.cutout);
  return fields;
}

function ownProduct(user, id) {
  const product = db.prepare('select * from products where id = ?').get(id);
  if (!product) fail(404, 'not_found', 'This item no longer exists.');
  if (product.seller_id !== user.id) fail(403, 'forbidden', 'Only the seller can change this item.');
  return product;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const PAYMENT_METHODS = ['mobile_money', 'cash_on_delivery', 'pickup'];
const ORDER_STATUSES = ['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'];

function orderOut(r) {
  return {
    id: r.id,
    buyerId: r.buyer_id,
    buyerName: r.buyer_name,
    buyerEmail: r.buyer_email,
    sellerId: r.seller_id,
    shop: parse(r.shop),
    items: parse(r.items),
    total: r.total,
    delivery: parse(r.delivery),
    paymentMethod: r.payment_method,
    paymentStatus: r.payment_status,
    status: r.status,
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler });

// Accounts
route('POST', '/api/auth/guest', () => {
  const id = randomUUID();
  db.prepare('insert into users (id, is_guest, created_at) values (?, 1, ?)').run(id, now());
  const user = db.prepare('select * from users where id = ?').get(id);
  return { token: createSession(id), user: publicUser(user) };
});

route('GET', '/api/auth/me', ({ user }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  return { user: publicUser(user) };
});

route('POST', '/api/auth/register', ({ req, user, body }) => {
  const name = String(body.name ?? '').trim().slice(0, 80);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const role = body.role === 'seller' ? 'seller' : 'buyer';
  if (!name) fail(400, 'missing_name', 'Please enter your name.');
  if (!EMAIL.test(email)) fail(400, 'invalid_email', 'Please enter a valid email address.');
  if (password.length < 6) fail(400, 'weak_password', 'Password must be at least 6 characters.');
  if (body.acceptTerms !== true) fail(400, 'terms_not_accepted', 'Please accept the Terms of Service and Privacy Policy.');
  if (db.prepare('select 1 from users where email = ?').get(email)) fail(409, 'user_already_exists', 'An account with this email already exists.');

  // A guest keeps everything they did: the guest account becomes the real one.
  let id = user?.is_guest ? user.id : null;
  if (id) {
    db.prepare('update users set email = ?, password_hash = ?, display_name = ?, role = ?, is_guest = 0, terms_accepted_at = ? where id = ?')
      .run(email, hashPassword(password), name, role, now(), id);
  } else {
    id = randomUUID();
    db.prepare('insert into users (id, email, password_hash, display_name, role, terms_accepted_at, created_at) values (?, ?, ?, ?, ?, ?, ?)')
      .run(id, email, hashPassword(password), name, role, now(), now());
  }
  welcome(id, name, role);
  return { token: id === user?.id ? tokenOf(req) : createSession(id), user: publicUser(db.prepare('select * from users where id = ?').get(id)), isNew: true };
});

function welcome(userId, name, role) {
  notify(userId, {
    type: 'account',
    title: `Welcome to Saligue, ${name}!`,
    body: role === 'seller'
      ? 'Your seller account is ready. Add your shop address, then list your first item so buyers can wear it in the Fitting Room.'
      : 'Your account is ready. Open the Fitting Room to see yourself in complete outfits before you buy.',
    link: role === 'seller' ? '/sell' : '/mirror',
  });
}

// Password recovery: a one-hour link sent by email. The answer is the same whether or not the email exists.
route('POST', '/api/auth/forgot', ({ body }) => {
  const email = String(body.email ?? '').trim().toLowerCase();
  // Limits reset emails to the same address too.
  if (tooManyAttempts(`reset:${email}`)) return { ok: true };
  noteFailedAttempt(`reset:${email}`);
  const account = EMAIL.test(email) ? db.prepare('select * from users where email = ? and is_guest = 0').get(email) : null;
  if (account) {
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    db.prepare('delete from password_resets where user_id = ? or expires_at < ?').run(account.id, now());
    db.prepare('insert into password_resets (token_hash, user_id, expires_at) values (?, ?, ?)')
      .run(hash, account.id, new Date(Date.now() + 3_600_000).toISOString());
    sendEmail(account.email, {
      subject: 'Reset your Saligue password',
      lines: [
        `Hi ${account.display_name || ''}, we got a request to reset your password.`,
        'The link works for one hour. If you did not ask for this, ignore this email; your password stays the same.',
      ],
      button: { label: 'Choose a new password', url: `/reset-password?token=${token}` },
    });
  }
  return { ok: true };
});

route('POST', '/api/auth/reset', ({ user, body }) => {
  const hash = createHash('sha256').update(String(body.token ?? '')).digest('hex');
  const reset = db.prepare('select * from password_resets where token_hash = ?').get(hash);
  if (!reset || reset.expires_at < now()) fail(400, 'invalid_reset', 'This link has expired. Ask for a new one.');
  const password = String(body.password ?? '');
  if (password.length < 6) fail(400, 'weak_password', 'Password must be at least 6 characters.');
  transaction(() => {
    db.prepare('update users set password_hash = ? where id = ?').run(hashPassword(password), reset.user_id);
    db.prepare('delete from password_resets where user_id = ?').run(reset.user_id);
    // Sign out everywhere else: whoever knew the old password loses access.
    db.prepare('delete from sessions where user_id = ?').run(reset.user_id);
  });
  if (user?.is_guest && user.id !== reset.user_id) mergeGuestInto(user.id, reset.user_id);
  notify(reset.user_id, { type: 'account', title: 'Your password was changed', body: 'If this was not you, reset your password now and contact Saligue support.', link: '/my-account/settings' });
  return { token: createSession(reset.user_id), user: publicUser(db.prepare('select * from users where id = ?').get(reset.user_id)) };
});

// Password guessing: at most 10 failed attempts per email in 15 minutes.
const failedLogins = new Map();
function tooManyAttempts(key) {
  const recent = (failedLogins.get(key) ?? []).filter((t) => t > Date.now() - 15 * 60_000);
  failedLogins.set(key, recent);
  return recent.length >= 10;
}
const noteFailedAttempt = (key) => failedLogins.set(key, [...(failedLogins.get(key) ?? []), Date.now()]);

route('POST', '/api/auth/login', ({ user, body }) => {
  const email = String(body.email ?? '').trim().toLowerCase();
  if (tooManyAttempts(email)) fail(429, 'too_many_attempts', 'Too many tries. Wait 15 minutes or reset your password.');
  const account = db.prepare('select * from users where email = ?').get(email);
  if (!account || !passwordMatches(String(body.password ?? ''), account.password_hash)) {
    noteFailedAttempt(email);
    fail(401, 'invalid_credentials', 'Email or password is incorrect.');
  }
  failedLogins.delete(email);
  if (body.role === 'seller' || body.role === 'buyer') db.prepare('update users set role = ? where id = ?').run(body.role, account.id);
  if (user?.is_guest && user.id !== account.id) mergeGuestInto(user.id, account.id);
  return { token: createSession(account.id), user: publicUser(db.prepare('select * from users where id = ?').get(account.id)) };
});

// Google sign-in. The OAuth client ID comes from GOOGLE_CLIENT_ID or `node server/admin.mjs google <client id>`.
const googleClientId = () =>
  process.env.GOOGLE_CLIENT_ID || parse(db.prepare("select value from app_config where key = 'google'").get()?.value)?.clientId || null;

route('GET', '/api/auth/google', () => ({ clientId: googleClientId() }));

route('POST', '/api/auth/google', async ({ req, user, body }) => {
  const clientId = googleClientId();
  if (!clientId) fail(503, 'google_not_configured', 'Google sign-in is not switched on yet.');
  // Google checks the signature and expiry of the ID token for us.
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(body.credential ?? ''))}`);
  const info = response.ok ? await response.json() : null;
  if (!info || info.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) {
    fail(401, 'invalid_credentials', 'Google sign-in failed. Please try again.');
  }
  if (info.email_verified !== 'true' && info.email_verified !== true) fail(401, 'unverified_email', 'Your Google email is not verified.');
  const email = String(info.email).toLowerCase();
  const name = String(info.name || email.split('@')[0]).slice(0, 80);
  const role = body.role === 'seller' || body.role === 'buyer' ? body.role : null;

  const account = db.prepare('select * from users where email = ?').get(email);
  if (account) {
    if (role) db.prepare('update users set role = ? where id = ?').run(role, account.id);
    if (user?.is_guest && user.id !== account.id) mergeGuestInto(user.id, account.id);
    return { token: createSession(account.id), user: publicUser(db.prepare('select * from users where id = ?').get(account.id)) };
  }
  // New account. A guest keeps everything they did: the guest account becomes the real one.
  // The Google button is shown with "By continuing you accept the Terms and Privacy Policy".
  if (user?.is_guest) {
    db.prepare('update users set email = ?, display_name = ?, role = ?, is_guest = 0, terms_accepted_at = ? where id = ?').run(email, name, role ?? 'buyer', now(), user.id);
    welcome(user.id, name, role ?? 'buyer');
    return { token: tokenOf(req), user: publicUser(db.prepare('select * from users where id = ?').get(user.id)), isNew: true };
  }
  const id = randomUUID();
  db.prepare('insert into users (id, email, display_name, role, terms_accepted_at, created_at) values (?, ?, ?, ?, ?, ?)').run(id, email, name, role ?? 'buyer', now(), now());
  welcome(id, name, role ?? 'buyer');
  return { token: createSession(id), user: publicUser(db.prepare('select * from users where id = ?').get(id)), isNew: true };
});

route('POST', '/api/auth/logout', ({ req }) => {
  const token = tokenOf(req);
  if (token) db.prepare('delete from sessions where token = ?').run(token);
  return { ok: true };
});

route('PATCH', '/api/auth/me', ({ user, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  if (body.displayName !== undefined) db.prepare('update users set display_name = ? where id = ?').run(String(body.displayName).slice(0, 80), user.id);
  if (body.role === 'seller' || body.role === 'buyer') db.prepare('update users set role = ? where id = ?').run(body.role, user.id);
  if (body.password !== undefined) {
    if (user.is_guest) fail(403, 'forbidden', 'Create an account first.');
    // Accounts made with Google have no password yet and can set one.
    if (user.password_hash && !passwordMatches(String(body.currentPassword ?? ''), user.password_hash)) fail(401, 'invalid_credentials', 'Your current password is incorrect.');
    if (String(body.password).length < 6) fail(400, 'weak_password', 'Password must be at least 6 characters.');
    db.prepare('update users set password_hash = ? where id = ?').run(hashPassword(String(body.password)), user.id);
    notify(user.id, { type: 'account', title: 'Your password was changed', body: 'If this was not you, reset your password now and contact Saligue support.', link: '/my-account/settings' });
  }
  if (body.shop !== undefined) {
    const shop = body.shop;
    if (!shop?.name || !shop.phone || !shop.country || !shop.city || !shop.street) fail(400, 'incomplete_shop', 'Shop name, phone, country, city and street are required.');
    transaction(() => {
      db.prepare('update users set shop = ? where id = ?').run(json(shop), user.id);
      // Keep the address on already-listed items up to date.
      db.prepare('update products set shop = ? where seller_id = ?').run(json(shop), user.id);
    });
    broadcast('products');
  }
  return { user: publicUser(db.prepare('select * from users where id = ?').get(user.id)) };
});

// Products
route('GET', '/api/products', () => db.prepare('select * from products order by created_at desc').all().map(productOut));

route('POST', '/api/products', ({ user, body }) => {
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Create an account to sell items.');
  const fields = productFields(body);
  if (!fields.name || fields.price === undefined || !fields.image || !fields.category) fail(400, 'incomplete_product', 'Name, price, photo and category are required.');
  const id = randomUUID();
  db.prepare(`insert into products (id, name, price, image, cutout, embedding, category, seller, seller_id, seller_email, status,
      description, size, color, brand, condition, contact, shop, official, sound, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, fields.name, fields.price, fields.image, fields.cutout ?? null, fields.embedding ?? null, fields.category,
    fields.seller || user.display_name || 'Seller', user.id, user.email, fields.description ?? null, fields.size ?? null,
    fields.color ?? null, fields.brand ?? null, fields.condition ?? null, fields.contact ?? null, user.shop, user.official, fields.sound ?? null, now()
  );
  broadcast('products');
  return { id };
});

route('PATCH', '/api/products/([\\w-]+)', ({ user, params, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  ownProduct(user, params[0]);
  const fields = productFields(body);
  const keys = Object.keys(fields);
  if (keys.length) {
    db.prepare(`update products set ${keys.map((k) => `${k} = ?`).join(', ')} where id = ?`).run(...keys.map((k) => fields[k]), params[0]);
    broadcast('products');
  }
  return { ok: true };
});

route('DELETE', '/api/products/([\\w-]+)', ({ user, params }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  ownProduct(user, params[0]);
  db.prepare('delete from products where id = ?').run(params[0]);
  broadcast('products');
  return { ok: true };
});

// Likes (public count) — anyone with a session, guests included.
route('POST', '/api/products/([\\w-]+)/like', ({ user, params }) => {
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  const id = params[0];
  if (!db.prepare('select 1 from products where id = ?').get(id)) fail(404, 'not_found', 'This item no longer exists.');
  const liked = transaction(() => {
    if (db.prepare('select 1 from likes where product_id = ? and user_id = ?').get(id, user.id)) {
      db.prepare('delete from likes where product_id = ? and user_id = ?').run(id, user.id);
      db.prepare('update products set like_count = max(0, like_count - 1) where id = ?').run(id);
      return false;
    }
    db.prepare('insert into likes (product_id, user_id, created_at) values (?, ?, ?)').run(id, user.id, now());
    db.prepare('update products set like_count = like_count + 1 where id = ?').run(id);
    return true;
  });
  broadcast('products');
  return { liked, likeCount: db.prepare('select like_count from products where id = ?').get(id).like_count };
});

route('GET', '/api/me/likes', ({ user }) => (user ? db.prepare('select product_id from likes where user_id = ?').all(user.id).map((r) => r.product_id) : []));

// Comments
route('GET', '/api/products/([\\w-]+)/comments', ({ params }) =>
  db.prepare('select * from comments where product_id = ? order by created_at desc limit 50').all(params[0])
    .map((r) => ({ id: r.id, uid: r.user_id, name: r.name, text: r.text, createdAt: r.created_at })));

route('POST', '/api/products/([\\w-]+)/comments', ({ user, params, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  const text = String(body.text ?? '').trim().slice(0, 500);
  if (!text) fail(400, 'empty_comment', 'Write a comment first.');
  const product = db.prepare('select id, name, seller_id, official from products where id = ?').get(params[0]);
  if (!product) fail(404, 'not_found', 'This item no longer exists.');
  const name = user.is_guest ? 'Guest' : user.display_name || user.email?.split('@')[0] || 'Saligue user';
  const id = randomUUID();
  db.prepare('insert into comments (id, product_id, user_id, name, text, created_at) values (?, ?, ?, ?, ?, ?)').run(id, params[0], user.id, name.slice(0, 60), text, now());
  broadcast('comments', { productId: params[0] });
  if (product.seller_id !== user.id) {
    notify(product.seller_id, {
      type: 'message',
      title: `New comment on ${product.name}`,
      body: `${name.slice(0, 60)}: "${text.slice(0, 140)}"`,
      link: product.official ? `/indeciana?item=${product.id}` : `/product?id=${product.id}`,
      email: false,
    });
  }
  return { id };
});

route('DELETE', '/api/comments/([\\w-]+)', ({ user, params }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  const comment = db.prepare('select c.*, p.seller_id from comments c join products p on p.id = c.product_id where c.id = ?').get(params[0]);
  if (!comment) return { ok: true };
  if (comment.user_id !== user.id && comment.seller_id !== user.id) fail(403, 'forbidden', 'You can only delete your own comments.');
  db.prepare('delete from comments where id = ?').run(params[0]);
  broadcast('comments', { productId: comment.product_id });
  return { ok: true };
});

// Item sounds
route('GET', '/api/products/([\\w-]+)/sound', ({ params }) => {
  const row = db.prepare('select data, name, duration from product_audio where product_id = ?').get(params[0]);
  if (!row) fail(404, 'not_found', 'This item has no sound.');
  return row;
});

route('PUT', '/api/products/([\\w-]+)/sound', ({ user, params, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  ownProduct(user, params[0]);
  const data = String(body.data ?? '');
  if (!data.startsWith('data:audio/') || data.length > 1_200_000) fail(400, 'invalid_sound', 'This sound could not be saved.');
  const name = String(body.name ?? 'Sound').slice(0, 80);
  const duration = Math.min(30, Math.max(0, Number(body.duration) || 0));
  transaction(() => {
    db.prepare('insert into product_audio (product_id, data, name, duration) values (?, ?, ?, ?) on conflict(product_id) do update set data = excluded.data, name = excluded.name, duration = excluded.duration')
      .run(params[0], data, name, duration);
    db.prepare('update products set sound = ? where id = ?').run(json({ name, duration: Math.round(duration) }), params[0]);
  });
  broadcast('products');
  return { ok: true };
});

// Cart and saved items (per account; guests have accounts too)
route('GET', '/api/me/cart', ({ user }) =>
  Object.fromEntries(user ? db.prepare('select product_id, quantity from cart_items where user_id = ?').all(user.id).map((r) => [r.product_id, r.quantity]) : []));

route('PUT', '/api/me/cart/([\\w-]+)', ({ user, params, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  const quantity = Math.floor(Number(body.quantity) || 0);
  if (quantity <= 0) db.prepare('delete from cart_items where user_id = ? and product_id = ?').run(user.id, params[0]);
  else {
    if (!db.prepare('select 1 from products where id = ?').get(params[0])) fail(404, 'not_found', 'This item no longer exists.');
    db.prepare('insert into cart_items (user_id, product_id, quantity) values (?, ?, ?) on conflict(user_id, product_id) do update set quantity = excluded.quantity')
      .run(user.id, params[0], Math.min(99, quantity));
  }
  return { ok: true };
});

route('DELETE', '/api/me/cart', ({ user }) => {
  if (user) db.prepare('delete from cart_items where user_id = ?').run(user.id);
  return { ok: true };
});

route('GET', '/api/me/wishlist', ({ user }) => (user ? db.prepare('select product_id from wishlists where user_id = ? order by added_at desc').all(user.id).map((r) => r.product_id) : []));

route('PUT', '/api/me/wishlist/([\\w-]+)', ({ user, params }) => {
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  if (!db.prepare('select 1 from products where id = ?').get(params[0])) fail(404, 'not_found', 'This item no longer exists.');
  db.prepare('insert or ignore into wishlists (user_id, product_id, added_at) values (?, ?, ?)').run(user.id, params[0], now());
  return { ok: true };
});

route('DELETE', '/api/me/wishlist/([\\w-]+)', ({ user, params }) => {
  if (user) db.prepare('delete from wishlists where user_id = ? and product_id = ?').run(user.id, params[0]);
  return { ok: true };
});

// Orders: one per shop; prices always come from the database.
route('POST', '/api/orders', ({ user, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  const lines = Array.isArray(body.items) ? body.items : [];
  if (!lines.length || lines.length > 50) fail(400, 'invalid_order', 'Your cart is empty.');
  if (!PAYMENT_METHODS.includes(body.paymentMethod)) fail(400, 'invalid_payment', 'Choose a payment method.');
  const delivery = body.delivery ?? {};
  if (!delivery.fullName || !delivery.phone || !delivery.city || !delivery.street) fail(400, 'incomplete_delivery', 'Please fill in the delivery address.');

  const groups = new Map();
  for (const line of lines) {
    const quantity = Math.floor(Number(line.quantity));
    if (!(quantity >= 1 && quantity <= 99)) fail(400, 'invalid_quantity', 'Invalid quantity.');
    const product = db.prepare("select * from products where id = ? and status = 'active'").get(String(line.productId));
    if (!product) fail(409, 'unavailable', 'An item in your cart is no longer available.');
    const group = groups.get(product.seller_id) ?? { shop: product.shop, items: [], total: 0 };
    group.items.push({ productId: product.id, name: product.name, price: product.price, quantity });
    group.total += product.price * quantity;
    groups.set(product.seller_id, group);
  }

  const ids = transaction(() =>
    [...groups].map(([sellerId, group]) => {
      const id = randomUUID();
      db.prepare(`insert into orders (id, buyer_id, buyer_name, buyer_email, seller_id, shop, items, total, delivery, payment_method, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.id, user.display_name || String(delivery.fullName), user.email || '', sellerId, group.shop,
        json(group.items), Math.round(group.total * 100) / 100, json(delivery), body.paymentMethod, now()
      );
      return { id, sellerId, group };
    })
  );
  const payment = { mobile_money: 'Mobile Money', cash_on_delivery: 'cash on delivery', pickup: 'pay at pickup' }[body.paymentMethod];
  for (const { id, sellerId, group } of ids) {
    const shopName = parse(group.shop)?.name || 'the shop';
    const list = group.items.map((i) => `${i.quantity} x ${i.name}`).join(', ');
    notify(sellerId, {
      type: 'sale',
      title: `New order #${id.slice(0, 6).toUpperCase()} - ${money(group.total)}`,
      body: `${delivery.fullName} (${delivery.phone}) ordered ${list}. Payment: ${payment}. Deliver to ${[delivery.street, delivery.city].join(', ')}.`,
      link: '/dashboard/orders',
    });
    notify(user.id, {
      type: 'order',
      title: `Order #${id.slice(0, 6).toUpperCase()} placed - ${money(group.total)}`,
      body: `${shopName} received your order for ${list}. Payment: ${payment}. You will be notified when it is confirmed.`,
      link: '/orders',
    });
  }
  broadcast('orders');
  return { ids: ids.map((o) => o.id) };
});

route('GET', '/api/orders', ({ user, url }) => {
  if (!user) return [];
  const column = url.searchParams.get('as') === 'seller' ? 'seller_id' : 'buyer_id';
  return db.prepare(`select * from orders where ${column} = ? order by created_at desc`).all(user.id).map(orderOut);
});

route('PATCH', '/api/orders/([\\w-]+)', ({ user, params, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  const order = db.prepare('select * from orders where id = ?').get(params[0]);
  if (!order) fail(404, 'not_found', 'Order not found.');
  if (order.seller_id === user.id) {
    if (body.status !== undefined && !ORDER_STATUSES.includes(body.status)) fail(400, 'invalid_status', 'Invalid status.');
    if (body.paymentStatus !== undefined && !['unpaid', 'paid'].includes(body.paymentStatus)) fail(400, 'invalid_status', 'Invalid payment status.');
    db.prepare('update orders set status = coalesce(?, status), payment_status = coalesce(?, payment_status) where id = ?')
      .run(body.status ?? null, body.paymentStatus ?? null, order.id);
    const code = order.id.slice(0, 6).toUpperCase();
    if (body.status && body.status !== order.status && ORDER_STATUS_TEXT[body.status]) {
      notify(order.buyer_id, { type: 'order', title: `Your order #${code} ${ORDER_STATUS_TEXT[body.status]}`, body: `Total ${money(order.total)}.`, link: '/orders' });
    }
    if (body.paymentStatus === 'paid' && order.payment_status !== 'paid') {
      notify(order.buyer_id, { type: 'order', title: `Payment received for order #${code}`, body: `The shop confirmed your payment of ${money(order.total)}. Thank you!`, link: '/orders' });
    }
  } else if (order.buyer_id === user.id) {
    if (order.status !== 'placed' || body.status !== 'cancelled' || body.paymentStatus !== undefined) fail(403, 'forbidden', 'You can only cancel an order that has not been confirmed.');
    db.prepare("update orders set status = 'cancelled' where id = ?").run(order.id);
    notify(order.seller_id, { type: 'sale', title: `Order #${order.id.slice(0, 6).toUpperCase()} was cancelled by the buyer`, body: `${order.buyer_name} cancelled the order (${money(order.total)}).`, link: '/dashboard/orders' });
  } else fail(403, 'forbidden', 'This is not your order.');
  broadcast('orders');
  return { ok: true };
});

// Notifications of the signed-in account
route('GET', '/api/me/notifications', ({ user }) => {
  if (!user) return [];
  return db.prepare('select * from notifications where user_id = ? order by created_at desc limit 100').all(user.id).map((n) => ({
    id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, read: !!n.read, createdAt: n.created_at,
  }));
});

route('POST', '/api/me/notifications/read', ({ user, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  if (body.id) db.prepare('update notifications set read = 1 where id = ? and user_id = ?').run(String(body.id), user.id);
  else db.prepare('update notifications set read = 1 where user_id = ?').run(user.id);
  return { ok: true };
});

// Support requests
route('POST', '/api/support', ({ user, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  const message = String(body.message ?? '').trim();
  if (!body.subject || !message) fail(400, 'incomplete', 'Please select a subject and write a message.');
  db.prepare('insert into support_requests (id, user_id, name, email, contact, subject, message, source, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), user.id, String(body.name ?? ''), String(body.email ?? ''), String(body.contact ?? ''), String(body.subject), message.slice(0, 5000), String(body.source ?? ''), now());
  return { ok: true };
});

// App settings (e.g. the Saligue AI Studio address), set by INDECIANA.
route('GET', '/api/config/([\\w-]+)', ({ params }) => parse(db.prepare('select value from app_config where key = ?').get(params[0])?.value));
route('PUT', '/api/config/([\\w-]+)', ({ user, params, body }) => {
  if (!user?.official) fail(403, 'forbidden', 'Only INDECIANA can change app settings.');
  db.prepare('insert into app_config (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(params[0], json(body));
  return { ok: true };
});

// Realistic try-on (see tryon.mjs). A few runs per account per hour, since the free AI has a daily limit.
const tryOnRuns = new Map();
route('GET', '/api/ai/tryon', () => ({ available: true, categories: REALISTIC_CATEGORIES }));
route('POST', '/api/ai/tryon', async ({ user, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  if (!REALISTIC_CATEGORIES.includes(body.category)) fail(400, 'unsupported', 'Realistic try-on works for tops, jackets, trousers and dresses.');
  const hour = Date.now() - 3_600_000;
  const recent = (tryOnRuns.get(user.id) ?? []).filter((t) => t > hour);
  if (recent.length >= 20) fail(429, 'too_many', 'You have made many realistic looks this hour. Try again a bit later.');
  tryOnRuns.set(user.id, [...recent, Date.now()]);
  try {
    return { image: await tryOn(body.person, body.garment, body.category) };
  } catch (error) {
    if (error.cause) console.error('Realistic try-on failed:', error.cause?.message ?? error.cause);
    fail(error.status ?? 502, 'tryon_failed', error.message);
  }
});

route('GET', '/api/health', () => ({ ok: true, products: db.prepare('select count(*) as n from products').get().n }));

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream', '.task': 'application/octet-stream',
};

function serveStatic(req, res, pathname) {
  const target = normalize(join(STATIC_DIR, decodeURIComponent(pathname)));
  if (!target.startsWith(STATIC_DIR + sep) && target !== STATIC_DIR) return send(res, 400, 'Bad path');
  let file = target;
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  else if (!existsSync(file) && !extname(file)) file = join(target, 'index.html');
  let status = 200;
  if (!existsSync(file)) {
    file = join(STATIC_DIR, '404.html');
    status = 404;
    if (!existsSync(file)) return send(res, 404, 'Not found');
  }
  const immutable = pathname.includes('/_next/static/');
  res.writeHead(status, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

function send(res, status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'too_large', 'This upload is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolveBody({});
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'bad_request', 'Invalid request.'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const isApi = url.pathname.startsWith('/api/');
  if (isApi) {
    // The website may be served from elsewhere (e.g. GitHub Pages) and call this server.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return send(res, 204, '');
  }

  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    listeners.add(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      listeners.delete(res);
    });
    return;
  }

  if (url.pathname.startsWith('/media/')) return serveMedia(res, url.pathname);
  if (!isApi) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, url.pathname);
  }

  try {
    const match = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
    if (!match) fail(404, 'not_found', 'Not found.');
    const params = url.pathname.match(match.pattern).slice(1);
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const result = await match.handler({ req, res, url, params, body, user: userOf(req) });
    send(res, 200, result ?? null);
  } catch (error) {
    if (error instanceof HttpError) return send(res, error.status, { error: { code: error.code, message: error.message } });
    console.error(error);
    send(res, 500, { error: { code: 'server_error', message: 'Something went wrong. Please try again.' } });
  }
});

const moved = moveImagesToFiles();
if (moved) console.log(`Moved the photos of ${moved} products into files.`);

server.listen(PORT, () => {
  console.log(`Saligue is running on http://localhost:${PORT}  (database: ${resolve(process.env.SALIGUE_DATA || 'data')}/saligue.db)`);
});
