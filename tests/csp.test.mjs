// The Content-Security-Policy (server/csp.mjs): may Saligue's own pages do everything they need?
//   npm test
// A security header that is one address too tight is not a warning on screen — it is a page that half-loads, which
// is the failure this app already went through once. So this checks the policy two ways: the directives that the app
// depends on (live, try-on, Google sign-in) are present, and nothing the built pages ask for is missing from it.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const { contentSecurityPolicy, cspDirectives, cspHeaderName, cspMode } = await import('../server/csp.mjs');

const policy = contentSecurityPolicy({
  liveKitUrl: 'wss://live.example.test',
  apiUrl: 'https://api.example.test',
  studioUrl: 'https://studio.example.test',
});
const directives = cspDirectives({ liveKitUrl: 'wss://live.example.test', studioUrl: 'https://studio.example.test' });
const sources = (directive) => directives[directive] ?? [];

describe('the policy lets the app do its job', () => {
  test('live can open its video room', () => {
    // The address is the one the server hands out with the pass (server/live.mjs), not one written here: a LiveKit
    // server that moves cannot leave the policy pointing at the old one.
    assert.ok(policy.includes('wss://live.example.test'), policy);
    assert.ok(sources('connect-src').includes('wss://live.example.test'));
    assert.ok(policy.includes('wss://live.example.test'), 'a socket is a connection, so it belongs to connect-src');
    assert.ok(!contentSecurityPolicy().includes('wss://'), 'no hard-coded socket address: it comes from LIVEKIT_URL');
  });

  test('try-on can compile its WebAssembly engine', () => {
    // onnxruntime-web and MediaPipe (the on-device Fitting Room) are WebAssembly. Without this a browser refuses to
    // compile them and the Fitting Room cannot start — the one script source that is easy to miss.
    assert.ok(sources('script-src').includes("'wasm-unsafe-eval'"), policy);
    assert.ok(sources('worker-src').includes('blob:'), 'the AI engine starts its worker from a blob: address');
  });

  test('Google sign-in is allowed to load, frame and call', () => {
    for (const directive of ['script-src', 'frame-src', 'connect-src']) {
      assert.ok(sources(directive).includes('https://accounts.google.com'), `${directive}: ${policy}`);
    }
  });

  test('the shop map and the pictures it needs are allowed', () => {
    assert.ok(sources('frame-src').includes('https://maps.google.com'));
    assert.deepEqual(sources('img-src').slice(0, 3), ["'self'", 'data:', 'blob:'], 'photos and recorded clips come from data: and blob:');
    assert.ok(sources('media-src').includes('blob:'), 'replays and voice notes play from blob:');
  });

  test('the plain-address fallback is not upgraded to https', () => {
    // The site also answers on http://<server address> for networks that block sslip.io. upgrade-insecure-requests
    // there would rewrite every picture to https:// on a host with no certificate: a page of broken images.
    assert.ok(!policy.includes('upgrade-insecure-requests'), policy);
  });

  test('the policy closes what the app never uses', () => {
    assert.equal(sources('object-src').join(), "'none'");
    assert.equal(sources('frame-ancestors').join(), "'self'", 'another site may not frame Saligue');
    assert.equal(sources('base-uri').join(), "'self'");
  });

  test('a badly written setting cannot silently empty the policy', () => {
    // No LiveKit and no Studio configured: still a policy, still closed, never "default-src 'self'" left alone.
    const bare = contentSecurityPolicy();
    assert.match(bare, /default-src 'self'/);
    assert.match(bare, /script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'/);
    assert.doesNotMatch(bare, /wss:\/\//);
  });
});

describe('switching it off in a hurry', () => {
  test('the default is enforced', () => {
    assert.equal(cspMode({}), 'enforce');
    assert.equal(cspHeaderName('enforce'), 'Content-Security-Policy');
  });

  test('report-only blocks nothing but still tells us', () => {
    for (const value of ['report', 'report-only', 'REPORT']) assert.equal(cspMode({ SALIGUE_CSP: value }), 'report');
    assert.equal(cspHeaderName('report'), 'Content-Security-Policy-Report-Only');
  });

  test('off means no header at all', () => {
    assert.equal(cspMode({ SALIGUE_CSP: 'off' }), 'off');
    assert.equal(cspHeaderName('off'), null);
  });
});

// ---------------------------------------------------------------------------
// Every address the built pages really ask for, against the policy.
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname, '..');

/** The built website the server serves (out/), or the copy inside the apps when only that is present. */
function builtSite() {
  for (const dir of ['out', 'android/app/src/main/assets/public']) {
    if (existsSync(join(ROOT, dir, 'index.html'))) return join(ROOT, dir);
  }
  return null;
}

function pages(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Parked AI models and dot-folders hold no pages.
      if (!entry.startsWith('.') && entry !== 'models' && entry !== 'ort') found.push(...pages(full));
    } else if (entry.endsWith('.html')) found.push(full);
  }
  return found;
}

