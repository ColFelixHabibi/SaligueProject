'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BarChart3, Bell, Coins, Megaphone, Home, LifeBuoy, MessageCircle, Package, Radio, Settings, ShieldCheck, ShoppingBag } from 'lucide-react';
import { Hub } from '@/components/layout/hub';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/auth-provider';
import { useNotificationStore } from '@/hooks/use-notification-store';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { useUnreadMessages } from '@/lib/messages';

/** Seller Center: the shop's own space, with its own menu (a Menu button on phones, a side menu on computers). */
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
    { href: '/dashboard/messages', icon: MessageCircle, label: 'Messages', count: unreadMessages },
    { href: '/dashboard/ads', icon: Megaphone, label: 'Ads' },
    { href: '/dashboard/earnings', icon: Coins, label: 'Earnings' },
    { href: '/dashboard/analytics', icon: BarChart3, label: 'Analytics' },
    { href: '/dashboard/notifications', icon: Bell, label: 'Notifications', count: unreadNotifications },
    // Only INDECIANA reviews reported items.
    ...(official ? [{ href: '/dashboard/reviews', icon: ShieldCheck, label: 'Reports' }] : []),
    { href: '/dashboard/settings', icon: Settings, label: 'Settings' },
    { href: '/dashboard/support', icon: LifeBuoy, label: 'Help' },
  ];
  const isTab = (href: string) => (href === '/dashboard' ? pathname.endsWith('/dashboard') : pathname.endsWith(href) || pathname.includes(`${href}/`));

  return (
    <Hub
      tone="shop"
      kicker="Seller Center"
      title={shop?.name ?? user.displayName ?? 'My shop'}
      avatar={avatar}
      avatarName={shop?.name ?? user.displayName ?? 'Shop'}
      items={tabs.map((t) => ({ key: t.href, icon: t.icon, label: t.label, count: t.count, href: t.href }))}
      activeKey={tabs.find((t) => isTab(t.href))?.href ?? '/dashboard'}
      action={(
        // "Add item" lives in the bottom bar (phones) and the side menu (computers), so it isn't repeated here.
        <Button variant="secondary" className="h-10 shrink-0 px-3" asChild>
          <Link href="/live/studio" aria-label="Go live"><Radio className="h-4 w-4 min-[400px]:mr-2" /><span className="hidden min-[400px]:inline">Go live</span></Link>
        </Button>
      )}
    >
      {children}
    </Hub>
  );
}
