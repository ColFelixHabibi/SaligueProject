'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BarChart3, Bell, Coins, Megaphone, Home, LayoutGrid, LifeBuoy, MessageCircle, Package, Radio, Settings, ShieldCheck, ShoppingBag } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SellerAvatar } from '@/components/seller-avatar';
import { useAuth } from '@/components/auth/auth-provider';
import { useNotificationStore } from '@/hooks/use-notification-store';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { useUnreadMessages } from '@/lib/messages';
import { cn } from '@/lib/utils';

/** Seller Center: the shop's own space, with its own menu (a Menu button on phones, a side menu on computers). */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname().replace(/\/+$/, '');
  const router = useRouter();
  const { user, role, isAuthLoading } = useAuth();
  const { official, shop, avatar } = useUserRoleStore();
  const unreadNotifications = useNotificationStore((s) => s.notifications.filter((n) => !n.read).length);
  const unreadMessages = useUnreadMessages();
  const [menuOpen, setMenuOpen] = useState(false);

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

  const current = tabs.find((t) => isTab(t.href)) ?? tabs[0];
  const badge = (count?: number) => !!count && <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{count > 9 ? '9+' : count}</span>;
  const waiting = tabs.reduce((n, t) => n + (t.count ?? 0), 0);

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-3 min-[360px]:px-4 md:px-8 md:py-5">
          <Link href={`/profile?id=${user.uid}`} className="flex min-w-0 items-center gap-3" title="My shop profile">
            <SellerAvatar src={avatar} name={shop?.name ?? user.displayName ?? 'Shop'} className="h-11 w-11 shrink-0 border-2 border-primary/30 md:h-12 md:w-12" />
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">Seller Center</span>
              <span className="block truncate text-lg font-extrabold tracking-tight md:text-2xl">{shop?.name ?? user.displayName ?? 'My shop'}</span>
            </span>
          </Link>
          {/* "Add item" lives in the bottom bar (phones) and the side menu (computers), so it isn't repeated here. */}
          <Button variant="secondary" className="h-10 shrink-0 px-3" asChild>
            <Link href="/live/studio" aria-label="Go live"><Radio className="h-4 w-4 min-[400px]:mr-2" /><span className="hidden min-[400px]:inline">Go live</span></Link>
          </Button>
        </div>
        {/* Phones: one Menu button showing where you are; it opens every section. */}
        <div className="px-3 pb-3 min-[360px]:px-4 md:hidden">
          <button type="button" onClick={() => setMenuOpen(true)} className="flex h-12 w-full items-center gap-3 rounded-xl border bg-muted/40 px-3 text-left font-semibold" aria-haspopup="dialog">
            <current.icon className="h-5 w-5 text-primary" />
            <span className="min-w-0 flex-1 truncate">{current.label}</span>
            {badge(waiting)}
            <span className="flex items-center gap-1 text-sm text-muted-foreground"><LayoutGrid className="h-4 w-4" /> Menu</span>
          </button>
        </div>
      </div>
      <div className="mx-auto flex max-w-7xl gap-6 md:p-8">
        {/* Computers: the shop's menu down the left. */}
        <nav className="sticky top-6 hidden h-fit w-56 shrink-0 flex-col gap-0.5 rounded-2xl border bg-background p-2 md:flex" aria-label="Seller Center">
          {tabs.map(({ href, icon: Icon, label, count }) => {
            const active = isTab(href);
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined}
                className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors', active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                <Icon className="h-4 w-4 shrink-0" /> <span className="min-w-0 flex-1 truncate">{label}</span> {badge(count)}
              </Link>
            );
          })}
        </nav>
        <main className="grid min-w-0 flex-1 gap-6 p-3 min-[360px]:p-4 md:p-0">{children}</main>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl px-4 pb-[calc(1.5rem+var(--sab))]">
          <SheetHeader><SheetTitle>Seller Center</SheetTitle></SheetHeader>
          <nav className="mt-4 grid grid-cols-3 gap-2" aria-label="Seller Center">
            {tabs.map(({ href, icon: Icon, label, count }) => {
              const active = isTab(href);
              return (
                <Link key={href} href={href} onClick={() => setMenuOpen(false)} aria-current={active ? 'page' : undefined}
                  className={cn('relative flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center text-xs font-semibold', active ? 'border-primary bg-primary/10 text-primary' : 'text-foreground hover:bg-muted')}>
                  <Icon className="h-6 w-6" />
                  <span className="w-full truncate">{label}</span>
                  {!!count && <span className="absolute right-1.5 top-1.5">{badge(count)}</span>}
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}
