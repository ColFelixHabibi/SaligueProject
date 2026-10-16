'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BarChart3, Bell, ExternalLink, Home, LifeBuoy, MessageCircle, Package, PlusCircle, Settings, ShieldCheck, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SellerAvatar } from '@/components/seller-avatar';
import { useAuth } from '@/components/auth/auth-provider';
import { useNotificationStore } from '@/hooks/use-notification-store';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { useUnreadMessages } from '@/lib/messages';
import { cn } from '@/lib/utils';

/** Seller Center: the shop's own space. The app's main menu stays; this adds the shop's sections as tabs. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname().replace(/\/+$/, '');
  const router = useRouter();
  const { user, role, isAuthLoading } = useAuth();
  const { official, shop, avatar } = useUserRoleStore();
  const unreadNotifications = useNotificationStore((s) => s.notifications.filter((n) => !n.read).length);
  const unreadMessages = useUnreadMessages();

  useEffect(() => {
    if (!isAuthLoading) {
      if (!user) router.replace('/login');
      else if (role === 'buyer') router.replace('/sell');
    }
  }, [user, role, isAuthLoading, router]);

  if (isAuthLoading || !user || role !== 'seller') {
    return (
      <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-8">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  const tabs = [
    { href: '/dashboard', icon: Home, label: 'Overview' },
    { href: '/dashboard/products', icon: Package, label: 'Products' },
    { href: '/dashboard/orders', icon: ShoppingBag, label: 'Orders' },
    { href: '/messages', icon: MessageCircle, label: 'Messages', count: unreadMessages },
    { href: '/dashboard/analytics', icon: BarChart3, label: 'Analytics' },
    { href: '/dashboard/notifications', icon: Bell, label: 'Notifications', count: unreadNotifications },
    // Only INDECIANA reviews reported items.
    ...(official ? [{ href: '/dashboard/reviews', icon: ShieldCheck, label: 'Reports' }] : []),
    { href: '/dashboard/settings', icon: Settings, label: 'Settings' },
    { href: '/dashboard/support', icon: LifeBuoy, label: 'Help' },
  ];
  const isTab = (href: string) => (href === '/dashboard' ? pathname.endsWith('/dashboard') : pathname.endsWith(href) || pathname.includes(`${href}/`));

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="border-b bg-background">
        <div className="mx-auto max-w-7xl px-4 pt-4 md:px-8 md:pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <SellerAvatar src={avatar} name={shop?.name ?? user.displayName ?? 'Shop'} className="h-12 w-12 border-2 border-primary/30" />
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Seller Center</p>
                <h1 className="truncate text-xl font-extrabold tracking-tight md:text-2xl">{shop?.name ?? user.displayName ?? 'My shop'}</h1>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="h-10" asChild>
                <Link href="/search"><ExternalLink className="mr-2 h-4 w-4" /> View shop</Link>
              </Button>
              <Button className="h-10" asChild>
                <Link href="/sell"><PlusCircle className="mr-2 h-4 w-4" /> Add item</Link>
              </Button>
            </div>
          </div>
          <nav className="-mx-4 mt-4 flex gap-1 overflow-x-auto px-4 md:-mx-0 md:px-0" aria-label="Seller Center">
            {tabs.map(({ href, icon: Icon, label, count }) => {
              const active = isTab(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex shrink-0 items-center gap-2 border-b-2 px-3 pb-3 pt-1 text-sm font-semibold transition-colors',
                    active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" /> {label}
                  {!!count && <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{count > 9 ? '9+' : count}</span>}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      <main className="mx-auto grid min-w-0 max-w-7xl gap-6 p-4 md:p-8">{children}</main>
    </div>
  );
}
