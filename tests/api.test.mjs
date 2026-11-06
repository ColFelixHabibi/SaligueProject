// Saligue's main paths, tested against a separate server with its own empty database (never the real one):
//   npm test
// It starts server/index.mjs on a free port with SALIGUE_DATA in a temporary folder, adds the sample catalogue
// (server/seed.mjs), and checks accounts, the catalogue, comments, looks, questions, orders and fees.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const data = mkdtempSync(join(tmpdir(), 'saligue-test-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;

// A stand-in for DeepSeek (DEEPSEEK_API_URL), so the AI key tests never touch the network: one key works and every
// other key is refused, exactly like the real /user/balance and /chat/completions.
const GOOD_KEY = `sk-${'a1b2c3d4'.repeat(4)}`;
const deepseek = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: { message: 'Authentication Fails' } }));
    return;
  }
  if (req.url === '/user/balance') {
    res.end(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '12.34' }] }));
    return;
  }
  if (req.url === '/chat/completions') {
    req.resume();
    req.on('end', () => res.end(JSON.stringify({
      model: 'deepseek-chat',
      usage: { total_tokens: 42 },
      choices: [{ message: { content: 'A soft cotton jacket in like-new condition.' } }],
    })));
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});
await new Promise((done) => deepseek.listen(0, '127.0.0.1', done));
const deepseekUrl = `http://127.0.0.1:${deepseek.address().port}`;

