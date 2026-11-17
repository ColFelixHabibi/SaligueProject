
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
import { Bookmark, ChevronRight, FileText, Info, HandCoins, Layers, LogOut, Package, PlusSquare, Radio, Settings, ShieldCheck, ShoppingBag, Store, UserPlus } from 'lucide-react';
import { ProfilePhotoField } from '@/components/profile-photo-field';
import { BadgeCheck, Eye, GraduationCap, Share2, Smartphone, Wallet } from 'lucide-react';
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

const CENTER_TONE = {
  shop: 'bg-gradient-to-r from-primary to-secondary text-primary-foreground',
  plain: 'border bg-card',
  admin: 'bg-neutral-950 text-white',
  subadmin: 'bg-sky-600 text-white',
} as const;

/** One Center (a place with its own menu): a big row that opens it. */
function CenterCard({ href, icon: Icon, title, text, tone }: { href: string; icon: typeof Package; title: string; text: string; tone: keyof typeof CENTER_TONE }) {
  const plain = tone === 'plain';
  return (
    <Link href={href} className={cn('flex items-center gap-4 rounded-2xl p-4 text-left shadow-sm transition hover:shadow-md', CENTER_TONE[tone])}>
      <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', plain ? 'bg-primary/10 text-primary' : 'bg-white/20')}><Icon className="h-6 w-6" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-extrabold">{title}</span>
        <span className={cn('block truncate text-sm', plain ? 'text-muted-foreground' : 'opacity-85')}>{text}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 opacity-70" />
    </Link>
  );
}

/** A small titled group of tiles. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="grid grid-cols-4 gap-2">{children}</div>
    </section>
  );
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
          avatar={<ProfilePhotoField photoOnly name={shop?.name ?? user.displayName} required={!!shop} />}
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

      {/* The Centers this account has, each once and by one name — the same name as in the side menu and on the
          Center itself: My Saligue (buying), Seller Center (selling) or Start selling, and Admin Center. */}
      {user && (
        <div className="space-y-2">
          {role === 'seller' ? (
            <CenterCard href="/dashboard" icon={Store} title={t('Seller Center')} text={t('Items, orders, sales, ads, earnings')} tone="shop" />
          ) : (
            <CenterCard href="/sell" icon={Store} title={t('Start selling')} text={t('Open your shop and list your first item')} tone="plain" />
          )}
          <CenterCard href="/my-account" icon={ShoppingBag} title={t('My Saligue')} text={t('Orders, saved, wallet, coins, history')} tone="plain" />
          {admin && (
            <CenterCard href="/admin" icon={ShieldCheck} title={t('Admin Center')} text={adminLevel === 1 ? t('Main admin · everything') : adminLevel === 2 ? t('Sub-admin · your rights') : t('Moderation, money, settings')} tone={adminLevel === 1 ? 'admin' : 'subadmin'} />
          )}
        </div>
      )}

      {user && <PushCard />}
      {user && on('weekly') && <WeekCard />}

      {/* Only what lives nowhere else: orders, saved, coins and history are in My Saligue; stats are in Seller Center;
          messages are in the top bar and the side menu. */}
      {user ? (
        <>
          <Group title={t('Create')}>
            {role === 'seller' && <Tile href="/sell" icon={PlusSquare} label="Add item" />}
            {role === 'seller' && on('live') && <Tile href="/live/studio" icon={Radio} label="Go live" />}
            {on('lessons') && <Tile href="/learn/new" icon={GraduationCap} label="Teach" />}
            {on('looks') && <Tile href="/looks" icon={Layers} label="My looks" />}
          </Group>
          <Group title={t('Earn')}>
            <Tile href="/my-account/wallet" icon={Wallet} label="Wallet" />
            {on('shares') && <Tile href="/share-earn" icon={HandCoins} label="Share & earn" />}
            <Tile href="/invite" icon={UserPlus} label="Bring a shop" />
            <Tile href="/verify" icon={BadgeCheck} label="Get verified" />
          </Group>
          <Group title={t('More')}>
            <Tile href="/about" icon={Info} label="About Saligue" />
            <Tile href="/download" icon={Smartphone} label="Android app" />
            <Tile href="/policies" icon={FileText} label="Policies" />
            <Tile icon={LogOut} label="Log out" tone="danger" onClick={async () => { await logout(); router.push('/'); }} />
          </Group>
        </>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          <Tile href="/orders" icon={Package} label="My orders" />
          <Tile href="/wishlist" icon={Bookmark} label="Saved" />
          <Tile href="/download" icon={Smartphone} label="Android app" />
          <Tile href="/policies" icon={FileText} label="Policies" />
        </div>
      )}

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={() => { setLoginOpen(false); setTimeout(() => setRegisterOpen(true), 150); }} />
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={() => { setRegisterOpen(false); setTimeout(() => setLoginOpen(true), 150); }} />
    </div>
  );
}
