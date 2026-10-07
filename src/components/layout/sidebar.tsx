
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogIn, LogOut, ShoppingBag, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import { Logo } from './header';
import { NAV, isActive } from './nav';

// One row of the side menu: icon always, label from large screens up (icon-only on tablets, like TikTok).
const row = 'flex items-center gap-4 rounded-lg px-3 py-3 text-base font-semibold transition-colors hover:bg-muted';

/** TikTok-style side menu for tablets and computers. Phones use the top bar and bottom bar instead. */
export default function Sidebar() {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { cartItems } = useCart();
  const [loginOpen, setLoginOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const cartCount = cartItems.reduce((n, i) => n + i.quantity, 0);
  const inIndeciana = pathname.includes('/indeciana');
  const inCart = pathname.replace(/\/+$/, '').endsWith('/cart');

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
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-col border-r bg-background py-5 md:flex lg:w-60">
      <div className="px-4 lg:px-5">
        <span className="lg:hidden"><Logo compact /></span>
        <span className="hidden lg:block"><Logo /></span>
      </div>

      <nav className="mt-6 flex flex-col gap-1 px-2 lg:px-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(href, pathname);
          return (
            <Link key={href} href={href} title={label} aria-current={active ? 'page' : undefined} className={cn(row, active ? 'text-primary' : 'text-foreground')}>
              <Icon className={cn('h-7 w-7 shrink-0', active && 'stroke-[2.5]')} />
              <span className="hidden lg:inline">{label}</span>
            </Link>
          );
        })}

        <Link href="/cart" title="Cart" className={cn(row, inCart ? 'text-primary' : 'text-foreground')}>
          <span className="relative shrink-0">
            <ShoppingBag className="h-7 w-7" />
            {cartCount > 0 && (
              <span className="absolute -right-2 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {cartCount}
              </span>
            )}
          </span>
          <span className="hidden lg:inline">Cart</span>
        </Link>

        {/* INDECIANA's own boutique: its single entry point on this screen size. */}
        <Link
          href="/indeciana"
          title="INDECIANA"
          className={cn(
            'mt-3 flex items-center justify-center rounded-lg py-3 font-serif tracking-[0.25em] transition-colors',
            inIndeciana ? 'bg-primary text-primary-foreground' : 'bg-neutral-950 text-white hover:bg-neutral-800'
          )}
        >
          <span className="text-lg lg:hidden">I</span>
          <span className="hidden text-sm lg:inline">INDECIANA</span>
        </Link>
      </nav>

      <div className="mt-auto space-y-4 px-2 lg:px-3">
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={cn(row, 'w-full text-left')} aria-label="Account">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={user.photoURL ?? undefined} alt="" />
                  <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                    {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden min-w-0 lg:block">
                  <span className="block truncate text-sm">{user.displayName || 'My account'}</span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" side="right" align="end">
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
          <>
            <Button className="hidden h-11 w-full rounded-lg text-base lg:flex" onClick={() => setLoginOpen(true)}>
              Log in
            </Button>
            <button type="button" title="Log in" onClick={() => setLoginOpen(true)} className={cn(row, 'w-full justify-center text-primary lg:hidden')}>
              <LogIn className="h-7 w-7" />
            </button>
          </>
        )}
        <p className="hidden px-3 text-xs leading-relaxed text-muted-foreground lg:block">
          © {new Date().getFullYear()} Saligue by INDECIANA
        </p>
      </div>

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={() => switchTo(setRegisterOpen, setLoginOpen)} />
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={() => switchTo(setLoginOpen, setRegisterOpen)} />
    </aside>
  );
}
