import { Compass, Flame, LayoutDashboard, PlusSquare, ShoppingBag, User, Wand2 } from 'lucide-react';

// The app's main destinations. Each appears once: in the side menu on computers, the bottom bar on phones.
// Shoppers and sellers see different ones: a seller's day is their shop, a shopper's is finding and trying on.
export const SHOPPER_NAV = [
  { href: '/', label: 'For You', icon: Flame },
  { href: '/search', label: 'Explore', icon: Compass },
  { href: '/mirror', label: 'Fitting Room', icon: Wand2 },
  { href: '/sell', label: 'Sell', icon: PlusSquare },
  { href: '/me', label: 'Me', icon: User },
] as const;

export const SELLER_NAV = [
  { href: '/', label: 'For You', icon: Flame },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/sell', label: 'Add item', icon: PlusSquare },
  { href: '/dashboard/orders', label: 'Orders', icon: ShoppingBag },
  { href: '/me', label: 'Me', icon: User },
] as const;

// Visitors who haven't logged in: browsing and trying on only. Selling, messages and the account come after logging in.
export const GUEST_NAV = SHOPPER_NAV.filter((d) => d.href !== '/sell' && d.href !== '/me');

export const navFor = (role: 'buyer' | 'seller', signedIn = true) => (!signedIn ? GUEST_NAV : role === 'seller' ? SELLER_NAV : SHOPPER_NAV);

// Kept for places that only need the shopper's destinations.
export const NAV = SHOPPER_NAV;

// Highlights the destination for the current page (sub-pages count as their section).
export function isActive(href: string, pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (href === '/') return path === '/';
  if (href === '/me') return ['/me', '/my-account', '/wishlist', '/cart', '/checkout', '/orders', '/notifications'].some((p) => path.endsWith(p) || path.includes(`${p}/`));
  // The dashboard's own sections (orders) are highlighted on their own.
  if (href === '/dashboard') return path.endsWith('/dashboard') || (path.includes('/dashboard/') && !path.includes('/dashboard/orders'));
  return path.endsWith(href) || path.includes(`${href}/`);
}