const env = { ...process.env, SALIGUE_SECURITY_WATCH: '0', SALIGUE_DATA: data, PORT: String(port), HOST: '127.0.0.1', SITE_URL: base, SMTP_URL: '', FAL_KEY: '', FLW_SECRET_KEY: '', FCM_SERVICE_ACCOUNT: '',
  // The AI key tests ask the stand-in above, never DeepSeek; no platform key, so an account's own key is the only one.
  DEEPSEEK_API_URL: deepseekUrl, DEEPSEEK_API_KEY: '',
  // The sealing key for those AI keys, outside the database (never the server's real /etc/saligue/seal.key).
  SALIGUE_SEAL_KEY: 'a'.repeat(64), SALIGUE_SEAL_FILE: join(data, 'no-seal-file'),
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
// The server is stopped even when a run is cut short (Ctrl-C, a killed terminal): otherwise it is left running
// on its own port, holding a few hundred megabytes.
const stop = () => server?.kill();
process.on('exit', stop);
after(() => {
  stop();
  deepseek.close();
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
  // The Terms and the age line on the register form are only worth anything if the account records which Terms it
  // accepted, and if an account cannot be made without ticking the box at all.
  test('an account cannot be made without accepting the Terms, and the version accepted is kept', async () => {
    const refused = await call('/auth/register', {
      body: { name: 'No Terms', email: `noterms${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'Test12345!', role: 'buyer' },
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.json.error.code, 'terms_not_accepted');

    const a = await register('Terms Keeper');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(data, 'saligue.db'));
    const row = db.prepare('select terms_accepted_at, terms_version from users where id = ?').get(a.id);
    db.close();
    assert.ok(row.terms_accepted_at, 'the date is kept on the account');
    assert.match(row.terms_version, /^\d{1,2} \w+ \d{4}$/, 'the version of the Terms that was accepted is kept too');
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
    // Reports count by weight, not by number (server/index.mjs reportWeight): an account opened minutes ago counts
    // half, so three throwaway accounts cannot hide someone's words. Settled accounts weigh one each here.
    const reporters = [];
    for (const name of ['R One', 'R Two', 'R Three']) reporters.push(await register(name));
    const report = async () => {
      for (const r of reporters) {
        assert.equal((await call('/comment-reports', { token: r.token, body: { kind: 'item', id: c.json.id, reason: 'rude' } })).status, 200);
      }
    };
    await report();
    const early = (await call(`/products/${product.id}/comments`)).json;
    assert.ok(early.some((x) => x.id === c.json.id), 'three accounts opened minutes ago must not hide a comment');
    await settle(reporters);
    // The same people report again (one report per person is kept): now they weigh one each, and it goes.
    await report();
    const list = (await call(`/products/${product.id}/comments`)).json;
    assert.ok(!list.some((x) => x.id === c.json.id), 'three settled accounts hide the comment');
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

// Item reports count by weight too, so a shop cannot bury a rival's listing with accounts opened the same day.
describe('reports count by weight, not by number', () => {
  test('three accounts opened minutes ago do not hide an item; settled ones do', async () => {
    const product = (await call('/products')).json[2];
    const people = [];
    for (const name of ['Watcher One', 'Watcher Two', 'Watcher Three']) people.push(await register(name));
    const report = async () => {
      for (const p of people) {
        assert.equal((await call(`/products/${product.id}/report`, { token: p.token, body: { reason: 'not_fashion' } })).status, 200);
      }
    };
    await report();
    assert.equal((await call(`/products/${product.id}`)).status, 200, 'half-weight reports alone must not hide an item');
    await settle(people);
    // The same people report again (one report per person is kept): now they weigh one each, and it goes.
    await report();
    assert.equal((await call(`/products/${product.id}`)).status, 404, 'three settled reports hide the item until INDECIANA looks');
  });
});

// Notices from people whose photo, brand or work was used (page /takedown). No account is needed: the person whose
// photo was used often has none. Only a notice that names one of our items and carries both statements hides it.
describe('notice and takedown', () => {
  const notice = (body) => call('/takedowns', {
    body: {
      name: 'Ana Mukamana', email: 'ana@example.com', rights: 'copyright', target: '',
      details: 'The main photo on this item is one I took in my shop in June, and it was used without my agreement.',
      ...body,
    },
  });

  test('a notice without the two statements is kept, and hides nothing', async () => {
    const product = (await call('/products')).json[0];
    const r = await notice({ target: product.id });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.hidden, false);
    assert.match(r.json.reference, /^[0-9A-F]{8}$/);
    assert.equal((await call(`/products/${product.id}`)).status, 200, 'nothing is hidden without both statements');
  });

  test('naming one of our items and confirming both statements hides it at once', async () => {
    const product = (await call('/products')).json[0];
    const r = await notice({ target: `https://saligue.com/product?id=${product.id}`, goodFaith: true, accuracy: true, rights: 'privacy' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.hidden, true);
    assert.equal(r.json.item, product.name);
    assert.equal((await call(`/products/${product.id}`)).status, 404, 'the item is out of sight while INDECIANA checks the notice');
  });

  test('a notice must be answerable and say what is yours', async () => {
    assert.equal((await notice({ name: '', target: 'some-item' })).json.error.code, 'missing_name');
    assert.equal((await notice({ name: 'Ana', target: 'some-item', email: 'not-an-email' })).json.error.code, 'invalid_email');
    assert.equal((await notice({ name: 'Ana', target: '' })).json.error.code, 'missing_target');
    assert.equal((await notice({ name: 'Ana', target: 'some-item', details: 'too short' })).json.error.code, 'missing_details');
  });

  test('notices are read by INDECIANA, not by shoppers', async () => {
    const a = await register('Nosy Shopper');
    assert.equal((await call('/admin/takedowns', { token: a.token })).status, 403);
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

// A link shared into WhatsApp, Facebook, X or Telegram arrives as a card with a picture and a line, not a bare
// address. The server writes those tags into the page it sends (server/index.mjs sharePreview), so this reads the
// HTML itself. It needs the built site in out/, which is what the server serves; without it there is nothing to add
// tags to, so the whole block is skipped rather than failing on a checkout that has never been built.
const page = async (path) => {
  const r = await fetch(`${base}${path}`, { headers: { Accept: 'text/html' } });
  return { status: r.status, html: await r.text() };
};
const tagIn = (html, property) => new RegExp(`<meta property="${property}" content="([^"]*)"`).exec(html)?.[1] ?? null;
const built = existsSync(join(root, 'out', 'index.html'));

describe('links shared into other apps show a card', { skip: built ? false : 'no out/ — run npm run build first' }, () => {
  test("an item's card carries its name, its price and its photo", async () => {
    const product = (await call('/products')).json.find((p) => p.image || p.cutout);
    const { status, html } = await page(`/product?id=${product.id}`);
    assert.equal(status, 200);
    const title = tagIn(html, 'og:title');
    assert.ok(title?.includes(product.name), `${title} should name the item`);
    assert.ok(/\$\d/.test(title), `${title} should show the price`);
    const image = tagIn(html, 'og:image');
    assert.match(image, /^https?:\/\//, `og:image must be a full address other apps can fetch, got ${image}`);
    assert.equal(tagIn(html, 'og:image:alt'), title);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  });
  test('a look shows its name, whose it is, and its first picture', async () => {
    const product = (await call('/products')).json.find((p) => p.image || p.cutout);
    const a = await register('Boarder');
    const look = await call('/looks', { token: a.token, body: { name: 'Wedding guest' } });
    await call(`/looks/${look.json.id}/items`, { token: a.token, body: { kind: 'product', id: product.id } });
    const { html } = await page(`/looks?id=${look.json.id}`);
    const title = tagIn(html, 'og:title');
    assert.match(title, /Wedding guest · a look by /);
    assert.match(tagIn(html, 'og:image'), /^https?:\/\//);
  });
  test('a #hashtag shows how many items carry it', async () => {
    const product = (await call('/products')).json.find((p) => p.image || p.cutout);
    const shop = await sampleShop(product.id);
    const tag = `saliguetest${Math.random().toString(36).slice(2, 7)}`;
    const patched = await call(`/products/${product.id}`, { method: 'PATCH', token: shop.token, body: { description: `Summer jacket #${tag}` } });
    assert.equal(patched.status, 200, JSON.stringify(patched.json));
    const { html } = await page(`/tag?t=${tag}`);
    assert.equal(tagIn(html, 'og:title'), `#${tag} · 1 item on Saligue`);
    assert.match(tagIn(html, 'og:image'), /^https?:\/\//);
  });
  test('a page with nothing behind it gets the site card, never a made-up item', async () => {
    const { html } = await page('/product?id=does-not-exist');
    // The site-wide card from src/app/layout.tsx answers: the site's name and its own icon, as full addresses
    // other apps can fetch. An item that does not exist must not be described as if it did.
    assert.equal(tagIn(html, 'og:title'), 'Saligue by INDECIANA');
    assert.match(tagIn(html, 'og:image'), /^https?:\/\/.+icon-512/);
    assert.equal(tagIn(html, 'og:image:alt'), 'Saligue by INDECIANA');
  });
});

// Makes accounts look settled — opened more than a day ago — so that their reports weigh one each instead of half
// (server/index.mjs reportWeight). Takes what register() returned, or account ids.
async function settle(accounts) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(data, 'saligue.db'));
  const when = new Date(Date.now() - 3 * 86_400_000).toISOString();
  for (const a of accounts) db.prepare('update users set created_at = ? where id = ?').run(when, typeof a === 'string' ? a : a.id);
  db.close();
}

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

  // A live drop: the host holds an item up, shoppers claim a place, ten minutes to pay. The place — not the
  // stock — is held, so a shopper who never pays cannot keep the item away from everyone else.
  test('a drop gives one place per person, frees it when given back or closed, and ends with the live', async () => {
    const product = (await call('/products')).json.find((p) => !p.official && (p.stock == null || p.stock > 0));
    const shop = await sampleShop(product.id);
    const live = (await call('/lives', { token: shop.token, body: { title: 'Drops tonight', productIds: [product.id] } })).json;
    const dropAt = `/lives/${live.id}/drops`;

    const drop = await call(dropAt, { token: shop.token, body: { productId: product.id, slots: 1 } });
    assert.equal(drop.status, 200, JSON.stringify(drop.json));
    assert.equal(drop.json.slots, 1);
    assert.equal(drop.json.claimed, 0);
    assert.equal(drop.json.open, true);
    // One open drop per item: holding the same item up twice is refused rather than doubling the queue.
    assert.equal((await call(dropAt, { token: shop.token, body: { productId: product.id } })).json.error.code, 'already_dropped');

    const a = await register('Fast Shopper');
    const b = await register('Slow Shopper');
    assert.equal((await call(`${dropAt}/${drop.json.id}/claim`, { body: {} })).json.error.code, 'not_signed_in');
    const mine = await call(`${dropAt}/${drop.json.id}/claim`, { token: a.token, body: {} });
    assert.equal(mine.status, 200, JSON.stringify(mine.json));
    assert.ok(mine.json.drop.mine.expiresAt, 'the place has a deadline');
    // The line in the chat, so the claim is visible to everyone and stays in the replay.
    const seen = await call(`/lives/${live.id}`, { token: a.token });
    assert.ok(seen.json.comments.some((c) => c.text === `claimed ${product.name}`), 'the claim shows in the chat');
    assert.equal(seen.json.drops[0].mine.claimId, mine.json.claim.claimId, 'my own place is mine to see, and nobody else’s');
    assert.equal((await call(`${dropAt}/${drop.json.id}/claim`, { token: a.token, body: {} })).json.error.code, 'already_claimed');
    const late = await call(`${dropAt}/${drop.json.id}/claim`, { token: b.token, body: {} });
    assert.equal(late.status, 409);
    assert.equal(late.json.error.code, 'all_claimed');
    assert.equal((await call(`/lives/${live.id}`, { token: b.token })).json.drops[0].mine, null, 'someone else’s place is not shown as mine');

    // Giving the place back puts it in the queue again.
    assert.equal((await call(`${dropAt}/${drop.json.id}/claim`, { method: 'DELETE', token: a.token })).status, 200);
    const second = await call(`${dropAt}/${drop.json.id}/claim`, { token: b.token, body: {} });
    assert.equal(second.status, 200, JSON.stringify(second.json));

    // Paying for it from the bag keeps the place, marked paid: a bought place is gone, so a one-place drop is all claimed.
    assert.equal((await call('/orders', { token: b.token, body: { items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'cash_on_delivery', delivery: { fullName: 'Live Shopper', phone: '0780000011', city: 'Kigali', street: 'KN 11 Ave' } } })).status, 200);
    const sold = (await call(`/lives/${live.id}`, { token: shop.token })).json.drops[0];
    assert.equal(sold.claimed, 1);
    assert.equal(sold.open, false, 'the only place was bought');
    assert.deepEqual(sold.claimers, [{ name: 'Slow Shopper', paid: true }]);
    assert.equal((await call(`/lives/${live.id}`, { token: b.token })).json.drops[0].mine, null, 'a paid place is no longer waiting on me');
    assert.equal((await call(`${dropAt}/${drop.json.id}/claim`, { token: a.token, body: {} })).json.error.code, 'all_claimed');
    // The buyer cancels that order: the item is on sale again, and so is the place.
    const placed = (await call('/orders', { token: b.token })).json[0];
    assert.equal((await call(`/orders/${placed.id}`, { method: 'PATCH', token: b.token, body: { status: 'cancelled' } })).status, 200);
    const reopened = (await call(`/lives/${live.id}`, { token: shop.token })).json.drops[0];
    assert.equal(reopened.claimed, 0, 'the cancelled order gave its place back');
    assert.equal(reopened.open, true);
    assert.equal((await call(`${dropAt}/${drop.json.id}/claim`, { token: a.token, body: {} })).status, 200, 'and someone else can claim it');

    // The host moves on: the drop closes, so the place can no longer be claimed.
    assert.equal((await call(`${dropAt}/${drop.json.id}`, { method: 'DELETE', token: shop.token })).status, 200);
    assert.equal((await call(`${dropAt}/${drop.json.id}/claim`, { token: b.token, body: {} })).json.error.code, 'closed');

    // A second drop, still open when the live ends: nobody can claim after the host has gone.
    const again = (await call(dropAt, { token: shop.token, body: { productId: product.id, slots: 2 } })).json;
    await call(`/lives/${live.id}/end`, { token: shop.token, body: {} });
    const after = await call(`${dropAt}/${again.id}/claim`, { token: b.token, body: {} });
    assert.equal(after.status, 410);
    assert.equal(after.json.error.code, 'ended');
  });

  test('a chat photo opens only through its signed link, signed with a key kept outside the database', async () => {
    const product = (await call('/products')).json.find((p) => !p.official);
    await sampleShop(product.id);
    const buyer = await register('Photo Sender');
    const started = await call('/conversations', { token: buyer.token, body: { productId: product.id } });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    const conversationId = started.json.id ?? started.json.conversation?.id;
    const { default: sharp } = await import('sharp');
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#e21376' } }).png().toBuffer();
    const sent = await fetch(`${base}/api/conversations/${conversationId}/attachments/image`, { method: 'PUT', headers: { Authorization: `Bearer ${buyer.token}`, 'Content-Type': 'image/png' }, body: png });
    const message = await sent.json();
    assert.equal(sent.status, 200, JSON.stringify(message));
    const link = message.attachment.url;
    assert.match(link, /^\/api\/chat-files\/[a-f0-9-]{36}\.jpg\?e=\d+&s=/);
    const opened = await fetch(`${base}${link}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.headers.get('content-type'), 'image/jpeg');
    // One character changed in the signature, or no signature: nothing.
    const s = new URL(link, base).searchParams.get('s');
    const forged = link.replace(`s=${s}`, `s=${(s[0] === 'A' ? 'B' : 'A')}${s.slice(1)}`);
    assert.equal((await fetch(`${base}${forged}`)).status, 404);
    assert.equal((await fetch(`${base}${link.split('?')[0]}`)).status, 404);
    // Someone outside the chat cannot add to it.
    const stranger = await register('Chat Stranger');
    const intruder = await fetch(`${base}/api/conversations/${conversationId}/attachments/image`, { method: 'PUT', headers: { Authorization: `Bearer ${stranger.token}`, 'Content-Type': 'image/png' }, body: png });
    assert.notEqual(intruder.status, 200);
    // The signing secret is not in the database: a copy of it cannot make working links.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(data, 'saligue.db'));
    assert.equal(db.prepare("select count(*) as n from app_config where key = 'chat_files'").get().n, 0);
    db.close();
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
    // Who moves the money is a decision, not a default: nothing goes out until it is made (server/compliance.mjs).
    assert.equal((await call(`/admin/shares/payout/${sharer.id}`, { token: admin.token, body: {} })).json.error.code, 'partner_missing');
    await call('/admin/compliance', { method: 'PUT', token: admin.token, body: { payouts: { mode: 'self' } } });
    assert.equal((await call(`/admin/shares/payout/${sharer.id}`, { token: admin.token, body: {} })).json.error.code, 'licence_missing');
    await call('/admin/compliance', { method: 'PUT', token: admin.token, body: { payouts: { mode: 'partner', partner: 'Test Mobile Money aggregator' } } });
    assert.equal((await call(`/admin/shares/payout/${sharer.id}`, { token: admin.token, body: {} })).json.error.code, 'no_momo');
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
  test('a photo far bigger than the app sends is refused before the AI is asked', async () => {
    const a = await register('Mirror Big Photo');
    const huge = `data:image/jpeg;base64,${'A'.repeat(2_600_000)}`;
    const r = await call('/ai/tryon', { token: a.token, body: { person: huge, garment: 'data:image/jpeg;base64,AAAA', category: 'top', consent: 'self' } });
    assert.equal(r.status, 413);
    assert.equal(r.json.error.code, 'too_large');
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

describe('AI keys', () => {
  const rightShape = `sk-${'z9y8x7'.repeat(4)}`; // looks like a key, but the stand-in refuses it
  test('a key that is not a DeepSeek key is refused without asking anyone', async () => {
    const a = await register('Key Typo');
    const r = await call('/ai/keys/deepseek', { method: 'PUT', token: a.token, body: { key: 'my-secret-key' } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'key_refused');
    assert.match(r.json.error.message, /sk-/);
    assert.equal((await call('/ai/keys', { token: a.token })).json.deepseek.saved, false);
  });

  test('a key DeepSeek refuses is not saved', async () => {
    const a = await register('Key Refused');
    const r = await call('/ai/keys/deepseek', { method: 'PUT', token: a.token, body: { key: rightShape } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'key_refused');
    assert.equal((await call('/ai/keys', { token: a.token })).json.deepseek.saved, false);
  });

  test('an accepted key is saved sealed, comes back only as a hint, and is removed on request', async () => {
    const a = await register('Key Owner');
    const r = await call('/ai/keys/deepseek', { method: 'PUT', token: a.token, body: { key: GOOD_KEY } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.saved, true);
    assert.equal(r.json.checked, true);
    assert.equal(r.json.balance, '12.34 USD');
    assert.equal(r.json.source, 'yours');
    assert.equal(r.json.hint, `••••${GOOD_KEY.slice(-4)}`);
    // The app never gets the key back, in the summary either.
    const summary = await call('/ai/keys', { token: a.token });
    assert.equal(JSON.stringify(summary.json).includes(GOOD_KEY), false);
    // A copy of the database is not a copy of the key: only the sealed form is written.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(data, 'saligue.db'));
    const saved = db.prepare('select secret from user_ai_keys where user_id = ?').get(a.id);
    assert.ok(saved?.secret.startsWith('enc2:'), 'sealed under the key kept outside the database');
    assert.equal(saved.secret.includes(GOOD_KEY), false);
    assert.equal(db.prepare("select count(*) as n from app_config where key = 'ai_keys'").get().n, 0, 'no sealing key in the database');
    // A key saved before sealing (plain text) still works, and is sealed the first time it is used.
    db.prepare('update user_ai_keys set secret = ? where user_id = ?').run(GOOD_KEY, a.id);
    const old = await call('/ai/keys/deepseek/check', { method: 'POST', token: a.token });
    assert.equal(old.json.checked, true, JSON.stringify(old.json));
    assert.ok(db.prepare('select secret from user_ai_keys where user_id = ?').get(a.id).secret.startsWith('enc2:'), 'sealed again on use');
    db.close();
    // Another account has none of it, and is never told it exists.
    const b = await register('Key Stranger');
    assert.equal((await call('/ai/keys', { token: b.token })).json.deepseek.saved, false);
    // "Check again" asks about the saved key without the app holding it.
    const checked = await call('/ai/keys/deepseek/check', { method: 'POST', token: a.token });
    assert.equal(checked.status, 200, JSON.stringify(checked.json));
    assert.equal(checked.json.checked, true);
    // Removing it returns the account to no key at all.
    const removed = await call('/ai/keys/deepseek', { method: 'DELETE', token: a.token });
    assert.equal(removed.json.saved, false);
    assert.equal(removed.json.source, 'none');
  });

  test('an item’s description is written with the account’s own key, and refused when it has none', async () => {
    const a = await register('Key Writer');
    const none = await call('/ai/write', { token: a.token, body: { title: 'Vintage denim jacket' } });
    assert.equal(none.status, 503);
    assert.equal(none.json.error.code, 'no_key');
    // Nothing to describe: the AI is not asked at all.
    await call('/ai/keys/deepseek', { method: 'PUT', token: a.token, body: { key: GOOD_KEY } });
    assert.equal((await call('/ai/write', { token: a.token, body: { title: '', category: '' } })).status, 400);
    const written = await call('/ai/write', {
      token: a.token,
      body: { title: 'Vintage denim jacket', category: 'Jackets', condition: 'Like new', size: 'M', lang: 'rw' },
    });
    assert.equal(written.status, 200, JSON.stringify(written.json));
    assert.equal(written.json.source, 'yours');
    assert.match(written.json.text, /jacket/);
  });

  test('the data download shows only the key’s hint, and deleting the account removes the key', async () => {
    const a = await register('Key Leaving');
    assert.equal((await call('/ai/keys/deepseek', { method: 'PUT', token: a.token, body: { key: GOOD_KEY } })).status, 200);
    // "Download my data" is everything Saligue keeps about the person, so the key is there as its hint, never itself.
    const file = await (await fetch(`${base}/api/auth/me/export`, { headers: { Authorization: `Bearer ${a.token}` } })).json();
    assert.equal(file.aiKey.saved, true);
    assert.equal(file.aiKey.hint, `••••${GOOD_KEY.slice(-4)}`);
    assert.equal(JSON.stringify(file).includes(GOOD_KEY), false);
    // Deleting an account empties it rather than removing the row, so nothing else would ever clean the key up.
    assert.equal((await call('/auth/me/delete', { token: a.token, body: { confirm: 'DELETE' } })).status, 200);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(data, 'saligue.db'));
    const left = db.prepare('select count(*) as n from user_ai_keys where user_id = ?').get(a.id).n;
    db.close();
    assert.equal(left, 0);
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

describe('clients, network and chat', () => {
  const upload = async (token, conversationId, kind, type, bytes) => {
    const r = await fetch(`${base}/api/conversations/${conversationId}/attachments/${kind}`, { method: 'PUT', headers: { 'Content-Type': type, Authorization: `Bearer ${token}` }, body: bytes });
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  test('anyone can follow anyone; connected people chat, strangers get one message until they answer', async () => {
    const amina = await register('Amina Chat');
    const grace = await register('Grace Chat');
    const zed = await register('Zed Stranger');
    // Not connected: no direct chat.
    assert.equal((await call('/conversations', { token: zed.token, body: { userId: amina.id, text: 'hi' } })).status, 403);
    // Grace follows Amina: Grace is one of Amina's Clients, Amina is in Grace's Network.
    assert.equal((await call(`/follow/${amina.id}`, { token: grace.token, body: {} })).status, 200);
    assert.deepEqual((await call(`/profiles/${amina.id}/clients`)).json.map((p) => p.id), [grace.id]);
    assert.deepEqual((await call(`/profiles/${grace.id}/following`)).json.map((p) => p.id), [amina.id]);
    const profile = (await call(`/profiles/${grace.id}`, { token: amina.token })).json;
    assert.equal(profile.followsYou, true);
    assert.equal(profile.canMessage, true);
    // Grace writes first; Amina doesn't follow Grace back, so Grace waits for an answer after one message.
    const start = await call('/conversations', { token: grace.token, body: { userId: amina.id, text: 'Hello Amina!' } });
    assert.equal(start.status, 200);
    const c = start.json.id;
    assert.equal((await call(`/conversations/${c}/messages`, { token: grace.token, body: { text: 'Are you there?' } })).status, 403);
    assert.equal((await call(`/conversations/${c}/messages`, { token: amina.token, body: { text: 'Hi Grace' } })).status, 200);
    assert.equal((await call(`/conversations/${c}/messages`, { token: grace.token, body: { text: 'Great!' } })).status, 200);
    // The same chat whoever opens it.
    assert.equal((await call('/conversations', { token: amina.token, body: { userId: grace.id } })).json.id, c);
    const inbox = (await call('/conversations', { token: amina.token })).json.find((x) => x.id === c);
    assert.equal(inbox.kind, 'direct');
    assert.equal(inbox.other.id, grace.id);
    // A stranger can't read it.
    assert.equal((await call(`/conversations/${c}`, { token: zed.token })).status, 404);
  });

  test('photos and voice notes are private files behind signed links; messages can be unsent', async () => {
    const a = await register('Media Sender');
    const b = await register('Media Friend');
    await call(`/follow/${a.id}`, { token: b.token, body: {} });
    await call(`/follow/${b.id}`, { token: a.token, body: {} });
    const c = (await call('/conversations', { token: a.token, body: { userId: b.id } })).json.id;
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#e21376' } }).png().toBuffer();
    const photo = await upload(a.token, c, 'image', 'image/png', png);
    assert.equal(photo.status, 200, JSON.stringify(photo.json));
    assert.equal(photo.json.attachment.kind, 'image');
    const file = await fetch(`${base}${photo.json.attachment.url}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/jpeg');
    // A changed signature, or no signature: nothing.
    assert.equal((await fetch(`${base}${photo.json.attachment.url.replace(/s=[^&]+/, 's=forged')}`)).status, 404);
    assert.equal((await fetch(`${base}${photo.json.attachment.url.split('?')[0]}`)).status, 404);
    // Not a photo.
    assert.equal((await upload(a.token, c, 'image', 'image/png', Buffer.from('not a picture'))).status, 400);
    // A one-second voice note (made with ffmpeg) becomes an M4A.
    const { spawnSync: run } = await import('node:child_process');
    const wav = run('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', '-f', 'wav', '-'], { maxBuffer: 10_000_000 }).stdout;
    const voice = await upload(b.token, c, 'voice', 'audio/wav', wav);
    assert.equal(voice.status, 200, JSON.stringify(voice.json));
    assert.equal(voice.json.attachment.kind, 'voice');
    assert.equal(voice.json.attachment.duration, 1);
    assert.equal((await fetch(`${base}${voice.json.attachment.url}`)).headers.get('content-type'), 'audio/mp4');
    // Someone outside the chat can't add to it.
    const z = await register('Media Outsider');
    assert.equal((await upload(z.token, c, 'image', 'image/png', png)).status, 404);
    // Unsend: gone for both, file deleted.
    assert.equal((await call(`/conversations/${c}/messages/${photo.json.id}`, { method: 'DELETE', token: b.token })).status, 404);
    assert.equal((await call(`/conversations/${c}/messages/${photo.json.id}`, { method: 'DELETE', token: a.token })).status, 200);
    const thread = (await call(`/conversations/${c}`, { token: b.token })).json.messages;
    assert.equal(thread.find((m) => m.id === photo.json.id).deleted, true);
    assert.equal((await fetch(`${base}${photo.json.attachment.url}`)).status, 404);
  });

  // Clearing is per account: your copy goes, the other person keeps theirs, and a new message brings the chat back.
  test('clearing a chat empties only your side, and a new message brings it back', async () => {
    const a = await register('Clear One');
    const b = await register('Clear Two');
    await call(`/follow/${a.id}`, { token: b.token, body: {} });
    const c = (await call('/conversations', { token: b.token, body: { userId: a.id, text: 'Hello' } })).json.id;
    await call(`/conversations/${c}/messages`, { token: a.token, body: { text: 'Hello back' } });
    assert.ok((await call('/conversations', { token: a.token })).json.some((x) => x.id === c));
    // The first person clears: his list and his thread empty.
    assert.equal((await call(`/conversations/${c}`, { method: 'DELETE', token: a.token })).status, 200);
    assert.equal((await call('/conversations', { token: a.token })).json.some((x) => x.id === c), false);
    assert.equal((await call(`/conversations/${c}`, { token: a.token })).json.messages.length, 0);
    // The other side still has everything: clearing never deletes the other person's copy.
    assert.equal((await call(`/conversations/${c}`, { token: b.token })).json.messages.length, 2);
    assert.ok((await call('/conversations', { token: b.token })).json.some((x) => x.id === c));
    // Someone outside the chat can't clear it.
    const outsider = await register('Clear Outsider');
    assert.equal((await call(`/conversations/${c}`, { method: 'DELETE', token: outsider.token })).status, 404);
    // A new message brings the chat back, with only what arrived after the clear.
    await new Promise((r) => setTimeout(r, 5));
    await call(`/conversations/${c}/messages`, { token: b.token, body: { text: 'Still there?' } });
    const back = (await call(`/conversations/${c}`, { token: a.token })).json;
    assert.deepEqual(back.messages.map((m) => m.text), ['Still there?']);
  });
});

describe('notifications', () => {
  test('a notification can be deleted, or all of them, and only this account’s are touched', async () => {
    const a = await register('Notify Me');
    const b = await register('Notify Other');
    // Every new account starts with a welcome notification; empty both lists first so the counts below are the
    // ones this test puts there (and clearing all is proved on the way).
    assert.equal((await call('/me/notifications', { method: 'DELETE', token: a.token })).status, 200);
    assert.equal((await call('/me/notifications', { method: 'DELETE', token: b.token })).status, 200);
    assert.deepEqual((await call('/me/notifications', { token: a.token })).json, []);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(data, 'saligue.db'));
    const put = (id, userId, title) => db.prepare('insert into notifications (id, user_id, type, title, body, link, read, created_at) values (?, ?, ?, ?, ?, ?, 0, ?)')
      .run(id, userId, 'account', title, '', null, new Date().toISOString());
    put('note-a1', a.id, 'One');
    put('note-a2', a.id, 'Two');
    put('note-b1', b.id, 'Other');
    db.close();
    // Signed out: an empty list, not an error (the bell has to work on every page).
    assert.deepEqual((await call('/me/notifications')).json, []);
    assert.equal((await call('/me/notifications', { token: a.token })).json.length, 2);
    // Deleting someone else's notification answers the same but leaves it alone.
    assert.equal((await call('/me/notifications/note-a1', { method: 'DELETE', token: b.token })).status, 200);
    assert.equal((await call('/me/notifications', { token: a.token })).json.length, 2);
    assert.deepEqual((await call('/me/notifications', { token: b.token })).json.map((n) => n.id), ['note-b1']);
    // Your own: gone, and the rest untouched.
    assert.equal((await call('/me/notifications/note-a1', { method: 'DELETE', token: a.token })).status, 200);
    assert.deepEqual((await call('/me/notifications', { token: a.token })).json.map((n) => n.id), ['note-a2']);
    // Clear all: this account only.
    assert.equal((await call('/me/notifications', { method: 'DELETE', token: a.token })).status, 200);
    assert.equal((await call('/me/notifications', { token: a.token })).json.length, 0);
    assert.equal((await call('/me/notifications', { token: b.token })).json.length, 1);
  });
});

describe('data protection, and who moves users’ money', () => {
  const mainAdmin = async (name) => {
    const a = await register(name);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(data, 'saligue.db'));
    db.prepare('update users set admin = 1, admin_level = 1 where id = ?').run(a.id);
    db.close();
    return a;
  };

  test('the public page says who is responsible, what is processed and who pays — without leaking the licence', async () => {
    const r = await call('/compliance');
    assert.equal(r.status, 200);
    assert.ok(r.json.controller.name);
    assert.equal(typeof r.json.controller.registered, 'boolean');
    assert.ok(r.json.processing.length >= 8, 'every purpose is listed');
    assert.ok(r.json.processing.every((p) => p.what && p.why && p.kept && p.where), 'each row says what, why, how long and where');
    assert.ok(r.json.dpia.risks.length >= 4, 'the try-on risks are assessed');
    assert.ok(r.json.dpia.risks.every((x) => x.risk && x.measures.length && x.residual), 'each risk says what answers it and what remains');
    assert.equal(typeof r.json.payouts.open, 'boolean');
    // The licence reference is an internal control, never published.
    assert.equal(r.json.payouts.licence, undefined);
  });

  test('only an admin with the policies right may read or change it', async () => {
    const shopper = await register('Data Visitor');
    assert.equal((await call('/admin/compliance', { token: shopper.token })).status, 403);
    assert.equal((await call('/admin/compliance', { method: 'PUT', token: shopper.token, body: { payouts: { mode: 'off' } } })).status, 403);
    // No session at all is refused with 403 by requireAdmin, like every admin route: an anonymous call has no
    // admin right, and the security watch counts that 403 as an attempt on admin functions (security.mjs adminDenied).
    assert.equal((await call('/admin/compliance', { method: 'PUT', body: { payouts: { mode: 'off' } } })).status, 403);
  });

  test('the registration number is published only once it is recorded, and a broken contact is refused', async () => {
    const admin = await mainAdmin('Controller Admin');
    const bad = await call('/admin/compliance', { method: 'PUT', token: admin.token, body: { controller: { dpoEmail: 'not-an-email' } } });
    assert.equal(bad.json.error.code, 'invalid_email');
    const noName = await call('/admin/compliance', { method: 'PUT', token: admin.token, body: { controller: { name: '  ' } } });
    assert.equal(noName.json.error.code, 'invalid_name');
    assert.equal((await call('/admin/compliance', { method: 'PUT', token: admin.token, body: { controller: { registrationNumber: 'DP/2026/0042', registeredAt: '2026-11-04', dpoName: 'Data desk', dpoEmail: 'data@example.com', lastReview: '2026-11-04' } } })).status, 200);
    const pub = (await call('/compliance')).json;
    assert.equal(pub.controller.registrationNumber, 'DP/2026/0042');
    assert.equal(pub.controller.registered, true);
    assert.equal(pub.controller.dpoEmail, 'data@example.com');
    assert.equal(pub.dpia.reviewedAt, '2026-11-04');
  });

  test('a payout is refused for the right reason, and sent only when the answer is complete', async () => {
    const admin = await mainAdmin('Payout Admin');
    const earner = await register('Payout Earner');
    // A payout waiting to be sent, inserted the way the monthly job creates one.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(data, 'saligue.db'));
    const id = `po-${Math.random().toString(36).slice(2, 10)}`;
    db.prepare("insert into payouts (id, user_id, period, amount, breakdown, status, created_at) values (?, ?, '2026-11', 5, '{}', 'pending', ?)").run(id, earner.id, new Date().toISOString());
    db.close();
    const send = () => call(`/admin/payouts/${id}/paid`, { token: admin.token, body: { reference: 'MM9' } });

    // An invalid choice of payer is refused before it is saved.
    assert.equal((await call('/admin/compliance', { method: 'PUT', token: admin.token, body: { payouts: { mode: 'everyone' } } })).json.error.code, 'invalid_mode');
    assert.equal((await call('/admin/compliance', { method: 'PUT', token: admin.token, body: { payouts: { mode: 'partner', partner: '' } } })).json.error.code, 'partner_missing');

    await call('/admin/compliance', { method: 'PUT', token: admin.token, body: { payouts: { mode: 'off' } } });
    assert.equal((await send()).json.error.code, 'payouts_closed');

    await call('/admin/compliance', { method: 'PUT', token: admin.token, body: { payouts: { mode: 'partner', partner: 'Test Mobile Money aggregator', requireIdentity: true } } });
    assert.equal((await send()).json.error.code, 'identity_required');

    await call('/admin/compliance', { method: 'PUT', token: admin.token, body: { payouts: { requireIdentity: false, monthlyCap: 1 } } });
    assert.equal((await send()).json.error.code, 'monthly_cap');

    await call('/admin/compliance', { method: 'PUT', token: admin.token, body: { payouts: { monthlyCap: 0 } } });
    assert.equal((await send()).status, 200);
    // Paid once only, ever.
    assert.equal((await send()).json.error.code, 'already_paid');
    // The admin queues say the same thing, so nobody presses a button that cannot work.
    const shares = (await call('/admin/shares', { token: admin.token })).json;
    assert.equal(shares.payout.open, true);
    assert.equal(shares.payout.payer, 'Test Mobile Money aggregator');
    assert.equal((await call('/admin/tips', { token: admin.token })).json.payout.open, true);
  });
});
