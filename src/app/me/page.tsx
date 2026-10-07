
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bookmark, ChevronRight, LayoutDashboard, LogOut, MapPin, Package, Settings, ShoppingBag, Store } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/components/auth/auth-provider';
import { LoginDialog } from '@/components/auth/login-dialog';
import { RegisterDialog } from '@/components/auth/register-dialog';
import { useCart } from '@/hooks/use-cart-store';
import { useWishlist } from '@/hooks/use-wishlist';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { logout } from '@/lib/auth-actions';

function Row({ href, icon: Icon, label, detail, onClick }: { href?: string; icon: typeof Package; label: string; detail?: string; onClick?: () => void }) {
  const body = (
    <>
      <Icon className="h-5 w-5 text-primary" />
      <span className="flex-1 font-medium">{label}</span>
      {detail && <span className="text-sm text-muted-foreground">{detail}</span>}
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </>
  );
  const className = 'flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-muted/60';
  return href ? <Link href={href} className={className}>{body}</Link> : <button type="button" onClick={onClick} className={className}>{body}</button>;
}

/** "Me": one place for saved items, cart, orders, shop and account. */
export default function MePage() {
  const router = useRouter();
  const { user, role } = useAuth();
  const shop = useUserRoleStore((s) => s.shop);
  const { wishlistItems } = useWishlist();
  const { cartItems } = useCart();
  const [loginOpen, setLoginOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-6 md:py-10">
      <Card>
        <CardContent className="flex items-center gap-4 p-5">
          <Avatar className="h-16 w-16">
            <AvatarImage src={user?.photoURL ?? undefined} alt="" />
            <AvatarFallback className="bg-primary/10 text-2xl font-bold text-primary">
              {user ? (user.displayName || user.email || 'U').charAt(0).toUpperCase() : 'S'}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold">{user ? user.displayName || 'My account' : 'Welcome to Saligue'}</p>
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {user ? (role === 'seller' ? `Seller${shop ? ` · ${shop.name}` : ''}` : user.email) : 'Browsing as a guest — your likes and saves are kept on this device.'}
            </p>
          </div>
        </CardContent>
        {!user && (
          <div className="grid grid-cols-2 gap-2 px-5 pb-5">
            <Button onClick={() => setRegisterOpen(true)}>Create account</Button>
            <Button variant="outline" onClick={() => setLoginOpen(true)}>Log in</Button>
          </div>
        )}
      </Card>

      <Card className="divide-y overflow-hidden">
        <Row href="/wishlist" icon={Bookmark} label="Saved" detail={String(wishlistItems.length)} />
        <Row href="/cart" icon={ShoppingBag} label="Cart" detail={String(cartItems.reduce((n, i) => n + i.quantity, 0))} />
        <Row href="/orders" icon={Package} label="My orders" />
      </Card>

      {user && (
        <Card className="divide-y overflow-hidden">
          {role === 'seller' ? (
            <>
              <Row href="/dashboard" icon={LayoutDashboard} label="Seller dashboard" />
              <Row href="/dashboard/orders" icon={Store} label="Shop orders" />
              <Row href="/dashboard/settings#shop" icon={MapPin} label="Shop & address" detail={shop ? undefined : 'Add'} />
            </>
          ) : (
            <Row href="/sell" icon={Store} label="Start selling" />
          )}
          <Row href={role === 'seller' ? '/dashboard/settings' : '/my-account/settings'} icon={Settings} label="Settings" />
          <Row
            icon={LogOut}
            label="Log out"
            onClick={async () => {
              await logout();
              router.push('/');
            }}
          />
        </Card>
      )}

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={() => { setLoginOpen(false); setTimeout(() => setRegisterOpen(true), 150); }} />
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={() => { setRegisterOpen(false); setTimeout(() => setLoginOpen(true), 150); }} />
    </div>
  );
}
