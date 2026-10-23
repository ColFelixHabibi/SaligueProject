// Saligue server: the app's own API and database (SQLite file), and the website itself, from one address.
//   npm run server          → http://localhost:8080
import http from 'node:http';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { db, json, now, parse, transaction } from './db.mjs';
import { mailConfigured, mailFrom, sendEmail, sendEmailNow, siteUrl, smtpUrlFor, verifyMailAccount } from './mail.mjs';
import { findByReference, paymentSettings, paymentsEnabled, startCheckout, toCharge, verifyTransaction, webhookIsGenuine } from './payments.mjs';
import { REALISTIC_CATEGORIES, checkOwnAi, clearResting, falKey, hfToken, ownAi, tryOn, unlimitedTryOn } from './tryon.mjs';
import { moveImagesToFiles, serveMedia, storeImage } from './media.mjs';
import { processVideo, receiveUpload } from './video.mjs';
import { AUTO_LANGUAGES, captionMissing, captionsAvailable, cuesToVtt, enqueueCaptions, storeVtt, textToVtt } from './captions.mjs';
import { TYPES as FASHION_TYPES, checkPhoto, notFashionWord, warmUpFashionCheck } from './fashion.mjs';
import { learn, productsChanged } from './learn.mjs';
import { accessToken, closeRoom, liveSettings, removeParticipant } from './live.mjs';
import { INTERACTION_WEIGHTS, feedFor, train } from './recommend.mjs';
import { adIncome, adSettings, campaignOut, closeMonth, earnings, eligibility, expireCampaigns, pickAds, recordAdEvents, requirements, startCampaign } from './ads.mjs';

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

// Sessions last 60 days. The app sends the token in the Authorization header; the same token is also kept in
// an HttpOnly cookie (scripts can't read it), which signs in live updates and works when storage is blocked.
const SESSION_DAYS = 60;
const COOKIE = 'saligue_session';

function cookieToken(req) {
  const match = /(?:^|;\s*)saligue_session=([\w-]+)/.exec(req.headers.cookie || '');
  return match ? match[1] : null;
}

function tokenOf(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : cookieToken(req);
}

function userOf(req, token = tokenOf(req)) {
  if (!token) return null;
  const since = new Date(Date.now() - SESSION_DAYS * 86_400_000).toISOString();
  // Suspended accounts (Admin → Accounts) can't use the app until an admin lifts it.
  return db.prepare('select u.* from sessions s join users u on u.id = s.user_id where s.token = ? and s.created_at > ? and u.suspended = 0').get(token, since) ?? null;
}

function isHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted || siteUrl().startsWith('https://');
}

function sessionCookie(req, token) {
  const secure = isHttps(req) ? '; Secure' : '';
  return token
    ? `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure}`
    : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    official: !!u.official,
    // Runs the platform (Platform settings: email, payments, try-on). Set with `node server/admin.mjs admin <email>`.
    admin: !!u.admin,
    // 1 = main admin (everything, manages admins); 2 = sub-admin with the rights in adminPerms.
    adminLevel: u.admin_level ?? 0,
    adminPerms: u.admin_level === 1 ? Object.keys(ADMIN_PERMS) : parse(u.admin_perms) ?? [],
    shop: parse(u.shop),
    // Profile photo (/media/… link); sellers need one before listing, it is shown with their shop.
    avatar: u.avatar ?? null,
    // Profile bio for people who aren't shops (a shop's bio is its description, shop.bio).
    bio: u.bio ?? null,
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

// Each listener knows whose app it is (when signed in), so private events reach only that account.
const listeners = new Map(); // res → user id or null
function broadcast(event, data = {}) {
  if (event === 'products') productsChanged();
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of listeners.keys()) res.write(message);
}

/** Sends an event only to the apps of the given accounts (e.g. a new chat message). */
function sendTo(userIds, event, data = {}) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [res, userId] of listeners) if (userId && userIds.includes(userId)) res.write(message);
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
    type: r.type ?? undefined,
    seller: r.seller,
    sellerId: r.seller_id,
    sellerAvatar: r.seller_avatar ?? undefined,
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
    // Hidden from shoppers after several reports; only its seller still sees it.
    hidden: !!r.hidden,
    likeCount: r.like_count,
    sound: parse(r.sound) ?? undefined,
    // null: the seller doesn't track stock.
    stock: r.stock ?? null,
    // Short video (up to 1 min 30 s) with its cover picture, and whether the photo shows someone wearing the item.
    video: r.video ?? undefined,
    videoPoster: r.video_poster ?? undefined,
    videoDuration: r.video_duration ?? undefined,
    photoType: r.photo_type === 'worn' ? 'worn' : 'item',
    rating: r.rating_count ? Math.round(r.rating_avg * 10) / 10 : 0,
    ratingCount: r.rating_count ?? 0,
    createdAt: r.created_at,
  };
  return p;
}

