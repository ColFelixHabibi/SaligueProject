import { Compass, Flame, PlusSquare, User, Wand2 } from 'lucide-react';

// The app's main destinations. Each appears once: in the top bar on computers, the bottom bar on phones.
export const NAV = [
  { href: '/', label: 'For You', icon: Flame },
  { href: '/search', label: 'Explore', icon: Compass },
  { href: '/mirror', label: 'Mirror', icon: Wand2 },
  { href: '/sell', label: 'Sell', icon: PlusSquare },
  { href: '/me', label: 'Me', icon: User },
] as const;

// Highlights the destination for the current page (sub-pages count as their section).
export function isActive(href: string, pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (href === '/') return path === '/';
  if (href === '/me') return ['/me', '/my-account', '/dashboard', '/wishlist', '/cart', '/checkout', '/orders'].some((p) => path.endsWith(p) || path.includes(`${p}/`));
  return path.endsWith(href) || path.includes(`${href}/`);
}
