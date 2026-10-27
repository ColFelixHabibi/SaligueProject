
// Sub-path the site is served from (e.g. "/SaligueProject" on GitHub Pages; empty locally).
// next/link and the router add it automatically; use these for plain URLs.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * A full link to a page, for sharing. Inside the Android/iOS app the page itself lives at https://localhost, so
 * links use the real site (the server the app talks to) instead.
 */
export function absoluteUrl(path: string) {
  const site = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
  const local = /^(https?|capacitor):\/\/localhost(:\d+)?$/.test(window.location.origin);
  return `${site && local ? site : window.location.origin}${BASE_PATH}${path}`;
}
