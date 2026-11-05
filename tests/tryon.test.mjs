// The realistic try-on engine chain (server/tryon.mjs), tested without touching the network:
//   npm test
// The paid model (fal.ai) and Saligue's own AI server both talk plain fetch, so they are replaced here with a
// stand-in that answers exactly like the real services. The free Hugging Face models are not exercised (they need
// a real Space); what is checked is the order of the chain, that a look is never passed off as a better AI's,
// and that a photo is never sent before it has been checked.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A database and a look cache of its own, never the real ones.
const data = mkdtempSync(join(tmpdir(), 'saligue-tryon-'));
process.env.SALIGUE_DATA = data;
process.env.FAL_QUEUE_URL = 'https://queue.test';
delete process.env.TRYON_USE_KOLORS;
delete process.env.AI_SERVER_URL;
delete process.env.AI_SERVER_KEY;
delete process.env.FAL_KEY;
delete process.env.HF_TOKEN;

const { tryOn, checkOwnAi, ownAi, unlimitedTryOn, REALISTIC_CATEGORIES } = await import('../server/tryon.mjs');

const QUEUE = 'https://queue.test';
const OWN_AI = 'https://ai.test';
const CACHE = join(data, 'tryon-cache');

const img = (text) => `data:image/jpeg;base64,${Buffer.from(text).toString('base64')}`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const own = (on) => {
  if (on) {
    process.env.AI_SERVER_URL = OWN_AI;
    process.env.AI_SERVER_KEY = 'own-key';
  } else {
    delete process.env.AI_SERVER_URL;
    delete process.env.AI_SERVER_KEY;
  }
};
const paid = (on) => (on ? (process.env.FAL_KEY = 'fal-key') : delete process.env.FAL_KEY);

// Collects every request the try-on makes, so a test can prove nothing was sent.
const realFetch = globalThis.fetch;
let calls = [];
function intercept(answer) {
  calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return answer(String(url), options);
  };
  return calls;
}
after(() => {
  globalThis.fetch = realFetch;
  try {
    rmSync(data, { recursive: true, force: true });
  } catch {
    // The database is still open; the temporary folder can stay behind.
  }
});

// fal.ai's queue: submit, poll until COMPLETED, then read the result.
function falQueue(lookedUrl) {
  return (url) => {
    if (url === `${QUEUE}/fal-ai/fashn/tryon/v1.6`) {
      return json({ request_id: 'r1', status_url: `${QUEUE}/status/r1`, response_url: `${QUEUE}/result/r1` });
    }
    if (url === `${QUEUE}/status/r1`) return json({ status: 'COMPLETED' });
    if (url === `${QUEUE}/result/r1`) return json({ images: [{ url: lookedUrl }] });
    throw new Error(`Unexpected request: ${url}`);
  };
}

