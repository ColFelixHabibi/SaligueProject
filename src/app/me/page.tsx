
'use client';

import { LanguagePicker } from '@/components/language-picker';

import { useT } from '@/lib/i18n';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, Bookmark, ChevronRight, FileText, LogOut, MapPin, Package, Repeat, Settings, Store } from 'lucide-react';
import { ProfilePhotoField } from '@/components/profile-photo-field';
import { BadgeCheck, CircleUserRound, Coins, GraduationCap, SlidersHorizontal, Smartphone } from 'lucide-react';
import { updateAccount } from '@/lib/auth-actions';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/components/auth/auth-provider';
import { LoginDialog } from '@/components/auth/login-dialog';
import { RegisterDialog } from '@/components/auth/register-dialog';
import { useWishlist } from '@/hooks/use-wishlist';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { logout } from '@/lib/auth-actions';
import { useNotificationStore } from '@/hooks/use-notification-store';

function Row({ href, icon: Icon, label, detail, onClick }: { href?: string; icon: typeof Package; label: string; detail?: string; onClick?: () => void }) {
  const t = useT();
  const body = (
    <>
      <Icon className="h-5 w-5 text-primary" />
      <span className="flex-1 font-medium">{t(label)}</span>
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
  const admin = useUserRoleStore((s) => s.admin);
  const photo = useUserRoleStore((s) => s.avatar);
  const { wishlistItems } = useWishlist();
  const unread = useNotificationStore((st) => st.notifications.filter((n) => !n.read).length);
  const [loginOpen, setLoginOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);

  return (
    <div className="mx-auto max-w-xl space-y-4 px-3 py-4 min-[360px]:px-4 md:space-y-6 md:py-10">
      <LanguagePicker className="justify-center" />
      <Card>
        <CardContent className="p-4 min-[360px]:p-5">
          {/* One photo: tap it to change it. */}
          {user ? (
            <ProfilePhotoField name={shop?.name ?? user.displayName} required={role === 'seller'}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xl font-bold">{user.displayName || 'My account'}</p>
                <p className="line-clamp-2 text-sm text-muted-foreground">{role === 'seller' ? `Seller${shop ? ` · ${shop.name}` : ''}` : user.email}</p>
                {role === 'seller' && !photo && <p className="text-xs font-semibold text-primary">Tap the photo to add your face or shop logo</p>}
              </div>
            </ProfilePhotoField>
          ) : (
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16"><AvatarFallback className="bg-primary/10 text-2xl font-bold text-primary">S</AvatarFallback></Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xl font-bold">Welcome to Saligue</p>
                <p className="line-clamp-2 text-sm text-muted-foreground">Browsing as a guest — your likes and saves are kept on this device.</p>
              </div>
            </div>
          )}
        </CardContent>
        {!user && (
          <div className="grid grid-cols-2 gap-2 px-5 pb-5">
            <Button onClick={() => setRegisterOpen(true)}>Create account</Button>
            <Button variant="outline" onClick={() => setLoginOpen(true)}>Log in</Button>
          </div>
        )}
      </Card>

      {user && role === 'seller' ? (
        <>
          {/* A seller's Me page is about their shop. Dashboard, orders and new items are in the bottom bar; messages in the top bar. */}
          <Card className="divide-y overflow-hidden">
            {user && <Row href={`/profile?id=${user.uid}`} icon={CircleUserRound} label="My shop profile" detail="Bio, clients" />}
            <Row href="/tips" icon={Coins} label="Tips received" />
            {user && <Row href="/verify" icon={BadgeCheck} label="Get verified" detail="Optional" />}
            <Row href="/dashboard/settings#shop" icon={MapPin} label="Shop & address" detail={shop ? undefined : 'Add'} />
            <Row href="/dashboard/notifications" icon={Bell} label="Notifications" detail={unread ? String(unread) : undefined} />
          </Card>
          <Card className="divide-y overflow-hidden">
            <Row icon={Repeat} label="Switch to shopping" detail="Buy as a shopper" onClick={() => updateAccount({ role: 'buyer' }).then(() => router.push('/'))} />
          </Card>
        </>
      ) : (
        <>
          <Card className="divide-y overflow-hidden">
            <Row href="/orders" icon={Package} label="My orders" />
            {user && <Row href="/learn/new" icon={GraduationCap} label="Teach a lesson" />}
            {user && <Row href="/tips" icon={Coins} label="My tips" />}
            {user && <Row href="/verify" icon={BadgeCheck} label="Get verified" detail="Optional" />}
            {user && <Row href={`/profile?id=${user.uid}`} icon={CircleUserRound} label="My profile" />}
            {/* Messages and the cart are in the top bar. */}
            <Row href="/wishlist" icon={Bookmark} label="Saved" detail={String(wishlistItems.length)} />
            {user && <Row href="/notifications" icon={Bell} label="Notifications" detail={unread ? String(unread) : undefined} />}
          </Card>
          {user && (
            <Card className="divide-y overflow-hidden">
              <Row href="/sell" icon={Store} label={shop ? 'Switch to my shop' : 'Start selling'} />
            </Card>
          )}
        </>
      )}

      {user && admin && (
        <Card className="divide-y overflow-hidden border-primary/40">
          <Row href="/admin" icon={SlidersHorizontal} label="Admin dashboard" detail="Moderation, money, settings" />
        </Card>
      )}

      {user && (
        <Card className="divide-y overflow-hidden">
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

      <Card className="divide-y overflow-hidden">
        <Row href="/download" icon={Smartphone} label="Get the Android app" />
        <Row href="/policies" icon={FileText} label="Policies" detail="Terms, privacy, monetization, ads…" />
      </Card>

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={() => { setLoginOpen(false); setTimeout(() => setRegisterOpen(true), 150); }} />
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={() => { setRegisterOpen(false); setTimeout(() => setLoginOpen(true), 150); }} />
    </div>
  );
}