/** Is `url` allowed by one of these sources? ('self' is judged separately, by the caller.) */
function allowedBy(list, url) {
  const target = new URL(url);
  return list.some((source) => {
    if (source === "'self'" || source === '*' || !/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) return false;
    const allowed = new URL(source);
    if (allowed.protocol !== target.protocol) return false;
    if (allowed.hostname.startsWith('*.')) {
      const base = allowed.hostname.slice(1); // ".example.com"
      return target.hostname === base.slice(1) || target.hostname.endsWith(base);
    }
    return allowed.host === target.host;
  });
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

describe('the built pages never ask for something the policy forbids', () => {
  test('every script, stylesheet, font and frame is allowed', (t) => {
    const site = builtSite();
    if (!site) return t.skip('no built website to check (run `npm run build` first)');
    const files = pages(site);
    assert.ok(files.length > 10, `only ${files.length} pages found in ${relative(ROOT, site)}`);

    const refused = [];
    const note = (page, directive, url) => refused.push(`${relative(ROOT, page)}: ${directive} does not allow ${url}`);
    let sawInlineScript = false;
    let sawInlineStyle = false;

    for (const page of files) {
      const html = readFileSync(page, 'utf8');
      // This site's own absolute addresses (og:image, og:url) count as 'self': the same server, reached by name.
      const selfOrigins = new Set([...html.matchAll(/<meta property="og:(?:image|url)" content="([^"]+)"/g)].map((m) => originOf(m[1])).filter(Boolean));
      const isSelf = (url) => selfOrigins.has(originOf(url));
      const check = (directive, url) => {
        if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('#')) return;
        if (url.startsWith('/') || !/^[a-z][a-z0-9+.-]*:/i.test(url)) return; // a path on this site
        if (isSelf(url)) return;
        if (!allowedBy(sources(directive), url)) note(page, directive, url);
      };

      if (/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html)) sawInlineScript = true;
      if (/<style\b/i.test(html) || /\sstyle="/i.test(html)) sawInlineStyle = true;

      for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)) check('script-src', m[1]);
      for (const m of html.matchAll(/<iframe\b[^>]*\bsrc="([^"]+)"/gi)) check('frame-src', m[1]);
      for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
        const tag = m[0];
        const href = /\bhref="([^"]+)"/i.exec(tag)?.[1];
        const rel = /\brel="([^"]+)"/i.exec(tag)?.[1]?.toLowerCase() ?? '';
        if (!href) continue;
        if (rel.includes('stylesheet')) check('style-src', href);
        else if (rel === 'preconnect' || rel === 'dns-prefetch') check('connect-src', href);
        else if (rel.includes('icon') || rel === 'apple-touch-icon') check('img-src', href);
        else if (rel === 'manifest') check('manifest-src', href);
      }
    }

    assert.deepEqual(refused.slice(0, 10), [], `${refused.length} address(es) the pages ask for are not in the policy`);
    // The static export inlines its bootstrap; that is why 'unsafe-inline' is in the policy and must stay until the
    // site is served by something that can stamp a nonce into each page.
    if (sawInlineScript) assert.ok(sources('script-src').includes("'unsafe-inline'"));
    if (sawInlineStyle) assert.ok(sources('style-src').includes("'unsafe-inline'"));
  });

  test('a page that needs no outside address needs no outside source', (t) => {
    // The other direction: nothing in the policy is there "just in case". Only the settings the server is given may
    // add an address (live, the Studio, the model hosts, a separately hosted API).
    const bare = cspDirectives();
    const outside = [...bare['script-src'], ...bare['frame-src'], ...bare['connect-src']].filter((s) => /^https?:\/\//.test(s));
    const known = new Set([
      'https://accounts.google.com',
      'https://maps.google.com',
      'https://www.google.com',
      'https://fonts.googleapis.com',
      'https://fonts.gstatic.com',
      'https://huggingface.co',
      'https://cdn.jsdelivr.net',
      'https://storage.googleapis.com',
    ]);
    for (const origin of outside) assert.ok(known.has(origin), `${origin} is allowed for no stated reason`);
  });
});