const PRODUCT_TEXT = ['name', 'image', 'cutout', 'category', 'type', 'seller', 'description', 'size', 'color', 'brand', 'condition', 'contact'];

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
  if (body.photoType !== undefined) fields.photo_type = body.photoType === 'worn' ? 'worn' : 'item';
  if (body.stock !== undefined) {
    const stock = body.stock === null || body.stock === '' ? null : Math.floor(Number(body.stock));
    if (stock !== null && !(stock >= 0 && stock <= 100_000)) fail(400, 'invalid_stock', 'Enter how many you have in stock (0 or more).');
    fields.stock = stock;
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

// online: card or Mobile Money on Flutterwave's page (payments.mjs), confirmed automatically.
const PAYMENT_METHODS = ['online', 'mobile_money', 'cash_on_delivery', 'pickup'];
const PAYMENT_LABELS = { online: 'paid online (card / Mobile Money)', mobile_money: 'Mobile Money to the shop', cash_on_delivery: 'cash on delivery', pickup: 'pay at pickup' };

/** Puts the items of a cancelled order back in stock. */
function restock(order) {
  for (const item of parse(order.items) ?? []) {
    db.prepare('update products set stock = stock + ? where id = ? and stock is not null').run(item.quantity, item.productId);
  }
}
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
    paidAt: r.paid_at ?? null,
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
  if (account?.suspended && passwordMatches(String(body.password ?? ''), account.password_hash)) fail(403, 'suspended', `This account is suspended${account.suspend_reason ? `: ${account.suspend_reason}` : ''}. Contact Saligue support.`);
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

route('POST', '/api/auth/logout', ({ req, res }) => {
  const token = tokenOf(req);
  if (token) db.prepare('delete from sessions where token = ?').run(token);
  res.setHeader('Set-Cookie', sessionCookie(req, null));
  return { ok: true };
});

route('PATCH', '/api/auth/me', ({ user, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  if (body.displayName !== undefined) db.prepare('update users set display_name = ? where id = ?').run(String(body.displayName).slice(0, 80), user.id);
  if (body.role === 'seller' || body.role === 'buyer') db.prepare('update users set role = ? where id = ?').run(body.role, user.id);
  if (body.avatar !== undefined) {
    if (user.is_guest) fail(403, 'forbidden', 'Create an account first.');
    const avatar = body.avatar === null ? null : String(body.avatar);
    if (avatar !== null && (!/^data:image\/(jpeg|png|webp);base64,/.test(avatar) || avatar.length > 1_000_000)) fail(400, 'invalid_image', 'Use a JPG, PNG or WebP photo under 700 KB.');
    db.prepare('update users set avatar = ? where id = ?').run(avatar && storeImage(avatar), user.id);
    broadcast('products');
  }
  if (body.password !== undefined) {
    if (user.is_guest) fail(403, 'forbidden', 'Create an account first.');
    // Accounts made with Google have no password yet and can set one.
    if (user.password_hash && !passwordMatches(String(body.currentPassword ?? ''), user.password_hash)) fail(401, 'invalid_credentials', 'Your current password is incorrect.');
    if (String(body.password).length < 6) fail(400, 'weak_password', 'Password must be at least 6 characters.');
    db.prepare('update users set password_hash = ? where id = ?').run(hashPassword(String(body.password)), user.id);
    notify(user.id, { type: 'account', title: 'Your password was changed', body: 'If this was not you, reset your password now and contact Saligue support.', link: '/my-account/settings' });
  }
  if (body.bio !== undefined) db.prepare('update users set bio = ? where id = ?').run(String(body.bio ?? '').trim().slice(0, 300) || null, user.id);
  if (body.shop !== undefined) {
    // Known fields only, each a short text; the description is the shop's bio on its profile.
    const limits = { name: 80, phone: 30, whatsapp: 30, country: 60, city: 60, district: 80, street: 160, landmark: 120, mapUrl: 500, hours: 120, bio: 300 };
    const shop = Object.fromEntries(Object.entries(limits).map(([k, max]) => [k, String(body.shop?.[k] ?? '').trim().slice(0, max)]).filter(([, v]) => v));
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
route('GET', '/api/products', ({ user }) =>
  db.prepare('select p.*, u.avatar as seller_avatar from products p left join users u on u.id = p.seller_id where p.hidden = 0 or p.seller_id = ? order by p.created_at desc')
    .all(user?.id ?? '').map(productOut));

// Saligue is for fashion only: clothes, shoes, bags and accessories, each with its exact type.
const CATEGORIES = Object.keys(FASHION_TYPES);

/**
 * Refuses listings that aren't fashion (category and type, words, and what the photo shows).
 * `current` is the listing before an edit. Returns the photo's AI fingerprint.
 */
async function requireFashion(fields, current = {}, productId = null) {
  const category = fields.category ?? current.category;
  const type = fields.type ?? current.type;
  if (fields.category !== undefined || fields.type !== undefined || !productId) {
    if (!CATEGORIES.includes(category)) fail(400, 'not_fashion', 'Choose one of the fashion categories.');
    if (!FASHION_TYPES[category].includes(type)) fail(400, 'type_required', `Choose the type of item: ${FASHION_TYPES[category].join(', ')}.`);
  }
  const word = notFashionWord(fields.name, fields.description);
  if (word) fail(422, 'not_fashion', `Saligue is only for fashion: clothes, shoes, bags and accessories. Remove "${word}" or list a fashion item.`);
  if (!fields.image) return null;
  let result;
  try {
    result = await checkPhoto(fields.cutout || fields.image, productId);
  } catch (error) {
    // The AI couldn't run (e.g. no internet to fetch it the first time): don't block sellers; reports still apply.
    console.error('Fashion check skipped:', error.message);
    return null;
  }
  if (!result.fashion) {
    fail(422, 'not_fashion', `This photo looks like ${result.looksLike}, not a fashion item. Saligue is only for clothes, shoes, bags and accessories.`);
  }
  return result.embedding;
}

route('POST', '/api/products', async ({ user, body }) => {
  needFeature('selling');
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Create an account to sell items.');
  if (user.role !== 'seller') fail(403, 'not_a_seller', 'Only seller accounts can list items. Switch to selling in your account settings.');
  if (!parse(user.shop)?.name) fail(403, 'shop_required', 'Add your shop name and full address before listing.');
  if (!user.avatar && !user.official) fail(403, 'avatar_required', 'Add a profile photo before listing, so buyers can see who they buy from.');
  const fields = productFields(body);
  if (!fields.name || fields.price === undefined || !fields.image || !fields.category) fail(400, 'incomplete_product', 'Name, price, photo and category are required.');
  const checked = await requireFashion(fields);
  if (checked) fields.embedding = json(checked);
  const id = randomUUID();
  db.prepare(`insert into products (id, name, price, image, cutout, embedding, category, type, seller, seller_id, seller_email, status,
      description, size, color, brand, condition, contact, shop, official, sound, stock, photo_type, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, fields.name, fields.price, fields.image, fields.cutout ?? null, fields.embedding ?? null, fields.category, fields.type,
    fields.seller || user.display_name || 'Seller', user.id, user.email, fields.status ?? 'active', fields.description ?? null, fields.size ?? null,
    fields.color ?? null, fields.brand ?? null, fields.condition ?? null, fields.contact ?? null, user.shop, user.official, fields.sound ?? null,
    fields.stock ?? null, fields.photo_type ?? 'item', now()
  );
  broadcast('products');
  return { id };
});

route('PATCH', '/api/products/([\\w-]+)', async ({ user, params, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  const before = ownProduct(user, params[0]);
  const fields = productFields(body);
  // Changed photo or words are checked again.
  const checked = await requireFashion({
    ...fields,
    image: fields.image && fields.image !== before.image ? fields.image : undefined,
    cutout: fields.cutout && fields.cutout !== before.cutout ? fields.cutout : undefined,
  }, before, before.id);
  if (checked) fields.embedding = json(checked);
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

// Early check while a seller adds a photo, so they know before filling in the rest.
route('POST', '/api/ai/fashion-check', async ({ user, body }) => {
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Create an account to sell items.');
  const image = String(body.image ?? '');
  if (!image.startsWith('data:image/') || image.length > 1_500_000) fail(400, 'invalid_image', 'This photo could not be checked.');
  try {
    const { fashion, looksLike, suggestion, learnedFrom } = await checkPhoto(image);
    return { fashion, looksLike, suggestion, learnedFrom };
  } catch {
    return { fashion: true, looksLike: null, suggestion: null, learnedFrom: 0 };
  }
});

// Reports: shoppers flag items that aren't fashion (or are fake or offensive). After 3 different
// people report an item it is hidden until INDECIANA reviews it (node server/admin.mjs reports).
const REPORT_REASONS = { not_fashion: 'not fashion', fake: 'fake or misleading', offensive: 'offensive', other: 'other problem' };
const HIDE_AFTER_REPORTS = 3;
route('POST', '/api/products/([\\w-]+)/report', ({ user, params, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  const product = db.prepare('select id, name, seller_id, hidden from products where id = ?').get(params[0]);
  if (!product) fail(404, 'not_found', 'This item no longer exists.');
  if (product.seller_id === user.id) fail(400, 'own_item', 'You cannot report your own item.');
  const reason = REPORT_REASONS[body.reason] ? body.reason : 'other';
  db.prepare('insert or ignore into reports (product_id, user_id, reason, created_at) values (?, ?, ?, ?)').run(product.id, user.id, reason, now());
  const count = db.prepare('select count(*) as n from reports where product_id = ?').get(product.id).n;
  if (count >= HIDE_AFTER_REPORTS && !product.hidden) {
    db.prepare('update products set hidden = 1 where id = ?').run(product.id);
    broadcast('products');
    notify(product.seller_id, {
      type: 'product',
      title: `"${product.name}" is hidden after reports`,
      body: 'Several shoppers reported this item. Saligue is only for fashion that is described honestly. INDECIANA will review it; edit or remove it if something is wrong.',
      link: '/dashboard/products',
    });
    for (const { id } of db.prepare('select id from users where official = 1').all()) {
      notify(id, { type: 'product', title: `Review needed: "${product.name}"`, body: `${count} reports. Check it with: node server/admin.mjs reports`, link: `/product?id=${product.id}`, email: false });
    }
  }
  return { ok: true };
});

// Review of reported items, by INDECIANA's official account. Each decision also teaches the AI (learn.mjs).
route('GET', '/api/admin/reports', ({ user }) => {
  if (!user?.official && !can(user, 'moderation')) fail(403, 'forbidden', 'Only INDECIANA and moderators can review reports.');
  return db.prepare(`select p.*, count(r.user_id) as report_count, group_concat(distinct r.reason) as reasons, max(r.created_at) as last_report
    from reports r join products p on p.id = r.product_id group by p.id order by p.hidden desc, report_count desc, last_report desc`).all()
    .map((r) => ({ ...productOut(r), reportCount: r.report_count, reasons: (r.reasons ?? '').split(','), lastReport: r.last_report }));
});

route('POST', '/api/admin/reports/([\\w-]+)', ({ user, params, body }) => {
  if (!user?.official && !can(user, 'moderation')) fail(403, 'forbidden', 'Only INDECIANA and moderators can review reports.');
  const product = db.prepare('select * from products where id = ?').get(params[0]);
  if (!product) fail(404, 'not_found', 'This item no longer exists.');
  const embedding = parse(product.embedding);
  if (body.decision === 'remove') {
    learn(embedding, 'not_fashion', product.id);
    db.prepare('delete from products where id = ?').run(product.id);
    notify(product.seller_id, {
      type: 'product',
      title: `"${product.name}" was removed`,
      body: 'After reports from shoppers, INDECIANA removed this item. Saligue is only for fashion items described honestly.',
      link: '/dashboard/products',
    });
  } else if (body.decision === 'keep') {
    learn(embedding, 'fashion', product.id);
    db.prepare('update products set hidden = 0 where id = ?').run(product.id);
    db.prepare('delete from reports where product_id = ?').run(product.id);
    if (product.hidden) {
      notify(product.seller_id, { type: 'product', title: `"${product.name}" is visible again`, body: 'INDECIANA reviewed the reports and your item is back on Saligue.', link: '/dashboard/products' });
    }
  } else {
    fail(400, 'invalid_decision', 'Choose remove or keep.');
  }
  broadcast('products');
  return { ok: true };
});

// Comments
route('GET', '/api/products/([\\w-]+)/comments', ({ params }) =>
  db.prepare('select * from comments where product_id = ? order by created_at desc limit 50').all(params[0])
    .map((r) => ({ id: r.id, uid: r.user_id, name: r.name, text: r.text, createdAt: r.created_at })));

route('POST', '/api/products/([\\w-]+)/comments', ({ user, params, body }) => {
  needFeature('comments');
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  const text = String(body.text ?? '').trim().slice(0, 500);
  if (!text) fail(400, 'empty_comment', 'Write a comment first.');
  const product = db.prepare('select id, name, seller_id, official from products where id = ?').get(params[0]);
  if (!product) fail(404, 'not_found', 'This item no longer exists.');
  if (blockedBetween(user.id, product.seller_id)) fail(403, 'blocked', 'You can’t comment here.');
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

route('DELETE', '/api/products/([\\w-]+)/video', ({ user, params }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  ownProduct(user, params[0]);
  db.prepare('update products set video = null, video_poster = null, video_duration = null where id = ?').run(params[0]);
  broadcast('products');
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
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Log in or create an account to place your order.');
  const lines = Array.isArray(body.items) ? body.items : [];
  if (!lines.length || lines.length > 50) fail(400, 'invalid_order', 'Your cart is empty.');
  if (!PAYMENT_METHODS.includes(body.paymentMethod)) fail(400, 'invalid_payment', 'Choose a payment method.');
  if (body.paymentMethod === 'online' && !paymentsEnabled()) fail(400, 'payments_off', 'Online payment is not available yet. Choose another way to pay.');
  const delivery = Object.fromEntries(Object.entries(body.delivery ?? {}).map(([k, v]) => [k, String(v ?? '').trim().slice(0, 300)]));
  if (!delivery.fullName || !delivery.phone || !delivery.city || !delivery.street) fail(400, 'incomplete_delivery', 'Please fill in the delivery address.');

  // Prices and stock always come from the database, checked and reserved in one step.
  const ids = transaction(() => {
    const groups = new Map();
    for (const line of lines) {
      const quantity = Math.floor(Number(line.quantity));
      if (!(quantity >= 1 && quantity <= 99)) fail(400, 'invalid_quantity', 'Invalid quantity.');
      const product = db.prepare("select * from products where id = ? and status = 'active' and hidden = 0").get(String(line.productId));
      if (!product) fail(409, 'unavailable', 'An item in your cart is no longer available.');
      if (product.seller_id === user.id) fail(400, 'own_item', `"${product.name}" is your own item.`);
      if (product.stock !== null && product.stock < quantity) {
        fail(409, 'out_of_stock', product.stock === 0 ? `"${product.name}" is sold out.` : `Only ${product.stock} of "${product.name}" left. Lower the quantity in your cart.`);
      }
      db.prepare('update products set stock = stock - ? where id = ? and stock is not null').run(quantity, product.id);
      const group = groups.get(product.seller_id) ?? { shop: product.shop, items: [], total: 0 };
      group.items.push({ productId: product.id, name: product.name, price: product.price, quantity, image: product.image });
      group.total += product.price * quantity;
      groups.set(product.seller_id, group);
    }
    return [...groups].map(([sellerId, group]) => {
      const id = randomUUID();
      db.prepare(`insert into orders (id, buyer_id, buyer_name, buyer_email, seller_id, shop, items, total, delivery, payment_method, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.id, user.display_name || String(delivery.fullName), user.email || '', sellerId, group.shop,
        json(group.items), Math.round(group.total * 100) / 100, json(delivery), body.paymentMethod, now()
      );
      return { id, sellerId, group };
    });
  });
  const payment = PAYMENT_LABELS[body.paymentMethod];
  for (const { id, sellerId, group } of ids) {
    const shopName = parse(group.shop)?.name || 'the shop';
    const list = group.items.map((i) => `${i.quantity} x ${i.name}`).join(', ');
    // Orders paid online are announced to the shop once the payment is confirmed (see markPaid).
    if (body.paymentMethod !== 'online') {
      notify(sellerId, {
        type: 'sale',
        title: `New order #${id.slice(0, 6).toUpperCase()} - ${money(group.total)}`,
        body: `${delivery.fullName} (${delivery.phone}) ordered ${list}. Payment: ${payment}. Deliver to ${[delivery.street, delivery.city].join(', ')}.`,
        link: '/dashboard/orders',
      });
    }
    notify(user.id, {
      type: 'order',
      title: `Order #${id.slice(0, 6).toUpperCase()} placed - ${money(group.total)}`,
      body: body.paymentMethod === 'online'
        ? `Your order for ${list} from ${shopName} is reserved. Finish paying online to send it to the shop.`
        : `${shopName} received your order for ${list}. Payment: ${payment}. You will be notified when it is confirmed.`,
      link: '/orders',
      // The confirmation email follows the payment for online orders.
      email: body.paymentMethod !== 'online',
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
    // A payment confirmed by Flutterwave can't be undone by hand.
    if (body.paymentStatus === 'unpaid' && order.payment_ref) fail(400, 'paid_online', 'This order was paid online; the payment cannot be removed here.');
    if (order.status === 'cancelled' && body.status && body.status !== 'cancelled') fail(400, 'cancelled', 'A cancelled order cannot be reopened. Ask the buyer to order again.');
    transaction(() => {
      db.prepare('update orders set status = coalesce(?, status), payment_status = coalesce(?, payment_status), paid_at = case when ? = \'paid\' then coalesce(paid_at, ?) when ? = \'unpaid\' then null else paid_at end where id = ?')
        .run(body.status ?? null, body.paymentStatus ?? null, body.paymentStatus ?? null, now(), body.paymentStatus ?? null, order.id);
      if (body.status === 'cancelled' && order.status !== 'cancelled') restock(order);
    });
    const code = order.id.slice(0, 6).toUpperCase();
    if (body.status && body.status !== order.status && ORDER_STATUS_TEXT[body.status]) {
      notify(order.buyer_id, { type: 'order', title: `Your order #${code} ${ORDER_STATUS_TEXT[body.status]}`, body: `Total ${money(order.total)}.`, link: '/orders' });
    }
    if (body.paymentStatus === 'paid' && order.payment_status !== 'paid') {
      notify(order.buyer_id, { type: 'order', title: `Payment received for order #${code}`, body: `The shop confirmed your payment of ${money(order.total)}. Thank you!`, link: '/orders' });
    }
  } else if (order.buyer_id === user.id) {
    if (order.status !== 'placed' || body.status !== 'cancelled' || body.paymentStatus !== undefined) fail(403, 'forbidden', 'You can only cancel an order that has not been confirmed.');
    if (order.payment_status === 'paid') fail(403, 'paid', 'This order is already paid. Message the shop to cancel it and get your money back.');
    transaction(() => {
      db.prepare("update orders set status = 'cancelled' where id = ?").run(order.id);
      restock(order);
    });
    notify(order.seller_id, { type: 'sale', title: `Order #${order.id.slice(0, 6).toUpperCase()} was cancelled by the buyer`, body: `${order.buyer_name} cancelled the order (${money(order.total)}).`, link: '/dashboard/orders' });
  } else fail(403, 'forbidden', 'This is not your order.');
  broadcast('orders');
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Messages: buyers talk directly with sellers (one conversation per buyer and shop), live and by email.
// ---------------------------------------------------------------------------

const shopNameOf = (u) => parse(u?.shop)?.name || u?.display_name || 'Shop';
const personNameOf = (u) => (u?.is_guest ? 'Guest shopper' : u?.display_name || u?.email?.split('@')[0] || 'Saligue user');

function conversationOut(c, me) {
  const iAmBuyer = c.buyer_id === me.id;
  const other = db.prepare('select id, display_name, email, shop, is_guest, official, avatar from users where id = ?').get(iAmBuyer ? c.seller_id : c.buyer_id);
  const readAt = (iAmBuyer ? c.buyer_read_at : c.seller_read_at) ?? '';
  const last = db.prepare('select * from messages where conversation_id = ? order by created_at desc limit 1').get(c.id);
  const unread = db.prepare('select count(*) as n from messages where conversation_id = ? and sender_id != ? and created_at > ?').get(c.id, me.id, readAt).n;
  return {
    id: c.id,
    role: iAmBuyer ? 'buyer' : 'seller',
    other: {
      id: other?.id,
      name: iAmBuyer ? shopNameOf(other) : personNameOf(other),
      official: !!other?.official,
      isGuest: !!other?.is_guest,
      avatar: other?.avatar ?? null,
    },
    lastMessage: last ? { text: last.text, fromMe: last.sender_id === me.id, productId: last.product_id, createdAt: last.created_at } : null,
    unread,
    lastMessageAt: c.last_message_at,
  };
}

function messageOut(m) {
  return { id: m.id, senderId: m.sender_id, text: m.text, productId: m.product_id ?? null, orderId: m.order_id ?? null, createdAt: m.created_at };
}

function ownConversation(user, id) {
  const c = db.prepare('select * from conversations where id = ?').get(id);
  if (!c || (c.buyer_id !== user.id && c.seller_id !== user.id)) fail(404, 'not_found', 'Conversation not found.');
  return c;
}

const messageRuns = new Map();
// Either of two people blocked the other.
const blockedBetween = (a, b) => !!(a && b && db.prepare('select 1 from blocks where (blocker_id = ? and blocked_id = ?) or (blocker_id = ? and blocked_id = ?)').get(a, b, b, a));

function addMessage(user, c, { text, productId = null, orderId = null }) {
  if (blockedBetween(c.buyer_id, c.seller_id)) fail(403, 'blocked', 'You can’t message this account.');
  const clean = String(text ?? '').trim().slice(0, 3000);
  if (!clean) fail(400, 'empty_message', 'Write a message first.');
  const minute = Date.now() - 60_000;
  const recent = (messageRuns.get(user.id) ?? []).filter((t) => t > minute);
  if (recent.length >= 30) fail(429, 'too_many', 'You are sending messages very fast. Wait a moment.');
  messageRuns.set(user.id, [...recent, Date.now()]);
  if (productId && !db.prepare('select 1 from products where id = ?').get(productId)) productId = null;
  if (orderId && !db.prepare('select 1 from orders where id = ? and (buyer_id = ? or seller_id = ?)').get(orderId, c.buyer_id, c.seller_id)) orderId = null;

  const time = now();
  const id = randomUUID();
  const iAmBuyer = c.buyer_id === user.id;
  transaction(() => {
    db.prepare('insert into messages (id, conversation_id, sender_id, text, product_id, order_id, created_at) values (?, ?, ?, ?, ?, ?, ?)')
      .run(id, c.id, user.id, clean, productId, orderId, time);
    db.prepare(`update conversations set last_message_at = ?, ${iAmBuyer ? 'buyer_read_at' : 'seller_read_at'} = ? where id = ?`).run(time, time, c.id);
  });
  sendTo([c.buyer_id, c.seller_id], 'messages', { conversationId: c.id });

  // Email the other person, at most once until they've read the chat (or every 6 hours while it stays unread).
  const recipientId = iAmBuyer ? c.seller_id : c.buyer_id;
  const fresh = db.prepare('select * from conversations where id = ?').get(c.id);
  const readAt = (iAmBuyer ? fresh.seller_read_at : fresh.buyer_read_at) ?? '';
  const emailedAt = (iAmBuyer ? fresh.seller_emailed_at : fresh.buyer_emailed_at) ?? '';
  const stale = !emailedAt || emailedAt < readAt || emailedAt < new Date(Date.now() - 6 * 3_600_000).toISOString();
  const recipient = db.prepare('select email, is_guest from users where id = ?').get(recipientId);
  if (stale && recipient?.email && !recipient.is_guest) {
    db.prepare(`update conversations set ${iAmBuyer ? 'seller_emailed_at' : 'buyer_emailed_at'} = ? where id = ?`).run(time, c.id);
    const from = iAmBuyer ? personNameOf(user) : shopNameOf(user);
    const product = productId && db.prepare('select name from products where id = ?').get(productId);
    sendEmail(recipient.email, {
      subject: `New message from ${from}`,
      lines: [`${from}${product ? ` about "${product.name}"` : ''}:`, `"${clean.slice(0, 400)}"`, 'Reply in Saligue so your conversation stays in one place.'],
      button: { label: 'Reply', url: `/messages?c=${c.id}` },
    });
  }
  return id;
}

route('GET', '/api/conversations', ({ user }) => {
  if (!user) return [];
  return db.prepare('select * from conversations where buyer_id = ? or seller_id = ? order by last_message_at desc limit 200')
    .all(user.id, user.id).map((c) => conversationOut(c, user));
});

// Starts (or continues) a conversation from an item, an order, or a shop, and sends the first message.
route('POST', '/api/conversations', ({ user, body }) => {
  needFeature('messages');
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  let buyerId = user.id;
  let sellerId = null;
  let productId = null;
  let orderId = null;
  if (body.orderId) {
    const order = db.prepare('select * from orders where id = ?').get(String(body.orderId));
    if (!order || (order.buyer_id !== user.id && order.seller_id !== user.id)) fail(404, 'not_found', 'Order not found.');
    [buyerId, sellerId, orderId] = [order.buyer_id, order.seller_id, order.id];
  } else if (body.productId) {
    const product = db.prepare('select id, seller_id from products where id = ?').get(String(body.productId));
    if (!product) fail(404, 'not_found', 'This item no longer exists.');
    [sellerId, productId] = [product.seller_id, product.id];
  } else if (body.sellerId) {
    if (!db.prepare("select 1 from users where id = ? and role = 'seller'").get(String(body.sellerId))) fail(404, 'not_found', 'Shop not found.');
    sellerId = String(body.sellerId);
  }
  if (!sellerId) fail(400, 'invalid', 'Choose who to message.');
  if (buyerId === sellerId) fail(400, 'own_item', 'This is your own shop.');

  let c = db.prepare('select * from conversations where buyer_id = ? and seller_id = ?').get(buyerId, sellerId);
  if (!c) {
    const id = randomUUID();
    db.prepare('insert into conversations (id, buyer_id, seller_id, last_message_at, created_at) values (?, ?, ?, ?, ?)').run(id, buyerId, sellerId, now(), now());
    c = db.prepare('select * from conversations where id = ?').get(id);
  }
  if (body.text) addMessage(user, c, { text: body.text, productId, orderId });
  return { id: c.id };
});

route('GET', '/api/conversations/([\\w-]+)', ({ user, params }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  const c = ownConversation(user, params[0]);
  const messages = db.prepare('select * from messages where conversation_id = ? order by created_at desc limit 300').all(c.id).reverse().map(messageOut);
  // The other side's read time, for "Seen" under the last message.
  const otherReadAt = (c.buyer_id === user.id ? c.seller_read_at : c.buyer_read_at) ?? null;
  return { conversation: conversationOut(c, user), messages, otherReadAt };
});

route('POST', '/api/conversations/([\\w-]+)/messages', ({ user, params, body }) => {
  needFeature('messages');
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  const c = ownConversation(user, params[0]);
  const id = addMessage(user, c, { text: body.text, productId: body.productId ? String(body.productId) : null, orderId: body.orderId ? String(body.orderId) : null });
  return messageOut(db.prepare('select * from messages where id = ?').get(id));
});

route('POST', '/api/conversations/([\\w-]+)/read', ({ user, params }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  const c = ownConversation(user, params[0]);
  db.prepare(`update conversations set ${c.buyer_id === user.id ? 'buyer_read_at' : 'seller_read_at'} = ? where id = ?`).run(now(), c.id);
  sendTo([c.buyer_id, c.seller_id], 'messages', { conversationId: c.id, read: true });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Reviews: only buyers whose order with the item was delivered can rate it ("Verified purchase").
// ---------------------------------------------------------------------------

function boughtAndDelivered(userId, productId) {
  return db.prepare("select 1 from orders where buyer_id = ? and status = 'delivered' and exists (select 1 from json_each(orders.items) where json_extract(value, '$.productId') = ?)")
    .get(userId, productId);
}

function refreshRating(productId) {
  const { avg, n } = db.prepare('select avg(rating) as avg, count(*) as n from reviews where product_id = ?').get(productId);
  db.prepare('update products set rating_avg = ?, rating_count = ? where id = ?').run(avg ?? 0, n, productId);
}

route('GET', '/api/products/([\\w-]+)/reviews', ({ user, params }) => {
  const reviews = db.prepare('select * from reviews where product_id = ? order by created_at desc limit 100').all(params[0])
    .map((r) => ({ id: r.id, uid: r.user_id, name: r.name, rating: r.rating, text: r.text, createdAt: r.created_at }));
  const mine = user ? reviews.find((r) => r.uid === user.id) ?? null : null;
  return { reviews, mine, canReview: !!(user && !user.is_guest && boughtAndDelivered(user.id, params[0])) };
});

route('POST', '/api/products/([\\w-]+)/reviews', ({ user, params, body }) => {
  needFeature('reviews');
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Create an account to write a review.');
  const product = db.prepare('select id, name, seller_id from products where id = ?').get(params[0]);
  if (!product) fail(404, 'not_found', 'This item no longer exists.');
  if (!boughtAndDelivered(user.id, product.id)) fail(403, 'not_bought', 'You can review this item once your order of it has been delivered.');
  const rating = Math.round(Number(body.rating));
  if (!(rating >= 1 && rating <= 5)) fail(400, 'invalid_rating', 'Choose 1 to 5 stars.');
  const text = String(body.text ?? '').trim().slice(0, 2000);
  const isNew = !db.prepare('select 1 from reviews where product_id = ? and user_id = ?').get(product.id, user.id);
  transaction(() => {
    db.prepare(`insert into reviews (id, product_id, user_id, name, rating, text, created_at) values (?, ?, ?, ?, ?, ?, ?)
      on conflict(product_id, user_id) do update set rating = excluded.rating, text = excluded.text, created_at = excluded.created_at`)
      .run(randomUUID(), product.id, user.id, personNameOf(user).slice(0, 60), rating, text, now());
    refreshRating(product.id);
  });
  broadcast('products');
  broadcast('reviews', { productId: product.id });
  if (isNew) {
    notify(product.seller_id, { type: 'product', title: `New ${rating}-star review on ${product.name}`, body: text.slice(0, 200), link: `/product?id=${product.id}`, email: false });
  }
  return { ok: true };
});

route('DELETE', '/api/products/([\\w-]+)/reviews', ({ user, params }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  transaction(() => {
    db.prepare('delete from reviews where product_id = ? and user_id = ?').run(params[0], user.id);
    refreshRating(params[0]);
  });
  broadcast('products');
  broadcast('reviews', { productId: params[0] });
  return { ok: true };
});

// Item views for the seller's dashboard: once per viewer, item and day; the seller's own visits don't count.
const viewedToday = new Set();
route('POST', '/api/products/([\\w-]+)/view', ({ req, user, params }) => {
  const product = db.prepare('select id, seller_id from products where id = ?').get(params[0]);
  if (!product || product.seller_id === user?.id) return { ok: true };
  const day = now().slice(0, 10);
  const viewer = user?.id ?? req.socket.remoteAddress;
  const key = `${day}|${viewer}|${product.id}`;
  if (viewedToday.has(key)) return { ok: true };
  if (viewedToday.size > 200_000) viewedToday.clear();
  viewedToday.add(key);
  db.prepare('insert into product_views (product_id, day, views) values (?, ?, 1) on conflict(product_id, day) do update set views = views + 1').run(product.id, day);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Seller dashboard numbers: daily revenue, orders, units and views, with the previous period for comparison.
// ---------------------------------------------------------------------------

route('GET', '/api/seller/stats', ({ user, url }) => {
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Please sign in.');
  const days = Math.min(365, Math.max(7, Math.floor(Number(url.searchParams.get('days')) || 30)));
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const previousStart = new Date(start.getTime() - days * 86_400_000);

  const dayKeys = Array.from({ length: days }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  const series = new Map(dayKeys.map((d) => [d, { date: d, revenue: 0, orders: 0, units: 0, views: 0 }]));
  const totals = { revenue: 0, orders: 0, units: 0, views: 0 };
  const previous = { revenue: 0, orders: 0, units: 0, views: 0 };
  const perProduct = {};

  const orders = db.prepare('select * from orders where seller_id = ?').all(user.id);
  const statusCounts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
  let unpaid = 0;
  for (const o of orders) {
    statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;
    if (o.status === 'cancelled') continue;
    if (o.payment_status !== 'paid') unpaid += 1;
    const items = parse(o.items) ?? [];
    const units = items.reduce((n, i) => n + i.quantity, 0);
    for (const i of items) {
      const p = (perProduct[i.productId] ??= { units: 0, revenue: 0, orders: 0 });
      p.units += i.quantity;
      p.revenue += i.price * i.quantity;
      p.orders += 1;
    }
    const day = o.created_at.slice(0, 10);
    const bucket = series.get(day);
    if (bucket) {
      bucket.revenue += o.total;
      bucket.orders += 1;
      bucket.units += units;
      totals.revenue += o.total;
      totals.orders += 1;
      totals.units += units;
    } else if (o.created_at >= previousStart.toISOString() && o.created_at < start.toISOString()) {
      previous.revenue += o.total;
      previous.orders += 1;
      previous.units += units;
    }
  }

  const views = db.prepare('select v.product_id, v.day, v.views from product_views v join products p on p.id = v.product_id where p.seller_id = ? and v.day >= ?')
    .all(user.id, previousStart.toISOString().slice(0, 10));
  for (const v of views) {
    const bucket = series.get(v.day);
    if (bucket) {
      bucket.views += v.views;
      totals.views += v.views;
      (perProduct[v.product_id] ??= { units: 0, revenue: 0, orders: 0 }).views = (perProduct[v.product_id].views ?? 0) + v.views;
    } else previous.views += v.views;
  }

  const round = (n) => Math.round(n * 100) / 100;
  const conversion = (t) => (t.views ? round((t.orders / t.views) * 100) : 0);
  const products = db.prepare("select id, name, image, stock, status, price from products where seller_id = ?").all(user.id);
  const unreadMessages = db.prepare(`select count(*) as n from messages m join conversations c on c.id = m.conversation_id
    where c.seller_id = ? and m.sender_id != ? and m.created_at > coalesce(c.seller_read_at, '')`).get(user.id, user.id).n;

  return {
    days,
    series: [...series.values()].map((d) => ({ ...d, revenue: round(d.revenue), conversion: d.views ? round((d.orders / d.views) * 100) : 0 })),
    totals: { ...totals, revenue: round(totals.revenue), conversion: conversion(totals) },
    previous: { ...previous, revenue: round(previous.revenue), conversion: conversion(previous) },
    perProduct,
    statusCounts,
    unpaid,
    unreadMessages,
    lowStock: products.filter((p) => p.status === 'active' && p.stock !== null && p.stock <= 3).map((p) => ({ id: p.id, name: p.name, image: p.image, stock: p.stock })),
    productCount: products.length,
    activeCount: products.filter((p) => p.status === 'active').length,
  };
});

// Several items at once from the dashboard: change status, or delete.
route('POST', '/api/seller/products/bulk', ({ user, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 500) : [];
  if (!ids.length) fail(400, 'invalid', 'Select at least one item.');
  const action = String(body.action);
  if (!['active', 'draft', 'archived', 'delete'].includes(action)) fail(400, 'invalid', 'Unknown action.');
  let changed = 0;
  transaction(() => {
    for (const id of ids) {
      const product = db.prepare('select id from products where id = ? and seller_id = ?').get(id, user.id);
      if (!product) continue;
      if (action === 'delete') db.prepare('delete from products where id = ?').run(id);
      else db.prepare('update products set status = ? where id = ?').run(action, id);
      changed += 1;
    }
  });
  broadcast('products');
  return { changed };
});

// ---------------------------------------------------------------------------
// Online payments (payments.mjs). Orders are marked paid only after Flutterwave confirms the transaction.
// ---------------------------------------------------------------------------

route('GET', '/api/payments/config', () => {
  const { currency, rate } = paymentSettings();
  return { enabled: paymentsEnabled(), currency, rate, methods: currency === 'RWF' ? ['card', 'mobile_money'] : ['card'] };
});

function markPaid(payment, providerRef) {
  // A tip: paid → the receiver is told and it counts toward their next payout.
  if (payment.tip_id) {
    const changed = transaction(() => {
      if (db.prepare('select status from payments where id = ?').get(payment.id)?.status === 'paid') return false;
      db.prepare("update payments set status = 'paid', provider_ref = ? where id = ?").run(providerRef, payment.id);
      return db.prepare("update tips set status = 'paid', paid_at = ? where id = ? and status = 'pending_payment'").run(now(), payment.tip_id).changes > 0;
    });
    if (changed) tipPaid(payment.tip_id);
    return;
  }
  // An ad campaign: paid → INDECIANA reviews it against the Ads Policy.
  if (payment.campaign_id) {
    const changed = transaction(() => {
      if (db.prepare('select status from payments where id = ?').get(payment.id)?.status === 'paid') return false;
      db.prepare("update payments set status = 'paid', provider_ref = ? where id = ?").run(providerRef, payment.id);
      db.prepare("update ad_campaigns set status = 'in_review', payment_ref = ? where id = ? and status = 'pending_payment'").run(payment.id, payment.campaign_id);
      return true;
    });
    if (changed) adPaid(payment.campaign_id);
    return;
  }
  const orderIds = parse(payment.order_ids) ?? [];
  const changed = transaction(() => {
    const current = db.prepare('select status from payments where id = ?').get(payment.id);
    if (current?.status === 'paid') return false;
    db.prepare("update payments set status = 'paid', provider_ref = ? where id = ?").run(providerRef, payment.id);
    for (const id of orderIds) {
      db.prepare("update orders set payment_status = 'paid', paid_at = ?, payment_ref = ? where id = ?").run(now(), payment.id, id);
    }
    return true;
  });
  if (!changed) return;
  for (const id of orderIds) {
    const o = db.prepare('select * from orders where id = ?').get(id);
    if (!o) continue;
    const delivery = parse(o.delivery) ?? {};
    const list = (parse(o.items) ?? []).map((i) => `${i.quantity} x ${i.name}`).join(', ');
    const code = o.id.slice(0, 6).toUpperCase();
    notify(o.seller_id, {
      type: 'sale',
      title: `New paid order #${code} - ${money(o.total)}`,
      body: `${delivery.fullName} (${delivery.phone}) ordered ${list} and paid online. Deliver to ${[delivery.street, delivery.city].join(', ')}.`,
      link: '/dashboard/orders',
    });
    notify(o.buyer_id, {
      type: 'order',
      title: `Payment received - order #${code}`,
      body: `Thank you! ${parse(o.shop)?.name || 'The shop'} has your paid order for ${list} (${money(o.total)}) and will confirm it soon.`,
      link: '/orders',
    });
  }
  broadcast('orders');
}

/** Checks a transaction with Flutterwave and settles the matching payment. Returns the payment's new status. */
async function settle(payment, { transactionId } = {}) {
  if (payment.status === 'paid') return 'paid';
  let tx;
  try {
    tx = transactionId ? await verifyTransaction(transactionId) : await findByReference(payment.id);
  } catch (error) {
    console.error('Payment check failed:', error.message);
    return payment.status;
  }
  const genuine = tx.txRef === payment.id && tx.currency === payment.currency && tx.amount >= payment.amount;
  if (tx.status === 'successful' && genuine) {
    markPaid(payment, tx.id);
    return 'paid';
  }
  if (tx.status === 'failed' || (tx.status === 'successful' && !genuine)) {
    if (tx.status === 'successful') console.error(`Payment ${payment.id} did not match (got ${tx.amount} ${tx.currency}, ref ${tx.txRef}).`);
    db.prepare("update payments set status = 'failed', provider_ref = ? where id = ? and status = 'pending'").run(tx.id, payment.id);
    return 'failed';
  }
  return 'pending';
}

route('POST', '/api/payments/start', async ({ req, user, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  if (!paymentsEnabled()) fail(400, 'payments_off', 'Online payment is not available yet.');
  const ids = Array.isArray(body.orderIds) ? body.orderIds.map(String).slice(0, 50) : [];
  const orders = ids.map((id) => db.prepare('select * from orders where id = ?').get(id)).filter(Boolean);
  if (!orders.length || orders.length !== ids.length) fail(404, 'not_found', 'Order not found.');
  for (const o of orders) {
    if (o.buyer_id !== user.id) fail(403, 'forbidden', 'This is not your order.');
    if (o.payment_status === 'paid') fail(400, 'paid', `Order #${o.id.slice(0, 6).toUpperCase()} is already paid.`);
    if (o.status === 'cancelled') fail(400, 'cancelled', `Order #${o.id.slice(0, 6).toUpperCase()} was cancelled.`);
  }
  const email = String(user.email || body.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) fail(400, 'email_required', 'Enter your email address to receive the payment receipt.');
  const delivery = parse(orders[0].delivery) ?? {};
  const { currency } = paymentSettings();
  const amount = toCharge(orders.reduce((sum, o) => sum + o.total, 0));
  const txRef = `SAL-${randomBytes(9).toString('base64url')}`;
  db.prepare('insert into payments (id, user_id, order_ids, amount, currency, created_at) values (?, ?, ?, ?, ?, ?)')
    .run(txRef, user.id, json(orders.map((o) => o.id)), amount, currency, now());
  // Back to this website after paying. A site address set by INDECIANA wins over the request's own address.
  const configured = siteUrl();
  const base = /localhost|127\.0\.0\.1/.test(configured) && /^https?:\/\/[\w.:-]+$/.test(req.headers.origin || '') ? req.headers.origin : configured;
  const link = await startCheckout({
    txRef,
    amount,
    currency,
    redirectUrl: `${base}/payment`,
    customer: { email, name: delivery.fullName || personNameOf(user), phone: delivery.phone },
    title: 'Saligue by INDECIANA',
    logo: `${configured}/icons/icon-192.png`,
  });
  return { link, txRef, amount, currency };
});

route('POST', '/api/payments/verify', async ({ user, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  const payment = db.prepare('select * from payments where id = ? and user_id = ?').get(String(body.txRef ?? ''), user.id);
  if (!payment) fail(404, 'not_found', 'Payment not found.');
  const status = await settle(payment, { transactionId: body.transactionId ? String(body.transactionId) : undefined });
  return { status, orderIds: parse(payment.order_ids) };
});

// Flutterwave calls this when a payment finishes, also when the buyer closed the page before coming back.
route('POST', '/api/payments/webhook', async ({ req, body }) => {
  if (!webhookIsGenuine(req.headers['verif-hash'])) fail(401, 'forbidden', 'Invalid signature.');
  const data = body?.data ?? body ?? {};
  const payment = db.prepare('select * from payments where id = ?').get(String(data.tx_ref ?? data.txRef ?? ''));
  if (payment && data.id) await settle(payment, { transactionId: String(data.id) });
  return { ok: true };
});

// Online orders that stay unpaid for a day are cancelled, so their items go back on sale.
function cancelAbandonedOrders() {
  const before = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const abandoned = db.prepare("select * from orders where payment_method = 'online' and payment_status = 'unpaid' and status = 'placed' and created_at < ?").all(before);
  for (const o of abandoned) {
    transaction(() => {
      db.prepare("update orders set status = 'cancelled' where id = ?").run(o.id);
      restock(o);
    });
    notify(o.buyer_id, { type: 'order', title: `Order #${o.id.slice(0, 6).toUpperCase()} was cancelled`, body: 'It was not paid within 24 hours, so the items went back on sale. You can order again any time.', link: '/orders' });
  }
  if (abandoned.length) broadcast('orders');
}

// ---------------------------------------------------------------------------
// Saligue Live: sellers stream from their camera; viewers chat, send hearts, buy featured items and can join
// on camera when the host accepts. Video goes through LiveKit (live.mjs); everything else is here.
// ---------------------------------------------------------------------------

function liveOut(l) {
  const seller = db.prepare('select id, display_name, shop, avatar, official from users where id = ?').get(l.seller_id);
  return {
    id: l.id,
    sellerId: l.seller_id,
    sellerName: shopNameOf(seller),
    sellerAvatar: seller?.avatar ?? null,
    official: !!seller?.official,
    title: l.title,
    description: l.description,
    status: l.status,
    productIds: parse(l.product_ids) ?? [],
    pinnedProductId: l.pinned_product_id,
    pinnedCommentId: l.pinned_comment_id,
    likeCount: l.like_count,
    peakViewers: l.peak_viewers,
    // Host's chat settings: who may comment, and how often.
    chatMode: l.chat_mode ?? 'everyone',
    slowSeconds: l.slow_seconds ?? 0,
    // 'fit': the whole camera picture (never cropped); 'fill': fills the screen.
    videoFit: l.video_fit === 'fill' ? 'fill' : 'fit',
    // People the host trusts to look after the chat (remove comments, mute, pin, chat settings).
    moderators: (parse(l.moderators) ?? []).map((uid) => ({ uid, name: personNameOf(db.prepare('select display_name, email, is_guest from users where id = ?').get(uid)) })),
    startedAt: l.started_at,
    endedAt: l.ended_at,
  };
}

const liveCommentOut = (c) => ({ id: c.id, uid: c.user_id, name: c.name, text: c.text, kind: c.kind, createdAt: c.created_at });

function getLive(id) {
  const live = db.prepare('select * from lives where id = ?').get(id);
  if (!live) fail(404, 'not_found', 'This live has ended or does not exist.');
  return live;
}
const ownLive = (user, id) => {
  const live = getLive(id);
  if (live.seller_id !== user?.id) fail(403, 'forbidden', 'Only the host can do this.');
  return live;
};
const isLiveMod = (live, user) => !!user && (parse(live.moderators) ?? []).includes(user.id);
// The host, or one of their moderators.
const modLive = (user, id) => {
  const live = getLive(id);
  if (live.seller_id !== user?.id && !isLiveMod(live, user)) fail(403, 'forbidden', 'Only the host and moderators can do this.');
  return live;
};
const liveEvent = (liveId, data) => broadcast('live', { liveId, ...data });
const sellerProductIds = (userId, ids) =>
  (Array.isArray(ids) ? ids.map(String) : []).filter((id) => db.prepare('select 1 from products where id = ? and seller_id = ?').get(id, userId)).slice(0, 30);

route('GET', '/api/lives', () => ({
  enabled: liveSettings().enabled && featureOn('live'),
  lives: db.prepare("select * from lives where status = 'live' order by started_at desc limit 50").all().map(liveOut),
}));

route('POST', '/api/lives', ({ user, body }) => {
  needFeature('live');
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Create an account to go live.');
  if (user.role !== 'seller') fail(403, 'not_a_seller', 'Only sellers can go live. Switch to selling first.');
  if (!liveSettings().enabled) fail(503, 'live_off', 'Live is not switched on yet.');
  const title = String(body.title ?? '').trim().slice(0, 100);
  if (!title) fail(400, 'missing_title', 'Give your live a title.');
  // One live at a time per shop: an older one still marked live is closed.
  for (const old of db.prepare("select id from lives where seller_id = ? and status = 'live'").all(user.id)) {
    db.prepare("update lives set status = 'ended', ended_at = ? where id = ?").run(now(), old.id);
    liveEvent(old.id, { type: 'ended' });
  }
  const id = randomUUID();
  const productIds = sellerProductIds(user.id, body.productIds);
  db.prepare('insert into lives (id, seller_id, title, description, product_ids, pinned_product_id, started_at) values (?, ?, ?, ?, ?, ?, ?)')
    .run(id, user.id, title, String(body.description ?? '').trim().slice(0, 1000), json(productIds), productIds[0] ?? null, now());
  broadcast('lives');
  // Tell the shop's past customers (in the app, not by email).
  const shopName = shopNameOf(user);
  const customers = db.prepare("select distinct buyer_id from orders where seller_id = ? and status != 'cancelled' limit 500").all(user.id);
  for (const { buyer_id } of customers) notify(buyer_id, { type: 'message', title: `${shopName} is live now`, body: title, link: `/live/watch?id=${id}`, email: false });
  return liveOut(db.prepare('select * from lives where id = ?').get(id));
});

route('GET', '/api/lives/([\\w-]+)', ({ user, params }) => {
  const live = getLive(params[0]);
  const comments = db.prepare('select * from live_comments where live_id = ? order by created_at desc limit 80').all(live.id).reverse().map(liveCommentOut);
  const guests = db.prepare("select g.user_id, g.status, u.display_name, u.is_guest from live_guests g join users u on u.id = g.user_id where g.live_id = ? and g.status != 'declined'").all(live.id)
    .map((g) => ({ uid: g.user_id, name: personNameOf({ display_name: g.display_name, is_guest: g.is_guest }), status: g.status }));
  const me = user ? db.prepare('select status from live_guests where live_id = ? and user_id = ?').get(live.id, user.id)?.status ?? null : null;
  return { live: liveOut(live), comments, guests, myGuestStatus: me, muted: user ? (parse(live.muted) ?? []).includes(user.id) : false, invited: user ? (parse(live.invited) ?? []).includes(user.id) : false };
});

// A pass into the video room: hosts and accepted guests can use their camera; everyone else watches.
route('POST', '/api/lives/([\\w-]+)/token', ({ user, params }) => {
  needFeature('live');
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  const live = getLive(params[0]);
  if (live.status !== 'live') fail(410, 'ended', 'This live has ended.');
  const host = live.seller_id === user.id;
  const guest = db.prepare("select 1 from live_guests where live_id = ? and user_id = ? and status = 'accepted'").get(live.id, user.id);
  const name = host ? shopNameOf(user) : personNameOf(user);
  return {
    url: liveSettings().url,
    token: accessToken({ room: live.id, identity: user.id, name, canPublish: !!(host || guest), metadata: { role: host ? 'host' : guest ? 'guest' : 'viewer', avatar: user.avatar ?? null, account: !user.is_guest } }),
    role: host ? 'host' : guest ? 'guest' : 'viewer',
  };
});

route('PATCH', '/api/lives/([\\w-]+)', ({ user, params, body }) => {
  const live = modLive(user, params[0]);
  // Moderators look after the chat; the live itself (title, items, picture) stays the host's.
  if (live.seller_id !== user.id && Object.keys(body).some((k) => !['pinnedCommentId', 'chatMode', 'slowSeconds'].includes(k))) fail(403, 'forbidden', 'Only the host can change this.');
  if (body.title !== undefined) db.prepare('update lives set title = ? where id = ?').run(String(body.title).trim().slice(0, 100) || live.title, live.id);
  if (body.description !== undefined) db.prepare('update lives set description = ? where id = ?').run(String(body.description).trim().slice(0, 1000), live.id);
  if (body.productIds !== undefined) db.prepare('update lives set product_ids = ? where id = ?').run(json(sellerProductIds(user.id, body.productIds)), live.id);
  if (body.pinnedProductId !== undefined) {
    const pin = body.pinnedProductId && sellerProductIds(user.id, [body.pinnedProductId])[0];
    db.prepare('update lives set pinned_product_id = ? where id = ?').run(pin || null, live.id);
  }
  if (body.pinnedCommentId !== undefined) db.prepare('update lives set pinned_comment_id = ? where id = ?').run(body.pinnedCommentId ? String(body.pinnedCommentId) : null, live.id);
  if (body.chatMode !== undefined && ['everyone', 'followers', 'off'].includes(body.chatMode)) db.prepare('update lives set chat_mode = ? where id = ?').run(body.chatMode, live.id);
  if (body.slowSeconds !== undefined) db.prepare('update lives set slow_seconds = ? where id = ?').run([0, 10, 30, 60].includes(Number(body.slowSeconds)) ? Number(body.slowSeconds) : 0, live.id);
  if (body.videoFit !== undefined && ['fit', 'fill'].includes(body.videoFit)) db.prepare('update lives set video_fit = ? where id = ?').run(body.videoFit, live.id);
  if (body.viewers !== undefined) db.prepare('update lives set peak_viewers = max(peak_viewers, ?) where id = ?').run(Math.max(0, Math.floor(Number(body.viewers) || 0)), live.id);
  const fresh = liveOut(db.prepare('select * from lives where id = ?').get(live.id));
  if (body.viewers === undefined || Object.keys(body).length > 1) liveEvent(live.id, { type: 'updated', live: fresh });
  return fresh;
});

route('POST', '/api/lives/([\\w-]+)/end', async ({ user, params }) => {
  const live = ownLive(user, params[0]);
  db.prepare("update lives set status = 'ended', ended_at = ? where id = ?").run(now(), live.id);
  liveEvent(live.id, { type: 'ended' });
  broadcast('lives');
  await closeRoom(live.id);
  return liveOut(db.prepare('select * from lives where id = ?').get(live.id));
});

const liveCommentRuns = new Map();
const liveSlow = new Map(); // live|user → time of the last comment (slow mode)
route('POST', '/api/lives/([\\w-]+)/comments', ({ user, params, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  const live = getLive(params[0]);
  if (live.status !== 'live') fail(410, 'ended', 'This live has ended.');
  if ((parse(live.muted) ?? []).includes(user.id) || blockedBetween(user.id, live.seller_id)) fail(403, 'muted', 'The host has turned off comments for you in this live.');
  const kind = body.kind === 'question' ? 'question' : body.kind === 'join' ? 'join' : 'comment';
  const isHost = live.seller_id === user.id;
  const onCamera = db.prepare("select 1 from live_guests where live_id = ? and user_id = ? and status = 'accepted'").get(live.id, user.id);
  if (kind !== 'join' && !isHost && !onCamera && !isLiveMod(live, user)) {
    if (live.chat_mode === 'off') fail(403, 'chat_off', 'The host has turned comments off.');
    if (live.chat_mode === 'followers' && !db.prepare('select 1 from follows where follower_id = ? and seller_id = ?').get(user.id, live.seller_id)) {
      fail(403, 'followers_only', 'Only clients can comment. Follow the shop to join the chat.');
    }
    if (live.slow_seconds > 0) {
      const key = `${live.id}|${user.id}`;
      const last = liveSlow.get(key) ?? 0;
      const wait = Math.ceil((last + live.slow_seconds * 1000 - Date.now()) / 1000);
      if (wait > 0) fail(429, 'slow_mode', `Slow mode: wait ${wait} s before your next comment.`);
      liveSlow.set(key, Date.now());
    }
  }
  const text = kind === 'join' ? 'joined' : String(body.text ?? '').trim().slice(0, 2500);
  if (!text) fail(400, 'empty_comment', 'Write a comment first.');
  const window = Date.now() - 10_000;
  const recent = (liveCommentRuns.get(user.id) ?? []).filter((t) => t > window);
  if (kind !== 'join' && recent.length >= 5) fail(429, 'too_many', 'Slow down a little — wait a few seconds.');
  liveCommentRuns.set(user.id, [...recent, Date.now()]);
  // "joined" is shown once per person per live.
  if (kind === 'join' && db.prepare("select 1 from live_comments where live_id = ? and user_id = ? and kind = 'join'").get(live.id, user.id)) return { ok: true };
  const name = live.seller_id === user.id ? shopNameOf(user) : personNameOf(user);
  const comment = { id: randomUUID(), live_id: live.id, user_id: user.id, name: name.slice(0, 60), text, kind, created_at: now() };
  db.prepare('insert into live_comments (id, live_id, user_id, name, text, kind, created_at) values (?, ?, ?, ?, ?, ?, ?)')
    .run(comment.id, comment.live_id, comment.user_id, comment.name, comment.text, comment.kind, comment.created_at);
  liveEvent(live.id, { type: 'comment', comment: liveCommentOut(comment) });
  return liveCommentOut(comment);
});

route('DELETE', '/api/lives/([\\w-]+)/comments/([\\w-]+)', ({ user, params }) => {
  const live = getLive(params[0]);
  const comment = db.prepare('select * from live_comments where id = ? and live_id = ?').get(params[1], live.id);
  if (!comment) return { ok: true };
  if (live.seller_id !== user?.id && comment.user_id !== user?.id && !isLiveMod(live, user)) fail(403, 'forbidden', 'Only the host and moderators can remove comments.');
  if (comment.user_id === live.seller_id && live.seller_id !== user?.id) fail(403, 'forbidden', 'Moderators can’t remove the host’s comments.');
  db.prepare('delete from live_comments where id = ?').run(comment.id);
  liveEvent(live.id, { type: 'comment_removed', commentId: comment.id });
  return { ok: true };
});

// Hearts arrive in small batches (many taps at once).
route('POST', '/api/lives/([\\w-]+)/like', ({ user, params, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  const live = getLive(params[0]);
  if (live.status !== 'live') return { likeCount: live.like_count };
  const count = Math.min(30, Math.max(1, Math.floor(Number(body.count) || 1)));
  db.prepare('update lives set like_count = like_count + ? where id = ?').run(count, live.id);
  const likeCount = db.prepare('select like_count from lives where id = ?').get(live.id).like_count;
  liveEvent(live.id, { type: 'likes', likeCount, count, emoji: ['❤️', '🔥', '😍', '👏'].includes(body.emoji) ? body.emoji : '❤️', from: user.id });
  return { likeCount };
});

// Joining on camera: a viewer asks, the host accepts (the guest then gets a pass with camera rights) or declines.
route('POST', '/api/lives/([\\w-]+)/guests', ({ user, params, body }) => {
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Create an account to join a live on camera.');
  const live = getLive(params[0]);
  if (live.status !== 'live') fail(410, 'ended', 'This live has ended.');
  if (live.seller_id === user.id) fail(400, 'host', 'You are the host.');
  // Answering the host's invitation to come on camera (co-host).
  const invited = parse(live.invited) ?? [];
  if (body?.accept !== undefined && invited.includes(user.id)) {
    db.prepare('update lives set invited = ? where id = ?').run(json(invited.filter((x) => x !== user.id)), live.id);
    if (body.accept) {
      const accepted = db.prepare("select count(*) as n from live_guests where live_id = ? and status = 'accepted'").get(live.id).n;
      if (accepted >= 3) fail(400, 'full', 'The live already has 3 guests on camera.');
      db.prepare("insert into live_guests (live_id, user_id, status, created_at) values (?, ?, 'accepted', ?) on conflict(live_id, user_id) do update set status = 'accepted'").run(live.id, user.id, now());
    }
    sendTo([live.seller_id], 'live', { liveId: live.id, type: 'invite_answer', uid: user.id, name: personNameOf(user), accepted: !!body.accept });
    liveEvent(live.id, { type: 'guests_changed' });
    return { status: body.accept ? 'accepted' : 'declined' };
  }
  db.prepare("insert into live_guests (live_id, user_id, status, created_at) values (?, ?, 'requested', ?) on conflict(live_id, user_id) do update set status = 'requested', created_at = excluded.created_at")
    .run(live.id, user.id, now());
  sendTo([live.seller_id], 'live', { liveId: live.id, type: 'guest_request', uid: user.id, name: personNameOf(user) });
  return { status: 'requested' };
});

route('POST', '/api/lives/([\\w-]+)/guests/([\\w-]+)', async ({ user, params, body }) => {
  const live = ownLive(user, params[0]);
  const guestId = params[1];
  const decision = body.decision;
  if (!['accept', 'decline', 'remove', 'invite'].includes(decision)) fail(400, 'invalid', 'Choose accept, decline, remove or invite.');
  const accepted = db.prepare("select count(*) as n from live_guests where live_id = ? and status = 'accepted'").get(live.id).n;
  if ((decision === 'accept' || decision === 'invite') && accepted >= 3) fail(400, 'full', 'Up to 3 guests can be on camera at once.');
  // Invite a viewer on camera without waiting for them to ask; they choose to come on or not.
  if (decision === 'invite') {
    const target = db.prepare('select id, is_guest from users where id = ?').get(guestId);
    if (!target || target.is_guest) fail(400, 'no_account', 'Only viewers with a Saligue account can come on camera.');
    if (guestId === live.seller_id) fail(400, 'host', 'You are the host.');
    db.prepare('update lives set invited = ? where id = ?').run(json([...new Set([...(parse(live.invited) ?? []), guestId])]), live.id);
    sendTo([guestId], 'live', { liveId: live.id, type: 'guest_invite', host: shopNameOf(user) });
    return { ok: true };
  }
  db.prepare('update live_guests set status = ? where live_id = ? and user_id = ?').run(decision === 'accept' ? 'accepted' : 'declined', live.id, guestId);
  if (decision === 'remove') await removeParticipant(live.id, guestId);
  sendTo([guestId], 'live', { liveId: live.id, type: 'guest_decision', decision });
  liveEvent(live.id, { type: 'guests_changed' });
  return { ok: true };
});

// Host moderation: stop someone commenting in this live.
route('POST', '/api/lives/([\\w-]+)/mute/([\\w-]+)', ({ user, params, body }) => {
  const live = modLive(user, params[0]);
  if (params[1] === live.seller_id) fail(400, 'host', 'The host can’t be muted.');
  if (live.seller_id !== user.id && (parse(live.moderators) ?? []).includes(params[1])) fail(403, 'forbidden', 'Only the host can mute a moderator.');
  const muted = new Set(parse(live.muted) ?? []);
  if (body.muted === false) muted.delete(params[1]);
  else muted.add(params[1]);
  db.prepare('update lives set muted = ? where id = ?').run(json([...muted]), live.id);
  return { ok: true };
});

// Host: make a viewer a moderator of this live, or stop it. Moderators need a Saligue account.
route('POST', '/api/lives/([\\w-]+)/moderators/([\\w-]+)', ({ user, params, body }) => {
  const live = ownLive(user, params[0]);
  const uid = params[1];
  const mods = new Set(parse(live.moderators) ?? []);
  if (body.moderator === false) mods.delete(uid);
  else {
    const target = db.prepare('select id, is_guest from users where id = ?').get(uid);
    if (!target || target.is_guest) fail(400, 'no_account', 'Only viewers with a Saligue account can be moderators.');
    if (uid === live.seller_id) fail(400, 'host', 'You are the host.');
    if (mods.size >= 10) fail(400, 'full', 'Up to 10 moderators per live.');
    mods.add(uid);
    // A moderator can always speak.
    db.prepare('update lives set muted = ? where id = ?').run(json((parse(live.muted) ?? []).filter((x) => x !== uid)), live.id);
  }
  db.prepare('update lives set moderators = ? where id = ?').run(json([...mods]), live.id);
  const fresh = liveOut(db.prepare('select * from lives where id = ?').get(live.id));
  liveEvent(live.id, { type: 'updated', live: fresh });
  sendTo([uid], 'live', { liveId: live.id, type: 'moderator', on: body.moderator !== false });
  return fresh;
});

// ---------------------------------------------------------------------------
// For You: behaviour shoppers allowed us to use (cookie banner "OK"), and the personal feed (recommend.mjs).
// ---------------------------------------------------------------------------

// The cookie banner's choice, as a cookie the server can read. "essential" = don't record behaviour.
const consentOf = (req) => /(?:^|;\s*)saligue_consent=(\w+)/.exec(req.headers.cookie || '')?.[1] ?? null;

route('POST', '/api/interactions', ({ req, user, body }) => {
  if (!user) return { ok: true, recorded: 0 };
  if (consentOf(req) === 'essential' || body.consent === 'essential') return { ok: true, recorded: 0 };
  const events = (Array.isArray(body.events) ? body.events : []).slice(0, 100);
  let recorded = 0;
  transaction(() => {
    for (const e of events) {
      const weight = INTERACTION_WEIGHTS[e.kind];
      if (weight === undefined) continue;
      const productId = String(e.productId ?? '');
      if (!db.prepare('select 1 from products where id = ?').get(productId)) continue;
      const times = Math.min(3, Math.max(0.1, Number(e.times) || 1));
      db.prepare('insert into interactions (user_id, product_id, kind, weight, created_at) values (?, ?, ?, ?, ?)').run(user.id, productId, e.kind, weight * times, now());
      recorded += 1;
    }
  });
  return { ok: true, recorded };
});

route('GET', '/api/feed', ({ user }) => feedFor(user?.id ?? null, db.prepare('select * from products').all()));

// A shopper can clear what was learned about them (Settings → Privacy).
route('DELETE', '/api/interactions', ({ user }) => {
  if (user) db.prepare('delete from interactions where user_id = ?').run(user.id);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Platform settings (admins): connect email, online payments and unlimited try-on from the browser.
// Secrets are stored on the server and never sent back, only whether they are set.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Feature switches (Admin → Features): the main parts of Saligue can be turned off without a new version.
// The server refuses switched-off features; the app hides their buttons (GET /api/features).
// ---------------------------------------------------------------------------
const FEATURES = {
  live: 'Live shopping',
  tryon: 'Realistic try-on (AI)',
  lessons: 'Community lessons (Learn)',
  challenges: 'Challenges',
  duets: 'Duets',
  captions: 'Automatic captions',
  tips: 'Tips',
  ads: 'Saligue Ads (sponsored items)',
  monetization: 'Creator monetization (applications)',
  selling: 'New item listings',
  messages: 'Messages between buyers and shops',
  comments: 'Comments',
  reviews: 'Reviews',
};
const features = () => ({ ...Object.fromEntries(Object.keys(FEATURES).map((k) => [k, true])), ...(parse(db.prepare("select value from app_config where key = 'features'").get()?.value) ?? {}) });
const featureOn = (name) => features()[name] !== false;
const needFeature = (name) => {
  if (!featureOn(name)) fail(503, 'feature_off', `${FEATURES[name] ?? 'This feature'} is switched off for now.`);
};
route('GET', '/api/features', () => features());

// What a sub-admin (type 2) may be allowed to do. The main admin (type 1) can do everything and manages admins.
const ADMIN_PERMS = {
  moderation: 'Reports, appeals, removing lessons and comments',
  ads: 'Review ads and confirm ad payments',
  money: 'Creators, monthly payouts and tips',
  users: 'Find accounts, suspend and restore them',
  content: 'Challenges',
  features: 'Switch app features on and off',
  policies: 'Edit policies, monetization and ad rules',
  platform: 'Email, payments, AI keys and the app signing key',
};
const can = (user, perm) => !!user?.admin && (user.admin_level === 1 || (user.admin_level === 2 && (parse(user.admin_perms) ?? []).includes(perm)));
const logAdmin = (user, action, detail = '') => db.prepare('insert into admin_log (user_id, action, detail, created_at) values (?, ?, ?, ?)').run(user.id, action, String(detail).slice(0, 300), now());
const requireAdmin = (user, perm = 'platform') => {
  if (!can(user, perm)) fail(403, 'forbidden', user?.admin ? 'Your admin account does not have this right. Ask the main admin.' : 'Only Saligue admins can do this.');
};
const saveConfig = (key, value) =>
  value === null
    ? db.prepare('delete from app_config where key = ?').run(key)
    : db.prepare('insert into app_config (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(key, json(value));
const masked = (secret) => (secret ? `••••${String(secret).slice(-4)}` : null);

route('GET', '/api/admin/platform', async ({ user }) => {
  requireAdmin(user, 'platform');
  const own = ownAi();
  const ownStatus = own ? await checkOwnAi(own.url, own.key) : null;
  const pay = paymentSettings();
  const count = (sql) => db.prepare(sql).get().n;
  let outbox = 0;
  try {
    outbox = readdirSync(join(resolve(process.env.SALIGUE_DATA || 'data'), 'outbox')).length;
  } catch {
    // No outbox yet.
  }
  return {
    site: siteUrl(),
    mail: { connected: mailConfigured(), from: mailFrom(), outbox, fromEnv: !!process.env.SMTP_URL },
    payments: { enabled: paymentsEnabled(), currency: pay.currency, rate: pay.rate, key: masked(pay.secretKey), webhook: `${siteUrl()}/api/payments/webhook`, fromEnv: !!process.env.FLW_SECRET_KEY },
    tryon: { unlimited: unlimitedTryOn(), key: masked(falKey()), fromEnv: !!process.env.FAL_KEY },
    hf: { key: masked(hfToken()), fromEnv: !!process.env.HF_TOKEN },
    aiServer: own ? { url: own.url, ...ownStatus, fromEnv: !!process.env.AI_SERVER_URL } : null,
    live: { enabled: liveSettings().enabled },
    stats: {
      users: count('select count(*) as n from users where is_guest = 0'),
      sellers: count("select count(*) as n from users where role = 'seller' and is_guest = 0"),
      products: count("select count(*) as n from products where status = 'active'"),
      orders: count("select count(*) as n from orders where status != 'cancelled'"),
    },
  };
});

route('PUT', '/api/admin/platform/mail', async ({ user, body }) => {
  requireAdmin(user, 'platform');
  if (body.off) {
    saveConfig('mail', null);
    return { ok: true };
  }
  const email = String(body.email ?? '').trim();
  const password = String(body.password ?? '').replace(/\s+/g, '');
  if (!EMAIL.test(email) || !password) fail(400, 'incomplete', 'Enter the email address and its app password.');
  const url = smtpUrlFor({ email, password, host: body.host ? String(body.host).trim() : undefined });
  if (!url) fail(400, 'unknown_provider', 'For this email provider, also enter its mail server (e.g. smtp.yourdomain.com).');
  try {
    await verifyMailAccount(url);
  } catch (error) {
    const reason = String(error?.message ?? error);
    fail(400, 'mail_login_failed', /535|Invalid login|Username and Password not accepted|auth/i.test(reason)
      ? 'The email provider refused the login. For Gmail, turn on 2-Step Verification and use an App Password (Google Account → Security → App passwords), not your normal password.'
      : `Could not reach the mail server: ${reason.slice(0, 160)}`);
  }
  const name = String(body.name ?? '').trim() || 'Saligue by INDECIANA';
  saveConfig('mail', { url, from: `${name.replace(/[<>"]/g, '')} <${email}>` });
  return { ok: true };
});

route('POST', '/api/admin/platform/test-email', async ({ user, body }) => {
  requireAdmin(user, 'platform');
  const to = String(body.to ?? user.email ?? '').trim();
  if (!EMAIL.test(to)) fail(400, 'invalid_email', 'Enter an email address to send the test to.');
  try {
    await sendEmailNow(to, { subject: 'Saligue test email', lines: ['Your Saligue email is working. Customers will now get order, message and password emails.'] });
  } catch (error) {
    fail(400, 'mail_failed', `The test email was not sent: ${String(error?.message ?? error).slice(0, 200)}`);
  }
  return { ok: true, to };
});

route('PUT', '/api/admin/platform/payments', async ({ user, body }) => {
  requireAdmin(user, 'platform');
  if (body.off) {
    saveConfig('payments', null);
    return { ok: true };
  }
  const secretKey = String(body.secretKey ?? '').trim();
  const secretHash = String(body.secretHash ?? '').trim();
  const currency = String(body.currency ?? 'RWF').toUpperCase();
  const rate = currency === 'USD' ? 1 : Number(body.rate);
  if (!/^FLWSECK/.test(secretKey)) fail(400, 'invalid_key', 'Paste the Secret key from Flutterwave (it starts with FLWSECK).');
  if (secretHash.length < 8) fail(400, 'invalid_hash', 'Choose a secret hash of at least 8 characters and enter the same one in Flutterwave → Settings → Webhooks.');
  if (!['RWF', 'USD', 'KES', 'UGX', 'TZS', 'NGN', 'GHS', 'ZAR', 'XAF', 'XOF'].includes(currency)) fail(400, 'invalid_currency', 'Choose a currency Flutterwave supports.');
  if (!(rate > 0)) fail(400, 'invalid_rate', `Enter how many ${currency} one dollar is worth (e.g. 1450).`);
  // Check the key with Flutterwave before saving it.
  const check = await fetch('https://api.flutterwave.com/v3/balances', { headers: { Authorization: `Bearer ${secretKey}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (check && check.status === 401) fail(400, 'invalid_key', 'Flutterwave says this secret key is not valid.');
  saveConfig('payments', { secretKey, secretHash, currency, rate });
  return { ok: true, checked: !!check?.ok };
});

route('PUT', '/api/admin/platform/aiserver', async ({ user, body }) => {
  requireAdmin(user, 'platform');
  if (body.off) {
    saveConfig('aiserver', null);
    return { ok: true };
  }
  const url = String(body.url ?? '').trim().replace(/\/+$/, '');
  const key = String(body.key ?? '').trim();
  if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(url)) fail(400, 'invalid_url', 'Enter the address the installer printed, starting with https://');
  if (key.length < 32) fail(400, 'invalid_key', 'Paste the secret key the installer printed.');
  const status = await checkOwnAi(url, key);
  if (!status.ok) fail(400, 'not_reachable', status.reason);
  saveConfig('aiserver', { url, key });
  return { ok: true, ...status };
});

// Hugging Face token for the free try-on models: checked with Hugging Face before it is saved.
route('PUT', '/api/admin/platform/hftoken', async ({ user, body }) => {
  requireAdmin(user, 'platform');
  if (body.off) {
    saveConfig('hftoken', null);
    clearResting();
    return { ok: true };
  }
  const token = String(body.token ?? '').trim();
  if (!/^hf_[A-Za-z0-9]{20,}$/.test(token)) fail(400, 'invalid_key', 'Paste a Hugging Face token (it starts with hf_).');
  const who = await fetch('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!who?.name) fail(400, 'invalid_key', 'Hugging Face did not accept this token. Create a new one (Settings → Access Tokens → Read).');
  saveConfig('hftoken', { token });
  clearResting();
  return { ok: true, account: who.name, pro: !!who.isPro };
});

route('PUT', '/api/admin/platform/tryon', async ({ user, body }) => {
  requireAdmin(user, 'platform');
  if (body.off) {
    saveConfig('tryon', null);
    return { ok: true };
  }
  const key = String(body.falKey ?? '').trim();
  if (key.length < 20) fail(400, 'invalid_key', 'Paste the API key from fal.ai (Dashboard → Keys).');
  saveConfig('tryon', { falKey: key });
  return { ok: true };
});

// The Android app's signing key, for the admin to keep a copy off the server. Without it, app updates can't be
// signed and phones refuse them. The key file is useless without its password, which is shown separately.
const SIGNING = process.env.SALIGUE_SIGNING || '/etc/saligue/android-signing.properties';
function signingInfo() {
  if (!existsSync(SIGNING)) return null;
  const props = Object.fromEntries(readFileSync(SIGNING, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  return existsSync(props.storeFile ?? '') ? props : null;
}

route('GET', '/api/admin/signing-key', ({ user }) => {
  requireAdmin(user, 'platform');
  const info = signingInfo();
  return info ? { available: true, alias: info.keyAlias } : { available: false };
});

route('GET', '/api/admin/signing-key/file', ({ user, res }) => {
  requireAdmin(user, 'platform');
  const info = signingInfo();
  if (!info) fail(404, 'not_found', 'There is no app signing key on this server yet.');
  const data = readFileSync(info.storeFile);
  res.writeHead(200, { 'Content-Type': 'application/x-pkcs12', 'Content-Length': data.length, 'Content-Disposition': 'attachment; filename="saligue-android-signing-key.p12"', 'Cache-Control': 'no-store' });
  res.end(data);
  return undefined;
});

route('POST', '/api/admin/signing-key/password', ({ user }) => {
  requireAdmin(user, 'platform');
  const info = signingInfo();
  if (!info) fail(404, 'not_found', 'There is no app signing key on this server yet.');
  return { password: info.storePassword, alias: info.keyAlias };
});

// ---------------------------------------------------------------------------
// Community: fashion lessons by anyone with an account (styling, sewing, care…), up to 4 min 30 s.
// Saligue stays about fashion: every lesson has a fashion topic, and reported lessons are hidden for review.
// ---------------------------------------------------------------------------

const LESSON_MAX_SECONDS = 270;
const LESSON_TOPICS = ['styling', 'sewing', 'care', 'shoes_accessories', 'traditional', 'business'];
const LESSON_LANGUAGES = ['rw', 'sw', 'en', 'fr'];

function lessonOut(l, viewer) {
  const author = db.prepare('select id, display_name, email, is_guest, shop, avatar, role, official from users where id = ?').get(l.user_id);
  return {
    id: l.id,
    authorId: l.user_id,
    authorName: author?.role === 'seller' ? shopNameOf(author) : personNameOf(author),
    authorAvatar: author?.avatar ?? null,
    authorIsShop: author?.role === 'seller',
    official: !!author?.official,
    title: l.title,
    description: l.description,
    topic: l.topic,
    language: l.language,
    video: l.video,
    poster: l.poster,
    duration: l.duration,
    likeCount: l.like_count,
    viewCount: l.view_count,
    commentCount: db.prepare('select count(*) as n from lesson_comments where lesson_id = ?').get(l.id).n,
    // A duet plays next to the lesson it answers.
    duetOf: l.duet_of ? (() => {
      const o = db.prepare('select l.id, l.title, l.video, l.poster, l.hidden, u.display_name, u.email, u.is_guest, u.role, u.shop from lessons l join users u on u.id = l.user_id where l.id = ?').get(l.duet_of);
      return o && !o.hidden && o.video ? { id: o.id, title: o.title, video: o.video, poster: o.poster, authorName: o.role === 'seller' ? shopNameOf(o) : personNameOf(o) } : null;
    })() : null,
    duetCount: db.prepare('select count(*) as n from lessons where duet_of = ? and video is not null and hidden = 0').get(l.id).n,
    // Timed captions (WebVTT): made on Saligue's server for English, French and Kiswahili, or typed by the teacher.
    captions: parse(l.captions) ?? [],
    captionsStatus: l.captions_status ?? null,
    challenge: l.challenge_id ? db.prepare('select id, title from challenges where id = ?').get(l.challenge_id) ?? null : null,
    liked: !!(viewer && db.prepare('select 1 from lesson_likes where lesson_id = ? and user_id = ?').get(l.id, viewer.id)),
    mine: viewer?.id === l.user_id,
    hidden: viewer?.id === l.user_id ? !!l.hidden : undefined,
    createdAt: l.created_at,
  };
}

// Newest first, with an even chance for new teachers: a lesson from someone with few views comes up every
// few lessons, so a first video gets seen (no "cold start" wall).
route('GET', '/api/lessons', ({ user, url }) => {
  const topic = url.searchParams.get('topic');
  const author = url.searchParams.get('author');
  const following = url.searchParams.get('following') === '1';
  const where = ["video is not null", 'hidden = 0'];
  const args = [];
  if (topic && LESSON_TOPICS.includes(topic)) where.push('topic = ?'), args.push(topic);
  const challenge = url.searchParams.get('challenge');
  if (challenge) {
    where.push('challenge_id = ?');
    args.push(challenge);
    return db.prepare(`select * from lessons where ${where.join(' and ')} order by like_count desc, created_at asc limit 200`).all(...args).map((l, i) => ({ ...lessonOut(l, user), rank: i + 1 }));
  }
  if (author) where.push('user_id = ?'), args.push(author);
  // Teachers see their own hidden lessons (to appeal).
  if (author && author === user?.id) where.splice(where.indexOf('hidden = 0'), 1);
  if (following) {
    if (!user) return [];
    where.push('user_id in (select seller_id from follows where follower_id = ?)'), args.push(user.id);
  }
  const rows = db.prepare(`select * from lessons where ${where.join(' and ')} order by created_at desc limit 200`).all(...args);
  if (author || following) return rows.map((l) => lessonOut(l, user));
  const views = new Map(db.prepare('select user_id, sum(view_count) as v from lessons group by user_id').all().map((r) => [r.user_id, r.v]));
  const score = (l) => {
    const ageDays = (Date.now() - Date.parse(l.created_at)) / 86_400_000;
    return Math.log1p(l.like_count * 3 + l.view_count) / 4 + Math.exp(-ageDays / 10);
  };
  const established = rows.filter((l) => (views.get(l.user_id) ?? 0) >= 500).sort((a, b) => score(b) - score(a));
  const newVoices = rows.filter((l) => (views.get(l.user_id) ?? 0) < 500).sort((a, b) => score(b) - score(a));
  const out = [];
  while (established.length || newVoices.length) {
    if (newVoices.length && (out.length % 3 === 0 || !established.length)) out.push({ ...lessonOut(newVoices.shift(), user), newVoice: true });
    else out.push(lessonOut(established.shift(), user));
  }
  return out;
});

route('GET', '/api/lessons/([\\w-]+)', ({ user, params }) => {
  const l = db.prepare('select * from lessons where id = ?').get(params[0]);
  if (!l || (l.hidden && l.user_id !== user?.id)) fail(404, 'not_found', 'This lesson is not available.');
  return lessonOut(l, user);
});

route('POST', '/api/lessons', ({ user, body }) => {
  needFeature('lessons');
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Create an account to teach on Saligue.');
  const title = String(body.title ?? '').trim().slice(0, 100);
  if (title.length < 3) fail(400, 'invalid', 'Give your lesson a title.');
  if (!LESSON_TOPICS.includes(body.topic)) fail(400, 'invalid', 'Choose a fashion topic.');
  const recent = db.prepare("select count(*) as n from lessons where user_id = ? and created_at > ?").get(user.id, new Date(Date.now() - 86_400_000).toISOString()).n;
  if (recent >= 10) fail(429, 'too_many', 'Up to 10 lessons a day.');
  let challengeId = null, duetOf = null;
  if (body.challengeId) {
    needFeature('challenges');
    const c = db.prepare('select id, ends_at from challenges where id = ?').get(String(body.challengeId));
    if (!c) fail(404, 'not_found', 'This challenge does not exist.');
    if (c.ends_at < now()) fail(400, 'ended', 'This challenge has ended.');
    challengeId = c.id;
  }
  if (body.duetOf) {
    needFeature('duets');
    const o = db.prepare('select id, user_id, title, hidden, video from lessons where id = ?').get(String(body.duetOf));
    if (!o || o.hidden || !o.video) fail(404, 'not_found', 'The lesson for this duet is not available.');
    if (blockedBetween(user.id, o.user_id)) fail(403, 'blocked', 'You can’t make a duet with this lesson.');
    duetOf = o;
  }
  const id = randomUUID();
  db.prepare('insert into lessons (id, user_id, title, description, topic, language, challenge_id, duet_of, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, user.id, title, String(body.description ?? '').trim().slice(0, 2000), body.topic, LESSON_LANGUAGES.includes(body.language) ? body.language : 'en', challengeId, duetOf?.id ?? null, now());
  if (duetOf && duetOf.user_id !== user.id) notify(duetOf.user_id, { type: 'message', title: `${personNameOf(user)} made a duet with "${duetOf.title}"`, body: title, link: `/learn?lesson=${id}`, email: false });
  return lessonOut(db.prepare('select * from lessons where id = ?').get(id), user);
});

route('DELETE', '/api/lessons/([\\w-]+)', ({ user, params }) => {
  const l = db.prepare('select * from lessons where id = ?').get(params[0]);
  if (!l) return { ok: true };
  if (l.user_id !== user?.id && !can(user, 'moderation')) fail(403, 'forbidden', 'Only the teacher can remove this lesson.');
  db.prepare('delete from lessons where id = ?').run(l.id);
  broadcast('lessons');
  return { ok: true };
});

route('POST', '/api/lessons/([\\w-]+)/like', ({ user, params }) => {
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  const l = db.prepare('select id from lessons where id = ?').get(params[0]);
  if (!l) fail(404, 'not_found', 'This lesson is not available.');
  const liked = transaction(() => {
    if (db.prepare('select 1 from lesson_likes where lesson_id = ? and user_id = ?').get(l.id, user.id)) {
      db.prepare('delete from lesson_likes where lesson_id = ? and user_id = ?').run(l.id, user.id);
      db.prepare('update lessons set like_count = max(0, like_count - 1) where id = ?').run(l.id);
      return false;
    }
    db.prepare('insert into lesson_likes (lesson_id, user_id) values (?, ?)').run(l.id, user.id);
    db.prepare('update lessons set like_count = like_count + 1 where id = ?').run(l.id);
    return true;
  });
  return { liked, likeCount: db.prepare('select like_count from lessons where id = ?').get(l.id).like_count };
});

// Challenges: Saligue (admins, INDECIANA) sets a fashion theme and a deadline; anyone joins with a lesson video.
const challengeOut = (c) => {
  const entries = db.prepare('select count(*) as n, count(distinct user_id) as people from lessons where challenge_id = ? and video is not null and hidden = 0').get(c.id);
  const top = db.prepare('select poster from lessons where challenge_id = ? and video is not null and hidden = 0 order by like_count desc limit 3').all(c.id).map((r) => r.poster);
  return { id: c.id, title: c.title, description: c.description, topic: c.topic, endsAt: c.ends_at, open: c.ends_at > now(), entries: entries.n, people: entries.people, posters: top, createdAt: c.created_at };
};

route('GET', '/api/challenges', () =>
  db.prepare('select * from challenges where ends_at > ? order by ends_at desc limit 30').all(new Date(Date.now() - 30 * 86_400_000).toISOString()).map(challengeOut));

route('GET', '/api/challenges/([\\w-]+)', ({ params }) => {
  const c = db.prepare('select * from challenges where id = ?').get(params[0]);
  if (!c) fail(404, 'not_found', 'This challenge does not exist.');
  return challengeOut(c);
});

route('POST', '/api/challenges', ({ user, body }) => {
  needFeature('challenges');
  if (!can(user, 'content') && !user?.official) fail(403, 'forbidden', 'Only Saligue can start challenges.');
  const title = String(body.title ?? '').trim().slice(0, 80);
  if (title.length < 3) fail(400, 'invalid', 'Give the challenge a title.');
  if (!LESSON_TOPICS.includes(body.topic)) fail(400, 'invalid', 'Choose a fashion topic.');
  const days = Math.min(60, Math.max(1, Math.floor(Number(body.days) || 7)));
  const id = randomUUID();
  db.prepare('insert into challenges (id, title, description, topic, created_by, ends_at, created_at) values (?, ?, ?, ?, ?, ?, ?)')
    .run(id, title, String(body.description ?? '').trim().slice(0, 600), body.topic, user.id, new Date(Date.now() + days * 86_400_000).toISOString(), now());
  broadcast('lessons');
  return challengeOut(db.prepare('select * from challenges where id = ?').get(id));
});

route('DELETE', '/api/challenges/([\\w-]+)', ({ user, params }) => {
  if (!can(user, 'content') && !user?.official) fail(403, 'forbidden', 'Only Saligue can remove challenges.');
  db.prepare('update lessons set challenge_id = null where challenge_id = ?').run(params[0]);
  db.prepare('delete from challenges where id = ?').run(params[0]);
  return { ok: true };
});

// The teacher corrects the automatic captions (same timings, new words) or types captions (timed evenly).
route('PUT', '/api/lessons/([\\w-]+)/captions', ({ user, params, body }) => {
  const l = db.prepare('select * from lessons where id = ?').get(params[0]);
  if (!l || l.user_id !== user?.id) fail(404, 'not_found', 'Lesson not found.');
  const lang = ['rw', 'sw', 'en', 'fr'].includes(body.lang) ? body.lang : l.language;
  const vtt = body.cues ? cuesToVtt(body.cues) : textToVtt(body.text ?? '', l.duration);
  const others = (parse(l.captions) ?? []).filter((c) => c.lang !== lang);
  const captions = vtt ? [{ lang, url: storeVtt(vtt), auto: false }, ...others] : others;
  db.prepare("update lessons set captions = ?, captions_status = 'done' where id = ?").run(json(captions), l.id);
  broadcast('lessons');
  return lessonOut(db.prepare('select * from lessons where id = ?').get(l.id), user);
});

route('GET', '/api/captions/status', () => ({ available: captionsAvailable(), languages: AUTO_LANGUAGES }));

// Comments and questions on a lesson. Questions the teacher replied to show as answered.
route('GET', '/api/lessons/([\\w-]+)/comments', ({ params }) => {
  const lesson = db.prepare('select user_id from lessons where id = ?').get(params[0]);
  if (!lesson) fail(404, 'not_found', 'This lesson is not available.');
  const rows = db.prepare('select c.*, u.display_name, u.email, u.is_guest, u.role, u.shop, u.avatar from lesson_comments c join users u on u.id = c.user_id where c.lesson_id = ? order by c.created_at limit 500').all(params[0]);
  const out = rows.map((c) => ({ id: c.id, uid: c.user_id, name: c.role === 'seller' ? shopNameOf(c) : personNameOf(c), avatar: c.avatar ?? null, parentId: c.parent_id, kind: c.kind, text: c.text, teacher: c.user_id === lesson.user_id, createdAt: c.created_at }));
  const answered = new Set(out.filter((c) => c.teacher && c.parentId).map((c) => c.parentId));
  return out.map((c) => ({ ...c, answered: c.kind === 'question' && answered.has(c.id) }));
});

route('POST', '/api/lessons/([\\w-]+)/comments', ({ user, params, body }) => {
  needFeature('comments');
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Create an account to comment on lessons.');
  const lesson = db.prepare('select id, user_id, title from lessons where id = ?').get(params[0]);
  if (!lesson) fail(404, 'not_found', 'This lesson is not available.');
  if (blockedBetween(user.id, lesson.user_id)) fail(403, 'blocked', 'You can’t comment here.');
  const text = String(body.text ?? '').trim().slice(0, 1000);
  if (!text) fail(400, 'empty_comment', 'Write a comment first.');
  const parent = body.parentId ? db.prepare('select id, user_id from lesson_comments where id = ? and lesson_id = ?').get(String(body.parentId), lesson.id) : null;
  if (body.parentId && !parent) fail(404, 'not_found', 'That comment was removed.');
  const kind = body.kind === 'question' && !parent ? 'question' : 'comment';
  const recent = db.prepare('select count(*) as n from lesson_comments where user_id = ? and created_at > ?').get(user.id, new Date(Date.now() - 60_000).toISOString()).n;
  if (recent >= 8) fail(429, 'too_many', 'Slow down a little — wait a minute.');
  const id = randomUUID();
  db.prepare('insert into lesson_comments (id, lesson_id, user_id, parent_id, kind, text, created_at) values (?, ?, ?, ?, ?, ?, ?)').run(id, lesson.id, user.id, parent?.id ?? null, kind, text, now());
  broadcast('lesson_comments', { lessonId: lesson.id });
  const who = personNameOf(user);
  if (lesson.user_id !== user.id) notify(lesson.user_id, { type: 'message', title: kind === 'question' ? `${who} asked a question on "${lesson.title}"` : `${who} commented on "${lesson.title}"`, body: text.slice(0, 140), link: `/learn?lesson=${lesson.id}`, email: kind === 'question' });
  if (parent && parent.user_id !== user.id) notify(parent.user_id, { type: 'message', title: lesson.user_id === user.id ? `The teacher answered you on "${lesson.title}"` : `${who} replied to you on "${lesson.title}"`, body: text.slice(0, 140), link: `/learn?lesson=${lesson.id}`, email: false });
  return { id };
});

route('DELETE', '/api/lesson-comments/([\\w-]+)', ({ user, params }) => {
  const c = db.prepare('select c.*, l.user_id as teacher from lesson_comments c join lessons l on l.id = c.lesson_id where c.id = ?').get(params[0]);
  if (!c) return { ok: true };
  if (c.user_id !== user?.id && c.teacher !== user?.id && !can(user, 'moderation')) fail(403, 'forbidden', 'You can only delete your own comments.');
  db.prepare('delete from lesson_comments where id = ? or parent_id = ?').run(c.id, c.id);
  broadcast('lesson_comments', { lessonId: c.lesson_id });
  return { ok: true };
});

// A view counts once per person per lesson per day.
const lessonViews = new Map();
route('POST', '/api/lessons/([\\w-]+)/view', ({ user, params }) => {
  const key = `${params[0]}|${user?.id ?? 'anon'}|${new Date().toISOString().slice(0, 10)}`;
  if (user && !lessonViews.has(key)) {
    lessonViews.set(key, 1);
    if (lessonViews.size > 50_000) lessonViews.clear();
    db.prepare('update lessons set view_count = view_count + 1 where id = ?').run(params[0]);
  }
  return { ok: true };
});

route('POST', '/api/lessons/([\\w-]+)/report', ({ user, params, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  const l = db.prepare('select * from lessons where id = ?').get(params[0]);
  if (!l) fail(404, 'not_found', 'This lesson is not available.');
  if (l.user_id === user.id) fail(400, 'own', 'You cannot report your own lesson.');
  const reason = REPORT_REASONS[body.reason] ? body.reason : 'other';
  db.prepare('insert or ignore into lesson_reports (lesson_id, user_id, reason, created_at) values (?, ?, ?, ?)').run(l.id, user.id, reason, now());
  const count = db.prepare('select count(*) as n from lesson_reports where lesson_id = ?').get(l.id).n;
  if (count >= HIDE_AFTER_REPORTS && !l.hidden) {
    db.prepare('update lessons set hidden = 1 where id = ?').run(l.id);
    broadcast('lessons');
    notify(l.user_id, { type: 'account', title: `Your lesson "${l.title}" is hidden after reports`, body: 'Community is for fashion lessons only. Saligue will review it.', link: '/learn', email: false });
  }
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Tips: viewers support teachers and shops directly (online, or Mobile Money with a reference that an
// admin confirms). The receiver gets 90%; payouts go to their Mobile Money.
// ---------------------------------------------------------------------------

// Tip amounts and the receiver's share, as set by admins (Admin → Policies & rules).
function tipRules() {
  const saved = parse(db.prepare("select value from app_config where key = 'tips'").get()?.value) ?? {};
  return { share: Number(saved.share ?? 0.9), amounts: Array.isArray(saved.amounts) && saved.amounts.length ? saved.amounts.map(Number) : [1, 2, 5, 10, 20] };
}

function tipPaid(tipId) {
  const tip = db.prepare('select * from tips where id = ?').get(tipId);
  if (!tip) return;
  const from = db.prepare('select display_name, email, is_guest from users where id = ?').get(tip.from_user);
  notify(tip.to_user, { type: 'account', title: `${personNameOf(from)} sent you a tip of ${money(tip.amount)}`, body: tip.message || 'Thank you for teaching and sharing!', link: '/tips' });
}

route('GET', '/api/tips/settings', () => {
  const a = adSettings();
  return { amounts: tipRules().amounts, share: tipRules().share, onlinePayment: paymentsEnabled(), momoNumber: a.momoNumber, momoName: a.momoName };
});

route('POST', '/api/tips', async ({ req, user, body }) => {
  needFeature('tips');
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Create an account to send a tip.');
  const to = db.prepare('select * from users where id = ?').get(String(body.toUserId ?? ''));
  const teaches = to && db.prepare('select 1 from lessons where user_id = ? and video is not null').get(to.id);
  if (!to || (to.role !== 'seller' && !teaches)) fail(404, 'not_found', 'You can tip shops and teachers.');
  if (to.id === user.id) fail(400, 'own', 'You can’t tip yourself.');
  if (blockedBetween(user.id, to.id)) fail(403, 'blocked', 'You can’t tip this account.');
  const amount = Number(body.amount);
  if (!tipRules().amounts.includes(amount)) fail(400, 'invalid_amount', 'Choose an amount.');
  const lessonId = body.lessonId && db.prepare('select id from lessons where id = ? and user_id = ?').get(String(body.lessonId), to.id)?.id;
  const id = randomUUID();
  const reference = `TIP-${id.slice(0, 6).toUpperCase()}`;
  db.prepare('insert into tips (id, from_user, to_user, lesson_id, amount, share, message, reference, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, user.id, to.id, lessonId ?? null, amount, Math.round(amount * tipRules().share * 100) / 100, String(body.message ?? '').trim().slice(0, 200), reference, now());
  if (!paymentsEnabled()) {
    const a = adSettings();
    return { manual: true, id, reference, amount, momoNumber: a.momoNumber, momoName: a.momoName };
  }
  const email = String(user.email || '').trim().toLowerCase();
  const { currency } = paymentSettings();
  const charge = toCharge(amount);
  const txRef = `SAL-TIP-${randomBytes(8).toString('base64url')}`;
  db.prepare('insert into payments (id, user_id, order_ids, amount, currency, tip_id, created_at) values (?, ?, ?, ?, ?, ?, ?)').run(txRef, user.id, '[]', charge, currency, id, now());
  const configured = siteUrl();
  const base = /localhost|127\.0\.0\.1/.test(configured) && /^https?:\/\/[\w.:-]+$/.test(req.headers.origin || '') ? req.headers.origin : configured;
  const link = await startCheckout({ txRef, amount: charge, currency, redirectUrl: `${base}/payment`, customer: { email, name: personNameOf(user) }, title: 'Saligue tip', logo: `${configured}/icons/icon-192.png` });
  return { link, id, reference };
});

// The receiver's tips: totals, what is waiting to be paid out, and where to send it.
route('GET', '/api/me/tips', ({ user }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  const rows = db.prepare("select t.*, u.display_name, u.email, u.is_guest from tips t join users u on u.id = t.from_user where t.to_user = ? and t.status = 'paid' order by t.paid_at desc limit 200").all(user.id);
  const account = db.prepare('select momo_number, momo_name from tip_accounts where user_id = ?').get(user.id) ?? db.prepare("select momo_number, momo_name from creators where user_id = ?").get(user.id);
  return {
    share: tipRules().share,
    total: Math.round(rows.reduce((s, r) => s + r.share, 0) * 100) / 100,
    waiting: Math.round(rows.filter((r) => !r.payout_id).reduce((s, r) => s + r.share, 0) * 100) / 100,
    momo: account ? { number: account.momo_number, name: account.momo_name } : null,
    tips: rows.map((r) => ({ id: r.id, from: personNameOf(r), amount: r.share, message: r.message, lessonId: r.lesson_id, paidAt: r.paid_at, paidOut: !!r.payout_id })),
  };
});

route('PUT', '/api/me/tips/account', ({ user, body }) => {
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Please sign in.');
  const number = String(body.momoNumber ?? '').trim().slice(0, 30);
  const name = String(body.momoName ?? '').trim().slice(0, 80);
  if (number.replace(/\D/g, '').length < 9 || name.length < 2) fail(400, 'invalid', 'Enter your Mobile Money number and the name on it.');
  db.prepare('insert into tip_accounts (user_id, momo_number, momo_name) values (?, ?, ?) on conflict(user_id) do update set momo_number = excluded.momo_number, momo_name = excluded.momo_name').run(user.id, number, name);
  return { ok: true };
});

// Admin: confirm Mobile Money tips by reference, and pay receivers.
route('GET', '/api/admin/tips', ({ user }) => {
  requireAdmin(user, 'money');
  const waiting = db.prepare("select t.*, f.display_name as from_name, r.display_name as to_name, r.shop as to_shop, r.role as to_role from tips t join users f on f.id = t.from_user join users r on r.id = t.to_user where t.status = 'pending_payment' and t.created_at > ? order by t.created_at desc").all(new Date(Date.now() - 14 * 86_400_000).toISOString());
  const due = db.prepare("select t.to_user, sum(t.share) as amount, count(*) as n, u.display_name, u.shop, u.role from tips t join users u on u.id = t.to_user where t.status = 'paid' and t.payout_id is null group by t.to_user").all();
  return {
    waiting: waiting.map((t) => ({ id: t.id, reference: t.reference, amount: t.amount, from: t.from_name, to: t.to_role === 'seller' ? shopNameOf({ shop: t.to_shop, display_name: t.to_name }) : t.to_name, createdAt: t.created_at })),
    due: due.map((d) => {
      const acc = db.prepare('select momo_number, momo_name from tip_accounts where user_id = ?').get(d.to_user) ?? db.prepare('select momo_number, momo_name from creators where user_id = ?').get(d.to_user);
      return { userId: d.to_user, name: d.role === 'seller' ? shopNameOf(d) : d.display_name, amount: Math.round(d.amount * 100) / 100, tips: d.n, momoNumber: acc?.momo_number ?? null, momoName: acc?.momo_name ?? null };
    }),
  };
});

route('POST', '/api/admin/tips/([\\w-]+)', ({ user, params, body }) => {
  requireAdmin(user, 'money');
  const tip = db.prepare("select * from tips where id = ? and status = 'pending_payment'").get(params[0]);
  if (!tip) fail(404, 'not_found', 'Tip not found.');
  if (body.decision === 'cancel') db.prepare("update tips set status = 'cancelled' where id = ?").run(tip.id);
  else {
    db.prepare("update tips set status = 'paid', paid_at = ? where id = ?").run(now(), tip.id);
    tipPaid(tip.id);
  }
  return { ok: true };
});

route('POST', '/api/admin/tips/payout/([\\w-]+)', ({ user, params }) => {
  requireAdmin(user, 'money');
  const rows = db.prepare("select id, share from tips where to_user = ? and status = 'paid' and payout_id is null").all(params[0]);
  if (!rows.length) fail(400, 'nothing', 'Nothing to pay.');
  if (!db.prepare('select 1 from tip_accounts where user_id = ?').get(params[0]) && !db.prepare('select 1 from creators where user_id = ?').get(params[0])) fail(400, 'no_momo', 'This person has not added a Mobile Money number yet (My tips).');
  const id = randomUUID();
  const amount = Math.round(rows.reduce((s, r) => s + r.share, 0) * 100) / 100;
  transaction(() => {
    db.prepare("insert into payouts (id, user_id, period, amount, breakdown, status, paid_at, created_at) values (?, ?, ?, ?, ?, 'paid', ?, ?)").run(id, params[0], `tips-${now()}`, amount, json({ tips: rows.length }), now(), now());
    for (const r of rows) db.prepare('update tips set payout_id = ? where id = ?').run(id, r.id);
  });
  notify(params[0], { type: 'account', title: `Your tips were paid: ${money(amount)}`, body: 'Sent to your Mobile Money.', link: '/tips' });
  return { ok: true, amount };
});

// ---------------------------------------------------------------------------
// Admin dashboard: features, policies and rules, accounts, admins and the admin log
// ---------------------------------------------------------------------------

route('GET', '/api/admin/me', ({ user }) => {
  if (!user?.admin) fail(403, 'forbidden', 'Admins only.');
  return { level: user.admin_level, perms: user.admin_level === 1 ? Object.keys(ADMIN_PERMS) : parse(user.admin_perms) ?? [], allPerms: ADMIN_PERMS, features: FEATURES };
});

route('PUT', '/api/admin/features', ({ user, body }) => {
  requireAdmin(user, 'features');
  const next = { ...features() };
  for (const k of Object.keys(FEATURES)) if (typeof body?.[k] === 'boolean') next[k] = body[k];
  saveConfig('features', next);
  logAdmin(user, 'features', Object.entries(body ?? {}).map(([k, v]) => `${k} ${v ? 'on' : 'off'}`).join(', '));
  broadcast('features');
  return next;
});

// Policies: the text of each policy page can be edited (headings and paragraphs); empty = Saligue's default text.
const POLICIES = ['monetization', 'ads', 'terms', 'privacy', 'cookies'];
route('GET', '/api/policies/([\\w-]+)', ({ params }) => {
  if (!POLICIES.includes(params[0])) fail(404, 'not_found', 'Not found.');
  return parse(db.prepare('select value from app_config where key = ?').get(`policy:${params[0]}`)?.value);
});
route('PUT', '/api/admin/policies/([\\w-]+)', ({ user, params, body }) => {
  requireAdmin(user, 'policies');
  if (!POLICIES.includes(params[0])) fail(404, 'not_found', 'Not found.');
  if (body?.reset) {
    saveConfig(`policy:${params[0]}`, null);
    logAdmin(user, 'policy reset', params[0]);
    return null;
  }
  const sections = (Array.isArray(body?.sections) ? body.sections : []).slice(0, 40).map((x) => ({
    heading: String(x?.heading ?? '').trim().slice(0, 150),
    paragraphs: (Array.isArray(x?.paragraphs) ? x.paragraphs : []).map((t) => String(t).trim().slice(0, 3000)).filter(Boolean).slice(0, 40),
  })).filter((x) => x.heading || x.paragraphs.length);
  if (!sections.length) fail(400, 'invalid', 'Write at least one section.');
  const policy = { intro: String(body.intro ?? '').trim().slice(0, 2000), sections, updated: new Date().toISOString().slice(0, 10) };
  saveConfig(`policy:${params[0]}`, policy);
  logAdmin(user, 'policy edited', params[0]);
  return policy;
});

// Money rules: monetization requirements, creators' share, ad prices, tips.
route('GET', '/api/admin/rules', ({ user }) => {
  requireAdmin(user, 'policies');
  const a = adSettings();
  return { ...requirements(), creatorShare: a.creatorShare, cpm: a.cpm, minBudget: a.minBudget, tipShare: tipRules().share, tipAmounts: tipRules().amounts };
});
route('PUT', '/api/admin/rules', ({ user, body }) => {
  requireAdmin(user, 'policies');
  const n = (v, min, max) => Math.min(max, Math.max(min, Number(v)));
  if (body.followers !== undefined || body.views90 !== undefined || body.accountDays !== undefined) {
    const r = requirements();
    saveConfig('monetization', { followers: Math.round(n(body.followers ?? r.followers, 0, 10_000_000)), views90: Math.round(n(body.views90 ?? r.views90, 0, 1e9)), accountDays: Math.round(n(body.accountDays ?? r.accountDays, 0, 3650)) });
  }
  if (body.creatorShare !== undefined || body.cpm !== undefined || body.minBudget !== undefined) {
    const saved = parse(db.prepare("select value from app_config where key = 'ads'").get()?.value) ?? {};
    saveConfig('ads', { ...saved, ...(body.creatorShare !== undefined ? { creatorShare: n(body.creatorShare, 0, 0.9) } : {}), ...(body.cpm !== undefined ? { cpm: n(body.cpm, 0.1, 1000) } : {}), ...(body.minBudget !== undefined ? { minBudget: n(body.minBudget, 1, 100000) } : {}) });
  }
  if (body.tipShare !== undefined || body.tipAmounts !== undefined) {
    const t = tipRules();
    const amounts = Array.isArray(body.tipAmounts) ? [...new Set(body.tipAmounts.map(Number).filter((x) => x >= 0.5 && x <= 1000))].sort((a, b) => a - b).slice(0, 8) : t.amounts;
    saveConfig('tips', { share: n(body.tipShare ?? t.share, 0.5, 1), amounts: amounts.length ? amounts : t.amounts });
  }
  logAdmin(user, 'rules changed', JSON.stringify(body).slice(0, 250));
  const a = adSettings();
  return { ...requirements(), creatorShare: a.creatorShare, cpm: a.cpm, minBudget: a.minBudget, tipShare: tipRules().share, tipAmounts: tipRules().amounts };
});

// Accounts: find people, suspend or restore them.
route('GET', '/api/admin/users', ({ user, url }) => {
  requireAdmin(user, 'users');
  const q = `%${String(url.searchParams.get('q') ?? '').trim().toLowerCase()}%`;
  return db.prepare("select * from users where is_guest = 0 and (lower(email) like ? or lower(display_name) like ? or lower(coalesce(shop, '')) like ?) order by created_at desc limit 50").all(q, q, q).map((u) => ({
    id: u.id, name: u.role === 'seller' ? shopNameOf(u) : personNameOf(u), email: u.email, role: u.role, official: !!u.official, adminLevel: u.admin_level ?? 0,
    suspended: !!u.suspended, suspendReason: u.suspend_reason, createdAt: u.created_at,
    items: db.prepare('select count(*) as n from products where seller_id = ?').get(u.id).n,
    orders: db.prepare('select count(*) as n from orders where buyer_id = ?').get(u.id).n,
  }));
});
route('POST', '/api/admin/users/([\\w-]+)/suspend', ({ user, params, body }) => {
  requireAdmin(user, 'users');
  const target = db.prepare('select * from users where id = ?').get(params[0]);
  if (!target) fail(404, 'not_found', 'Account not found.');
  if (target.id === user.id) fail(400, 'self', 'You can’t suspend yourself.');
  if (target.admin_level === 1 || (target.admin_level === 2 && user.admin_level !== 1)) fail(403, 'forbidden', 'Only the main admin can suspend an admin, and the main admin can’t be suspended.');
  const suspend = body.suspended !== false;
  const reason = suspend ? String(body.reason ?? '').trim().slice(0, 200) || null : null;
  db.prepare('update users set suspended = ?, suspend_reason = ? where id = ?').run(suspend ? 1 : 0, reason, target.id);
  if (suspend) db.prepare('delete from sessions where user_id = ?').run(target.id);
  logAdmin(user, suspend ? 'suspended' : 'restored', `${target.email}${reason ? `: ${reason}` : ''}`);
  return { ok: true };
});

// Admins: only the main admin (type 1) adds sub-admins (type 2) and chooses their rights.
const requireMain = (user) => {
  if (!(user?.admin && user.admin_level === 1)) fail(403, 'forbidden', 'Only the main admin can manage admins.');
};
route('GET', '/api/admin/admins', ({ user }) => {
  requireMain(user);
  return db.prepare('select id, display_name, email, admin_level, admin_perms, created_at from users where admin = 1 order by admin_level, created_at').all()
    .map((u) => ({ id: u.id, name: u.display_name, email: u.email, level: u.admin_level, perms: u.admin_level === 1 ? Object.keys(ADMIN_PERMS) : parse(u.admin_perms) ?? [] }));
});
const cleanPerms = (perms) => (Array.isArray(perms) ? perms : []).filter((p) => ADMIN_PERMS[p]);
route('POST', '/api/admin/admins', ({ user, body }) => {
  requireMain(user);
  const target = db.prepare('select * from users where lower(email) = ? and is_guest = 0').get(String(body.email ?? '').trim().toLowerCase());
  if (!target) fail(404, 'not_found', 'No Saligue account with this email. Ask them to create one first.');
  if (target.admin_level === 1) fail(400, 'main', 'This is a main admin.');
  const perms = cleanPerms(body.perms);
  if (!perms.length) fail(400, 'invalid', 'Choose at least one right.');
  db.prepare("update users set admin = 1, admin_level = 2, admin_perms = ? where id = ?").run(json(perms), target.id);
  notify(target.id, { type: 'account', title: 'You are now a Saligue admin', body: `Rights: ${perms.map((p) => ADMIN_PERMS[p]).join('; ')}.`, link: '/admin' });
  logAdmin(user, 'sub-admin added', `${target.email}: ${perms.join(', ')}`);
  return { ok: true };
});
route('PUT', '/api/admin/admins/([\\w-]+)', ({ user, params, body }) => {
  requireMain(user);
  const target = db.prepare('select * from users where id = ? and admin_level = 2').get(params[0]);
  if (!target) fail(404, 'not_found', 'Sub-admin not found.');
  const perms = cleanPerms(body.perms);
  if (!perms.length) fail(400, 'invalid', 'Choose at least one right, or remove the admin.');
  db.prepare('update users set admin_perms = ? where id = ?').run(json(perms), target.id);
  logAdmin(user, 'sub-admin rights', `${target.email}: ${perms.join(', ')}`);
  return { ok: true };
});
route('DELETE', '/api/admin/admins/([\\w-]+)', ({ user, params }) => {
  requireMain(user);
  const target = db.prepare('select * from users where id = ? and admin_level = 2').get(params[0]);
  if (!target) fail(404, 'not_found', 'Sub-admin not found.');
  db.prepare("update users set admin = 0, admin_level = 0, admin_perms = '[]' where id = ?").run(target.id);
  logAdmin(user, 'sub-admin removed', target.email);
  return { ok: true };
});
route('GET', '/api/admin/log', ({ user }) => {
  requireMain(user);
  return db.prepare('select l.*, u.display_name, u.email from admin_log l left join users u on u.id = l.user_id order by l.id desc limit 200').all()
    .map((r) => ({ id: r.id, who: r.display_name || r.email || 'admin', action: r.action, detail: r.detail, at: r.created_at }));
});

// ---------------------------------------------------------------------------
// Blocking and appeals
// ---------------------------------------------------------------------------

route('GET', '/api/me/blocks', ({ user }) =>
  user ? db.prepare('select u.id, u.display_name, u.email, u.is_guest, u.role, u.shop, u.avatar, u.official from blocks b join users u on u.id = b.blocked_id where b.blocker_id = ? order by b.created_at desc').all(user.id).map(personOut) : []);

// Block or unblock someone. Blocking also ends following in both directions.
route('POST', '/api/blocks/([\\w-]+)', ({ user, params, body }) => {
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Log in to block accounts.');
  const target = db.prepare('select id from users where id = ?').get(params[0]);
  if (!target || target.id === user.id) fail(400, 'invalid', 'You can’t block this account.');
  if (body.blocked === false) db.prepare('delete from blocks where blocker_id = ? and blocked_id = ?').run(user.id, target.id);
  else transaction(() => {
    db.prepare('insert or ignore into blocks (blocker_id, blocked_id, created_at) values (?, ?, ?)').run(user.id, target.id, now());
    db.prepare('delete from follows where (follower_id = ? and seller_id = ?) or (follower_id = ? and seller_id = ?)').run(user.id, target.id, target.id, user.id);
  });
  return { blocked: body.blocked !== false };
});

const APPEAL_TARGETS = { product: 'products', lesson: 'lessons' };
const appealTarget = (kind, id) => db.prepare(`select id, ${kind === 'product' ? 'name' : 'title'} as title, ${kind === 'product' ? 'seller_id' : 'user_id'} as owner, hidden from ${APPEAL_TARGETS[kind]} where id = ?`).get(id);

route('POST', '/api/appeals', ({ user, body }) => {
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Please sign in.');
  if (!APPEAL_TARGETS[body.kind]) fail(400, 'invalid', 'Choose what to appeal.');
  const target = appealTarget(body.kind, String(body.targetId ?? ''));
  if (!target || target.owner !== user.id) fail(404, 'not_found', 'Not found.');
  if (!target.hidden) fail(400, 'not_hidden', 'This is not hidden.');
  const text = String(body.text ?? '').trim().slice(0, 1000);
  if (text.length < 10) fail(400, 'invalid', 'Explain in a few words why it should be shown again.');
  if (db.prepare("select 1 from appeals where kind = ? and target_id = ? and status = 'open'").get(body.kind, target.id)) fail(400, 'already', 'Your appeal is already being reviewed.');
  const id = randomUUID();
  db.prepare('insert into appeals (id, user_id, kind, target_id, text, created_at) values (?, ?, ?, ?, ?, ?)').run(id, user.id, body.kind, target.id, text, now());
  for (const { id: admin } of db.prepare('select id from users where admin = 1 or official = 1').all()) {
    notify(admin, { type: 'account', title: `Appeal: "${target.title}"`, body: text.slice(0, 140), link: '/admin#appeals', email: false });
  }
  return { id, status: 'open' };
});

route('GET', '/api/me/appeals', ({ user }) =>
  user ? db.prepare('select id, kind, target_id as targetId, status, note, created_at as createdAt, decided_at as decidedAt from appeals where user_id = ? order by created_at desc').all(user.id) : []);

route('GET', '/api/admin/appeals', ({ user }) => {
  requireAdmin(user, 'moderation');
  return db.prepare("select * from appeals where status = 'open' order by created_at").all().map((a) => {
    const target = appealTarget(a.kind, a.target_id);
    const reasons = db.prepare(`select reason, count(*) as n from ${a.kind === 'product' ? 'reports where product_id' : 'lesson_reports where lesson_id'} = ? group by reason`).all(a.target_id);
    return { id: a.id, kind: a.kind, targetId: a.target_id, title: target?.title ?? '(removed)', text: a.text, reasons, createdAt: a.created_at };
  });
});

// Admin decision: show it again (reports are cleared) or keep it hidden, with a note the owner receives.
route('POST', '/api/admin/appeals/([\\w-]+)', ({ user, params, body }) => {
  requireAdmin(user, 'moderation');
  const a = db.prepare("select * from appeals where id = ? and status = 'open'").get(params[0]);
  if (!a) fail(404, 'not_found', 'Appeal not found.');
  const restore = body.decision === 'restore';
  const note = String(body.note ?? '').trim().slice(0, 500) || null;
  transaction(() => {
    db.prepare('update appeals set status = ?, note = ?, decided_at = ? where id = ?').run(restore ? 'restored' : 'kept', note, now(), a.id);
    if (restore) {
      db.prepare(`update ${APPEAL_TARGETS[a.kind]} set hidden = 0 where id = ?`).run(a.target_id);
      db.prepare(`delete from ${a.kind === 'product' ? 'reports where product_id' : 'lesson_reports where lesson_id'} = ?`).run(a.target_id);
    }
  });
  broadcast(a.kind === 'product' ? 'products' : 'lessons');
  const target = appealTarget(a.kind, a.target_id);
  notify(a.user_id, {
    type: 'account',
    title: restore ? `"${target?.title}" is visible again` : `"${target?.title}" stays hidden`,
    body: note ?? (restore ? 'Saligue reviewed your appeal and agreed. Thank you.' : 'Saligue reviewed your appeal. It does not follow the rules (fashion only, honest, respectful).'),
    link: a.kind === 'product' ? '/dashboard/products' : '/learn',
  });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Following shops
// ---------------------------------------------------------------------------

const followerCount = (sellerId) => db.prepare('select count(*) as n from follows where seller_id = ?').get(sellerId).n;

route('GET', '/api/follow/([\\w-]+)', ({ user, params }) => ({
  followers: followerCount(params[0]),
  following: !!(user && db.prepare('select 1 from follows where follower_id = ? and seller_id = ?').get(user.id, params[0])),
}));

route('POST', '/api/follow/([\\w-]+)', ({ user, params }) => {
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  // Shops, and anyone who teaches in Community.
  const seller = db.prepare("select id, display_name, shop from users where id = ? and (role = 'seller' or exists (select 1 from lessons where user_id = users.id))").get(params[0]);
  if (!seller) fail(404, 'not_found', 'Shop not found.');
  if (seller.id === user.id) fail(400, 'own_shop', 'This is your own shop.');
  if (blockedBetween(user.id, seller.id)) fail(403, 'blocked', 'You can’t follow this account.');
  const following = transaction(() => {
    if (db.prepare('select 1 from follows where follower_id = ? and seller_id = ?').get(user.id, seller.id)) {
      db.prepare('delete from follows where follower_id = ? and seller_id = ?').run(user.id, seller.id);
      return false;
    }
    db.prepare('insert into follows (follower_id, seller_id, created_at) values (?, ?, ?)').run(user.id, seller.id, now());
    return true;
  });
  if (following && !user.is_guest) notify(seller.id, { type: 'account', title: `${personNameOf(user)} is now your client`, body: `You now have ${followerCount(seller.id)} clients.`, link: `/profile?id=${seller.id}`, email: false });
  return { following, followers: followerCount(seller.id) };
});

// Profiles: every shop and teacher has one. "Clients" are the people who follow them.
const PROFILE_PEOPLE = 'select u.id, u.display_name, u.email, u.is_guest, u.role, u.shop, u.avatar, u.official from follows f join users u on u.id = ';
const personOut = (u) => ({ id: u.id, name: u.role === 'seller' ? shopNameOf(u) : personNameOf(u), avatar: u.avatar ?? null, isShop: u.role === 'seller', official: !!u.official });

route('GET', '/api/profiles/([\\w-]+)', ({ user, params }) => {
  const u = db.prepare('select * from users where id = ?').get(params[0]);
  const teaches = u && db.prepare('select count(*) as n from lessons where user_id = ? and video is not null and hidden = 0').get(u.id).n;
  if (!u || u.is_guest || (u.role !== 'seller' && !teaches && u.id !== user?.id)) fail(404, 'not_found', 'This profile does not exist.');
  const shop = u.role === 'seller' ? parse(u.shop) : null;
  const rating = db.prepare('select avg(r.rating) as avg, count(*) as n from reviews r join products p on p.id = r.product_id where p.seller_id = ?').get(u.id);
  const live = db.prepare("select id from lives where seller_id = ? and status = 'live'").get(u.id);
  return {
    ...personOut(u),
    bio: shop?.bio || u.bio || '',
    shop: shop ? { city: shop.city, country: shop.country, hours: shop.hours ?? null, phone: shop.phone, whatsapp: shop.whatsapp ?? null, street: shop.street, district: shop.district ?? null, landmark: shop.landmark ?? null, mapUrl: shop.mapUrl ?? null } : null,
    email: u.role === 'seller' ? u.email : null,
    clients: followerCount(u.id),
    following: db.prepare('select count(*) as n from follows where follower_id = ?').get(u.id).n,
    items: db.prepare("select count(*) as n from products where seller_id = ? and status = 'active' and hidden = 0").get(u.id).n,
    lessons: teaches,
    rating: rating.n ? Math.round(rating.avg * 10) / 10 : null,
    ratingCount: rating.n,
    liveId: live?.id ?? null,
    isClient: !!(user && db.prepare('select 1 from follows where follower_id = ? and seller_id = ?').get(user.id, u.id)),
    mine: user?.id === u.id,
    joinedAt: u.created_at,
  };
});

// Who follows a profile (its clients) and who it follows, by name. Accounts without a name (guests) are counted, not listed.
route('GET', '/api/profiles/([\\w-]+)/clients', ({ params }) =>
  db.prepare(`${PROFILE_PEOPLE}f.follower_id where f.seller_id = ? and u.is_guest = 0 order by f.created_at desc limit 500`).all(params[0]).map(personOut));
route('GET', '/api/profiles/([\\w-]+)/following', ({ params }) =>
  db.prepare(`${PROFILE_PEOPLE}f.seller_id where f.follower_id = ? order by f.created_at desc limit 500`).all(params[0]).map(personOut));

route('GET', '/api/me/following', ({ user }) => (user ? db.prepare('select seller_id from follows where follower_id = ?').all(user.id).map((r) => r.seller_id) : []));

// ---------------------------------------------------------------------------
// Saligue Ads (ads.mjs): sellers promote items; shown as "Sponsored"; paid per 1,000 views.
// ---------------------------------------------------------------------------

function adPaid(campaignId) {
  const c = db.prepare('select * from ad_campaigns where id = ?').get(campaignId);
  if (!c) return;
  notify(c.seller_id, { type: 'sale', title: 'Ad payment received', body: `Your ad (${money(c.budget)}) is being reviewed and will start soon.`, link: '/dashboard/ads' });
  for (const { id } of db.prepare('select id from users where admin = 1 or official = 1').all()) {
    notify(id, { type: 'product', title: 'Ad waiting for review', body: `${money(c.budget)} · ${c.days} days`, link: '/admin', email: false });
  }
}

route('GET', '/api/ads/settings', () => {
  const a = adSettings();
  const pay = paymentSettings();
  return { cpm: a.cpm, minBudget: a.minBudget, maxDays: a.maxDays, onlinePayment: paymentsEnabled(), currency: pay.currency, rate: pay.rate, momoNumber: a.momoNumber, momoName: a.momoName };
});

route('GET', '/api/ads/campaigns', ({ user }) => {
  if (!user) return [];
  expireCampaigns();
  return db.prepare('select * from ad_campaigns where seller_id = ? order by created_at desc').all(user.id).map(campaignOut);
});

route('POST', '/api/ads/campaigns', ({ user, body }) => {
  needFeature('ads');
  if (!user || user.is_guest || user.role !== 'seller') fail(403, 'not_a_seller', 'Only shops can advertise.');
  const a = adSettings();
  const product = db.prepare("select * from products where id = ? and seller_id = ? and status = 'active' and hidden = 0").get(String(body.productId ?? ''), user.id);
  if (!product) fail(400, 'invalid_product', 'Choose one of your items on sale.');
  const budget = Math.round(Number(body.budget) * 100) / 100;
  const days = Math.floor(Number(body.days));
  if (!(budget >= a.minBudget && budget <= 100_000)) fail(400, 'invalid_budget', `The budget must be at least ${money(a.minBudget)}.`);
  if (!(days >= 1 && days <= a.maxDays)) fail(400, 'invalid_days', `Choose 1 to ${a.maxDays} days.`);
  const placements = (Array.isArray(body.placements) ? body.placements : ['feed', 'explore']).filter((x) => ['feed', 'explore'].includes(x));
  if (!placements.length) fail(400, 'invalid_placements', 'Choose where the ad appears.');
  const id = randomUUID();
  db.prepare('insert into ad_campaigns (id, seller_id, product_id, headline, budget, cpm, days, placements, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, user.id, product.id, String(body.headline ?? '').trim().slice(0, 80), budget, a.cpm, days, json(placements), now());
  return campaignOut(db.prepare('select * from ad_campaigns where id = ?').get(id));
});

// Pay for a campaign: online when switched on, otherwise by Mobile Money to Saligue with a reference.
route('POST', '/api/ads/campaigns/([\\w-]+)/pay', async ({ req, user, params, body }) => {
  const c = db.prepare('select * from ad_campaigns where id = ? and seller_id = ?').get(params[0], user?.id ?? '');
  if (!c) fail(404, 'not_found', 'Ad not found.');
  if (c.status !== 'pending_payment') fail(400, 'paid', 'This ad is already paid.');
  const reference = `AD-${c.id.slice(0, 6).toUpperCase()}`;
  if (!paymentsEnabled()) {
    const a = adSettings();
    return { manual: true, reference, amount: c.budget, momoNumber: a.momoNumber, momoName: a.momoName };
  }
  const email = String(user.email || body.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) fail(400, 'email_required', 'Enter your email address for the receipt.');
  const { currency } = paymentSettings();
  const amount = toCharge(c.budget);
  const txRef = `SAL-AD-${randomBytes(8).toString('base64url')}`;
  db.prepare('insert into payments (id, user_id, order_ids, amount, currency, campaign_id, created_at) values (?, ?, ?, ?, ?, ?, ?)').run(txRef, user.id, '[]', amount, currency, c.id, now());
  const configured = siteUrl();
  const base = /localhost|127\.0\.0\.1/.test(configured) && /^https?:\/\/[\w.:-]+$/.test(req.headers.origin || '') ? req.headers.origin : configured;
  const link = await startCheckout({ txRef, amount, currency, redirectUrl: `${base}/payment`, customer: { email, name: shopNameOf(user), phone: parse(user.shop)?.phone }, title: 'Saligue Ads', logo: `${configured}/icons/icon-192.png` });
  return { link, reference };
});

route('POST', '/api/ads/campaigns/([\\w-]+)/(pause|resume)', ({ user, params }) => {
  const c = db.prepare('select * from ad_campaigns where id = ? and seller_id = ?').get(params[0], user?.id ?? '');
  if (!c) fail(404, 'not_found', 'Ad not found.');
  if (params[1] === 'pause' && c.status === 'active') db.prepare("update ad_campaigns set status = 'paused' where id = ?").run(c.id);
  if (params[1] === 'resume' && c.status === 'paused') db.prepare("update ad_campaigns set status = 'active' where id = ?").run(c.id);
  return campaignOut(db.prepare('select * from ad_campaigns where id = ?').get(c.id));
});

route('GET', '/api/ads/campaigns/([\\w-]+)/stats', ({ user, params }) => {
  const c = db.prepare('select * from ad_campaigns where id = ? and seller_id = ?').get(params[0], user?.id ?? '');
  if (!c) fail(404, 'not_found', 'Ad not found.');
  return { campaign: campaignOut(c), days: db.prepare('select day, impressions, clicks, spent from ad_stats where campaign_id = ? order by day').all(c.id) };
});

// Ads to show, and their views/clicks (views are billed).
route('GET', '/api/ads', ({ user, url }) => {
  const placement = url.searchParams.get('placement') === 'explore' ? 'explore' : 'feed';
  const count = Math.min(5, Math.max(1, Number(url.searchParams.get('count')) || 2));
  if (!featureOn('ads')) return [];
  return pickAds(user?.id ?? null, count, placement);
});
route('POST', '/api/ads/events', ({ user, body }) => ({ recorded: recordAdEvents(user?.id ?? null, Array.isArray(body.events) ? body.events : []) }));

// ---------------------------------------------------------------------------
// Creator monetization (ads.mjs): strict eligibility, application, monthly earnings paid by Mobile Money.
// ---------------------------------------------------------------------------

const period = (offset = 0) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
};

route('GET', '/api/creator', ({ user }) => {
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Please sign in.');
  const creator = db.prepare('select * from creators where user_id = ?').get(user.id);
  const month = earnings(period());
  const mine = month.rows.find((r) => r.userId === user.id) ?? null;
  return {
    status: creator?.status ?? null,
    note: creator?.note ?? null,
    momo: creator ? { number: creator.momo_number, name: creator.momo_name } : null,
    requirements: requirements(),
    ...eligibility(user.id),
    followers: followerCount(user.id),
    thisMonth: { period: period(), pool: month.pool, mine },
    share: adSettings().creatorShare,
    payouts: db.prepare('select * from payouts where user_id = ? order by period desc').all(user.id)
      .map((p) => ({ id: p.id, period: p.period, amount: p.amount, status: p.status, paidAt: p.paid_at, breakdown: parse(p.breakdown) })),
  };
});

route('POST', '/api/creator/apply', ({ user, body }) => {
  needFeature('monetization');
  if (!user || user.is_guest || user.role !== 'seller') fail(403, 'not_a_seller', 'Only shops can join the program.');
  const momoNumber = String(body.momoNumber ?? '').replace(/[^\d+]/g, '');
  const momoName = String(body.momoName ?? '').trim().slice(0, 80);
  if (momoNumber.length < 9 || !momoName) fail(400, 'invalid_momo', 'Enter the Mobile Money number and the name on it, for your payouts.');
  const existing = db.prepare('select status from creators where user_id = ?').get(user.id);
  if (existing?.status === 'approved') {
    db.prepare('update creators set momo_number = ?, momo_name = ? where user_id = ?').run(momoNumber, momoName, user.id);
    return { status: 'approved' };
  }
  if (existing?.status === 'suspended') fail(403, 'suspended', 'Your monetization is suspended. Contact Saligue support.');
  if (!eligibility(user.id).eligible) fail(403, 'not_eligible', 'You don’t meet all the requirements yet.');
  db.prepare("insert into creators (user_id, status, momo_number, momo_name, applied_at) values (?, 'applied', ?, ?, ?) on conflict(user_id) do update set status = 'applied', momo_number = excluded.momo_number, momo_name = excluded.momo_name, applied_at = excluded.applied_at, note = null")
    .run(user.id, momoNumber, momoName, now());
  for (const { id } of db.prepare('select id from users where admin = 1').all()) notify(id, { type: 'account', title: 'New monetization application', body: shopNameOf(user), link: '/admin', email: false });
  return { status: 'applied' };
});

// ---------------------------------------------------------------------------
// Admin: ad review, creator applications, payouts, ad prices.
// ---------------------------------------------------------------------------

route('GET', '/api/admin/ads', ({ user }) => {
  requireAdmin(user, 'ads');
  return db.prepare("select c.*, u.display_name, u.shop from ad_campaigns c join users u on u.id = c.seller_id order by case c.status when 'in_review' then 0 when 'pending_payment' then 1 when 'active' then 2 else 3 end, c.created_at desc limit 100").all()
    .map((c) => ({ ...campaignOut(c), shop: shopNameOf(c), reference: `AD-${c.id.slice(0, 6).toUpperCase()}` }));
});

route('POST', '/api/admin/ads/([\\w-]+)', ({ user, params, body }) => {
  requireAdmin(user, 'ads');
  const c = db.prepare('select * from ad_campaigns where id = ?').get(params[0]);
  if (!c) fail(404, 'not_found', 'Ad not found.');
  const note = String(body.note ?? '').trim().slice(0, 300) || null;
  if (body.decision === 'confirm_payment' && c.status === 'pending_payment') {
    db.prepare("update ad_campaigns set status = 'in_review', payment_ref = 'manual' where id = ?").run(c.id);
    adPaid(c.id);
  } else if (body.decision === 'approve' && c.status === 'in_review') {
    startCampaign(c.id);
    notify(c.seller_id, { type: 'product', title: 'Your ad is live', body: `It runs for ${c.days} days or until ${money(c.budget)} is used.`, link: '/dashboard/ads' });
  } else if (body.decision === 'reject' && ['in_review', 'pending_payment', 'active', 'paused'].includes(c.status)) {
    db.prepare("update ad_campaigns set status = 'rejected', review_note = ? where id = ?").run(note ?? 'Does not follow the Ads Policy.', c.id);
    const refund = c.payment_ref ? Math.max(0, c.budget - c.spent) : 0;
    notify(c.seller_id, { type: 'product', title: 'Your ad was not approved', body: `${note ?? 'It does not follow the Saligue Ads Policy.'}${refund ? ` ${money(refund)} will be refunded.` : ''}`, link: '/dashboard/ads' });
  } else fail(400, 'invalid', 'This action is not possible for this ad now.');
  return campaignOut(db.prepare('select * from ad_campaigns where id = ?').get(c.id));
});

route('GET', '/api/admin/creators', ({ user }) => {
  requireAdmin(user, 'money');
  return db.prepare("select c.*, u.display_name, u.email, u.shop from creators c join users u on u.id = c.user_id order by case c.status when 'applied' then 0 else 1 end, c.applied_at desc").all()
    .map((c) => ({ userId: c.user_id, shop: shopNameOf(c), email: c.email, status: c.status, momoNumber: c.momo_number, momoName: c.momo_name, appliedAt: c.applied_at, followers: followerCount(c.user_id), ...eligibility(c.user_id) }));
});

route('POST', '/api/admin/creators/([\\w-]+)', ({ user, params, body }) => {
  requireAdmin(user, 'money');
  const decision = { approve: 'approved', reject: 'rejected', suspend: 'suspended' }[body.decision];
  if (!decision) fail(400, 'invalid', 'Choose approve, reject or suspend.');
  const note = String(body.note ?? '').trim().slice(0, 300) || null;
  const done = db.prepare('update creators set status = ?, note = ?, decided_at = ? where user_id = ?').run(decision, note, now(), params[0]);
  if (!done.changes) fail(404, 'not_found', 'Application not found.');
  const titles = { approved: 'You are now a monetized creator', rejected: 'Your monetization application was not approved', suspended: 'Your monetization is suspended' };
  notify(params[0], { type: 'account', title: titles[decision], body: note ?? (decision === 'approved' ? 'You now earn from your views, sales and new clients every month.' : 'See the Monetization Policy for details.'), link: '/dashboard/earnings' });
  return { ok: true };
});

route('GET', '/api/admin/payouts', ({ user, url }) => {
  requireAdmin(user, 'money');
  const p = /^\d{4}-\d{2}$/.test(url.searchParams.get('period') ?? '') ? url.searchParams.get('period') : period(-1);
  const rows = db.prepare('select p.*, c.momo_number, c.momo_name, u.display_name, u.shop from payouts p left join creators c on c.user_id = p.user_id join users u on u.id = p.user_id where p.period = ? order by p.amount desc').all(p);
  return {
    period: p,
    adIncome: Math.round(adIncome(p) * 100) / 100,
    estimate: p === period() ? earnings(p) : null,
    payouts: rows.map((r) => ({ id: r.id, shop: shopNameOf(r), amount: r.amount, status: r.status, momoNumber: r.momo_number, momoName: r.momo_name, paidAt: r.paid_at, reference: r.reference })),
  };
});

route('POST', '/api/admin/payouts/close', ({ user, body }) => {
  requireAdmin(user, 'money');
  const p = String(body.period ?? period(-1));
  if (!/^\d{4}-\d{2}$/.test(p) || p >= period()) fail(400, 'invalid', 'Only a finished month can be closed.');
  return { created: closeMonth(p) };
});

route('POST', '/api/admin/payouts/([\\w-]+)/paid', ({ user, params, body }) => {
  requireAdmin(user, 'money');
  const payout = db.prepare('select * from payouts where id = ?').get(params[0]);
  if (!payout) fail(404, 'not_found', 'Payout not found.');
  db.prepare("update payouts set status = 'paid', paid_at = ?, reference = ? where id = ?").run(now(), String(body.reference ?? '').slice(0, 80) || null, payout.id);
  notify(payout.user_id, { type: 'sale', title: `Payout sent: ${money(payout.amount)}`, body: `Your Saligue earnings for ${payout.period} were sent by Mobile Money.`, link: '/dashboard/earnings' });
  return { ok: true };
});

route('PUT', '/api/admin/platform/ads', ({ user, body }) => {
  requireAdmin(user, 'policies');
  const cpm = Number(body.cpm), minBudget = Number(body.minBudget), share = Number(body.creatorShare);
  if (!(cpm >= 0.1 && cpm <= 100) || !(minBudget >= 1) || !(share >= 0 && share <= 0.9)) fail(400, 'invalid', 'Check the numbers.');
  saveConfig('ads', { cpm, minBudget, creatorShare: share, momoNumber: String(body.momoNumber ?? '').trim() || null, momoName: String(body.momoName ?? '').trim() || 'INDECIANA' });
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
// Only these settings are public; the others hold passwords and keys (mail, payments, tryon).
const PUBLIC_CONFIG = ['ai'];
route('GET', '/api/config/([\\w-]+)', ({ params }) => {
  if (!PUBLIC_CONFIG.includes(params[0])) fail(404, 'not_found', 'Not found.');
  return parse(db.prepare('select value from app_config where key = ?').get(params[0])?.value);
});
route('PUT', '/api/config/([\\w-]+)', ({ user, params, body }) => {
  if (!user?.official && !can(user, 'features')) fail(403, 'forbidden', 'Only INDECIANA can change app settings.');
  if (!PUBLIC_CONFIG.includes(params[0])) fail(403, 'forbidden', 'Change this in Platform settings.');
  db.prepare('insert into app_config (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(params[0], json(body));
  return { ok: true };
});

// Realistic try-on (see tryon.mjs). A few runs per account per hour, since the free AI has a daily limit.
const tryOnRuns = new Map();
route('GET', '/api/ai/tryon', () => ({ available: featureOn('tryon'), unlimited: unlimitedTryOn(), categories: REALISTIC_CATEGORIES }));
route('POST', '/api/ai/tryon', async ({ user, body }) => {
  needFeature('tryon');
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  if (!REALISTIC_CATEGORIES.includes(body.category)) fail(400, 'unsupported', 'Realistic try-on works for tops, jackets, trousers and dresses.');
  const hour = Date.now() - 3_600_000;
  const recent = (tryOnRuns.get(user.id) ?? []).filter((t) => t > hour);
  // With the paid provider there is no daily limit; this only stops runaway scripts.
  const perHour = unlimitedTryOn() ? 300 : 20;
  if (recent.length >= perHour) fail(429, 'too_many', 'You have made many realistic looks this hour. Try again a bit later.');
  tryOnRuns.set(user.id, [...recent, Date.now()]);
  try {
    return { image: await tryOn(body.person, body.garment, body.category, String(body.description ?? '').slice(0, 120), Math.min(5, Math.max(0, Math.floor(Number(body.variant) || 0)))) };
  } catch (error) {
    if (error.cause) console.error('Realistic try-on failed:', error.cause?.message ?? error.cause);
    fail(error.status ?? 502, 'tryon_failed', error.message);
  }
});

// Crashes on shoppers' phones and browsers (src/lib/report-error.ts), written to the server log.
const clientErrors = new Map();
route('POST', '/api/client-errors', ({ req, user, body }) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket.remoteAddress;
  const minute = Date.now() - 60_000;
  const recent = (clientErrors.get(ip) ?? []).filter((t) => t > minute);
  if (recent.length >= 10) return { ok: true };
  clientErrors.set(ip, [...recent, Date.now()]);
  const clip = (v, n) => String(v ?? '').replace(/[\r\n]+/g, ' | ').slice(0, n);
  console.error(`CLIENT ERROR ${body.app ? '[app]' : '[web]'} ${clip(body.where, 120)} user=${user?.id?.slice(0, 8) ?? '-'} ua=${clip(req.headers['user-agent'], 120)}\n  ${clip(body.message, 500)}\n  ${clip(body.stack, 1500)}`);
  return { ok: true };
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
  // Build files have unique names, so they never change; AI models are large and change rarely (30 days).
  const immutable = pathname.includes('/_next/static/');
  const model = pathname.startsWith('/models/');
  res.writeHead(status, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : model ? 'public, max-age=2592000' : 'no-cache',
    // The Android/iOS apps load the AI models from here.
    ...(model ? { 'Access-Control-Allow-Origin': '*' } : {}),
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
    // The session cookie identifies the app; a site hosted elsewhere passes its token instead (EventSource can't send headers).
    const listener = userOf(req, cookieToken(req) || url.searchParams.get('token'));
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    listeners.set(res, listener?.id ?? null);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      listeners.delete(res);
    });
    return;
  }

  if (url.pathname.startsWith('/media/')) return serveMedia(res, url.pathname, req);
  // The Android app, built by `node scripts/build-app.mjs --apk` into data/downloads/.
  if (url.pathname === '/download/saligue.apk') {
    const apk = join(resolve(process.env.SALIGUE_DATA || 'data'), 'downloads', 'saligue.apk');
    if (!existsSync(apk)) return send(res, 404, 'The Android app has not been built yet.');
    res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': statSync(apk).size, 'Content-Disposition': 'attachment; filename="Saligue.apk"', 'Cache-Control': 'no-cache' });
    return createReadStream(apk).pipe(res);
  }
  if (!isApi) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    return serveStatic(req, res, url.pathname);
  }

  // Lesson video (Community): up to 4 min 30 s, same conversion as item videos.
  const lessonUpload = req.method === 'PUT' && /^\/api\/lessons\/([\w-]+)\/video$/.exec(url.pathname);
  if (lessonUpload) {
    try {
      const user = userOf(req);
      if (!user || user.is_guest) fail(401, 'not_signed_in', 'Please sign in.');
      const lesson = db.prepare('select * from lessons where id = ?').get(lessonUpload[1]);
      if (!lesson || lesson.user_id !== user.id) fail(404, 'not_found', 'Lesson not found.');
      if (!/^video\//.test(String(req.headers['content-type'] || ''))) fail(400, 'invalid_video', 'Choose a video file.');
      const file = await receiveUpload(req);
      const { video, poster, duration } = await processVideo(file, LESSON_MAX_SECONDS);
      db.prepare("update lessons set video = ?, poster = ?, duration = ?, captions = null, captions_status = null where id = ?").run(video, poster, duration, lesson.id);
      broadcast('lessons');
      if (featureOn('captions')) enqueueCaptions(lesson.id);
      return send(res, 200, lessonOut(db.prepare('select * from lessons where id = ?').get(lesson.id), user));
    } catch (error) {
      if (error instanceof HttpError) return send(res, error.status, { error: { code: error.code, message: error.message } });
      if (error.status) return send(res, error.status, { error: { code: 'invalid_video', message: error.message } });
      console.error('Lesson upload failed:', error);
      return send(res, 500, { error: { code: 'server_error', message: 'The video could not be prepared. Try another one.' } });
    }
  }

  // Item video upload: the raw video streams to a file (too big for JSON), then ffmpeg prepares it (video.mjs).
  const videoUpload = req.method === 'PUT' && /^\/api\/products\/([\w-]+)\/video$/.exec(url.pathname);
  if (videoUpload) {
    try {
      const user = userOf(req);
      if (!user) fail(401, 'not_signed_in', 'Please sign in.');
      const product = ownProduct(user, videoUpload[1]);
      if (!/^video\//.test(String(req.headers['content-type'] || ''))) fail(400, 'invalid_video', 'Choose a video file.');
      const file = await receiveUpload(req);
      const { video, poster, duration } = await processVideo(file);
      db.prepare('update products set video = ?, video_poster = ?, video_duration = ? where id = ?').run(video, poster, duration, product.id);
      broadcast('products');
      return send(res, 200, { video, poster, duration });
    } catch (error) {
      if (error instanceof HttpError) return send(res, error.status, { error: { code: error.code, message: error.message } });
      if (error.status) return send(res, error.status, { error: { code: 'invalid_video', message: error.message } });
      console.error('Video upload failed:', error);
      return send(res, 500, { error: { code: 'server_error', message: 'The video could not be prepared. Try another one.' } });
    }
  }

  try {
    const match = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
    if (!match) fail(404, 'not_found', 'Not found.');
    const params = url.pathname.match(match.pattern).slice(1);
    const bearer = (req.headers.authorization || '').startsWith('Bearer ');
    // Signed in by cookie only: refuse changes that don't come from the app itself (a plain form on another
    // site can't send JSON), so other websites can't act on someone's account.
    if (!bearer && cookieToken(req) && ['POST', 'PUT', 'PATCH'].includes(req.method) && !String(req.headers['content-type'] || '').startsWith('application/json')) {
      fail(403, 'forbidden', 'Invalid request.');
    }
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const user = userOf(req);
    const result = await match.handler({ req, res, url, params, body, user });
    // Keep the session cookie in step with the session the app uses.
    if (res.writableEnded) return;
    if (typeof result?.token === 'string') res.setHeader('Set-Cookie', sessionCookie(req, result.token));
    else if (bearer && user && cookieToken(req) !== tokenOf(req)) res.setHeader('Set-Cookie', sessionCookie(req, tokenOf(req)));
    send(res, 200, result ?? null);
  } catch (error) {
    if (error instanceof HttpError) return send(res, error.status, { error: { code: error.code, message: error.message } });
    console.error(error);
    send(res, 500, { error: { code: 'server_error', message: 'Something went wrong. Please try again.' } });
  }
});

warmUpFashionCheck();
// Items listed without an AI fingerprint (older listings, demo items) get one in the background,
// so search and the shop's learned memory include them.
(async () => {
  const missing = db.prepare('select id, image, cutout from products where embedding is null').all();
  for (const p of missing) {
    try {
      const { embedding } = await checkPhoto(p.cutout || p.image, p.id);
      db.prepare('update products set embedding = ? where id = ?').run(json(embedding), p.id);
    } catch (error) {
      console.error('Could not fingerprint', p.id, error.message);
      return;
    }
  }
  if (missing.length) {
    console.log(`Added AI fingerprints to ${missing.length} items.`);
    broadcast('products');
  }
})();
const moved = moveImagesToFiles();
if (moved) console.log(`Moved the photos of ${moved} products into files.`);
cancelAbandonedOrders();
setInterval(cancelAbandonedOrders, 30 * 60_000).unref();
// The For You model relearns from everyone's behaviour every few minutes.
try {
  train();
} catch (error) {
  console.error('Could not train the For You model:', error.message);
}
setInterval(() => {
  try {
    train();
  } catch (error) {
    console.error('Could not train the For You model:', error.message);
  }
}, 5 * 60_000).unref();
// Behaviour older than 6 months is forgotten.
setInterval(() => db.prepare('delete from interactions where created_at < ?').run(new Date(Date.now() - 183 * 86_400_000).toISOString()), 86_400_000).unref();
// Old sessions are removed once a day.
const dropOldSessions = () => db.prepare('delete from sessions where created_at < ?').run(new Date(Date.now() - SESSION_DAYS * 86_400_000).toISOString());
dropOldSessions();
setInterval(dropOldSessions, 86_400_000).unref();

server.listen(PORT, process.env.HOST || undefined, () => {
  console.log(`Saligue is running on http://localhost:${PORT}  (database: ${resolve(process.env.SALIGUE_DATA || 'data')}/saligue.db)`);
  // Captions for lessons that don't have them yet (a minute after start, so starting stays quick).
  setTimeout(() => featureOn('captions') && captionMissing(), 60_000).unref();
});
