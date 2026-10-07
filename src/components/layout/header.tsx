
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, ShoppingBag, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/components/auth/auth-provider';
import { LoginDialog } from '@/components/auth/login-dialog';
import { RegisterDialog } from '@/components/auth/register-dialog';
import { useCart } from '@/hooks/use-cart-store';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { logout } from '@/lib/auth-actions';
import { cn } from '@/lib/utils';
import { NAV, isActive } from './nav';

export function Logo({ light, compact }: { light?: boolean; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary text-lg font-extrabold text-primary-foreground">S</span>
      <span className={cn('flex flex-col leading-none', compact && 'hidden')}>
        <span className={cn('text-xl font-extrabold tracking-tight', light ? 'text-white' : 'text-foreground')}>Saligue</span>
        <span className={cn('text-[9px] font-semibold uppercase tracking-[0.25em]', light ? 'text-white/70' : 'text-primary')}>by INDECIANA</span>
      </span>
    </span>
  );
}

export default function Header() {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { cartItems } = useCart();
  const [loginOpen, setLoginOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const cartCount = cartItems.reduce((n, i) => n + i.quantity, 0);

  const switchTo = (open: (v: boolean) => void, close: (v: boolean) => void) => {
    close(false);
    setTimeout(() => open(true), 150);
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast({ title: 'Logged out' });
      router.push('/');
    } catch (error) {
      toast({ variant: 'destructive', title: 'Logout failed', description: friendlyError(error) });
    }
  };

  return (
    // Phones only; tablets and computers use the side menu (sidebar.tsx), like TikTok.
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
        {/* Brand only: "For You" is the way home, so the menu never repeats a link. */}
        <Logo />


        <div className="flex items-center gap-1">
          {/* INDECIANA's own boutique: its single entry point in the app. */}
          <Link
            href="/indeciana"
            className={cn(
              'mr-1 rounded-full px-3 py-1.5 font-serif text-[11px] tracking-[0.2em] transition-colors sm:text-xs',
              pathname.includes('/indeciana') ? 'bg-primary text-primary-foreground' : 'bg-neutral-950 text-white hover:bg-neutral-800'
            )}
          >
            INDECIANA
          </Link>
          <Button variant="ghost" size="icon" className="relative" asChild>
            <Link href="/cart" aria-label={`Cart, ${cartCount} items`}>
              <ShoppingBag className="h-5 w-5" />
              {cartCount > 0 && (
                <Badge className="absolute -right-0.5 -top-0.5 h-5 min-w-5 justify-center rounded-full px-1 text-[10px]">{cartCount}</Badge>
              )}
            </Link>
          </Button>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-10 w-10 rounded-full p-0" aria-label="Account">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={user.photoURL ?? undefined} alt="" />
                    <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                      {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-medium">{user.displayName || 'My account'}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/me"><User className="mr-2 h-4 w-4" /> My account</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}><LogOut className="mr-2 h-4 w-4" /> Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" className="rounded-full px-5" onClick={() => setLoginOpen(true)}>
              Log in
            </Button>
          )}
        </div>
      </div>

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={() => switchTo(setRegisterOpen, setLoginOpen)} />
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={() => switchTo(setLoginOpen, setRegisterOpen)} />
    </header>
  );
}
