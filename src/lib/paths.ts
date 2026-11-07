
// Sub-path the site is served from (e.g. "/SaligueProject" on GitHub Pages; empty locally).
// next/link and the router add it automatically; use these for plain URLs.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The website's own address without the scheme ("78-47-151-100.sslip.io"), for showing a person where to go.
 * Inside the app the pages come from https://localhost, which is nobody's website, so the address baked in at
 * build time is used — the same fallback src/app/layout.tsx keeps. Written next to a <b> it is never empty.
 */
export function siteHost() {
  const baked = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://78-47-151-100.sslip.io')
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/+$/, '');
  if (typeof window === 'undefined') return baked;
  const local = /^(https?|capacitor):\/\/localhost(:\d+)?$/.test(window.location.origin);
  return local ? baked : window.location.host;
}

/**
 * A full link to a page, for sharing. Inside the Android/iOS app the page itself lives at https://localhost, so
 * links use the real site (the server the app talks to) instead.
 */
export function absoluteUrl(path: string) {
  // NEXT_PUBLIC_SITE_URL is the address baked in at build time; an app built without NEXT_PUBLIC_API_URL has no
  // other real one (see src/lib/api.ts), and a shared link must never point at https://localhost.
  const site = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  const local = /^(https?|capacitor):\/\/localhost(:\d+)?$/.test(window.location.origin);
  return `${site && local ? site : window.location.origin}${BASE_PATH}${path}`;
}
