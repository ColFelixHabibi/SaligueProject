// Saligue's main paths, tested against a separate server with its own empty database (never the real one):
//   npm test
// It starts server/index.mjs on a free port with SALIGUE_DATA in a temporary folder, adds the sample catalogue
// (server/seed.mjs), and checks accounts, the catalogue, comments, looks, questions, orders and fees.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const data = mkdtempSync(join(tmpdir(), 'saligue-test-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, SALIGUE_SECURITY_WATCH: '0', SALIGUE_DATA: data, PORT: String(port), HOST: '127.0.0.1', SITE_URL: base, SMTP_URL: '', FAL_KEY: '', FLW_SECRET_KEY: '', FCM_SERVICE_ACCOUNT: '',
  // Live works against a LiveKit that is not there; no server recorder answers, so hosts' phones record.
  LIVEKIT_URL: 'ws://127.0.0.1:9', LIVEKIT_API_KEY: 'test', LIVEKIT_API_SECRET: 'test-secret', LIVEKIT_API_URL: 'http://127.0.0.1:9', EGRESS_HEALTH_PORT: '9' };
let server;

async function call(path, { method, body, token, headers = {} } = {}) {
  const r = await fetch(`${base}/api${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: r.status, json, headers: r.headers };
}
const register = async (name, role = 'buyer') => {
  const r = await call('/auth/register', { body: { name, email: `${name.toLowerCase().replace(/\W/g, '')}${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'Test12345!', role, acceptTerms: true } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { token: r.json.token, id: r.json.user.id, user: r.json.user };
};

before(async () => {
  // The sample shops and items (no network needed).
  const seed = spawnSync(process.execPath, ['--no-warnings', 'server/seed.mjs'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(seed.status, 0, seed.stderr);
  server = spawn(process.execPath, ['--no-warnings', 'server/index.mjs'], { cwd: root, env, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('The test server did not start.');
});
after(() => {
  server?.kill();
  rmSync(data, { recursive: true, force: true });
});

describe('accounts', () => {
  test('register gives a token, a unique @username and the account', async () => {
    const a = await register('Amina Uwase');
    const b = await register('Amina Uwase');
    assert.ok(a.token);
    assert.match(a.user.username, /^aminauwase/);
    assert.notEqual(a.user.username, b.user.username);
    const me = await call('/auth/me', { token: a.token });
    assert.equal(me.json.user.id, a.id);
  });
  test('usernames can be changed, but not to one that is taken or invalid', async () => {
    const a = await register('Jean Paul');
    const b = await register('Grace');
    assert.equal((await call('/auth/me', { method: 'PATCH', token: a.token, body: { username: 'jp.style' } })).status, 200);
    assert.equal((await call('/auth/me', { method: 'PATCH', token: b.token, body: { username: 'JP.Style' } })).status, 409);
    assert.equal((await call('/auth/me', { method: 'PATCH', token: b.token, body: { username: 'a' } })).status, 400);
    assert.equal((await call('/usernames/jp.style')).json.id, a.id);
  });
});

describe('catalogue', () => {
  test('items come without AI fingerprints; fingerprints come apart and are cached', async () => {
    const list = await call('/products');
    assert.ok(list.json.length > 5);
    assert.ok(list.json.every((p) => p.embedding === undefined));
    assert.ok(list.json.every((p) => typeof p.sold === 'number'));
    const fp = await call('/products/fingerprints');
    const etag = fp.headers.get('etag');
    assert.ok(etag);
    const again = await fetch(`${base}/api/products/fingerprints`, { headers: { 'If-None-Match': etag } });
    assert.equal(again.status, 304);
  });
  test('sample items are marked and the demo sentence is removed', async () => {
    const list = (await call('/products')).json;
    assert.ok(list.some((p) => p.sample));
    assert.ok(list.every((p) => !/Demo item for trying Saligue/.test(p.description ?? '')));
  });
});

describe('comments', () => {
  test('replies can go as deep as people like; only the shop can remove them, with their replies', async () => {
    const product = (await call('/products')).json[0];
    const a = await register('Commenter');
    const top = await call(`/products/${product.id}/comments`, { token: a.token, body: { text: 'Is it cotton?' } });
    const r1 = await call(`/products/${product.id}/comments`, { token: a.token, body: { text: 'Reply', parentId: top.json.id } });
    const r2 = await call(`/products/${product.id}/comments`, { token: a.token, body: { text: 'Reply to reply', parentId: r1.json.id } });
    assert.equal(r2.status, 200);
    const list = (await call(`/products/${product.id}/comments`)).json;
    assert.equal(list.find((c) => c.id === r2.json.id).parentId, r1.json.id);
    // The person who wrote it can't delete it.
    assert.equal((await call(`/comments/${top.json.id}`, { method: 'DELETE', token: a.token })).status, 403);
  });
});

describe('looks and questions', () => {
  test('a look collects items; anyone can open it by link', async () => {
    const product = (await call('/products')).json[0];
    const a = await register('Looker');
    const look = await call('/looks', { token: a.token, body: { name: 'Wedding' } });
    const added = await call(`/looks/${look.json.id}/items`, { token: a.token, body: { kind: 'product', id: product.id } });
    assert.equal(added.json.added, true);
    assert.equal((await call(`/looks/${look.json.id}`)).json.count, 1);
  });
  test('guests cannot make looks', async () => {
    assert.equal((await call('/looks', { body: { name: 'X' } })).status, 401);
  });
  test('a waiting question is seen only by the asker and the shop; the answer is public', async () => {
    const product = (await call('/products')).json[0];
    const a = await register('Asker');
    const q = await call(`/products/${product.id}/questions`, { token: a.token, body: { text: 'Does size M fit 1.70 m?' } });
    assert.equal(q.status, 200);
    assert.equal((await call(`/products/${product.id}/questions`)).json.length, 0);
    assert.equal((await call(`/products/${product.id}/questions`, { token: a.token })).json.length, 1);
  });
});

describe('orders', () => {
  test('an order is placed and counted as sold', async () => {
    const product = (await call('/products')).json.find((p) => p.stock == null || p.stock > 0);
    const a = await register('Buyer');
    const order = await call('/orders', {
      token: a.token,
      body: { items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'cash_on_delivery', delivery: { fullName: 'Buyer', phone: '0780000000', city: 'Kigali', street: 'KN 1 Ave' } },
    });
    assert.equal(order.status, 200, JSON.stringify(order.json));
    const mine = (await call('/orders', { token: a.token })).json;
    assert.equal(mine.length, 1);
    const after = (await call('/products')).json.find((p) => p.id === product.id);
    assert.equal(after.sold, 1);
  });
});

describe('site', () => {
  test('a page data file opened in a browser goes to the page', async () => {
    const r = await fetch(`${base}/me/index.txt?_rsc=x`, { headers: { Accept: 'text/html' }, redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/me/');
  });
  test('push notifications offer a web key', async () => {
    const r = await call('/push');
    assert.ok(r.json.webKey.length > 40);
  });
});

describe('safety and privacy', () => {
  test('three reports hide a comment until a moderator looks', async () => {
    const product = (await call('/products')).json[1];
    const writer = await register('Rude Writer');
    const c = await call(`/products/${product.id}/comments`, { token: writer.token, body: { text: 'Something rude' } });
    for (const name of ['R One', 'R Two', 'R Three']) {
      const r = await register(name);
      assert.equal((await call('/comment-reports', { token: r.token, body: { kind: 'item', id: c.json.id, reason: 'rude' } })).status, 200);
    }
    const list = (await call(`/products/${product.id}/comments`)).json;
    assert.ok(!list.some((x) => x.id === c.json.id));
  });
  test('item comments are limited to 8 a minute', async () => {
    const product = (await call('/products')).json[2];
    const a = await register('Fast Typer');
    const codes = [];
    for (let i = 0; i < 9; i++) codes.push((await call(`/products/${product.id}/comments`, { token: a.token, body: { text: `hi ${i}` } })).status);
    assert.deepEqual(codes.slice(0, 8), Array(8).fill(200));
    assert.equal(codes[8], 429);
  });
  test('deleting an account empties it, removes what it made, and it can no longer sign in', async () => {
    const product = (await call('/products')).json[3];
    const a = await register('Leaving Person');
    await call(`/products/${product.id}/comments`, { token: a.token, body: { text: 'bye' } });
    assert.equal((await call('/auth/me/delete', { token: a.token, body: { confirm: 'nope' } })).status, 400);
    assert.equal((await call('/auth/me/delete', { token: a.token, body: { confirm: 'DELETE' } })).status, 200);
    assert.equal((await call('/auth/me', { token: a.token })).json?.user?.isGuest ?? true, true);
    assert.equal((await call(`/usernames/${a.user.username}`)).status, 404);
    assert.ok(!(await call(`/products/${product.id}/comments`)).json.some((c) => c.uid === a.id));
  });
  test('people can be found by name, @username or shop name', async () => {
    const a = await register('Diane Mukamana');
    const found = (await call('/usernames?q=mukamana')).json;
    assert.ok(found.some((p) => p.id === a.id));
    assert.ok((await call('/usernames?q=kigali')).json.some((p) => p.isShop));
  });
});

describe('catalogue pages', () => {
  test('the list comes in pages, and one item can be fetched alone', async () => {
    const all = (await call('/products')).json;
    const first = (await call('/products?limit=5&offset=0')).json;
    const second = (await call('/products?limit=5&offset=5')).json;
    assert.equal(first.length, 5);
    assert.deepEqual([...first, ...second].map((p) => p.id), all.slice(0, 10).map((p) => p.id));
    const one = await call(`/products/${all[7].id}`);
    assert.equal(one.json.id, all[7].id);
    assert.equal(one.json.embedding, undefined);
    assert.equal((await call('/products/does-not-exist')).status, 404);
  });
});

// Signs in as a sample shop in the test database (sample shops have no password).
async function sampleShop(productId) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(data, 'saligue.db'));
  const sellerId = db.prepare('select seller_id from products where id = ?').get(productId).seller_id;
  const token = `test-${Math.random().toString(36).slice(2)}${Date.now()}`;
  db.prepare('insert into sessions (token, user_id, created_at) values (?, ?, ?)').run(token, sellerId, new Date().toISOString());
  db.close();
  return { token, id: sellerId };
}

describe('buyer protection', () => {
  test('the buyer confirms it arrived; a reported problem holds the shop’s payment', async () => {
    const product = (await call('/products')).json.find((p) => !p.official && (p.stock == null || p.stock > 0));
    const shop = await sampleShop(product.id);
    const a = await register('Careful Buyer');
    const order = await call('/orders', { token: a.token, body: { items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'cash_on_delivery', delivery: { fullName: 'Careful Buyer', phone: '0780000001', city: 'Kigali', street: 'KN 2 Ave' } } });
    const id = (await call('/orders', { token: a.token })).json[0].id;
    assert.equal(order.status, 200);
    // Not on its way yet: "I received it" is refused.
    assert.equal((await call(`/orders/${id}`, { method: 'PATCH', token: a.token, body: { received: true } })).status, 400);
    assert.equal((await call(`/orders/${id}`, { method: 'PATCH', token: shop.token, body: { status: 'shipped' } })).status, 200);
    assert.equal((await call(`/orders/${id}`, { method: 'PATCH', token: a.token, body: { received: true } })).status, 200);
    const delivered = (await call('/orders', { token: a.token })).json[0];
    assert.equal(delivered.status, 'delivered');
    assert.ok(delivered.receivedAt);
    assert.equal((await call(`/orders/${id}/problem`, { token: a.token, body: { text: 'Wrong colour arrived' } })).status, 200);
    assert.equal((await call('/orders', { token: a.token })).json[0].problem.status, 'open');
    // The held order is not in what the shop is owed.
    assert.equal((await call('/seller/sales', { token: shop.token })).json.open.orders, 0);
  });
});

describe('comment controls and my data', () => {
  test('a shop can turn comments off or allow only followers, and hide words', async () => {
    const product = (await call('/products')).json.find((p) => !p.official);
    const shop = await sampleShop(product.id);
    const a = await register('Visitor');
    await call('/auth/me', { method: 'PATCH', token: shop.token, body: { commentMode: 'off' } });
    assert.equal((await call(`/products/${product.id}/comments`, { token: a.token, body: { text: 'hello' } })).status, 403);
    await call('/auth/me', { method: 'PATCH', token: shop.token, body: { commentMode: 'followers' } });
    assert.equal((await call(`/products/${product.id}/comments`, { token: a.token, body: { text: 'hello' } })).status, 403);
    // After following, the follower can comment.
    assert.equal((await call(`/follow/${shop.id}`, { token: a.token, body: {} })).status, 200);
    assert.equal((await call(`/products/${product.id}/comments`, { token: a.token, body: { text: 'hello as a follower' } })).status, 200);
    await call('/auth/me', { method: 'PATCH', token: shop.token, body: { commentMode: 'everyone', hiddenWords: ['ugly'] } });
    const c = await call(`/products/${product.id}/comments`, { token: a.token, body: { text: 'So ugly!' } });
    assert.equal(c.status, 200);
    assert.ok(!(await call(`/products/${product.id}/comments`)).json.some((x) => x.id === c.json.id));
    assert.ok((await call(`/products/${product.id}/comments`, { token: a.token })).json.some((x) => x.id === c.json.id));
  });
  test('download my data gives one file with the account', async () => {
    const a = await register('Data Owner');
    const r = await fetch(`${base}/api/auth/me/export`, { headers: { Authorization: `Bearer ${a.token}` } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition') ?? '', /attachment/);
    const file = await r.json();
    assert.equal(file.account.id, a.id);
    assert.ok(Array.isArray(file.orders) && Array.isArray(file.comments));
  });
});

describe('seller protection', () => {
  test('the handover code proves delivery at once; a wrong code is refused; the shop never sees it', async () => {
    const product = (await call('/products')).json.find((p) => !p.official && (p.stock == null || p.stock > 0));
    const shop = await sampleShop(product.id);
    const a = await register('Code Buyer');
    await call('/orders', { token: a.token, body: { items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'cash_on_delivery', delivery: { fullName: 'Code Buyer', phone: '0780000002', city: 'Kigali', street: 'KN 3 Ave' } } });
    const mine = (await call('/orders', { token: a.token })).json[0];
    assert.match(mine.deliveryCode, /^\d{4}$/);
    const theirs = (await call('/orders?as=seller', { token: shop.token })).json.find((o) => o.id === mine.id);
    assert.equal(theirs.deliveryCode, undefined);
    await call(`/orders/${mine.id}`, { method: 'PATCH', token: shop.token, body: { status: 'confirmed' } });
    const wrong = mine.deliveryCode === '1234' ? '4321' : '1234';
    assert.equal((await call(`/orders/${mine.id}/handover`, { token: shop.token, body: { code: wrong } })).status, 400);
    assert.equal((await call(`/orders/${mine.id}/handover`, { token: shop.token, body: { code: mine.deliveryCode } })).status, 200);
    const done = (await call('/orders', { token: a.token })).json[0];
    assert.equal(done.status, 'delivered');
    assert.equal(done.receivedBy, 'code');
    // The shop can answer a reported problem.
    assert.equal((await call(`/orders/${mine.id}/problem`, { token: a.token, body: { text: 'Button missing' } })).status, 200);
    assert.equal((await call(`/orders/${mine.id}/reply`, { token: shop.token, body: { text: 'We will send a new button today' } })).status, 200);
    assert.equal((await call('/orders', { token: a.token })).json[0].problem.shopReply, 'We will send a new button today');
  });
});

describe('reasons to come back', () => {
  test('a price drop reaches people who saved the item, once a week', async () => {
    const product = (await call('/products')).json.find((p) => !p.official && p.price > 5);
    const shop = await sampleShop(product.id);
    const a = await register('Bargain Hunter');
    assert.equal((await call(`/me/cart/${product.id}`, { method: 'PUT', token: a.token, body: { quantity: 1 } })).status, 200);
    assert.equal((await call(`/products/${product.id}`, { method: 'PATCH', token: shop.token, body: { price: product.price - 1 } })).status, 200);
    await call(`/products/${product.id}`, { method: 'PATCH', token: shop.token, body: { price: product.price - 2 } });
    const drops = (await call('/me/notifications', { token: a.token })).json.filter((n) => /^Price drop/.test(n.title));
    assert.equal(drops.length, 1);
  });
  test('a shop plans a live and people ask to be reminded', async () => {
    const product = (await call('/products')).json.find((p) => !p.official);
    const shop = await sampleShop(product.id);
    const a = await register('Live Fan');
    const at = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const plan = await call('/live-schedules', { token: shop.token, body: { title: 'New kitenge', startsAt: at } });
    assert.equal(plan.status, 200);
    assert.equal((await call('/live-schedules', { token: a.token, body: { title: 'x y z', startsAt: at } })).status, 403);
    const r = await call(`/live-schedules/${plan.json.id}/remind`, { token: a.token, body: {} });
    assert.equal(r.json.reminded, true);
    assert.equal((await call(`/live-schedules?seller=${shop.id}`)).json[0].reminders, 1);
  });
});

describe('profiles, lives and the admin log', () => {
  test('a profile counts the hearts on everything the shop shares', async () => {
    const product = (await call('/products?limit=1')).json[0];
    const shop = await sampleShop(product.id);
    const profile = await call(`/profiles/${shop.id}`);
    assert.equal(profile.status, 200);
    assert.equal(typeof profile.json.likes, 'number');
    assert.ok(profile.json.likes >= 0);
  });

  test('a live starts in the side layout, the host can switch it, and the phone records when the server cannot', async () => {
    const product = (await call('/products?limit=1')).json[0];
    const shop = await sampleShop(product.id);
    const live = await call('/lives', { token: shop.token, body: { title: 'New arrivals', productIds: [product.id] } });
    assert.equal(live.status, 200, JSON.stringify(live.json));
    assert.equal(live.json.layout, 'side');
    assert.equal(live.json.recorder, 'phone');
    const changed = await call(`/lives/${live.json.id}`, { method: 'PATCH', token: shop.token, body: { layout: 'grid' } });
    assert.equal(changed.json.layout, 'grid');
    assert.equal((await call(`/lives/${live.json.id}`, { method: 'PATCH', token: shop.token, body: { layout: 'nonsense' } })).json.layout, 'grid');
    await call(`/lives/${live.json.id}/end`, { token: shop.token, body: {} });
  });

  test('changing the money rules logs only what changed, in words, with tidy numbers', async () => {
    const admin = await register('Rules Admin');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(data, 'saligue.db'));
    db.prepare("update users set admin = 1, admin_level = 1 where id = ?").run(admin.id);
    db.close();
    const saved = await call('/admin/rules', { method: 'PUT', token: admin.token, body: { saleFee: 0.57 / 100, freeDays: 60 } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.saleFee, 0.0057);
    const log = await call('/admin/log', { token: admin.token });
    const line = log.json.find((r) => r.action === 'rules changed');
    assert.ok(line, 'logged');
    assert.match(line.detail, /Sale fee .*% → 0\.57%/);
    assert.match(line.detail, /Free days for new shops \d+ → 60/);
    assert.doesNotMatch(line.detail, /[{}]/);
  });
});

describe('share & earn', () => {
  test('a sale from a shared link pays the sharer once delivered and checked; own links and cancelled orders earn nothing', async () => {
    const product = (await call('/products')).json.find((p) => !p.official && (p.stock == null || p.stock > 1));
    const shop = await sampleShop(product.id);
    const sharer = await register('Style Sharer');
    const buyer = await register('Friend Buyer');
    // Opening your own link, or a link from the shop itself, records nothing.
    assert.equal((await call('/share/visit', { token: sharer.token, body: { via: sharer.id, product: product.id } })).json.recorded, 0);
    assert.equal((await call('/share/visit', { token: buyer.token, body: { via: shop.id, product: product.id } })).json.recorded, 0);
    assert.equal((await call('/share/visit', { token: buyer.token, body: { via: sharer.id, product: product.id } })).json.recorded, 1);
    const delivery = { fullName: 'Friend Buyer', phone: '0780000009', city: 'Kigali', street: 'KN 9 Ave' };
    await call('/orders', { token: buyer.token, body: { items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'cash_on_delivery', delivery } });
    let mine = (await call('/me/shares', { token: sharer.token })).json;
    assert.equal(mine.rewards.length, 1);
    assert.equal(mine.rewards[0].state, 'pending');
    assert.ok(mine.pending > 0 && mine.ready === 0);
    // Delivered with the handover code, but paid in cash: no money reached Saligue, so an admin checks it first.
    const order = (await call('/orders', { token: buyer.token })).json[0];
    await call(`/orders/${order.id}`, { method: 'PATCH', token: shop.token, body: { status: 'confirmed' } });
    assert.equal((await call(`/orders/${order.id}/handover`, { token: shop.token, body: { code: order.deliveryCode } })).status, 200);
    mine = (await call('/me/shares', { token: sharer.token })).json;
    assert.equal(mine.rewards[0].state, 'review');
    assert.equal(mine.ready, 0);
    const admin = await register('Shares Admin');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(data, 'saligue.db'));
    db.prepare('update users set admin = 1, admin_level = 1 where id = ?').run(admin.id);
    db.close();
    const queue = (await call('/admin/shares', { token: admin.token })).json;
    const waiting = queue.review.find((r) => r.sharer === 'Style Sharer');
    assert.ok(waiting && waiting.buyerAgeDays === 0 && waiting.paymentMethod === 'cash_on_delivery');
    assert.equal((await call(`/admin/shares/review/${waiting.id}`, { token: admin.token, body: { decision: 'approve' } })).status, 200);
    // Approved: ready to be paid, capped per item.
    mine = (await call('/me/shares', { token: sharer.token })).json;
    assert.equal(mine.rewards[0].state, 'earned');
    assert.equal(mine.ready, Math.min(mine.cap, Math.round(product.price * mine.rate * 100) / 100));
    // The admin pays it once the sharer has a Mobile Money number.
    assert.ok((await call('/admin/shares', { token: admin.token })).json.due.some((d) => d.userId === sharer.id));
    assert.equal((await call(`/admin/shares/payout/${sharer.id}`, { token: admin.token, body: {} })).status, 400);
    await call('/me/tips/account', { method: 'PUT', token: sharer.token, body: { momoNumber: '0780000010', momoName: 'Style Sharer' } });
    assert.equal((await call(`/admin/shares/payout/${sharer.id}`, { token: admin.token, body: { reference: 'MM123' } })).status, 200);
    mine = (await call('/me/shares', { token: sharer.token })).json;
    assert.equal(mine.ready, 0);
    assert.equal(mine.rewards[0].state, 'paid');
    // A second order from the same link that is cancelled earns nothing.
    await call('/orders', { token: buyer.token, body: { items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'cash_on_delivery', delivery } });
    const second = (await call('/orders', { token: buyer.token })).json.find((o) => o.id !== order.id);
    await call(`/orders/${second.id}`, { method: 'PATCH', token: buyer.token, body: { status: 'cancelled' } });
    mine = (await call('/me/shares', { token: sharer.token })).json;
    assert.ok(mine.rewards.some((r) => r.state === 'void'));
    assert.equal(mine.pending, 0);
  });
});

describe('launch numbers', () => {
  test('admins see each launch number with its target; too few people says so', async () => {
    const admin = await register('Launch Admin');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(data, 'saligue.db'));
    db.prepare('update users set admin = 1, admin_level = 1 where id = ?').run(admin.id);
    db.close();
    const visitor = await register('Launch Visitor');
    assert.equal((await call('/admin/launch', { token: visitor.token })).status, 403);
    const r = await call('/admin/launch', { token: admin.token });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    // Using the app today counts.
    assert.ok(r.json.trackingSince);
    const all = r.json.groups.flatMap((g) => g.metrics);
    assert.ok(all.find((m) => m.key === 'dau').value >= 2);
    assert.equal(all.find((m) => m.key === 'd7').status, 'none');
    assert.ok(all.every((m) => ['good', 'warn', 'bad', 'none'].includes(m.status) && m.target));
    assert.equal(r.json.ready.length, 4);
  });
});

describe('for you', () => {
  test('a new post nobody has seen gets a first audience early in the feed', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(data, 'saligue.db'));
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const active = db.prepare("select id, seller_id from products where status = 'active' and hidden = 0 and official = 0").all();
    db.prepare('update products set created_at = ?').run(old);
    const fresh = active.at(-1);
    db.prepare('update products set created_at = ? where id = ?').run(new Date().toISOString(), fresh.id);
    db.close();
    const shopper = await register('Feed Shopper');
    const feed = (await call('/feed', { token: shopper.token })).json;
    const at = feed.items.findIndex((x) => x.id === fresh.id);
    assert.ok(at >= 0 && at <= 5, `new post at ${at}`);
    assert.ok(feed.items[at].reason);
  });
});

describe('try-on photos', () => {
  test('realistic try-on is refused until the person confirms the photo is of them', async () => {
    const a = await register('Mirror User');
    const r = await call('/ai/tryon', { token: a.token, body: { person: 'data:image/jpeg;base64,AAAA', garment: 'data:image/jpeg;base64,AAAA', category: 'top' } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'consent_needed');
  });
  test('finished looks are deleted after 24 hours', async () => {
    const { mkdirSync, writeFileSync, utimesSync, existsSync } = await import('node:fs');
    const dir = join(data, 'tryon-cache');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'old-look.txt');
    writeFileSync(file, 'free\ndata:image/jpeg;base64,AAAA');
    const twoDays = (Date.now() - 48 * 3_600_000) / 1000;
    utimesSync(file, twoDays, twoDays);
    // The server sweeps at start; a fresh import of the module runs the same sweep.
    const sweep = spawnSync(process.execPath, ['--no-warnings', '-e', "await import('./server/tryon.mjs'); process.exit(0)"], { cwd: root, env, encoding: 'utf8' });
    assert.equal(sweep.status, 0, sweep.stderr);
    assert.equal(existsSync(file), false);
  });
});

describe('security watch', () => {
  const from = (ip) => ({ 'X-Forwarded-For': ip });
  const mainAdmin = async (name) => {
    const a = await register(name);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(data, 'saligue.db'));
    db.prepare('update users set admin = 1, admin_level = 1 where id = ?').run(a.id);
    db.close();
    return a;
  };
  test('a scanner is blocked, the admins are told, and an admin can lift the block', async () => {
    const admin = await mainAdmin('Security Admin');
    for (let i = 0; i < 30; i++) await fetch(`${base}/${['.env', '.git/config', 'wp-login.php'][i % 3]}`, { headers: from('203.0.113.7') });
    assert.equal((await call('/health', { headers: from('203.0.113.7') })).status, 403);
    assert.equal((await call('/health', { headers: from('203.0.113.8') })).status, 200);
    const seen = (await call('/admin/security', { token: admin.token })).json;
    assert.ok(seen.blocked.some((b) => b.ip === '203.0.113.7'));
    assert.ok(seen.events.some((e) => e.kind === 'probe' && e.ip === '203.0.113.7'));
    const told = (await call('/me/notifications', { token: admin.token })).json;
    assert.ok(JSON.stringify(told).includes('scanner was blocked'));
    assert.equal((await call('/admin/security/block/203.0.113.7', { method: 'DELETE', token: admin.token })).status, 200);
    assert.equal((await call('/health', { headers: from('203.0.113.7') })).status, 200);
    // The server's own address is never blocked (that would lock everyone out).
    const own = await call('/admin/security/block', { token: admin.token, body: { ip: '127.0.0.1' }, headers: from('192.0.2.50') });
    assert.equal(own.status, 200);
    assert.equal(own.json.blocked.some((b) => b.ip === '127.0.0.1'), false);
    // Nor the admin's own address.
    assert.equal((await call('/admin/security/block', { token: admin.token, body: { ip: '192.0.2.50' }, headers: from('192.0.2.50') })).status, 400);
  });
  test('guessing an admin password, trying admin functions and faking a payment are reported', async () => {
    const admin = await mainAdmin('Watch Admin');
    for (let i = 0; i < 3; i++) await call('/auth/login', { body: { email: admin.user.email, password: 'wrong-guess' }, headers: from('198.51.100.4') });
    const intruder = await register('Curious User');
    assert.equal((await call('/admin/security', { token: intruder.token, headers: from('198.51.100.5') })).status, 403);
    assert.equal((await call('/payments/webhook', { body: { event: 'charge.completed' }, headers: { ...from('198.51.100.6'), 'verif-hash': 'fake' } })).status, 401);
    const seen = (await call('/admin/security', { token: admin.token })).json;
    for (const kind of ['login_failed', 'admin_denied', 'webhook_forged']) assert.ok(seen.events.some((e) => e.kind === kind), kind);
    const told = JSON.stringify((await call('/me/notifications', { token: admin.token })).json);
    assert.ok(told.includes('guessing an admin password'));
    assert.ok(told.includes('fake payment confirmation'));
  });
});

describe('resaligue, pin and download', () => {
  test('a shop resaligues another shop’s item: its followers see it in Following and For You, with the shop’s name', async () => {
    const products = (await call('/products')).json.filter((p) => p.status === 'active' && !p.hidden);
    const first = products.find((p) => !p.official);
    const other = products.find((p) => p.sellerId !== first.sellerId);
    const shop = await sampleShop(first.id);
    const fan = await register('Resaligue Fan');
    assert.equal((await call(`/follow/${shop.id}`, { token: fan.token, body: {} })).status, 200);
    // Not your own item.
    assert.equal((await call(`/products/${first.id}/resaligue`, { token: shop.token, body: {} })).status, 400);
    const r = await call(`/products/${other.id}/resaligue`, { token: shop.token, body: {} });
    assert.equal(r.status, 200);
    assert.equal(r.json.reposted, true);
    assert.equal(r.json.repostCount, 1);
    assert.deepEqual((await call('/me/resaligues', { token: shop.token })).json, [other.id]);
    assert.deepEqual((await call(`/profiles/${shop.id}/resaligues`)).json, [other.id]);
    const following = (await call('/me/following/resaligues', { token: fan.token })).json;
    assert.equal(following[0].productId, other.id);
    assert.equal(following[0].by.id, shop.id);
    const feed = (await call('/feed', { token: fan.token })).json.items;
    const item = feed.find((x) => x.id === other.id);
    assert.equal(item.resaliguedBy.id, shop.id);
    assert.match(item.reason, /^Resaligued by /);
    // The shop that owns the item is told.
    const owner = await sampleShop(other.id);
    assert.ok((await call('/me/notifications', { token: owner.token })).json.some((n) => /resaligued your item/.test(n.title)));
    // Taking it back.
    const undo = await call(`/products/${other.id}/resaligue`, { token: shop.token, body: {} });
    assert.equal(undo.json.reposted, false);
    assert.equal(undo.json.repostCount, 0);
    assert.equal((await call('/me/following/resaligues', { token: fan.token })).json.length, 0);
  });

  test('only the shop pins its items, at most 3', async () => {
    const products = (await call('/products')).json;
    const shopId = products.find((p) => !p.official).sellerId;
    const mine = products.filter((p) => p.sellerId === shopId);
    const shop = await sampleShop(mine[0].id);
    const stranger = await register('Pin Stranger');
    assert.equal((await call(`/products/${mine[0].id}/pin`, { token: stranger.token, body: {} })).status, 403);
    assert.equal((await call(`/products/${mine[0].id}/pin`, { token: shop.token, body: {} })).status, 200);
    assert.ok((await call('/products')).json.find((p) => p.id === mine[0].id).pinnedAt);
    if (mine.length >= 4) {
      for (const p of mine.slice(1, 3)) assert.equal((await call(`/products/${p.id}/pin`, { token: shop.token, body: {} })).status, 200);
      assert.equal((await call(`/products/${mine[3].id}/pin`, { token: shop.token, body: {} })).status, 409);
    }
    assert.equal((await call(`/products/${mine[0].id}/pin`, { token: shop.token, body: { pinned: false } })).status, 200);
    assert.equal((await call('/products')).json.find((p) => p.id === mine[0].id).pinnedAt, undefined);
  });

  test('download gives the picture with the Saligue mark as a JPEG file', async () => {
    const p = (await call('/products')).json.find((x) => x.status === 'active' && !x.hidden && x.image?.startsWith('/media/'));
    const r = await fetch(`${base}/api/products/${p.id}/download`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.match(r.headers.get('content-disposition'), /attachment; filename="saligue-.+\.jpg"/);
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
    assert.equal((await call('/products/nope/download')).status, 404);
  });
});
