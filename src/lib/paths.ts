
// Sub-path the site is served from (e.g. "/SaligueProject" on GitHub Pages; empty locally).
// next/link and the router add it automatically; use these for plain URLs.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function absoluteUrl(path: string) {
  return `${window.location.origin}${BASE_PATH}${path}`;
}
