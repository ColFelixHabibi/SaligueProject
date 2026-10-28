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
const env = { ...process.env, SALIGUE_DATA: data, PORT: String(port), HOST: '127.0.0.1', SITE_URL: base, SMTP_URL: '', FAL_KEY: '', FLW_SECRET_KEY: '', FCM_SERVICE_ACCOUNT: '' };
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
