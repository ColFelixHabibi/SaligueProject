
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
import { Bookmark, ChevronRight, FileText, Info, HandCoins, Layers, LogOut, Menu, Package, PlusSquare, Radio, Settings, ShieldCheck, ShoppingBag, Store, UserPlus } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
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


// Me shows an overview; everything else, the Centers too, is in the Menu panel (styled like the filters panel).
type Icon = typeof Package;

/** The Centers keep their colour, but only on their icon. */
const BADGE_TONE = {
  shop: 'bg-gradient-to-br from-primary to-secondary text-primary-foreground',
  admin: 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950',
  subadmin: 'bg-sky-600 text-white',
} as const;

/** A row inside the Menu panel: plain icon, label, chevron — light, like the options of the filters panel. */
function MenuRow({ href, icon: Icon, label, text, badge }: { href: string; icon: Icon; label: string; text?: string; badge?: keyof typeof BADGE_TONE | 'plain' }) {
  const t = useT();
  return (
    <Link href={href} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 text-[15px] font-medium transition-colors hover:bg-muted">
      {badge ? (
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', badge === 'plain' ? 'bg-primary/10 text-primary' : BADGE_TONE[badge])}><Icon className="h-[18px] w-[18px]" /></span>
      ) : <Icon className="h-5 w-5 shrink-0 text-primary" />}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate', text && 'font-semibold')}>{t(label)}</span>
        {text && <span className="block truncate text-xs font-normal text-muted-foreground">{text}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function MenuSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div>{children}</div>
    </section>
  );
}

/** Everything that is not overview lives here: a panel from the right, sections on top, Log out pinned at the bottom. */
function MeMenu({ trigger, signedIn, seller, admin = false, adminLevel = null, settingsHref, onLogout }: {
  trigger: React.ReactNode; signedIn: boolean; seller: boolean; admin?: boolean; adminLevel?: number | null; settingsHref: string; onLogout: () => void;
}) {
  const t = useT();
  const on = useFeatures();
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="flex w-[88vw] max-w-sm flex-col gap-0 p-0">
        <SheetHeader className="border-b px-5 pb-4 pt-5 text-left">
          <SheetTitle className="text-xl font-extrabold">{t('Menu')}</SheetTitle>
          <SheetDescription className="sr-only">{t('Everything in your account')}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {signedIn ? (
            <>
              <MenuSection title={t('Your centers')}>
                {seller ? (
                  <MenuRow href="/dashboard" icon={Store} label="Seller Center" text={t('Items, orders, sales, ads, earnings')} badge="shop" />
                ) : (
                  <MenuRow href="/sell" icon={Store} label="Start selling" text={t('Open your shop and list your first item')} badge="plain" />
                )}
                <MenuRow href="/my-account" icon={ShoppingBag} label="My Saligue" text={t('Orders, saved, wallet, coins, history')} badge="plain" />
                {admin && (
                  <MenuRow href="/admin" icon={ShieldCheck} label="Admin Center" badge={adminLevel === 1 ? 'admin' : 'subadmin'}
                    text={adminLevel === 1 ? t('Main admin · everything') : adminLevel === 2 ? t('Sub-admin · your rights') : t('Moderation, money, settings')} />
                )}
              </MenuSection>
              {(seller || on('lessons') || on('looks')) && (
                <MenuSection title={t('Create')}>
                  {seller && <MenuRow href="/sell" icon={PlusSquare} label="Add item" />}
                  {seller && on('live') && <MenuRow href="/live/studio" icon={Radio} label="Go live" />}
                  {on('lessons') && <MenuRow href="/learn/new" icon={GraduationCap} label="Teach" />}
                  {on('looks') && <MenuRow href="/looks" icon={Layers} label="My looks" />}
                </MenuSection>
              )}
              <MenuSection title={t('Earn')}>
                <MenuRow href="/my-account/wallet" icon={Wallet} label="Wallet" />
                {on('shares') && <MenuRow href="/share-earn" icon={HandCoins} label="Share & earn" />}
                <MenuRow href="/invite" icon={UserPlus} label="Bring a shop" />
                <MenuRow href="/verify" icon={BadgeCheck} label="Get verified" />
              </MenuSection>
            </>
          ) : (
            <MenuSection title={t('Shopping')}>
              <MenuRow href="/orders" icon={Package} label="My orders" />
              <MenuRow href="/wishlist" icon={Bookmark} label="Saved" />
            </MenuSection>
          )}
          <MenuSection title={t('Settings')}>
            <div className="space-y-3 pt-1">
              <LanguagePicker />
              {signedIn && <PushCard plain />}
            </div>
            {signedIn && <div className="pt-2"><MenuRow href={settingsHref} icon={Settings} label="Account settings" /></div>}
          </MenuSection>
          <MenuSection title={t('More')}>
            <MenuRow href="/about" icon={Info} label="About Saligue" />
            <MenuRow href="/download" icon={Smartphone} label="Android app" />
            <MenuRow href="/policies" icon={FileText} label="Policies" />
          </MenuSection>
        </div>
        {signedIn && (
          <div className="border-t px-5 py-4">
            <Button variant="outline" className="h-11 w-full border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive" onClick={onLogout}>
              <LogOut className="mr-2 h-4 w-4" /> {t('Log out')}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** "Me": an overview (profile and week); everything else, the Centers too, is in the Menu panel beside the profile buttons. */
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
  const settingsHref = role === 'seller' ? '/dashboard/settings' : '/my-account/settings';
  const doLogout = async () => { await logout(); router.push('/'); };

  return (
    <div className="mx-auto max-w-xl space-y-4 px-3 py-4 min-[360px]:px-4 md:space-y-6 md:py-10">
      {/* The same top as your public profile (and every shop's), so Me and Profile look alike. */}
      {user && stats ? (
        <ProfileHeader profile={{ ...stats, avatar: photo ?? null }}
          avatar={<ProfilePhotoField photoOnly name={shop?.name ?? user.displayName} required={!!shop} />}
          statHref={{ items: '/dashboard/products', clients: `/profile?id=${user.uid}`, following: `/profile?id=${user.uid}`, likes: `/profile?id=${user.uid}` }}>
          {/* One profile: this is it, as others see it (with the shop's items when there is a shop). */}
          <Button asChild variant="secondary" size="icon" className="h-10 w-10 shrink-0 rounded-full"><Link href={`/profile?id=${user.uid}`} aria-label={t('See my profile as others see it')} title={t('See my profile as others see it')}><Eye className="h-4 w-4" /></Link></Button>
          <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-full" aria-label="Share profile" title="Share profile"
            onClick={() => shareLink({ title: stats.name, text: `${stats.name} on Saligue`, url: absoluteUrl(profileHref(user.uid)) })}><Share2 className="h-4 w-4" /></Button>
          <MeMenu signedIn seller={role === 'seller'} admin={admin} adminLevel={adminLevel} settingsHref={settingsHref} onLogout={doLogout}
            trigger={<Button size="sm" className="h-10 shrink-0 rounded-full px-4 font-semibold" aria-label={t('Menu')}><Menu className="mr-1.5 h-4 w-4" />{t('Menu')}</Button>} />
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
          <div className="flex gap-2 px-5 pb-5">
            <Button className="flex-1" onClick={() => setRegisterOpen(true)}>Create account</Button>
            <Button variant="outline" className="flex-1" onClick={() => setLoginOpen(true)}>Log in</Button>
            <MeMenu signedIn={false} seller={false} settingsHref="" onLogout={() => {}}
              trigger={<Button variant="outline" size="icon" className="shrink-0" aria-label={t('Menu')}><Menu className="h-4 w-4" /></Button>} />
          </div>
        </Card>
      )}

      {user && on('weekly') && <WeekCard />}


      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={() => { setLoginOpen(false); setTimeout(() => setRegisterOpen(true), 150); }} />
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={() => { setRegisterOpen(false); setTimeout(() => setLoginOpen(true), 150); }} />
    </div>
  );
}
