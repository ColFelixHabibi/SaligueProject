// A Cloudflare quick tunnel gets a new name when it restarts. The running server writes the new name to
// data/tunnel-url (server/tunnel.mjs), and the next app build must use it — but only while the configured address is
// such a tunnel: a real domain always wins (scripts/site-url.mjs).
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const run = async (env) => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try {
    const { siteUrl } = await import(`../scripts/site-url.mjs?${Math.random()}`);
    return siteUrl();
  } finally {
    process.env = saved;
  }
};

test('a restarted quick tunnel is followed, a real domain is not overridden', async () => {
  const data = mkdtempSync(join(tmpdir(), 'saligue-site-'));
  writeFileSync(join(data, 'tunnel-url'), 'https://new-name-here.trycloudflare.com');
  const base = { SALIGUE_DATA: data, SALIGUE_SERVER: undefined, SALIGUE_ENV_FILE: join(data, 'none.env') };
  assert.equal(await run({ ...base, SITE_URL: 'https://old-name-here.trycloudflare.com' }), 'https://new-name-here.trycloudflare.com');
  assert.equal(await run({ ...base, SITE_URL: 'https://saligue.rw' }), 'https://saligue.rw');
  assert.equal(await run({ ...base, SITE_URL: 'https://old-name-here.trycloudflare.com', SALIGUE_SERVER: 'https://chosen.example' }), 'https://chosen.example');
});
