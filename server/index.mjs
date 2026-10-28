// Saligue server: the app's own API and database (SQLite file), and the website itself, from one address.
//   npm run server          → http://localhost:8080
import http from 'node:http';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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
import { AsyncLocalStorage } from 'node:async_hooks';
import { countryOfIp } from './geo.mjs';
import { fileURLToPath } from 'node:url';
import { INTERACTION_WEIGHTS, feedFor, train } from './recommend.mjs';
import { adBalance, adIncome, adSales, adSettings, addCredit, campaignOut, closeMonth, creditUnused, earnings, eligibility, expireCampaigns, pickAds, recordAdEvents, recordConversions, requirements, startCampaign, whenCredited } from './ads.mjs';

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
    verified: !!u.verified,
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
    sellerVerified: !!r.seller_verified,
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
  // Invited by someone (their link /register?ref=…): they get coins when this shop makes its first real sale.
  const ref = String(body.ref ?? '');
  if (ref && ref !== id && db.prepare('select 1 from users where id = ? and is_guest = 0').get(ref)) db.prepare('update users set referred_by = ? where id = ? and referred_by is null').run(ref, id);
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
// Sample items (server/seed.mjs) fill the app while it is new. They are marked as samples, and leave on their own
// once real shops list enough real items.
const SAMPLES_HIDE_AT = 12;
route('GET', '/api/products', ({ user }) => {
  const rows = db.prepare("select p.*, u.avatar as seller_avatar, u.verified as seller_verified, u.email like '%@demo.saligue.app' as sample from products p left join users u on u.id = p.seller_id where p.hidden = 0 or p.seller_id = ? order by p.created_at desc")
    .all(user?.id ?? '');
  const real = rows.filter((r) => !r.sample && r.status === 'active').length;
  return rows
    .filter((r) => !r.sample || real < SAMPLES_HIDE_AT || r.seller_id === user?.id)
    .map((r) => (r.sample ? { ...productOut({ ...r, description: r.description?.replace(/\s*Demo item for trying Saligue\.?/, '') }), sample: true } : productOut(r)));
});

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
  // Once sent, a comment stays: only the shop that owns the item (or a moderator) can remove it.
  if (comment.seller_id !== user.id && !can(user, 'moderation')) fail(403, 'forbidden', 'Only the shop can remove comments on its items.');
  db.prepare('delete from comments where id = ?').run(params[0]);
  broadcast('comments', { productId: comment.product_id });
  return { ok: true };
});

// Looks: named boards of items and lessons. Making them needs an account; anyone with the link can view one.
function lookOut(l, full = false) {
  const items = db.prepare('select kind, ref_id, added_at from look_items where look_id = ? order by added_at desc').all(l.id);
  const cover = (it) => it.kind === 'product'
    ? db.prepare('select coalesce(cutout, image) as img from products where id = ?').get(it.ref_id)?.img
    : db.prepare('select poster as img from lessons where id = ?').get(it.ref_id)?.img;
  const owner = db.prepare('select id, display_name, email, is_guest, avatar, role, shop from users where id = ?').get(l.user_id);
  return {
    id: l.id,
    name: l.name,
    ownerId: l.user_id,
    ownerName: owner?.role === 'seller' ? shopNameOf(owner) : personNameOf(owner),
    count: items.length,
    covers: items.slice(0, 4).map(cover).filter(Boolean),
    items: full ? items.map((it) => ({ kind: it.kind, id: it.ref_id })) : undefined,
    updatedAt: l.updated_at,
  };
}
const ownLook = (user, id) => {
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Log in to make looks.');
  const l = db.prepare('select * from looks where id = ?').get(id);
  if (!l || l.user_id !== user.id) fail(404, 'not_found', 'This look no longer exists.');
  return l;
};
route('GET', '/api/looks', ({ user }) => {
  if (!user || user.is_guest) return [];
  return db.prepare('select * from looks where user_id = ? order by updated_at desc').all(user.id).map((l) => ({
    ...lookOut(l, true),
  }));
});
route('GET', '/api/looks/([\\w-]+)', ({ params }) => {
  const l = db.prepare('select * from looks where id = ?').get(params[0]);
  if (!l) fail(404, 'not_found', 'This look no longer exists.');
  return lookOut(l, true);
});
route('POST', '/api/looks', ({ user, body }) => {
  needFeature('looks');
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Log in to make looks.');
  const name = String(body.name ?? '').trim().slice(0, 40);
  if (!name) fail(400, 'empty', 'Give your look a name.');
  if (db.prepare('select count(*) as n from looks where user_id = ?').get(user.id).n >= 100) fail(400, 'too_many', 'You have 100 looks. Delete one first.');
  const id = randomUUID();
  db.prepare('insert into looks (id, user_id, name, created_at, updated_at) values (?, ?, ?, ?, ?)').run(id, user.id, name, now(), now());
  return lookOut(db.prepare('select * from looks where id = ?').get(id), true);
});
route('PATCH', '/api/looks/([\\w-]+)', ({ user, params, body }) => {
  const l = ownLook(user, params[0]);
  const name = String(body.name ?? '').trim().slice(0, 40);
  if (name) db.prepare('update looks set name = ?, updated_at = ? where id = ?').run(name, now(), l.id);
  return lookOut(db.prepare('select * from looks where id = ?').get(l.id), true);
});
route('DELETE', '/api/looks/([\\w-]+)', ({ user, params }) => {
  const l = ownLook(user, params[0]);
  db.prepare('delete from looks where id = ?').run(l.id);
  return { ok: true };
});
// Adds or removes one item or lesson (toggle).
route('POST', '/api/looks/([\\w-]+)/items', ({ user, params, body }) => {
  const l = ownLook(user, params[0]);
  const kind = body.kind === 'lesson' ? 'lesson' : 'product';
  const ref = String(body.id ?? '');
  const exists = kind === 'product' ? db.prepare('select 1 from products where id = ?').get(ref) : db.prepare('select 1 from lessons where id = ?').get(ref);
  if (!exists) fail(404, 'not_found', 'This is no longer on Saligue.');
  const had = db.prepare('delete from look_items where look_id = ? and kind = ? and ref_id = ?').run(l.id, kind, ref).changes;
  if (!had) {
    if (db.prepare('select count(*) as n from look_items where look_id = ?').get(l.id).n >= 60) fail(400, 'too_many', 'A look holds up to 60 pieces.');
    db.prepare('insert into look_items (look_id, kind, ref_id, added_at) values (?, ?, ?, ?)').run(l.id, kind, ref, now());
  }
  db.prepare('update looks set updated_at = ? where id = ?').run(now(), l.id);
  return { added: !had, look: lookOut(db.prepare('select * from looks where id = ?').get(l.id), true) };
});

// The weekly note: a calm summary of what someone learned and made, instead of a stream of alerts.
function weekOf(userId, since = new Date(Date.now() - 7 * 86_400_000).toISOString()) {
  const done = db.prepare('select l.id, l.title, l.topic, l.duration, d.thanked_at from lesson_done d join lessons l on l.id = d.lesson_id where d.user_id = ? and d.done_at > ? order by d.done_at desc').all(userId, since);
  const topics = {};
  for (const l of done) topics[l.topic] = (topics[l.topic] ?? 0) + 1;
  return {
    since,
    lessons: done.length,
    minutes: Math.round(done.reduce((sum, l) => sum + (l.duration ?? 0), 0) / 60),
    topics,
    recent: done.slice(0, 3).map((l) => ({ id: l.id, title: l.title })),
    thanked: done.filter((l) => l.thanked_at).length,
    answers: db.prepare("select count(*) as n from lesson_comments r join lesson_comments q on q.id = r.parent_id join lessons l on l.id = q.lesson_id where q.user_id = ? and q.kind = 'question' and r.user_id = l.user_id and r.created_at > ?").get(userId, since).n
      + db.prepare('select count(*) as n from product_questions where user_id = ? and answered_at > ?').get(userId, since).n,
    looks: db.prepare('select count(distinct li.look_id) as n from look_items li join looks k on k.id = li.look_id where k.user_id = ? and li.added_at > ?').get(userId, since).n,
    saved: db.prepare('select count(*) as n from look_items li join looks k on k.id = li.look_id where k.user_id = ? and li.added_at > ?').get(userId, since).n,
    newFromFollowed: db.prepare("select count(*) as n from products p join follows f on f.seller_id = p.seller_id where f.follower_id = ? and p.created_at > ? and p.status = 'active' and p.hidden = 0").get(userId, since).n
      + db.prepare('select count(*) as n from lessons l join follows f on f.seller_id = l.user_id where f.follower_id = ? and l.created_at > ? and l.hidden = 0').get(userId, since).n,
  };
}
route('GET', '/api/me/week', ({ user }) => {
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Log in to see your week.');
  return weekOf(user.id);
});

