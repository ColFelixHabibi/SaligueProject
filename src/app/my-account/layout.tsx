'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Bookmark, Coins, Gift, Home, LifeBuoy, MessageCircle, Settings, ShoppingBag } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/auth-provider';
import { Hub } from '@/components/layout/hub';
import { useNotificationStore } from '@/hooks/use-notification-store';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { useUnreadMessages } from '@/lib/messages';

/** My Saligue: a shopper's own space (orders, messages, saved, coins…). Shops have Seller Center instead. */
export default function MySaligueLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname().replace(/\/+$/, '');
  const router = useRouter();
  const { user, role, isAuthLoading } = useAuth();
  const avatar = useUserRoleStore((s) => s.avatar);
  const unreadNotifications = useNotificationStore((s) => s.notifications.filter((n) => !n.read).length);
  const unreadMessages = useUnreadMessages();

  useEffect(() => {
    if (isAuthLoading) return;
    if (!user) router.replace('/login');
    else if (role === 'seller') router.replace('/dashboard');
  }, [user, role, isAuthLoading, router]);

  if (isAuthLoading || !user || role === 'seller') {
    return (
      <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-8">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  const items = [
    { key: '/my-account', icon: Home, label: 'Overview' },
    { key: '/my-account/orders', icon: ShoppingBag, label: 'Orders' },
    { key: '/my-account/messages', icon: MessageCircle, label: 'Messages', count: unreadMessages },
    { key: '/my-account/saved', icon: Bookmark, label: 'Saved' },
    { key: '/my-account/coins', icon: Coins, label: 'Coins' },
    { key: '/my-account/tips', icon: Gift, label: 'Tips received' },
    { key: '/my-account/notifications', icon: Bell, label: 'Notifications', count: unreadNotifications },
    { key: '/my-account/settings', icon: Settings, label: 'Settings' },
    { key: '/my-account/support', icon: LifeBuoy, label: 'Help' },
  ];
  const active = [...items].reverse().find((i) => (i.key === '/my-account' ? pathname.endsWith('/my-account') : pathname.endsWith(i.key) || pathname.includes(`${i.key}/`)))?.key ?? '/my-account';

  return (
    <Hub tone="shopper" kicker="My Saligue" title={user.displayName || 'My account'} avatar={avatar} avatarName={user.displayName || user.email || 'Me'}
      items={items.map((i) => ({ ...i, href: i.key }))} activeKey={active}>
      {children}
    </Hub>
  );
}