describe('realistic try-on: which AI dresses the shopper', () => {
  test("Saligue's own AI server is asked first, with its key", async () => {
    own(true);
    paid(true);
    const look = img('own-look');
    const sent = intercept(() => json({ image: look }));

    const made = await tryOn(img('person-own'), img('garment-own'), 'top');

    assert.equal(made.by, 'own');
    assert.equal(made.image, look);
    assert.equal(sent.length, 1, 'the paid model must not be charged when our own server answered');
    assert.equal(sent[0].url, `${OWN_AI}/api/tryon`);
    assert.equal(sent[0].options.headers['X-Saligue-Key'], 'own-key');
    const body = JSON.parse(sent[0].options.body);
    assert.equal(body.category, 'top');
    assert.equal(body.person, img('person-own'), 'the photo is sent as it was given');
    assert.equal(body.variant, 0);
  });

  test('when our own server fails, the paid model dresses the shopper', async () => {
    own(true);
    paid(true);
    const look = img('paid-look');
    const sent = intercept((url) => (url.startsWith(OWN_AI) ? json({ detail: 'down' }, 500) : falQueue(look)(url)));

    const made = await tryOn(img('person-2'), img('garment-2'), 'dress');

    assert.equal(made.by, 'fashn');
    assert.equal(made.image, look);
    const submit = sent.find((c) => c.url.endsWith('/fal-ai/fashn/tryon/v1.6'));
    assert.ok(submit, 'the paid model was asked');
    assert.equal(submit.options.headers.Authorization, 'Key fal-key');
    const body = JSON.parse(submit.options.body);
    assert.equal(body.category, 'one-pieces', 'a dress is FASHN one-pieces');
    assert.equal(body.mode, 'quality', 'the Fitting Room uses FASHN quality mode');
    assert.equal(body.model_image, img('person-2'));
  });

  test('a picture kept at an address is downloaded and returned as a data URL', async () => {
    own(false);
    paid(true);
    const photo = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
    intercept((url) => {
      if (url === 'https://fal.media/look.jpg') {
        return new Response(photo, { status: 200, headers: { 'content-type': 'image/jpeg' } });
      }
      return falQueue('https://fal.media/look.jpg')(url);
    });

    const made = await tryOn(img('person-3'), img('garment-3'), 'bottom');

    assert.equal(made.by, 'fashn');
    assert.equal(made.image, `data:image/jpeg;base64,${Buffer.from(photo).toString('base64')}`);
  });

  test('a free look is never reused once a better AI is connected', async () => {
    own(false);
    paid(true);
    // A look the free models made earlier, kept under their name.
    const person = img('person-4');
    const garment = img('garment-4');
    const free = img('free-look');
    const key = createHash('sha256').update(person).update('|').update(garment).update('|').update('top').update('|0|free').digest('hex').slice(0, 40);
    writeFileSync(join(CACHE, `${key}.txt`), `free\n${free}`);

    const better = img('better-look');
    intercept(falQueue(better));

    const made = await tryOn(person, garment, 'top');

    assert.equal(made.by, 'fashn');
    assert.equal(made.image, better, 'the free look must not be handed back as the paid one');
  });

  test('the same photo and garment are only ever made once', async () => {
    own(true);
    paid(true);
    const look = img('once-look');
    const sent = intercept(() => json({ image: look }));

    const first = await tryOn(img('person-5'), img('garment-5'), 'top');
    const again = await tryOn(img('person-5'), img('garment-5'), 'top');

    assert.equal(sent.length, 1, 'a second look at the same item must not be paid for twice');
    assert.deepEqual(again, first);
  });

  test('a photo that is not an image is refused before any AI is asked', async () => {
    own(true);
    paid(true);
    const sent = intercept(() => json({ image: img('never') }));

    await assert.rejects(
      () => tryOn('not-an-image', img('garment-6'), 'top'),
      (error) => error.status === 400
    );
    assert.equal(sent.length, 0, 'nothing may be sent to an AI provider before the photo is checked');
  });
});

describe('realistic try-on: what the shopper is told about the AI server', () => {
  test('an AI server that does not answer is reported plainly', async () => {
    intercept(() => {
      throw new TypeError('fetch failed');
    });
    const check = await checkOwnAi(OWN_AI, 'own-key');
    assert.deepEqual(check, { ok: false, reason: 'The AI server does not answer at this address.' });
  });

  test('a refused secret key is reported plainly', async () => {
    intercept((url) => (url.endsWith('/api/health') ? json({ ok: true }) : new Response('', { status: 403 })));
    const check = await checkOwnAi(OWN_AI, 'wrong-key');
    assert.deepEqual(check, { ok: false, reason: 'The AI server refused the secret key.' });
  });

  test('a working AI server reports its GPU', async () => {
    intercept((url) => (url.endsWith('/api/health')
      ? json({ ok: true, gpu: 'RTX 4090', memoryGb: 24, ready: true, busy: false })
      : new Response('', { status: 422 })));
    const check = await checkOwnAi(OWN_AI, 'own-key');
    assert.deepEqual(check, { ok: true, gpu: 'RTX 4090', memoryGb: 24, ready: true, busy: false });
  });
});

describe('realistic try-on: settings', () => {
  test('no AI server is used until both an address and a key are set', () => {
    own(false);
    assert.equal(ownAi(), null);
    process.env.AI_SERVER_URL = `${OWN_AI}/`;
    assert.equal(ownAi(), null, 'an address without a key is not enough');
    process.env.AI_SERVER_KEY = 'own-key';
    assert.deepEqual(ownAi(), { url: OWN_AI, key: 'own-key' }, 'the trailing slash is dropped');
    own(false);
  });

  test('unlimited try-on needs the paid model or our own server', () => {
    own(false);
    paid(false);
    assert.equal(unlimitedTryOn(), false);
    paid(true);
    assert.equal(unlimitedTryOn(), true);
    paid(false);
    own(true);
    assert.equal(unlimitedTryOn(), true);
    own(false);
  });

  test('the models can dress exactly these categories', () => {
    assert.deepEqual(REALISTIC_CATEGORIES, ['top', 'outerwear', 'bottom', 'dress']);
  });
});