// Ask the shop: questions on an item. Answered ones are public, so the next shopper sees the answer;
// waiting ones are seen only by the person who asked and the shop.
function questionOut(q, viewer, sellerId) {
  const asker = db.prepare('select display_name, email, is_guest, avatar from users where id = ?').get(q.user_id);
  return { id: q.id, uid: q.user_id, name: personNameOf(asker), avatar: asker?.avatar ?? null, text: q.text, answer: q.answer, answeredAt: q.answered_at, createdAt: q.created_at, mine: q.user_id === viewer?.id, canAnswer: sellerId === viewer?.id };
}
route('GET', '/api/products/([\\w-]+)/questions', ({ user, params }) => {
  const product = db.prepare('select seller_id from products where id = ?').get(params[0]);
  if (!product) fail(404, 'not_found', 'This item no longer exists.');
  const shop = product.seller_id === user?.id;
  return db.prepare('select * from product_questions where product_id = ? and (answer is not null or user_id = ? or ?) order by answer is null desc, coalesce(answered_at, created_at) desc limit 100')
    .all(params[0], user?.id ?? '', shop ? 1 : 0).map((q) => questionOut(q, user, product.seller_id));
});
route('POST', '/api/products/([\\w-]+)/questions', ({ user, params, body }) => {
  needFeature('questions');
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Log in to ask the shop.');
  const product = db.prepare('select id, name, seller_id, official from products where id = ?').get(params[0]);
  if (!product) fail(404, 'not_found', 'This item no longer exists.');
  if (product.seller_id === user.id) fail(400, 'own', 'This is your own item.');
  if (blockedBetween(user.id, product.seller_id)) fail(403, 'blocked', 'You can’t ask here.');
  const text = String(body.text ?? '').trim().slice(0, 300);
  if (text.length < 3) fail(400, 'empty', 'Write your question first.');
  const recent = db.prepare('select count(*) as n from product_questions where user_id = ? and created_at > ?').get(user.id, new Date(Date.now() - 3_600_000).toISOString()).n;
  if (recent >= 10) fail(429, 'too_many', 'Slow down a little — try again in an hour.');
  const id = randomUUID();
  db.prepare('insert into product_questions (id, product_id, user_id, text, created_at) values (?, ?, ?, ?, ?)').run(id, product.id, user.id, text, now());
  broadcast('questions', { productId: product.id });
  notify(product.seller_id, { type: 'message', title: `Question about ${product.name}`, body: text.slice(0, 140), link: `/product?id=${product.id}#questions`, email: true });
  return { id };
});
// The shop's questions across all its items, waiting ones first (Seller Center → Questions).
route('GET', '/api/seller/questions', ({ user }) => {
  if (!user) fail(401, 'not_signed_in', 'Please sign in.');
  return db.prepare('select q.*, p.name as product_name, coalesce(p.cutout, p.image) as product_image from product_questions q join products p on p.id = q.product_id where p.seller_id = ? order by q.answer is null desc, q.created_at desc limit 200')
    .all(user.id).map((q) => ({ ...questionOut(q, user, user.id), productId: q.product_id, productName: q.product_name, productImage: q.product_image }));
});
route('PUT', '/api/questions/([\\w-]+)/answer', ({ user, params, body }) => {
  const q = db.prepare('select q.*, p.seller_id, p.name as product_name from product_questions q join products p on p.id = q.product_id where q.id = ?').get(params[0]);
  if (!q) fail(404, 'not_found', 'This question was removed.');
  if (q.seller_id !== user?.id) fail(403, 'forbidden', 'Only the shop can answer.');
  const answer = String(body.answer ?? '').trim().slice(0, 600);
  if (!answer) fail(400, 'empty', 'Write the answer first.');
  db.prepare('update product_questions set answer = ?, answered_at = ? where id = ?').run(answer, now(), q.id);
  broadcast('questions', { productId: q.product_id });
  if (!q.answered_at) notify(q.user_id, { type: 'message', title: `The shop answered your question about ${q.product_name}`, body: answer.slice(0, 140), link: `/product?id=${q.product_id}#questions`, email: true });
  return { ok: true };
});
// The shop or a moderator can remove a question (spam, rude); the person who asked can't once it is answered.
route('DELETE', '/api/questions/([\\w-]+)', ({ user, params }) => {
  const q = db.prepare('select q.*, p.seller_id from product_questions q join products p on p.id = q.product_id where q.id = ?').get(params[0]);
  if (!q) return { ok: true };
  if (q.seller_id !== user?.id && !can(user, 'moderation')) fail(403, 'forbidden', 'Only the shop can remove questions.');
  db.prepare('delete from product_questions where id = ?').run(q.id);
  broadcast('questions', { productId: q.product_id });
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
      const total = Math.round(group.total * 100) / 100;
      db.prepare(`insert into orders (id, buyer_id, buyer_name, buyer_email, seller_id, shop, items, total, delivery, payment_method, fee, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.id, user.display_name || String(delivery.fullName), user.email || '', sellerId, group.shop,
        json(group.items), total, json(delivery), body.paymentMethod, saleFee(sellerId, total), now()
      );
      return { id, sellerId, group };
    });
  });
  // Sales from ads: items this buyer clicked or saw in an ad shortly before.
  for (const { id } of ids) {
    try {
      recordConversions(db.prepare('select id, items from orders where id = ?').get(id), user.id);
    } catch (error) {
      console.error('Ad sales not counted:', error);
    }
  }
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
    if (body.status === 'delivered' && order.status !== 'delivered') rewardReferral(order);
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
  // A monthly badge renewal: paid → 30 more days.
  if (payment.renewal_id) {
    const changed = transaction(() => {
      if (db.prepare('select status from payments where id = ?').get(payment.id)?.status === 'paid') return false;
      db.prepare("update payments set status = 'paid', provider_ref = ? where id = ?").run(providerRef, payment.id);
      return true;
    });
    if (changed) renewalPaid(payment.renewal_id);
    return;
  }
  // A verification fee: paid → an admin reviews the documents.
  if (payment.verification_id) {
    const changed = transaction(() => {
      if (db.prepare('select status from payments where id = ?').get(payment.id)?.status === 'paid') return false;
      db.prepare("update payments set status = 'paid', provider_ref = ? where id = ?").run(providerRef, payment.id);
      return db.prepare("update verifications set status = 'in_review' where id = ? and status = 'pending_payment'").run(payment.verification_id).changes > 0;
    });
    if (changed) verificationToReview(payment.verification_id);
    return;
  }
  // A tip: paid → the receiver is told and it counts toward their next payout.
  if (payment.coin_order_id) {
    const changed = transaction(() => {
      if (db.prepare('select status from payments where id = ?').get(payment.id)?.status === 'paid') return false;
      db.prepare("update payments set status = 'paid', provider_ref = ? where id = ?").run(providerRef, payment.id);
      return coinsPaid(payment.coin_order_id);
    });
    if (changed) coinsArrived(payment.coin_order_id);
    return;
  }
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
  const seller = db.prepare('select id, display_name, shop, avatar, official, verified from users where id = ?').get(l.seller_id);
  return {
    id: l.id,
    sellerId: l.seller_id,
    sellerName: shopNameOf(seller),
    sellerAvatar: seller?.avatar ?? null,
    sellerVerified: !!seller?.verified,
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
    // Cover picture shown in the list of lives (a photo, or a frame from the host's camera).
    thumbnail: l.thumbnail ?? null,
    // Hearts the host hopes to reach (0 = no goal), shown as a bar to everyone.
    heartGoal: l.heart_goal ?? 0,
    poll: pollOut(l.poll),
    startedAt: l.started_at,
    endedAt: l.ended_at,
  };
}

// A live poll: a question with 2–4 answers; everyone sees the counts, nobody sees who voted what.
function pollOut(raw) {
  const p = parse(raw);
  if (!p) return null;
  const votes = Object.values(p.votes ?? {});
  return { id: p.id, question: p.question, open: !!p.open, total: votes.length, options: p.options.map((text, i) => ({ text, votes: votes.filter((v) => v === i).length })) };
}
const liveThumbnail = (value) => {
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(String(value ?? ''))) fail(400, 'invalid_file', 'Choose a JPG or PNG picture for the cover.');
  return storeImage(value);
};
const blockedWordIn = (live, text) => {
  const words = parse(live.blocked_words) ?? [];
  const lower = text.toLowerCase();
  return words.some((w) => w && lower.includes(w));
};

const liveCommentOut = (c) => ({ id: c.id, uid: c.user_id, name: c.name, text: c.text, kind: c.kind, replyTo: parse(c.reply_to ?? null), gift: parse(c.gift ?? null), createdAt: c.created_at });

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

// ---------------------------------------------------------------------------
// Where people are (for ranking only, never shown): the visitor's country from their address, their city from
// their latest delivery address or their own shop; a shop's from its address. Closer comes first:
// same city, same country, same region (Africa's UN sub-regions), same continent, then the rest.
// ---------------------------------------------------------------------------
const REGIONS = JSON.parse(readFileSync(fileURLToPath(new URL('../src/lib/regions.json', import.meta.url)), 'utf8')).regions;
const COUNTRY_CODES = (() => {
  const names = new Map();
  for (const lang of ['en', 'fr', 'sw', 'rw']) {
    try {
      const display = new Intl.DisplayNames([lang], { type: 'region' });
      for (const code of Object.keys(REGIONS)) names.set(display.of(code)?.toLowerCase(), code);
    } catch {
      // Language not known to this Node build.
    }
  }
  return names;
})();
const countryCode = (value) => {
  const v = String(value ?? '').trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return COUNTRY_CODES.get(v.toLowerCase()) ?? null;
};
const sameText = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
function whereIs(user, ipCountry) {
  const shop = parse(user?.shop ?? null);
  const order = user ? db.prepare('select delivery from orders where buyer_id = ? order by created_at desc limit 1').get(user.id) : null;
  const city = parse(order?.delivery ?? null)?.city || shop?.city || null;
  const country = ipCountry || countryCode(parse(order?.delivery ?? null)?.country) || countryCode(shop?.country);
  return { country, city };
}
/** 4 same city · 3 same country · 2 same region · 1 same continent · 0 farther (or unknown). */
function closeness(a, b) {
  if (!a.country || !b.country) return 0;
  if (a.country === b.country) return sameText(a.city, b.city) ? 4 : 3;
  const [ca, ra] = REGIONS[a.country] ?? [];
  const [cb, rb] = REGIONS[b.country] ?? [];
  if (ra && ra === rb) return 2;
  return ca && ca === cb ? 1 : 0;
}
const shopPlace = (sellerId) => {
  const shop = parse(db.prepare('select shop from users where id = ?').get(sellerId)?.shop ?? null);
  return { country: countryCode(shop?.country), city: shop?.city ?? null };
};
const engage = (userId, sellerId, field, amount = 1) => {
  if (!userId || userId === sellerId) return;
  db.prepare(`insert into live_engagement (user_id, seller_id, ${field}, updated_at) values (?, ?, ?, ?)
    on conflict(user_id, seller_id) do update set ${field} = ${field} + excluded.${field}, updated_at = excluded.updated_at`).run(userId, sellerId, amount, now());
};

// The visitor's place, for ranking on the device (For You). Not shown anywhere.
route('GET', '/api/where', ({ user }) => whereIs(user, visitorCountry()));

/**
 * Lives for this viewer, closest first, then by how much they engage with each shop (hearts and double-taps,
 * comments, gifts), shops they follow or bought from, and how lively each live is.
 */
route('GET', '/api/lives', ({ user }) => {
  const lives = db.prepare("select * from lives where status = 'live' order by started_at desc limit 50").all();
  const me = whereIs(user, visitorCountry());
  const score = (l) => {
    const e = user ? db.prepare('select hearts, comments, gifts from live_engagement where user_id = ? and seller_id = ?').get(user.id, l.seller_id) : null;
    const follows = user && db.prepare('select 1 from follows where follower_id = ? and seller_id = ?').get(user.id, l.seller_id) ? 1 : 0;
    const bought = user && db.prepare("select 1 from orders where buyer_id = ? and seller_id = ? and status != 'cancelled' limit 1").get(user.id, l.seller_id) ? 1 : 0;
    const affinity = Math.log1p(e?.hearts ?? 0) * 0.6 + Math.log1p(e?.comments ?? 0) * 0.8 + Math.log1p((e?.gifts ?? 0) / 10) * 1.2 + follows * 1.5 + bought * 1.2;
    const lively = Math.log1p(l.like_count) * 0.25 + Math.log1p(l.peak_viewers) * 0.4;
    // Closeness leads (each step is worth more than a little engagement); strong engagement can still lift a far shop.
    return closeness(me, shopPlace(l.seller_id)) * 2 + affinity + lively;
  };
  return {
    enabled: liveSettings().enabled && featureOn('live'),
    lives: lives.map((l) => ({ l, s: score(l) })).sort((a, b) => b.s - a.s).map(({ l }) => liveOut(l)),
    // While no one is live: the latest lives (their covers), so the page is never empty.
    recent: lives.length ? [] : db.prepare("select * from lives where status = 'ended' and ended_at > ? order by ended_at desc limit 8").all(new Date(Date.now() - 14 * 86_400_000).toISOString()).map(liveOut),
  };
});

// Shops worth following (empty Live and Learn pages, new visitors): verified and busy shops first, nearby first.
route('GET', '/api/shops/suggested', ({ user }) => {
  const me = whereIs(user, visitorCountry());
  return db.prepare("select u.*, count(p.id) as items, coalesce(sum(p.like_count), 0) as likes from users u join products p on p.seller_id = u.id and p.status = 'active' and p.hidden = 0 where u.role = 'seller' and u.suspended = 0 and u.id != ? group by u.id").all(user?.id ?? '')
    .map((u) => ({ u, score: closeness(me, shopPlace(u.id)) + (u.verified ? 2 : 0) + Math.log1p(u.items) + Math.log1p(u.likes) * 0.5 + Math.log1p(followerCount(u.id)) }))
    .sort((a, b) => b.score - a.score).slice(0, 8)
    .map(({ u }) => ({ ...personOut(u), city: parse(u.shop)?.city ?? null, items: u.items, clients: followerCount(u.id), isClient: !!(user && db.prepare('select 1 from follows where follower_id = ? and seller_id = ?').get(user.id, u.id)) }));
});

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
  const thumbnail = body.thumbnail ? liveThumbnail(body.thumbnail) : null;
  db.prepare('insert into lives (id, seller_id, title, description, product_ids, pinned_product_id, thumbnail, started_at) values (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, user.id, title, String(body.description ?? '').trim().slice(0, 1000), json(productIds), productIds[0] ?? null, thumbnail, now());
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
  const staff = !!user && (live.seller_id === user.id || isLiveMod(live, user));
  return {
    live: liveOut(live), comments, guests, myGuestStatus: me, muted: user ? (parse(live.muted) ?? []).includes(user.id) : false, invited: user ? (parse(live.invited) ?? []).includes(user.id) : false,
    myVote: user ? parse(live.poll)?.votes?.[user.id] ?? null : null,
    // Only the host and moderators see the words they filter out of the chat.
    blockedWords: staff ? parse(live.blocked_words) ?? [] : undefined,
  };
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
  if (live.seller_id !== user.id && Object.keys(body).some((k) => !['pinnedCommentId', 'chatMode', 'slowSeconds', 'poll', 'pollOpen', 'blockedWords'].includes(k))) fail(403, 'forbidden', 'Only the host can change this.');
  if (body.thumbnail !== undefined) db.prepare('update lives set thumbnail = ? where id = ?').run(body.thumbnail ? liveThumbnail(body.thumbnail) : null, live.id);
  if (body.heartGoal !== undefined) db.prepare('update lives set heart_goal = ? where id = ?').run(Math.min(10_000_000, Math.max(0, Math.floor(Number(body.heartGoal) || 0))), live.id);
  if (body.blockedWords !== undefined) {
    const words = (Array.isArray(body.blockedWords) ? body.blockedWords : []).map((w) => String(w).trim().toLowerCase().slice(0, 30)).filter(Boolean);
    db.prepare('update lives set blocked_words = ? where id = ?').run(json([...new Set(words)].slice(0, 50)), live.id);
  }
  if (body.poll !== undefined) {
    if (body.poll === null) db.prepare('update lives set poll = null where id = ?').run(live.id);
    else {
      const question = String(body.poll.question ?? '').trim().slice(0, 120);
      const options = (Array.isArray(body.poll.options) ? body.poll.options : []).map((o) => String(o).trim().slice(0, 40)).filter(Boolean).slice(0, 4);
      if (!question || options.length < 2) fail(400, 'invalid', 'Write a question and at least two answers.');
      db.prepare('update lives set poll = ? where id = ?').run(json({ id: randomUUID(), question, options, open: true, votes: {} }), live.id);
    }
  }
  if (body.pollOpen !== undefined) {
    const p = parse(live.poll);
    if (p) db.prepare('update lives set poll = ? where id = ?').run(json({ ...p, open: !!body.pollOpen }), live.id);
  }
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
  // Words the host filters out: like TikTok, the writer still sees their comment, nobody else does.
  if (kind !== 'join' && !isHost && blockedWordIn(live, text)) {
    return liveCommentOut({ id: randomUUID(), user_id: user.id, name: personNameOf(user).slice(0, 60), text, kind, created_at: now() });
  }
  const window = Date.now() - 10_000;
  const recent = (liveCommentRuns.get(user.id) ?? []).filter((t) => t > window);
  if (kind !== 'join' && recent.length >= 5) fail(429, 'too_many', 'Slow down a little — wait a few seconds.');
  liveCommentRuns.set(user.id, [...recent, Date.now()]);
  // "joined" is shown once per person per live.
  if (kind === 'join' && db.prepare("select 1 from live_comments where live_id = ? and user_id = ? and kind = 'join'").get(live.id, user.id)) return { ok: true };
  const name = live.seller_id === user.id ? shopNameOf(user) : personNameOf(user);
  // A reply quotes the comment it answers (same live only).
  const answered = kind !== 'join' && body.replyToId ? db.prepare('select id, name, text from live_comments where id = ? and live_id = ?').get(String(body.replyToId), live.id) : null;
  const comment = { id: randomUUID(), live_id: live.id, user_id: user.id, name: name.slice(0, 60), text, kind, reply_to: answered ? json({ id: answered.id, name: answered.name, text: answered.text.slice(0, 80) }) : null, created_at: now() };
  db.prepare('insert into live_comments (id, live_id, user_id, name, text, kind, reply_to, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(comment.id, comment.live_id, comment.user_id, comment.name, comment.text, comment.kind, comment.reply_to, comment.created_at);
  liveEvent(live.id, { type: 'comment', comment: liveCommentOut(comment) });
  if (kind !== 'join') engage(user.id, live.seller_id, 'comments');
  return liveCommentOut(comment);
});

route('DELETE', '/api/lives/([\\w-]+)/comments/([\\w-]+)', ({ user, params }) => {
  const live = getLive(params[0]);
  const comment = db.prepare('select * from live_comments where id = ? and live_id = ?').get(params[1], live.id);
  if (!comment) return { ok: true };
  if (live.seller_id !== user?.id && !isLiveMod(live, user)) fail(403, 'forbidden', 'Only the host and moderators can remove comments.');
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
  engage(user.id, live.seller_id, 'hearts', count);
  const likeCount = db.prepare('select like_count from lives where id = ?').get(live.id).like_count;
  liveEvent(live.id, { type: 'likes', likeCount, count, emoji: ['❤️', '🔥', '😍', '👏'].includes(body.emoji) ? body.emoji : '❤️', from: user.id });
  return { likeCount };
});

// Voting in the host's poll (one answer per person; changing it is allowed while the poll is open).
const pollUpdates = new Map(); // live id → timer, so a burst of votes sends one update
route('POST', '/api/lives/([\\w-]+)/poll', ({ user, params, body }) => {
  if (!user) fail(401, 'not_signed_in', 'Please wait a moment and try again.');
  const live = getLive(params[0]);
  const p = parse(live.poll);
  if (!p || !p.open || live.status !== 'live') fail(400, 'closed', 'This poll is closed.');
  const option = Math.floor(Number(body.option));
  if (!(option >= 0 && option < p.options.length)) fail(400, 'invalid', 'Choose an answer.');
  p.votes = { ...(p.votes ?? {}), [user.id]: option };
  db.prepare('update lives set poll = ? where id = ?').run(json(p), live.id);
  if (!pollUpdates.has(live.id)) {
    pollUpdates.set(live.id, setTimeout(() => {
      pollUpdates.delete(live.id);
      const fresh = db.prepare('select * from lives where id = ?').get(live.id);
      if (fresh) liveEvent(live.id, { type: 'updated', live: liveOut(fresh) });
    }, 800));
  }
  return { myVote: option, poll: pollOut(json(p)) };
});

// A gift in a live: coins from the viewer, a paid tip to the host, a line in the chat and an animation for all.
route('POST', '/api/lives/([\\w-]+)/gift', ({ user, params, body }) => {
  needFeature('tips');
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Create an account to send gifts.');
  const live = getLive(params[0]);
  if (live.status !== 'live') fail(410, 'ended', 'This live has ended.');
  if (live.seller_id === user.id) fail(400, 'host', 'You can’t send gifts to yourself.');
  if (blockedBetween(user.id, live.seller_id)) fail(403, 'blocked', 'You can’t send gifts here.');
  const gift = GIFTS.find((g) => g.id === body.gift);
  if (!gift) fail(400, 'invalid', 'Choose a gift.');
  const name = personNameOf(user).slice(0, 60);
  const comment = transaction(() => {
    if (coinBalance(user.id) < gift.coins) fail(402, 'not_enough_coins', 'Not enough coins. Get more coins to send this gift.');
    addCoins(user.id, -gift.coins, `${gift.emoji} ${gift.name} in a live`, live.id);
    const dollars = gift.coins / 100;
    const tipId = randomUUID();
    db.prepare("insert into tips (id, from_user, to_user, live_id, amount, share, message, status, reference, created_at, paid_at) values (?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?)")
      .run(tipId, user.id, live.seller_id, live.id, dollars, Math.round(dollars * tipRules().share * 100) / 100, `${gift.emoji} ${gift.name} in your live`, `GIFT-${tipId.slice(0, 6).toUpperCase()}`, now(), now());
    const c = { id: randomUUID(), live_id: live.id, user_id: user.id, name, text: `sent ${gift.emoji} ${gift.name}`, kind: 'comment', gift: json({ id: gift.id, emoji: gift.emoji, name: gift.name, coins: gift.coins }), created_at: now() };
    db.prepare('insert into live_comments (id, live_id, user_id, name, text, kind, gift, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)').run(c.id, c.live_id, c.user_id, c.name, c.text, c.kind, c.gift, c.created_at);
    return c;
  });
  liveEvent(live.id, { type: 'comment', comment: liveCommentOut(comment) });
  liveEvent(live.id, { type: 'gift', from: name, emoji: gift.emoji, name: gift.name, coins: gift.coins });
  engage(user.id, live.seller_id, 'gifts', gift.coins);
  return { balance: coinBalance(user.id) };
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

// For You follows the person (likes, searches, what they spend seconds on…), wherever items come from;
// the Local tab is the one about place.
route('GET', '/api/feed', ({ user }) => feedFor(user?.id ?? null, db.prepare('select * from products').all()));

// A shopper can clear what was learned about them (Settings → Privacy).
route('DELETE', '/api/interactions', ({ user }) => {
  if (user) {
    db.prepare('delete from interactions where user_id = ?').run(user.id);
    db.prepare('delete from searches where user_id = ?').run(user.id);
  }
  return { ok: true };
});

// What someone searched for: items like it come up in their For You, wherever they're from.
route('POST', '/api/searches', ({ req, user, body }) => {
  if (!user) return { ok: true };
  if (consentOf(req) === 'essential' || body.consent === 'essential') return { ok: true };
  const q = String(body.q ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
  if (q.length < 2) return { ok: true };
  const today = db.prepare('select count(*) as n from searches where user_id = ? and created_at > ?').get(user.id, new Date(Date.now() - 86_400_000).toISOString()).n;
  if (today >= 60) return { ok: true };
  db.prepare('insert into searches (user_id, q, created_at) values (?, ?, ?)').run(user.id, q, now());
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
  verification: 'Verification badge requests',
  looks: 'Looks (boards of items and lessons)',
  questions: 'Ask the shop (questions on items)',
  weekly: 'Weekly note',
};
const features = () => ({ ...Object.fromEntries(Object.keys(FEATURES).map((k) => [k, true])), ...(parse(db.prepare("select value from app_config where key = 'features'").get()?.value) ?? {}) });
// Where each request comes from (set by the router for every API call).
const requestContext = new AsyncLocalStorage();
const visitorCountry = () => requestContext.getStore()?.country ?? null;
function countryOf(req) {
  return countryOfIp(clientIp(req));
}

// A feature can also be limited by country (e.g. monetization only where it makes sense, or a feature closed
// where the law asks): 'only' these countries, or every country 'except' these. No rule = everywhere.
const featureCountries = () => parse(db.prepare("select value from app_config where key = 'feature_countries'").get()?.value) ?? {};
function featureOn(name, country = visitorCountry()) {
  if (features()[name] === false) return false;
  const rule = featureCountries()[name];
  if (!rule?.countries?.length) return true;
  // Unknown country (rare): allowed unless the feature is limited to a list.
  if (!country) return rule.mode !== 'only';
  return rule.mode === 'only' ? rule.countries.includes(country) : !rule.countries.includes(country);
}
const needFeature = (name) => {
  if (featureOn(name)) return;
  if (features()[name] === false) fail(503, 'feature_off', `${FEATURES[name] ?? 'This feature'} is switched off for now.`);
  const why = featureCountries()[name]?.reason;
  fail(403, 'not_in_country', `${FEATURES[name] ?? 'This feature'} is not available in your country yet${why ? `: ${why}` : '.'}`);
};
// Admins see and switch the global setting (not their own country's view of it).
route('GET', '/api/admin/features', ({ user }) => {
  requireAdmin(user, 'features');
  return Object.fromEntries(Object.keys(FEATURES).map((k) => [k, features()[k] !== false]));
});
route('GET', '/api/features', () => Object.fromEntries(Object.keys(FEATURES).map((k) => [k, featureOn(k)])));
route('GET', '/api/admin/feature-countries', ({ user }) => {
  requireAdmin(user, 'features');
  return featureCountries();
});
route('PUT', '/api/admin/feature-countries', ({ user, body }) => {
  requireAdmin(user, 'features');
  if (!FEATURES[body.feature]) fail(400, 'invalid', 'Unknown feature.');
  const countries = [...new Set((Array.isArray(body.countries) ? body.countries : []).map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))].slice(0, 250);
  const all = featureCountries();
  if (!countries.length || !['only', 'except'].includes(body.mode)) delete all[body.feature];
  // Why (e.g. "waiting for the payment licence"): shown to people where it's closed, and kept in the admin log.
  else all[body.feature] = { mode: body.mode, countries, reason: String(body.reason ?? '').trim().slice(0, 160) || null };
  saveConfig('feature_countries', all);
  logAdmin(user, 'feature countries', `${body.feature}: ${all[body.feature] ? `${all[body.feature].mode} ${countries.join(' ')}${all[body.feature].reason ? ` — ${all[body.feature].reason}` : ''}` : 'everywhere'}`);
  broadcast('features');
  return all;
});

// What a sub-admin (type 2) may be allowed to do. The main admin (type 1) can do everything and manages admins.
const ADMIN_PERMS = {
  moderation: 'Reports, appeals, removing lessons and comments',
  ads: 'Review ads and confirm ad payments',
  money: 'Creators, monthly payouts and tips',
  users: 'Accounts: find, suspend, restore; verification badges',
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
// General studies (longer lessons: fashion history, design, textiles, study skills…) may run up to 10 minutes.
const GENERAL_MAX_SECONDS = 600;
const lessonMaxSeconds = (topic) => (topic === 'general' ? GENERAL_MAX_SECONDS : LESSON_MAX_SECONDS);
// Similar topics were merged (care → sewing, shoes & bags → styling; see db.mjs).
const LESSON_TOPICS = ['styling', 'sewing', 'traditional', 'business', 'general'];
const LESSON_LANGUAGES = ['rw', 'sw', 'en', 'fr'];

function lessonOut(l, viewer) {
  const author = db.prepare('select id, display_name, email, is_guest, shop, avatar, role, official, verified from users where id = ?').get(l.user_id);
  return {
    id: l.id,
    authorId: l.user_id,
    authorName: author?.role === 'seller' ? shopNameOf(author) : personNameOf(author),
    authorAvatar: author?.avatar ?? null,
    authorVerified: !!author?.verified,
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
  if (c.teacher !== user?.id && !can(user, 'moderation')) fail(403, 'forbidden', 'Only the teacher can remove comments on a lesson.');
  db.prepare('delete from lesson_comments where id = ? or parent_id = ?').run(c.id, c.id);
  broadcast('lesson_comments', { lessonId: c.lesson_id });
  return { ok: true };
});

// Watched to the end: counts in the person's weekly note, and the teacher can be thanked.
route('POST', '/api/lessons/([\\w-]+)/done', ({ user, params }) => {
  if (!user || user.is_guest) return { ok: true };
  const l = db.prepare('select id, user_id from lessons where id = ?').get(params[0]);
  if (!l || l.user_id === user.id) return { ok: true };
  db.prepare('insert into lesson_done (user_id, lesson_id, done_at) values (?, ?, ?) on conflict (user_id, lesson_id) do update set done_at = excluded.done_at').run(user.id, l.id, now());
  const row = db.prepare('select thanked_at from lesson_done where user_id = ? and lesson_id = ?').get(user.id, l.id);
  return { ok: true, thanked: !!row?.thanked_at };
});

// A free "thank you" to the teacher (once per lesson); a tip is the paid way.
route('POST', '/api/lessons/([\\w-]+)/thanks', ({ user, params }) => {
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Log in to thank a teacher.');
  const l = db.prepare('select id, user_id, title from lessons where id = ?').get(params[0]);
  if (!l) fail(404, 'not_found', 'This lesson is not available.');
  if (l.user_id === user.id) fail(400, 'own', 'This is your own lesson.');
  if (blockedBetween(user.id, l.user_id)) fail(403, 'blocked', 'You can’t do this.');
  db.prepare('insert into lesson_done (user_id, lesson_id, done_at) values (?, ?, ?) on conflict (user_id, lesson_id) do nothing').run(user.id, l.id, now());
  const fresh = db.prepare('update lesson_done set thanked_at = ? where user_id = ? and lesson_id = ? and thanked_at is null').run(now(), user.id, l.id).changes;
  if (fresh) notify(l.user_id, { type: 'message', title: `${personNameOf(user)} thanked you for "${l.title}"`, body: 'Your lesson helped someone today.', link: `/learn?lesson=${l.id}`, email: false });
  return { ok: true, thanks: db.prepare('select count(*) as n from lesson_done where lesson_id = ? and thanked_at is not null').get(l.id).n };
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

// ---------------------------------------------------------------------------
// Coins and live gifts (like TikTok): coins are bought in packs (online, or Mobile Money confirmed by an admin)
// and sent as gifts during a live. A gift is a paid tip to the host (they get the tip share, paid out with tips).
// 100 coins = $1.
// ---------------------------------------------------------------------------
const COIN_PACKS = [{ coins: 100, price: 1 }, { coins: 500, price: 5 }, { coins: 1000, price: 10 }, { coins: 2500, price: 25 }];
const GIFTS = [
  { id: 'rose', emoji: '🌹', name: 'Rose', coins: 10 },
  { id: 'heart', emoji: '💖', name: 'Big heart', coins: 50 },
  { id: 'dress', emoji: '👗', name: 'Dress', coins: 100 },
  { id: 'heels', emoji: '👠', name: 'Heels', coins: 200 },
  { id: 'bag', emoji: '👜', name: 'Designer bag', coins: 500 },
  { id: 'crown', emoji: '👑', name: 'Crown', coins: 1000 },
];
const coinBalance = (userId) => db.prepare('select coalesce(sum(amount), 0) as n from coins where user_id = ?').get(userId).n;
const addCoins = (userId, amount, reason, liveId = null) =>
  db.prepare('insert into coins (id, user_id, amount, reason, live_id, created_at) values (?, ?, ?, ?, ?, ?)').run(randomUUID(), userId, amount, reason, liveId, now());
/** Marks a coin order paid and adds the coins, once. True when it changed. */
function coinsPaid(orderId) {
  const o = db.prepare("select * from coin_orders where id = ? and status = 'pending_payment'").get(orderId);
  if (!o) return false;
  db.prepare("update coin_orders set status = 'paid', paid_at = ? where id = ?").run(now(), o.id);
  addCoins(o.user_id, o.coins, `Bought ${o.coins} coins`);
  return true;
}
function coinsArrived(orderId) {
  const o = db.prepare('select * from coin_orders where id = ?').get(orderId);
  if (o) notify(o.user_id, { type: 'account', title: `${o.coins.toLocaleString()} coins added`, body: 'Send gifts to the shops you watch live.', link: '/live', email: false });
}

route('GET', '/api/coins', ({ user }) => {
  const a = adSettings();
  return {
    balance: user ? coinBalance(user.id) : 0,
    packs: COIN_PACKS,
    gifts: GIFTS,
    onlinePayment: paymentsEnabled(),
    momoNumber: a.momoNumber,
    momoName: a.momoName,
    history: user ? db.prepare('select amount, reason, created_at from coins where user_id = ? order by created_at desc limit 40').all(user.id).map((c) => ({ amount: c.amount, reason: c.reason, createdAt: c.created_at })) : [],
    pending: user ? db.prepare("select coins, amount, reference, created_at from coin_orders where user_id = ? and status = 'pending_payment' and created_at > ? order by created_at desc").all(user.id, new Date(Date.now() - 3 * 86_400_000).toISOString())
      .map((o) => ({ coins: o.coins, amount: o.amount, reference: o.reference, createdAt: o.created_at })) : [],
  };
});

route('POST', '/api/coins/buy', async ({ req, user, body }) => {
  needFeature('tips');
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Create an account to get coins.');
  const pack = COIN_PACKS.find((p) => p.coins === Number(body.coins));
  if (!pack) fail(400, 'invalid', 'Choose a pack.');
  const id = randomUUID();
  const reference = `COIN-${id.slice(0, 6).toUpperCase()}`;
  db.prepare('insert into coin_orders (id, user_id, coins, amount, reference, created_at) values (?, ?, ?, ?, ?, ?)').run(id, user.id, pack.coins, pack.price, reference, now());
  if (!paymentsEnabled()) {
    const a = adSettings();
    for (const { id: admin } of db.prepare('select id from users where admin = 1').all()) notify(admin, { type: 'product', title: 'Coins waiting for payment', body: `${reference} · ${money(pack.price)}`, link: '/admin', email: false });
    return { manual: true, reference, amount: pack.price, momoNumber: a.momoNumber, momoName: a.momoName };
  }
  const { currency } = paymentSettings();
  const amount = toCharge(pack.price);
  const txRef = `SAL-COIN-${randomBytes(8).toString('base64url')}`;
  db.prepare('insert into payments (id, user_id, order_ids, amount, currency, coin_order_id, created_at) values (?, ?, ?, ?, ?, ?, ?)').run(txRef, user.id, '[]', amount, currency, id, now());
  const configured = siteUrl();
  const base = /localhost|127\.0\.0\.1/.test(configured) && /^https?:\/\/[\w.:-]+$/.test(req.headers.origin || '') ? req.headers.origin : configured;
  const link = await startCheckout({ txRef, amount, currency, redirectUrl: `${base}/payment`, customer: { email: user.email, name: personNameOf(user) }, title: 'Saligue coins', logo: `${configured}/icons/icon-192.png` });
  return { link, reference };
});

route('GET', '/api/admin/coins', ({ user }) => {
  requireAdmin(user, 'money');
  return db.prepare("select o.*, u.display_name, u.email from coin_orders o join users u on u.id = o.user_id where o.status = 'pending_payment' and o.created_at > ? order by o.created_at desc").all(new Date(Date.now() - 14 * 86_400_000).toISOString())
    .map((o) => ({ id: o.id, reference: o.reference, coins: o.coins, amount: o.amount, name: o.display_name, email: o.email, createdAt: o.created_at }));
});
route('POST', '/api/admin/coins/([\\w-]+)', ({ user, params, body }) => {
  requireAdmin(user, 'money');
  if (body.decision === 'confirm') {
    if (transaction(() => coinsPaid(params[0]))) coinsArrived(params[0]);
    logAdmin(user, 'coins payment confirmed', params[0]);
  } else if (body.decision === 'cancel') {
    db.prepare("update coin_orders set status = 'cancelled' where id = ? and status = 'pending_payment'").run(params[0]);
  } else fail(400, 'invalid', 'Choose an action.');
  return { ok: true };
});

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

// The first tab of the admin dashboard: the platform at a glance, and what is waiting for this admin
// (only the queues their rights cover).
route('GET', '/api/admin/overview', ({ user }) => {
  if (!user?.admin) fail(403, 'forbidden', 'Admins only.');
  const n = (sql, ...args) => db.prepare(sql).get(...args).n;
  const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const waiting = [];
  if (can(user, 'users')) waiting.push({ key: 'verifications', tab: 'accounts', count: n("select count(*) as n from verifications where status in ('pending_payment', 'in_review')") });
  if (can(user, 'moderation')) {
    waiting.push({ key: 'appeals', tab: 'moderation', count: n("select count(*) as n from appeals where status = 'open'") });
    waiting.push({ key: 'hidden', tab: 'moderation', count: n('select count(*) as n from products where hidden = 1') + n('select count(*) as n from lessons where hidden = 1') });
  }
  if (can(user, 'ads')) waiting.push({ key: 'ads', tab: 'money', count: n("select count(*) as n from ad_campaigns where status in ('in_review', 'pending_payment')") });
  if (can(user, 'money')) {
    waiting.push({ key: 'creators', tab: 'money', count: n("select count(*) as n from creators where status = 'applied'") });
    waiting.push({ key: 'tips', tab: 'money', count: n("select count(*) as n from tips where status = 'pending_payment' and created_at > ?", new Date(Date.now() - 14 * 86_400_000).toISOString()) });
    waiting.push({ key: 'coins', tab: 'money', count: n("select count(*) as n from coin_orders where status = 'pending_payment' and created_at > ?", new Date(Date.now() - 14 * 86_400_000).toISOString()) });
  }
  return {
    stats: {
      users: n('select count(*) as n from users where is_guest = 0'),
      newUsers: n('select count(*) as n from users where is_guest = 0 and created_at > ?', week),
      sellers: n("select count(*) as n from users where role = 'seller' and is_guest = 0"),
      products: n("select count(*) as n from products where status = 'active' and hidden = 0"),
      orders: n("select count(*) as n from orders where status != 'cancelled'"),
      newOrders: n("select count(*) as n from orders where status != 'cancelled' and created_at > ?", week),
      lessons: n('select count(*) as n from lessons where hidden = 0 and video is not null'),
      livesNow: n("select count(*) as n from lives where status = 'live'"),
    },
    // New accounts and orders per day for the last 30 days (the overview's chart).
    days: (() => {
      const since = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
      const perDay = (sql) => new Map(db.prepare(sql).all(since).map((r) => [r.d, r.n]));
      const users = perDay('select substr(created_at, 1, 10) as d, count(*) as n from users where is_guest = 0 and created_at >= ? group by d');
      const orders = perDay("select substr(created_at, 1, 10) as d, count(*) as n from orders where status != 'cancelled' and created_at >= ? group by d");
      return Array.from({ length: 30 }, (_, i) => {
        const date = new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10);
        return { date, users: users.get(date) ?? 0, orders: orders.get(date) ?? 0 };
      });
    })(),
    waiting,
  };
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
const POLICIES = ['monetization', 'ads', 'verification', 'terms', 'privacy', 'cookies'];
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
  return { ...requirements(), creatorShare: a.creatorShare, cpm: a.cpm, minBudget: a.minBudget, tipShare: tipRules().share, tipAmounts: tipRules().amounts, verificationPrice: verificationPrice(), saleFee: commission().rate, freeDays: commission().freeDays };
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
  if (body.verificationPrice !== undefined) saveConfig('verification', { price: Math.round(n(body.verificationPrice, 0, 1000) * 100) / 100 });
  if (body.saleFee !== undefined || body.freeDays !== undefined) {
    const c = commission();
    saveConfig('commission', { rate: n(body.saleFee ?? c.rate, 0, 0.3), freeDays: Math.round(n(body.freeDays ?? c.freeDays, 0, 3650)) });
  }
  logAdmin(user, 'rules changed', JSON.stringify(body).slice(0, 250));
  const a = adSettings();
  return { ...requirements(), creatorShare: a.creatorShare, cpm: a.cpm, minBudget: a.minBudget, tipShare: tipRules().share, tipAmounts: tipRules().amounts, verificationPrice: verificationPrice(), saleFee: commission().rate, freeDays: commission().freeDays };
});

// "Bring a shop, get coins": whoever invited a shop gets coins when that shop's first order is delivered
// (to someone other than them), so empty or fake shops earn nothing.
const referralCoins = () => Number(parse(db.prepare("select value from app_config where key = 'referral'").get()?.value)?.coins ?? 500);
function rewardReferral(order) {
  const shop = db.prepare('select id, referred_by, referral_rewarded, shop, display_name, email, is_guest, role from users where id = ?').get(order.seller_id);
  if (!shop?.referred_by || shop.referral_rewarded || order.buyer_id === shop.referred_by) return;
  const coins = referralCoins();
  if (!db.prepare('update users set referral_rewarded = 1 where id = ? and referral_rewarded = 0').run(shop.id).changes) return;
  addCoins(shop.referred_by, coins, 'Brought a shop to Saligue');
  notify(shop.referred_by, { type: 'account', title: `+${coins} coins: ${shopNameOf(shop)} made its first sale`, body: 'Thank you for bringing a shop to Saligue.', link: '/invite', email: false });
}
route('GET', '/api/me/referrals', ({ user }) => {
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Log in to invite people.');
  const people = db.prepare('select id, role, referral_rewarded, shop, display_name, email, is_guest, created_at from users where referred_by = ? order by created_at desc limit 100').all(user.id);
  return {
    coinsPerShop: referralCoins(),
    joined: people.length,
    shops: people.filter((p) => p.role === 'seller').map((p) => ({ name: shopNameOf(p), rewarded: !!p.referral_rewarded, joinedAt: p.created_at })),
    earned: db.prepare("select coalesce(sum(amount), 0) as n from coins where user_id = ? and reason = 'Brought a shop to Saligue'").get(user.id).n,
  };
});

// Saligue's fee on each sale (Admin → Rules): a share of the order, nothing during a new shop's first days,
// nothing for Saligue's own shop. Fixed on the order when it is placed, so later changes never touch old orders.
function commission() {
  const saved = parse(db.prepare("select value from app_config where key = 'commission'").get()?.value) ?? {};
  return { rate: Number(saved.rate ?? 0.05), freeDays: Number(saved.freeDays ?? 90) };
}
function freeUntil(seller) {
  return new Date(new Date(seller.created_at).getTime() + commission().freeDays * 86_400_000).toISOString();
}
function saleFee(sellerId, total) {
  const seller = db.prepare('select created_at, official from users where id = ?').get(sellerId);
  if (!seller || seller.official || freeUntil(seller) > now()) return 0;
  return Math.round(total * commission().rate * 100) / 100;
}
// Delivered sales not settled yet: what Saligue owes the shop (paid online) and what the shop owes (paid to the shop).
function openSales(sellerId) {
  const rows = db.prepare("select id, total, fee, payment_method, payment_status, created_at from orders where seller_id = ? and status = 'delivered' and settlement_id is null order by created_at").all(sellerId);
  const online = rows.filter((o) => o.payment_method === 'online' && o.payment_status === 'paid');
  const direct = rows.filter((o) => !(o.payment_method === 'online' && o.payment_status === 'paid'));
  const toShop = online.reduce((sum, o) => sum + o.total - o.fee, 0);
  const fees = direct.reduce((sum, o) => sum + o.fee, 0);
  const r2 = (v) => Math.round(v * 100) / 100;
  return { orders: rows.length, ids: rows.map((o) => o.id), onlineSales: r2(online.reduce((s, o) => s + o.total, 0)), directSales: r2(direct.reduce((s, o) => s + o.total, 0)), fees: r2(rows.reduce((s, o) => s + o.fee, 0)), balance: r2(toShop - fees) };
}

route('GET', '/api/seller/sales', ({ user }) => {
  if (!user || user.role !== 'seller') fail(403, 'forbidden', 'For shops only.');
  const c = commission();
  const account = db.prepare('select momo_number, momo_name from tip_accounts where user_id = ?').get(user.id) ?? db.prepare('select momo_number, momo_name from creators where user_id = ?').get(user.id);
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = db.prepare("select count(*) as n, coalesce(sum(total), 0) as total, coalesce(sum(fee), 0) as fees from orders where seller_id = ? and status = 'delivered' and substr(created_at, 1, 7) = ?").get(user.id, month);
  return {
    rate: user.official ? 0 : c.rate,
    freeUntil: user.official ? null : freeUntil(user),
    official: !!user.official,
    open: openSales(user.id),
    thisMonth: { orders: thisMonth.n, total: Math.round(thisMonth.total * 100) / 100, fees: Math.round(thisMonth.fees * 100) / 100 },
    momo: account ? { number: account.momo_number, name: account.momo_name } : null,
    saligueMomo: { number: adSettings().momoNumber ?? null, name: adSettings().momoName ?? 'Saligue' },
    settlements: db.prepare('select * from shop_settlements where seller_id = ? order by created_at desc limit 24').all(user.id).map((r) => ({ id: r.id, amount: r.amount, orders: r.orders, reference: r.reference, createdAt: r.created_at })),
  };
});

// Admin → Money: shops with sales to settle, and recording a settlement (money sent either way by Mobile Money).
route('GET', '/api/admin/settlements', ({ user }) => {
  requireAdmin(user, 'money');
  const sellers = db.prepare("select distinct seller_id from orders where status = 'delivered' and settlement_id is null").all();
  return {
    commission: commission(),
    shops: sellers.map(({ seller_id }) => {
      const u = db.prepare('select * from users where id = ?').get(seller_id);
      const acc = db.prepare('select momo_number, momo_name from tip_accounts where user_id = ?').get(seller_id) ?? db.prepare('select momo_number, momo_name from creators where user_id = ?').get(seller_id);
      const { ids, ...open } = openSales(seller_id);
      return { sellerId: seller_id, shop: u ? shopNameOf(u) : 'Shop', momoNumber: acc?.momo_number ?? parse(u?.shop)?.phone ?? null, momoName: acc?.momo_name ?? null, ...open };
    }).filter((s) => s.orders > 0).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
    recent: db.prepare('select s.*, u.shop, u.display_name, u.email, u.is_guest, u.role from shop_settlements s join users u on u.id = s.seller_id order by s.created_at desc limit 30').all()
      .map((r) => ({ id: r.id, shop: shopNameOf(r), amount: r.amount, orders: r.orders, reference: r.reference, createdAt: r.created_at })),
  };
});
route('POST', '/api/admin/settlements/([\\w-]+)', ({ user, params, body }) => {
  requireAdmin(user, 'money');
  const open = openSales(params[0]);
  if (!open.orders) fail(400, 'nothing', 'Nothing to settle for this shop.');
  const id = randomUUID();
  const reference = String(body.reference ?? '').trim().slice(0, 80) || null;
  transaction(() => {
    db.prepare('insert into shop_settlements (id, seller_id, amount, orders, reference, created_at) values (?, ?, ?, ?, ?, ?)').run(id, params[0], open.balance, open.orders, reference, now());
    const mark = db.prepare('update orders set settlement_id = ? where id = ?');
    for (const o of open.ids) mark.run(id, o);
  });
  logAdmin(user, 'shop settled', `${params[0]}: ${money(open.balance)} for ${open.orders} orders${reference ? ` (${reference})` : ''}`);
  notify(params[0], {
    type: 'sale',
    title: open.balance >= 0 ? `Saligue sent you ${money(open.balance)}` : `Saligue fees settled: ${money(-open.balance)}`,
    body: `${open.orders} delivered order${open.orders === 1 ? '' : 's'} settled${reference ? ` · ref ${reference}` : ''}.`,
    link: '/dashboard/sales',
  });
  return { ok: true, id };
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
  // A second main admin (e.g. the owner's separate admin account) has every right and can manage admins.
  if (body.main) {
    db.prepare("update users set admin = 1, admin_level = 1, admin_perms = '[]' where id = ?").run(target.id);
    notify(target.id, { type: 'account', title: 'You are now a main Saligue admin', body: 'You can do everything in the Admin dashboard, including managing admins.', link: '/admin' });
    logAdmin(user, 'main admin added', target.email);
    return { ok: true };
  }
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
  const target = db.prepare('select * from users where id = ? and admin_level in (1, 2)').get(params[0]);
  if (!target) fail(404, 'not_found', 'Admin not found.');
  // Saligue always keeps at least one main admin.
  if (target.admin_level === 1 && db.prepare('select count(*) as n from users where admin_level = 1').get().n < 2) fail(400, 'last_main', 'Add another main admin first: Saligue must always have one.');
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
// Verification badge: a person (ID card or passport) or a business (registration certificate) pays a small fee
// and sends documents; an admin checks them. Documents are stored privately (never under /media) and deleted
// as soon as the admin decides; only the result, the document type and the last 4 characters are kept.
// ---------------------------------------------------------------------------

const PRIVATE_DIR = join(resolve(process.env.SALIGUE_DATA || 'data'), 'private');
mkdirSync(PRIVATE_DIR, { recursive: true });
const verificationPrice = () => Number(parse(db.prepare("select value from app_config where key = 'verification'").get()?.value)?.price ?? 2.53);

function savePrivate(dataUrl) {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) fail(400, 'invalid_file', 'Add a clear photo (JPG or PNG) of each document.');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > 8 * 1024 * 1024) fail(413, 'too_big', 'A photo is too large (8 MB at most).');
  const name = `${randomUUID()}.${m[1] === 'jpg' ? 'jpeg' : m[1]}`;
  writeFileSync(join(PRIVATE_DIR, name), bytes, { mode: 0o600 });
  return name;
}
const removePrivate = (files) => {
  for (const f of Object.values(files ?? {})) {
    try { if (/^[\w-]+\.(jpeg|png|webp)$/.test(f)) unlinkSync(join(PRIVATE_DIR, f)); } catch { /* already gone */ }
  }
};

function verificationToReview(id) {
  const v = db.prepare('select * from verifications where id = ?').get(id);
  if (!v) return;
  notify(v.user_id, { type: 'account', title: 'Verification request received', body: 'Saligue checks your documents within a few days.', link: '/verify' });
  for (const { id: admin } of db.prepare("select id from users where admin = 1 and (admin_level = 1 or admin_perms like '%users%')").all()) {
    notify(admin, { type: 'account', title: 'Verification to review', body: `${v.legal_name} · ${v.type === 'business' ? v.business_name : v.type}`, link: '/admin', email: false });
  }
}

// Each paid month adds 30 days, counted from the end of the current month if the badge is still running.
function renewalPaid(id) {
  const r = db.prepare("select * from verification_renewals where id = ? and status = 'pending_payment'").get(id);
  if (!r) return;
  const u = db.prepare('select verified_until from users where id = ?').get(r.user_id);
  const from = Math.max(Date.now(), Date.parse(u?.verified_until ?? '') || 0);
  const until = new Date(from + 30 * 86_400_000).toISOString();
  db.prepare("update verification_renewals set status = 'paid', paid_at = ? where id = ?").run(now(), r.id);
  db.prepare('update users set verified = 1, verified_until = ?, verify_reminded = null where id = ? and identity_checked = 1').run(until, r.user_id);
  broadcast('products');
  notify(r.user_id, { type: 'account', title: 'Verification renewed ✓', body: `Your badge is active until ${until.slice(0, 10)}.`, link: '/verify' });
}

// Every hour: a reminder 3 days before the badge ends, and the badge goes away when the month is not renewed.
function checkBadges() {
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
  for (const u of db.prepare('select id, verified_until from users where verified = 1 and verified_until < ? and verify_reminded is null').all(soon)) {
    db.prepare('update users set verify_reminded = ? where id = ?').run(now(), u.id);
    notify(u.id, { type: 'account', title: 'Your verification badge ends soon', body: `Renew it before ${String(u.verified_until).slice(0, 10)} to keep the ✓ (${money(verificationPrice())} per month).`, link: '/verify' });
  }
  const ended = db.prepare('select id from users where verified = 1 and verified_until < ?').all(now());
  for (const u of ended) {
    db.prepare('update users set verified = 0 where id = ?').run(u.id);
    notify(u.id, { type: 'account', title: 'Your verification badge has ended', body: 'Renew it any time from Get verified; your documents don’t need to be sent again.', link: '/verify' });
  }
  if (ended.length) broadcast('products');
}

const verificationOut = (v) => v && { id: v.id, type: v.type, legalName: v.legal_name, businessName: v.business_name, status: v.status, amount: v.amount, reference: v.reference, note: v.note, createdAt: v.created_at, decidedAt: v.decided_at };

route('GET', '/api/verification', ({ user }) => {
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Please sign in.');
  const a = adSettings();
  const last = db.prepare('select * from verifications where user_id = ? order by created_at desc limit 1').get(user.id);
  const renewal = db.prepare("select id, reference, amount from verification_renewals where user_id = ? and status = 'pending_payment' order by created_at desc limit 1").get(user.id);
  return { verified: !!user.verified, identityChecked: !!user.identity_checked, verifiedUntil: user.verified_until, renewal: renewal ?? null, verifiedType: user.verified_type, price: verificationPrice(), onlinePayment: paymentsEnabled(), momoNumber: a.momoNumber, momoName: a.momoName, request: verificationOut(last) };
});

route('POST', '/api/verification', async ({ req, user, body }) => {
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Create an account first.');
  needFeature('verification');
  if (user.verified) fail(400, 'already', 'Your account is already verified.');
  const open = db.prepare("select * from verifications where user_id = ? and status in ('pending_payment', 'in_review')").get(user.id);
  if (open?.status === 'in_review') fail(400, 'in_review', 'Your request is being reviewed.');
  const type = ['id', 'passport', 'business'].includes(body.type) ? body.type : fail(400, 'invalid', 'Choose ID card, passport or business.');
  const legalName = String(body.legalName ?? '').trim().slice(0, 120);
  const docNumber = String(body.docNumber ?? '').replace(/\s/g, '');
  const country = String(body.country ?? '').trim().slice(0, 60);
  const businessName = type === 'business' ? String(body.businessName ?? '').trim().slice(0, 120) : null;
  if (legalName.length < 3 || docNumber.length < 4 || country.length < 2 || (type === 'business' && !businessName)) fail(400, 'invalid', 'Fill in every field exactly as on the document.');
  const need = type === 'business' ? ['certificate', 'front', 'selfie'] : type === 'id' ? ['front', 'back', 'selfie'] : ['front', 'selfie'];
  if (need.some((k) => !body.files?.[k])) fail(400, 'invalid_file', 'Add every photo asked for.');
  const files = Object.fromEntries(need.map((k) => [k, savePrivate(body.files[k])]));
  if (open) {
    removePrivate(parse(open.files));
    db.prepare("update verifications set status = 'cancelled', files = '{}' where id = ?").run(open.id);
  }
  // A request refused in the last 30 days after paying can be sent again without paying again.
  const paidBefore = db.prepare("select 1 from verifications where user_id = ? and status = 'rejected' and decided_at > ?").get(user.id, new Date(Date.now() - 30 * 86_400_000).toISOString());
  const id = randomUUID();
  const reference = `VER-${id.slice(0, 6).toUpperCase()}`;
  const amount = paidBefore ? 0 : verificationPrice();
  db.prepare('insert into verifications (id, user_id, type, legal_name, doc_number, country, business_name, files, status, amount, reference, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, user.id, type, legalName, docNumber.slice(-4), country, businessName, json(files), amount ? 'pending_payment' : 'in_review', amount, reference, now());
  if (!amount) {
    verificationToReview(id);
    return { id, status: 'in_review' };
  }
  if (!paymentsEnabled()) {
    const a = adSettings();
    return { id, status: 'pending_payment', manual: true, reference, amount, momoNumber: a.momoNumber, momoName: a.momoName };
  }
  const { currency } = paymentSettings();
  const charge = toCharge(amount);
  const txRef = `SAL-VER-${randomBytes(8).toString('base64url')}`;
  db.prepare('insert into payments (id, user_id, order_ids, amount, currency, verification_id, created_at) values (?, ?, ?, ?, ?, ?, ?)').run(txRef, user.id, '[]', charge, currency, id, now());
  const configured = siteUrl();
  const base = /localhost|127\.0\.0\.1/.test(configured) && /^https?:\/\/[\w.:-]+$/.test(req.headers.origin || '') ? req.headers.origin : configured;
  const link = await startCheckout({ txRef, amount: charge, currency, redirectUrl: `${base}/payment`, customer: { email: user.email, name: legalName }, title: 'Saligue verification', logo: `${configured}/icons/icon-192.png` });
  return { id, status: 'pending_payment', link, reference };
});

// Renew the badge for a month (documents were already checked): online, or Mobile Money with a reference.
route('POST', '/api/verification/renew', async ({ req, user }) => {
  if (!user || user.is_guest) fail(401, 'not_signed_in', 'Please sign in.');
  needFeature('verification');
  if (!user.identity_checked) fail(400, 'not_checked', 'Send your documents first.');
  db.prepare("update verification_renewals set status = 'cancelled' where user_id = ? and status = 'pending_payment'").run(user.id);
  const id = randomUUID();
  const reference = `VRN-${id.slice(0, 6).toUpperCase()}`;
  const amount = verificationPrice();
  db.prepare("insert into verification_renewals (id, user_id, amount, reference, status, created_at) values (?, ?, ?, ?, 'pending_payment', ?)").run(id, user.id, amount, reference, now());
  if (!paymentsEnabled()) {
    const a = adSettings();
    return { id, manual: true, reference, amount, momoNumber: a.momoNumber, momoName: a.momoName };
  }
  const { currency } = paymentSettings();
  const charge = toCharge(amount);
  const txRef = `SAL-VRN-${randomBytes(8).toString('base64url')}`;
  db.prepare('insert into payments (id, user_id, order_ids, amount, currency, renewal_id, created_at) values (?, ?, ?, ?, ?, ?, ?)').run(txRef, user.id, '[]', charge, currency, id, now());
  const configured = siteUrl();
  const base = /localhost|127\.0\.0\.1/.test(configured) && /^https?:\/\/[\w.:-]+$/.test(req.headers.origin || '') ? req.headers.origin : configured;
  const link = await startCheckout({ txRef, amount: charge, currency, redirectUrl: `${base}/payment`, customer: { email: user.email, name: personNameOf(user) }, title: 'Saligue verification (1 month)', logo: `${configured}/icons/icon-192.png` });
  return { id, link, reference };
});

route('GET', '/api/admin/verification-renewals', ({ user }) => {
  requireAdmin(user, 'users');
  return db.prepare("select r.*, u.email, u.display_name, u.role, u.shop from verification_renewals r join users u on u.id = r.user_id where r.status = 'pending_payment' order by r.created_at").all()
    .map((r) => ({ id: r.id, reference: r.reference, amount: r.amount, account: r.role === 'seller' ? shopNameOf(r) : r.display_name, email: r.email, createdAt: r.created_at }));
});
route('POST', '/api/admin/verification-renewals/([\\w-]+)', ({ user, params, body }) => {
  requireAdmin(user, 'users');
  const r = db.prepare("select * from verification_renewals where id = ? and status = 'pending_payment'").get(params[0]);
  if (!r) fail(404, 'not_found', 'Renewal not found.');
  if (body.decision === 'cancel') db.prepare("update verification_renewals set status = 'cancelled' where id = ?").run(r.id);
  else renewalPaid(r.id);
  logAdmin(user, body.decision === 'cancel' ? 'renewal cancelled' : 'renewal payment confirmed', r.reference);
  return { ok: true };
});

// Admin: requests to check (payment first for Mobile Money, then documents), the documents themselves, and decisions.
route('GET', '/api/admin/verifications', ({ user }) => {
  requireAdmin(user, 'users');
  return db.prepare("select v.*, u.email, u.display_name, u.role, u.shop from verifications v join users u on u.id = v.user_id where v.status in ('pending_payment', 'in_review') order by v.created_at").all()
    .map((v) => ({ ...verificationOut(v), docLast4: v.doc_number, country: v.country, email: v.email, account: v.role === 'seller' ? shopNameOf(v) : v.display_name, files: Object.keys(parse(v.files) ?? {}) }));
});
route('GET', '/api/admin/verifications/([\\w-]+)/file/(\\w+)', ({ user, params, res }) => {
  requireAdmin(user, 'users');
  const v = db.prepare('select files from verifications where id = ?').get(params[0]);
  const name = (parse(v?.files) ?? {})[params[1]];
  if (!name || !existsSync(join(PRIVATE_DIR, name))) fail(404, 'not_found', 'This document was deleted after the decision.');
  const data = readFileSync(join(PRIVATE_DIR, name));
  res.writeHead(200, { 'Content-Type': `image/${name.split('.').pop()}`, 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
  return undefined;
});
route('POST', '/api/admin/verifications/([\\w-]+)', ({ user, params, body }) => {
  requireAdmin(user, 'users');
  const v = db.prepare("select * from verifications where id = ? and status in ('pending_payment', 'in_review')").get(params[0]);
  if (!v) fail(404, 'not_found', 'Request not found.');
  if (body.decision === 'confirm_payment') {
    db.prepare("update verifications set status = 'in_review' where id = ?").run(v.id);
    logAdmin(user, 'verification payment confirmed', v.reference);
    verificationToReview(v.id);
    return { ok: true };
  }
  if (v.status !== 'in_review') fail(400, 'not_paid', 'Confirm the payment first.');
  const approve = body.decision === 'approve';
  const note = String(body.note ?? '').trim().slice(0, 300) || null;
  transaction(() => {
    db.prepare("update verifications set status = ?, note = ?, files = '{}', decided_at = ?, decided_by = ? where id = ?").run(approve ? 'approved' : 'rejected', note, now(), user.id, v.id);
    // The first payment covers the first month.
    if (approve) db.prepare('update users set verified = 1, identity_checked = 1, verified_type = ?, verified_at = ?, verified_until = ?, verify_reminded = null where id = ?').run(v.type, now(), new Date(Date.now() + 30 * 86_400_000).toISOString(), v.user_id);
  });
  removePrivate(parse(v.files));
  broadcast('products');
  notify(v.user_id, approve
    ? { type: 'account', title: 'Your account is verified ✓', body: 'The verification badge now shows next to your name.', link: `/profile?id=${v.user_id}` }
    : { type: 'account', title: 'Verification not approved', body: `${note ?? 'The documents could not be confirmed.'} You can send new photos within 30 days without paying again.`, link: '/verify' });
  logAdmin(user, approve ? 'verified' : 'verification refused', `${v.legal_name}${note ? `: ${note}` : ''}`);
  return { ok: true };
});
route('POST', '/api/admin/users/([\\w-]+)/verified', ({ user, params, body }) => {
  requireAdmin(user, 'users');
  const target = db.prepare('select id, email from users where id = ?').get(params[0]);
  if (!target) fail(404, 'not_found', 'Account not found.');
  db.prepare('update users set verified = ?, verified_type = case when ? then verified_type else null end where id = ?').run(body.verified ? 1 : 0, body.verified ? 1 : 0, target.id);
  logAdmin(user, body.verified ? 'badge given' : 'badge removed', target.email);
  broadcast('products');
  return { ok: true };
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
const PROFILE_PEOPLE = 'select u.id, u.display_name, u.email, u.is_guest, u.role, u.shop, u.avatar, u.official, u.verified from follows f join users u on u.id = ';
const personOut = (u) => ({ id: u.id, name: u.role === 'seller' ? shopNameOf(u) : personNameOf(u), avatar: u.avatar ?? null, isShop: u.role === 'seller', official: !!u.official, verified: !!u.verified });

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
    verifiedType: u.verified ? u.verified_type : null,
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

// Who is looking at ads: their account, or for visitors without one, their own network + browser (each visitor
// has their own daily limit). Network addresses are only kept as a hash. Behind Caddy the last
// X-Forwarded-For entry is the one Caddy saw (earlier ones can be made up by the visitor).
const clientIp = (req) => String(req.headers['x-forwarded-for'] ?? '').split(',').map((x) => x.trim()).filter(Boolean).pop() || req.socket.remoteAddress || '';
const hashed = (value) => createHash('sha256').update(`saligue-ads|${value}`).digest('hex').slice(0, 32);
const adViewer = (req, user) => ({ viewer: user?.id ?? `v:${hashed(`${clientIp(req)}|${req.headers['user-agent'] ?? ''}`)}`, ip: hashed(clientIp(req)) });

// Unused budget back in the shop's ad balance: tell them.
whenCredited((c, amount) => notify(c.seller_id, { type: 'sale', title: `${money(amount)} added to your ad balance`, body: 'Your ad finished without using its whole budget. The rest pays for your next ad.', link: '/dashboard/ads' }));
// Ads end on time (and give back unused money) even when nobody is browsing.
setInterval(() => {
  try {
    expireCampaigns();
  } catch (error) {
    console.error('Ad expiry failed:', error);
  }
}, 10 * 60_000).unref();

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
  // The ad balance pays first: all of it (the ad goes straight to review), or part (the rest is paid as usual).
  const balance = adBalance(user.id);
  if (balance > 0 && !(c.credit_used > 0)) {
    const use = Math.min(balance, c.budget);
    transaction(() => {
      db.prepare('update ad_campaigns set credit_used = ? where id = ?').run(use, c.id);
      addCredit(user.id, -use, use >= c.budget ? 'Paid an ad' : 'Part of an ad', c.id);
      if (use >= c.budget) db.prepare("update ad_campaigns set status = 'in_review', payment_ref = 'credit' where id = ?").run(c.id);
    });
    if (use >= c.budget) {
      adPaid(c.id);
      return { paidWithCredit: true, reference, amount: 0 };
    }
    c.credit_used = use;
  }
  const due = Math.round((c.budget - (c.credit_used ?? 0)) * 100) / 100;
  if (!paymentsEnabled()) {
    const a = adSettings();
    return { manual: true, reference, amount: due, creditUsed: c.credit_used ?? 0, momoNumber: a.momoNumber, momoName: a.momoName };
  }
  const email = String(user.email || body.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) fail(400, 'email_required', 'Enter your email address for the receipt.');
  const { currency } = paymentSettings();
  const amount = toCharge(due);
  const txRef = `SAL-AD-${randomBytes(8).toString('base64url')}`;
  db.prepare('insert into payments (id, user_id, order_ids, amount, currency, campaign_id, created_at) values (?, ?, ?, ?, ?, ?, ?)').run(txRef, user.id, '[]', amount, currency, c.id, now());
  const configured = siteUrl();
  const base = /localhost|127\.0\.0\.1/.test(configured) && /^https?:\/\/[\w.:-]+$/.test(req.headers.origin || '') ? req.headers.origin : configured;
  const link = await startCheckout({ txRef, amount, currency, redirectUrl: `${base}/payment`, customer: { email, name: shopNameOf(user), phone: parse(user.shop)?.phone }, title: 'Saligue Ads', logo: `${configured}/icons/icon-192.png` });
  return { link, reference };
});

// An ad not paid yet can be removed; balance it already used comes back.
route('DELETE', '/api/ads/campaigns/([\\w-]+)', ({ user, params }) => {
  const c = db.prepare('select * from ad_campaigns where id = ? and seller_id = ?').get(params[0], user?.id ?? '');
  if (!c) return { ok: true };
  if (c.status !== 'pending_payment') fail(400, 'paid', 'Only an ad that is not paid yet can be removed. Pause it instead.');
  transaction(() => {
    if (c.credit_used > 0) addCredit(c.seller_id, c.credit_used, 'Ad removed before payment', c.id);
    db.prepare("delete from payments where campaign_id = ? and status != 'paid'").run(c.id);
    db.prepare('delete from ad_campaigns where id = ?').run(c.id);
  });
  return { ok: true };
});

// The shop's ad balance and every line of it.
route('GET', '/api/ads/balance', ({ user }) => {
  if (!user) return { balance: 0, history: [] };
  expireCampaigns();
  return {
    balance: adBalance(user.id),
    history: db.prepare('select amount, reason, campaign_id, created_at from ad_credits where user_id = ? order by created_at desc limit 50').all(user.id)
      .map((r) => ({ amount: r.amount, reason: r.reason, campaignId: r.campaign_id, createdAt: r.created_at })),
  };
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
  const sales = new Map(adSales(c.id).days.map((d) => [d.day, d]));
  const days = db.prepare('select day, impressions, clicks, spent from ad_stats where campaign_id = ? order by day').all(c.id);
  for (const d of sales.keys()) if (!days.some((x) => x.day === d)) days.push({ day: d, impressions: 0, clicks: 0, spent: 0 });
  days.sort((a, b) => a.day.localeCompare(b.day));
  return { campaign: campaignOut(c), days: days.map((d) => ({ ...d, spent: Math.round(d.spent * 1000) / 1000, orders: sales.get(d.day)?.orders ?? 0, sales: Math.round((sales.get(d.day)?.sales ?? 0) * 100) / 100 })) };
});

// Ads to show, and their views/clicks (views are billed).
route('GET', '/api/ads', ({ req, user, url }) => {
  const placement = url.searchParams.get('placement') === 'explore' ? 'explore' : 'feed';
  const count = Math.min(5, Math.max(1, Number(url.searchParams.get('count')) || 2));
  if (!featureOn('ads')) return [];
  const { viewer, ip } = adViewer(req, user);
  return pickAds(viewer, ip, user?.id ?? null, count, placement);
});
route('POST', '/api/ads/events', ({ req, user, body }) => {
  const { viewer, ip } = adViewer(req, user);
  return { recorded: recordAdEvents(viewer, ip, user?.id ?? null, Array.isArray(body.events) ? body.events : []) };
});

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
    // With all creators' points, so the Earnings page can show how the amount is calculated.
    thisMonth: { period: period(), pool: month.pool, totalPoints: month.totalPoints, creators: month.rows.length, mine },
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
    // What it didn't use goes straight back to the shop's ad balance.
    const refund = creditUnused(c, c.status === 'in_review' ? 'Ad not approved' : 'Ad stopped by Saligue');
    notify(c.seller_id, { type: 'product', title: c.status === 'in_review' ? 'Your ad was not approved' : 'Your ad was stopped', body: `${note ?? 'It does not follow the Saligue Ads Policy.'}${refund ? ` ${money(refund)} is back in your ad balance.` : ''}`, link: '/dashboard/ads' });
  } else fail(400, 'invalid', 'This action is not possible for this ad now.');
  return campaignOut(db.prepare('select * from ad_campaigns where id = ?').get(c.id));
});

// A shop asked for its ad balance back by Mobile Money: the admin sends it, then records it here (the balance drops).
route('POST', '/api/admin/ad-balance', ({ user, body }) => {
  requireAdmin(user, 'ads');
  const shop = db.prepare('select id from users where email = ?').get(String(body.email ?? '').trim().toLowerCase());
  if (!shop) fail(404, 'not_found', 'No account with this email.');
  const balance = adBalance(shop.id);
  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (!(amount > 0 && amount <= balance + 1e-9)) fail(400, 'invalid', `Their ad balance is ${money(balance)}.`);
  addCredit(shop.id, -amount, `Paid back by Mobile Money${body.reference ? ` (${String(body.reference).slice(0, 40)})` : ''}`);
  logAdmin(user, 'ad balance paid back', `${body.email} ${money(amount)}`);
  notify(shop.id, { type: 'sale', title: `${money(amount)} of your ad balance was sent to you`, body: 'By Mobile Money, as you asked.', link: '/dashboard/ads' });
  return { balance: adBalance(shop.id) };
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

// Where sellers send ad money while online payment is off. Prices and the creators' share are edited in the
// money rules (/api/admin/rules); only the fields sent are changed, so saving the number never resets prices.
route('GET', '/api/admin/platform/ads', ({ user }) => {
  if (!['ads', 'money', 'policies'].some((p) => can(user, p))) requireAdmin(user, 'ads');
  const a = adSettings();
  return { cpm: a.cpm, minBudget: a.minBudget, creatorShare: a.creatorShare, momoNumber: a.momoNumber, momoName: a.momoName ?? 'INDECIANA' };
});
route('PUT', '/api/admin/platform/ads', ({ user, body }) => {
  const prices = body.cpm !== undefined || body.minBudget !== undefined || body.creatorShare !== undefined;
  if (prices) requireAdmin(user, 'policies');
  else if (!['ads', 'money', 'policies'].some((p) => can(user, p))) requireAdmin(user, 'ads');
  const saved = parse(db.prepare("select value from app_config where key = 'ads'").get()?.value) ?? {};
  const next = { ...saved };
  if (body.cpm !== undefined) next.cpm = Number(body.cpm);
  if (body.minBudget !== undefined) next.minBudget = Number(body.minBudget);
  if (body.creatorShare !== undefined) next.creatorShare = Number(body.creatorShare);
  if (prices && !(next.cpm >= 0.1 && next.cpm <= 100 && next.minBudget >= 1 && next.creatorShare >= 0 && next.creatorShare <= 0.9)) fail(400, 'invalid', 'Check the numbers.');
  if (body.momoNumber !== undefined) next.momoNumber = String(body.momoNumber ?? '').trim().slice(0, 30) || null;
  if (body.momoName !== undefined) next.momoName = String(body.momoName ?? '').trim().slice(0, 60) || 'INDECIANA';
  saveConfig('ads', next);
  logAdmin(user, 'ad payment settings', JSON.stringify(body).slice(0, 250));
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

// Link previews (WhatsApp, Facebook, X, Telegram read these tags): a shared live shows its cover and title,
// an item its photo and price, a shop or teacher their photo, a lesson its poster. Other pages stay as built.
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function sharePreview(pathname, params) {
  const path = pathname.replace(/\/+$/, '');
  const abs = (media) => (media ? (/^https?:/.test(media) ? media : `${siteUrl()}${media}`) : null);
  try {
    if (path === '/live/watch' && params.get('id')) {
      const l = db.prepare('select l.title, l.description, l.thumbnail, l.status, u.avatar, u.shop, u.display_name, u.email, u.is_guest, u.role from lives l join users u on u.id = l.seller_id where l.id = ?').get(params.get('id'));
      if (l) return { title: `${l.status === 'live' ? '🔴 LIVE · ' : ''}${l.title}`, description: `${shopNameOf(l)} on Saligue Live${l.description ? ` · ${l.description}` : ''}`, image: abs(l.thumbnail ?? l.avatar) };
    }
    if ((path === '/product' || path === '/indeciana') && (params.get('id') || params.get('item'))) {
      const p = db.prepare("select name, description, price, image, cutout from products where id = ? and status = 'active' and hidden = 0").get(params.get('id') ?? params.get('item'));
      if (p) return { title: `${p.name} · ${money(p.price)}`, description: p.description || 'See it on you in the Saligue Fitting Room.', image: abs(p.image ?? p.cutout) };
    }
    if (path === '/profile' && params.get('id')) {
      const u = db.prepare('select display_name, email, is_guest, role, shop, avatar, bio from users where id = ? and suspended = 0').get(params.get('id'));
      if (u) return { title: `${u.role === 'seller' ? shopNameOf(u) : personNameOf(u)} on Saligue`, description: u.bio || 'Fashion on Saligue', image: abs(u.avatar) };
    }
    if (path === '/learn' && params.get('lesson')) {
      const l = db.prepare('select title, description, poster from lessons where id = ? and hidden = 0').get(params.get('lesson'));
      if (l) return { title: `${l.title} · a fashion lesson`, description: l.description || 'Learn on Saligue', image: abs(l.poster) };
    }
  } catch (error) {
    console.error('Link preview failed:', error.message);
  }
  return null;
}

function serveStatic(req, res, pathname) {
  // Next.js page data (…/index.txt) opened as a page: after a deploy, a tab that was already open reloads the data
  // file's address instead of the page (a Next.js quirk with static sites). Send the browser to the page itself.
  if (pathname.endsWith('/index.txt') && !req.headers.rsc && /text\/html/.test(req.headers.accept ?? '')) {
    const page = new URL(req.url, 'http://x');
    page.searchParams.delete('_rsc');
    res.writeHead(302, { Location: `${pathname.slice(0, -'index.txt'.length)}${page.search}`, 'Cache-Control': 'no-store' });
    return res.end();
  }
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
  if (status === 200 && file.endsWith('.html')) {
    const preview = sharePreview(pathname, new URL(req.url, 'http://x').searchParams);
    if (preview) {
      const tags = [
        ['og:title', preview.title], ['og:description', preview.description], ['og:type', 'website'], ['og:site_name', 'Saligue'],
        ['og:url', `${siteUrl()}${req.url}`], ...(preview.image ? [['og:image', preview.image]] : []),
      ].map(([k, v]) => `<meta property="${k}" content="${escapeHtml(v)}">`).join('')
        + `<meta name="twitter:card" content="${preview.image ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${escapeHtml(preview.title)}">${preview.image ? `<meta name="twitter:image" content="${escapeHtml(preview.image)}">` : ''}`;
      const html = readFileSync(file, 'utf8').replace(/<head>/, `<head>${tags}`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(html);
    }
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
  // The newest Android app on the server: installed apps show an Update banner when theirs is older.
  if (url.pathname === '/api/app/version') {
    const info = join(resolve(process.env.SALIGUE_DATA || 'data'), 'downloads', 'saligue.json');
    let latest = null;
    try {
      latest = JSON.parse(readFileSync(info, 'utf8'));
    } catch {
      // No app built yet.
    }
    return send(res, 200, latest ? { versionCode: latest.versionCode, versionName: latest.versionName, url: `${siteUrl()}/download/saligue.apk` } : null);
  }
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

  // Lesson video (Community): up to 4 min 30 s (General studies 10 min), same conversion as item videos.
  const lessonUpload = req.method === 'PUT' && /^\/api\/lessons\/([\w-]+)\/video$/.exec(url.pathname);
  if (lessonUpload) {
    try {
      const user = userOf(req);
      if (!user || user.is_guest) fail(401, 'not_signed_in', 'Please sign in.');
      const lesson = db.prepare('select * from lessons where id = ?').get(lessonUpload[1]);
      if (!lesson || lesson.user_id !== user.id) fail(404, 'not_found', 'Lesson not found.');
      if (!/^video\//.test(String(req.headers['content-type'] || ''))) fail(400, 'invalid_video', 'Choose a video file.');
      // A 10-minute phone video can pass 200 MB.
      const file = await receiveUpload(req, lesson.topic === 'general' ? 600 * 1024 * 1024 : undefined);
      const { video, poster, duration } = await processVideo(file, lessonMaxSeconds(lesson.topic));
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
    // The visitor's country (from their address) travels with the request: per-country features, "near you".
    const result = await requestContext.run({ country: countryOf(req) }, () => match.handler({ req, res, url, params, body, user }));
    // A route that answered by itself (a file) is done; never answer twice.
    if (res.writableEnded || res.headersSent) return;
    if (typeof result?.token === 'string') res.setHeader('Set-Cookie', sessionCookie(req, result.token));
    else if (bearer && user && cookieToken(req) !== tokenOf(req)) res.setHeader('Set-Cookie', sessionCookie(req, tokenOf(req)));
    send(res, 200, result ?? null);
  } catch (error) {
    if (res.headersSent) return console.error(error);
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
setInterval(checkBadges, 60 * 60_000).unref();
// Sunday evening: one note per person who learned or saved something that week (nothing for quiet weeks).
function sendWeeklyNotes() {
  const d = new Date();
  if (d.getUTCDay() !== 0 || d.getUTCHours() < 16) return;
  const week = d.toISOString().slice(0, 10);
  const key = 'weekly_note_sent';
  if (parse(db.prepare('select value from app_config where key = ?').get(key)?.value) === week) return;
  db.prepare('insert into app_config (key, value) values (?, ?) on conflict (key) do update set value = excluded.value').run(key, json(week));
  if (!featureOn('weekly', null)) return;
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const people = db.prepare('select distinct user_id from lesson_done where done_at > ? union select distinct k.user_id from look_items li join looks k on k.id = li.look_id where li.added_at > ?').all(since, since);
  for (const { user_id } of people) {
    const w = weekOf(user_id, since);
    const parts = [w.lessons && `${w.lessons} lesson${w.lessons === 1 ? '' : 's'} (${w.minutes} min)`, w.saved && `${w.saved} piece${w.saved === 1 ? '' : 's'} saved to looks`, w.answers && `${w.answers} answer${w.answers === 1 ? '' : 's'}`].filter(Boolean);
    if (parts.length) notify(user_id, { type: 'account', title: 'Your week on Saligue', body: parts.join(' · '), link: '/me#week', email: false });
  }
}
setInterval(sendWeeklyNotes, 60 * 60_000).unref();

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
  setTimeout(checkBadges, 30_000).unref();
});
