
'use client';

import { useFeatures } from '@/lib/features';

import { useLives } from '@/lib/lives';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CircleUserRound, MessageCircle, Radio, Search, ShoppingBag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import { LoginDialog } from '@/components/auth/login-dialog';
import { RegisterDialog } from '@/components/auth/register-dialog';
import { useCart } from '@/hooks/use-cart-store';
import { useUnreadMessages } from '@/lib/messages';
import { cn } from '@/lib/utils';

export function Logo({ light, compact }: { light?: boolean; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary text-lg font-extrabold text-primary-foreground">S</span>
      <span className={cn('flex-col leading-none', compact ? 'hidden' : 'hidden min-[420px]:flex')}>
        <span className={cn('text-xl font-extrabold tracking-tight', light ? 'text-white' : 'text-foreground')}>Saligue</span>
        <span className={cn('text-[9px] font-semibold uppercase tracking-[0.25em]', light ? 'text-white/70' : 'text-primary')}>by INDECIANA</span>
      </span>
    </span>
  );
}

export default function Header() {
  const pathname = usePathname();
  const { user, role } = useAuth();
  const on = useFeatures();
  const { cartItems } = useCart();
  const unreadMessages = useUnreadMessages();
  const liveCount = useLives()?.lives.length ?? 0;
  const [loginOpen, setLoginOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const cartCount = cartItems.reduce((n, i) => n + i.quantity, 0);

  const switchTo = (open: (v: boolean) => void, close: (v: boolean) => void) => {
    close(false);
    setTimeout(() => open(true), 150);
  };


  // Lives fill the whole screen, like TikTok.
  if (/\/live\/(studio|watch)/.test(pathname)) return null;
  return (
    // Phones only; tablets and computers use the side menu (sidebar.tsx), like TikTok.
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 pt-[var(--sat)] backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
        {/* Brand only: "For You" is the way home, so the menu never repeats a link. */}
        <Logo />


        {/* Icons only, like TikTok and Instagram. INDECIANA is in Explore's categories; notifications are under Me. */}
        <div className="flex items-center">
          {!pathname.replace(/\/+$/, '').endsWith('/search') && (
            <Button variant="ghost" size="icon" asChild>
              <Link href="/search" aria-label="Search"><Search className="h-5 w-5" /></Link>
            </Button>
          )}
          {on('live') && <Button variant="ghost" size="icon" className="relative" asChild>
            <Link href="/live" aria-label="Live">
              <Radio className="h-5 w-5" />
              {liveCount > 0 && <span className="absolute -right-1 top-0 rounded bg-primary px-1 text-[8px] font-extrabold text-primary-foreground">LIVE</span>}
            </Link>
          </Button>}
          {user && on('messages') && <Button variant="ghost" size="icon" className="relative" asChild>
            <Link href="/messages" aria-label={`Messages, ${unreadMessages} unread`}>
              <MessageCircle className="h-5 w-5" />
              {unreadMessages > 0 && (
                <Badge className="absolute -right-0.5 -top-0.5 h-5 min-w-5 justify-center rounded-full px-1 text-[10px]">{unreadMessages > 9 ? '9+' : unreadMessages}</Badge>
              )}
            </Link>
          </Button>}
          {role !== 'seller' && <Button variant="ghost" size="icon" className="relative" asChild>
            <Link href="/cart" aria-label={`Cart, ${cartCount} items`}>
              <ShoppingBag className="h-5 w-5" />
              {cartCount > 0 && (
                <Badge className="absolute -right-0.5 -top-0.5 h-5 min-w-5 justify-center rounded-full px-1 text-[10px]">{cartCount}</Badge>
              )}
            </Link>
          </Button>}

          {/* Signed in: "Me" in the bottom bar has the account and Log out, so no second account menu here. */}
          {user ? null : (
            <Button variant="ghost" size="icon" onClick={() => setLoginOpen(true)} aria-label="Log in">
              <CircleUserRound className="h-6 w-6 text-primary" />
            </Button>
          )}
        </div>
      </div>

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={() => switchTo(setRegisterOpen, setLoginOpen)} />
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={() => switchTo(setLoginOpen, setRegisterOpen)} />
    </header>
  );
}
