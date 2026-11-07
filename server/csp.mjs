// The Content-Security-Policy of the website's pages, built from the addresses Saligue really talks to.
//
// A policy typed out by hand goes stale the first time a feature adds an address, and the symptom is not a warning
// but a blank screen (the exact failure this app already suffered). So every address here is derived from what the
// server is actually configured with — the LiveKit address from the same settings that hand out live passes, the
// API address from NEXT_PUBLIC_API_URL, the AI Studio address from the server's own setting — and the list of what
// the built pages ask for is checked by tests/csp.test.mjs on every run.
//
// The one weakness that cannot be removed without a server stamping a nonce into every page: a Next.js static export
// inlines its own bootstrap (the page data is written into a <script> in each HTML file), so script-src carries
// 'unsafe-inline'. Everything else is closed: no plugin, no <base> rewriting, this site cannot be framed by another,
// and the pages may only talk to the addresses below.
//
// SALIGUE_CSP (in /etc/saligue.env):
//   (unset)  the policy is enforced
//   report   it is only reported (Content-Security-Policy-Report-Only): nothing is blocked, every refusal is logged
//   off      no header at all
// A refusal is posted by the browser to /api/csp-report and appears in `journalctl -u saligue` as "CSP <directive>
// blocked <address> on <page>", so a mistake is seen in the log instead of by a shopper.

const GOOGLE_SIGN_IN = 'https://accounts.google.com';
// The shop's location card on a profile is an embedded Google map (src/components/mirror/locate-seller.tsx).
const MAP_FRAMES = ['https://maps.google.com', 'https://www.google.com'];
// Optional public homes of the AI models (src/lib/ai/models.ts): used only when a build does not serve the model
// files itself (NEXT_PUBLIC_SELF_HOSTED_MODELS=0). They are data downloads, never scripts.
const MODEL_HOSTS = ['https://huggingface.co', 'https://cdn.jsdelivr.net', 'https://storage.googleapis.com'];

/** The address of a service as written, or null when it is not a usable http(s)/ws(s) URL. */
function originOf(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!/^(https?|wss?):$/.test(url.protocol) || !url.host) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * Both faces of one service: a browser opens a socket to wss://live.… and the same server answers https://live.…
 * for the room's own requests, so a live that connects but cannot ask anything would otherwise look like a bug.
 */
function bothSchemes(value) {
  const origin = originOf(value);
  if (!origin) return [];
  const secure = origin.startsWith('wss:') || origin.startsWith('https:');
  const host = origin.replace(/^\w+:\/\//, '');
  return secure ? [`wss://${host}`, `https://${host}`] : [`ws://${host}`, `http://${host}`];
}

/**
 * Every directive of the policy, as lists. Kept as data so a test can ask "may a page load this?" instead of
 * matching a string.
 */
export function cspDirectives({ liveKitUrl, apiUrl, studioUrl, extraConnect } = {}) {
  // A separately hosted website (e.g. GitHub Pages) calls this server from elsewhere; the same addresses are
  // allowed for its pictures and requests.
  const api = originOf(apiUrl);
  const connect = [
    "'self'",
    // Live: the browser opens a socket to the LiveKit server (server/live.mjs hands the address out with the pass).
    ...bothSchemes(liveKitUrl),
    // Saligue AI Studio, when one is configured on the server (src/lib/ai/studio.ts calls it straight from the browser).
    // Deliberately from the server's own setting only: a `?ai=` address in a link could otherwise widen this page's
    // policy and send the shopper's photo wherever the link said. An address picked by hand on one device is added
    // with SALIGUE_CSP_CONNECT in /etc/saligue.env, which is the operator's choice and not a stranger's link.
    ...bothSchemes(studioUrl),
    ...(api ? [api] : []),
    GOOGLE_SIGN_IN,
    // The font hosts, because <head> preconnects to them (src/app/layout.tsx) and some browsers check a preconnect
    // against connect-src. They are the hosts style-src and font-src already trust, so this adds no new party.
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    ...MODEL_HOSTS,
    ...(Array.isArray(extraConnect) ? extraConnect.map(originOf).filter(Boolean) : []),
  ];
  return {
    'default-src': ["'self'"],
    'connect-src': connect,
    // 'unsafe-inline': the static export's own bootstrap. 'wasm-unsafe-eval': the on-device try-on engine compiles
    // WebAssembly (onnxruntime-web, MediaPipe) — without it the Fitting Room cannot start.
    'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", GOOGLE_SIGN_IN],
    // Tailwind ships one file, but React writes style attributes and Next inlines a few rules.
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:', ...(api ? [api] : [])],
    // Recordings and voice notes are played from blob: addresses the page made itself; replays come from this server.
    'media-src': ["'self'", 'data:', 'blob:'],
    // The AI engine's worker is started from a blob: address.
    'worker-src': ["'self'", 'blob:'],
    'frame-src': ["'self'", GOOGLE_SIGN_IN, ...MAP_FRAMES],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'self'"],
    // No upgrade-insecure-requests on purpose: the site also answers on http://<server address> (where sslip.io is
    // blocked), and upgrading there would break every picture on a page that has no certificate.
  };
}

/** The header value: `directive source source; directive source`. */
export function contentSecurityPolicy(options = {}) {
  return Object.entries(cspDirectives(options))
    .map(([directive, sources]) => `${directive} ${[...new Set(sources)].join(' ')}`)
    .join('; ');
}

/** 'enforce' (default), 'report' (report-only), or 'off'. */
export function cspMode(env = process.env) {
  const mode = String(env.SALIGUE_CSP ?? '').trim().toLowerCase();
  if (mode === 'off') return 'off';
  if (mode === 'report' || mode === 'report-only' || mode === 'report_only') return 'report';
  return 'enforce';
}

/** The header this mode uses, or null when the policy is switched off. */
export function cspHeaderName(mode) {
  if (mode === 'off') return null;
  return mode === 'report' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
}
