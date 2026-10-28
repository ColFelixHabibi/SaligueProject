
'use client';

import { LanguagePicker } from '@/components/language-picker';

import { useT } from '@/lib/i18n';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bookmark, ChevronRight, FileText, LayoutDashboard, LogOut, Package, Repeat, Settings, ShieldCheck, Store } from 'lucide-react';
import { ProfilePhotoField } from '@/components/profile-photo-field';
import { BadgeCheck, CircleUserRound, GraduationCap, Smartphone } from 'lucide-react';
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
  // Main admin (1) or sub-admin (2): their admin card looks different.
  const [adminLevel, setAdminLevel] = useState<number | null>(null);
  useEffect(() => {
    if (admin) api<{ level: number }>('/admin/me').then((d) => setAdminLevel(d.level)).catch(() => {});
  }, [admin]);
  const { wishlistItems } = useWishlist();
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

      {/* Each kind of account has its own dashboard (like Instagram's Professional dashboard). */}
      {user && (
        <Link href={role === 'seller' ? '/dashboard' : '/my-account'} className={cn('flex items-center gap-4 rounded-2xl p-4 text-left shadow-sm transition hover:shadow-md', role === 'seller' ? 'bg-gradient-to-r from-primary to-secondary text-primary-foreground' : 'border bg-card')}>
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', role === 'seller' ? 'bg-white/20' : 'bg-primary/10 text-primary')}>{role === 'seller' ? <Store className="h-6 w-6" /> : <LayoutDashboard className="h-6 w-6" />}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-extrabold">{role === 'seller' ? 'Seller Center' : 'My Saligue'}</span>
            <span className={cn('block truncate text-sm', role === 'seller' ? 'text-white/85' : 'text-muted-foreground')}>{role === 'seller' ? 'Orders, products, messages, ads, earnings' : 'Orders, messages, saved, coins, tips'}</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 opacity-70" />
        </Link>
      )}
      {user && admin && (
        <Link href="/admin" className={cn('flex items-center gap-4 rounded-2xl p-4 text-left shadow-sm transition hover:shadow-md', adminLevel === 1 ? 'bg-neutral-950 text-white' : 'bg-sky-600 text-white')}>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15"><ShieldCheck className="h-6 w-6" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-extrabold">Admin dashboard</span>
            <span className="block truncate text-sm text-white/80">{adminLevel === 1 ? 'Main admin · everything' : adminLevel === 2 ? 'Sub-admin · your rights' : 'Moderation, money, settings'}</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 opacity-70" />
        </Link>
      )}

      {user ? (
        <Card className="divide-y overflow-hidden">
          <Row href={`/profile?id=${user.uid}`} icon={CircleUserRound} label={role === 'seller' ? 'My shop profile' : 'My profile'} detail={role === 'seller' ? 'Bio, clients' : undefined} />
          {role !== 'seller' && <Row href="/learn/new" icon={GraduationCap} label="Teach a lesson" />}
          <Row href="/verify" icon={BadgeCheck} label="Get verified" detail="Optional" />
          {role === 'seller'
            ? <Row icon={Repeat} label="Switch to shopping" detail="Buy as a shopper" onClick={() => updateAccount({ role: 'buyer' }).then(() => router.push('/'))} />
            : <Row href="/sell" icon={Store} label={shop ? 'Switch to my shop' : 'Start selling'} />}
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden">
          <Row href="/orders" icon={Package} label="My orders" />
          <Row href="/wishlist" icon={Bookmark} label="Saved" detail={String(wishlistItems.length)} />
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
