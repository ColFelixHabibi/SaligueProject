
'use client';

import { ProfileHeader, type Profile } from '@/components/profile-header';
import { profileHref } from '@/components/profile-avatar';
import { shareLink } from '@/components/share-sheet';
import { absoluteUrl } from '@/lib/paths';
import { Skeleton } from '@/components/ui/skeleton';

import { LanguagePicker } from '@/components/language-picker';

import { useT } from '@/lib/i18n';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bookmark, ChevronRight, Coins, FileText, HandCoins, Layers, LayoutDashboard, LogOut, MessageCircle, Package, PlusSquare, Radio, Settings, ShieldCheck, Store, TrendingUp, UserPlus } from 'lucide-react';
import { ProfilePhotoField } from '@/components/profile-photo-field';
import { BadgeCheck, Eye, GraduationCap, Share2, Smartphone } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/components/auth/auth-provider';
import { LoginDialog } from '@/components/auth/login-dialog';
import { RegisterDialog } from '@/components/auth/register-dialog';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { logout } from '@/lib/auth-actions';
import { useFeatures } from '@/lib/features';
import { WeekCard } from '@/components/week-card';
import { PushCard } from '@/components/push-card';


// Everything on Me is one grid of big icons: fewer words, one tap.
function Tile({ href, icon: Icon, label, onClick, tone }: { href?: string; icon: typeof Package; label: string; onClick?: () => void; tone?: 'danger' }) {
  const t = useT();
  const className = 'flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border bg-card px-1 py-3 text-center shadow-sm transition hover:border-primary/40 hover:shadow-md';
  const body = (
    <>
      <span className={cn('flex h-10 w-10 items-center justify-center rounded-full', tone === 'danger' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary')}><Icon className="h-5 w-5" /></span>
      <span className="line-clamp-2 w-full text-[11px] font-semibold leading-tight min-[360px]:text-xs">{t(label)}</span>
    </>
  );
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
  const on = useFeatures();
  const [stats, setStats] = useState<Profile | null>(null);
  const t = useT();
  useEffect(() => {
    if (user) api<Profile>(`/profiles/${user.uid}`).then(setStats).catch(() => {});
  }, [user]);
  const [loginOpen, setLoginOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);

  return (
    <div className="mx-auto max-w-xl space-y-4 px-3 py-4 min-[360px]:px-4 md:space-y-6 md:py-10">
      <LanguagePicker className="justify-center" />
      {/* The same top as your public profile (and every shop's), so Me and Profile look alike. */}
      {user && stats ? (
        <ProfileHeader profile={{ ...stats, avatar: photo ?? null }}
          avatar={<ProfilePhotoField photoOnly name={shop?.name ?? user.displayName} required={role === 'seller'} />}
          statHref={{ items: '/dashboard/products', clients: `/profile?id=${user.uid}`, following: `/profile?id=${user.uid}`, likes: `/profile?id=${user.uid}` }}>
          {/* One profile: this is it, as others see it (with the shop's items when there is a shop). */}
          <Button asChild variant="secondary" size="icon" className="h-10 w-10 shrink-0 rounded-full"><Link href={`/profile?id=${user.uid}`} aria-label={t('See my profile as others see it')} title={t('See my profile as others see it')}><Eye className="h-4 w-4" /></Link></Button>
          <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-full" aria-label="Share profile" title="Share profile"
            onClick={() => shareLink({ title: stats.name, text: `${stats.name} on Saligue`, url: absoluteUrl(profileHref(user.uid)) })}><Share2 className="h-4 w-4" /></Button>
          <Button asChild variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-full"><Link href={role === 'seller' ? '/dashboard/settings' : '/my-account/settings'} aria-label="Settings" title="Settings"><Settings className="h-4 w-4" /></Link></Button>
        </ProfileHeader>
      ) : user ? (
        <Skeleton className="mx-auto h-64 w-full max-w-sm rounded-2xl" />
      ) : (
        <Card>
          <CardContent className="flex items-center gap-4 p-4 min-[360px]:p-5">
            <Avatar className="h-16 w-16"><AvatarFallback className="bg-primary/10 text-2xl font-bold text-primary">S</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xl font-bold">Welcome to Saligue</p>
              <p className="line-clamp-2 text-sm text-muted-foreground">Browsing as a guest — your likes and saves are kept on this device.</p>
            </div>
          </CardContent>
          <div className="grid grid-cols-2 gap-2 px-5 pb-5">
            <Button onClick={() => setRegisterOpen(true)}>Create account</Button>
            <Button variant="outline" onClick={() => setLoginOpen(true)}>Log in</Button>
          </div>
        </Card>
      )}

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

      {user && <PushCard />}
      {user && on('weekly') && <WeekCard />}

      <div className="grid grid-cols-4 gap-2">
        {/* One account: the shopping side for everyone, the shop's tools added when there is a shop. */}
        {user && (
          <>
            <Tile href="/my-account/orders" icon={Package} label="Orders" />
            <Tile href="/my-account/saved" icon={Bookmark} label="Saved" />
            <Tile href="/messages" icon={MessageCircle} label="Messages" />
            <Tile href="/my-account/coins" icon={Coins} label="Coins" />
          </>
        )}
        {user && role === 'seller' && (
          <>
            <Tile href="/sell" icon={PlusSquare} label="Add item" />
            <Tile href="/live/studio" icon={Radio} label="Go live" />
            <Tile href="/dashboard/analytics" icon={TrendingUp} label="Stats" />
          </>
        )}
        {!user && (
          <>
            <Tile href="/orders" icon={Package} label="My orders" />
            <Tile href="/wishlist" icon={Bookmark} label="Saved" />
          </>
        )}
        {user && on('looks') && <Tile href="/looks" icon={Layers} label="My looks" />}
        {user && on('shares') && <Tile href="/share-earn" icon={HandCoins} label="Share & earn" />}
        {user && <Tile href="/invite" icon={UserPlus} label="Bring a shop" />}
        {user && on('lessons') && <Tile href="/learn/new" icon={GraduationCap} label="Teach" />}
        {user && <Tile href="/verify" icon={BadgeCheck} label="Get verified" />}
        {user && role !== 'seller' && <Tile href="/sell" icon={Store} label="Start selling" />}
        <Tile href="/download" icon={Smartphone} label="Android app" />
        <Tile href="/policies" icon={FileText} label="Policies" />
        {user && <Tile icon={LogOut} label="Log out" tone="danger" onClick={async () => { await logout(); router.push('/'); }} />}
      </div>

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={() => { setLoginOpen(false); setTimeout(() => setRegisterOpen(true), 150); }} />
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={() => { setRegisterOpen(false); setTimeout(() => setLoginOpen(true), 150); }} />
    </div>
  );
}
