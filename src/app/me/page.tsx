
'use client';

import { LanguagePicker } from '@/components/language-picker';

import { useT } from '@/lib/i18n';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bookmark, ChevronRight, Coins, Layers, UserPlus, FileText, LayoutDashboard, LogOut, MessageCircle, Package, PlusSquare, Radio, Repeat, Settings, ShieldCheck, Store, TrendingUp } from 'lucide-react';
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
import { useFeatures } from '@/lib/features';
import { WeekCard } from '@/components/week-card';

type Stats = { clients: number; following: number; items: number; lessons: number; rating: number | null };

function Stat({ value, label, href }: { value: string | number; label: string; href?: string }) {
  const t = useT();
  const body = (
    <>
      <span className="block text-lg font-extrabold leading-tight">{value}</span>
      <span className="block truncate text-[11px] text-muted-foreground">{t(label)}</span>
    </>
  );
  const className = 'min-w-0 flex-1 rounded-xl px-1 py-2 text-center transition hover:bg-muted/60';
  return href ? <Link href={href} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

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
  const { wishlistItems } = useWishlist();
  const on = useFeatures();
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    if (user) api<Stats>(`/profiles/${user.uid}`).then(setStats).catch(() => {});
  }, [user]);
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
          {user && stats && (
            <div className="mt-4 flex divide-x rounded-xl border">
              {role === 'seller' && <Stat value={stats.clients} label="Clients" href={`/profile?id=${user.uid}`} />}
              {role === 'seller' && <Stat value={stats.items} label="Items" href="/dashboard/products" />}
              {role === 'seller'
                ? <Stat value={stats.rating ?? '—'} label="Rating" href="/dashboard/reviews" />
                : <Stat value={stats.following} label="Following" href={`/profile?id=${user.uid}`} />}
              {role !== 'seller' && <Stat value={wishlistItems.length} label="Saved" href="/my-account/saved" />}
              <Stat value={stats.lessons ?? 0} label="Lessons" href="/learn" />
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

      {user && on('weekly') && <WeekCard />}

      <div className="grid grid-cols-4 gap-2">
        {user && role === 'seller' && (
          <>
            <Tile href="/sell" icon={PlusSquare} label="Add item" />
            <Tile href="/live/studio" icon={Radio} label="Go live" />
            <Tile href="/dashboard/messages" icon={MessageCircle} label="Messages" />
            <Tile href="/dashboard/analytics" icon={TrendingUp} label="Stats" />
          </>
        )}
        {user && role !== 'seller' && (
          <>
            <Tile href="/my-account/orders" icon={Package} label="Orders" />
            <Tile href="/my-account/saved" icon={Bookmark} label="Saved" />
            <Tile href="/my-account/messages" icon={MessageCircle} label="Messages" />
            <Tile href="/my-account/coins" icon={Coins} label="Coins" />
          </>
        )}
        {!user && (
          <>
            <Tile href="/orders" icon={Package} label="My orders" />
            <Tile href="/wishlist" icon={Bookmark} label="Saved" />
          </>
        )}
        {user && on('looks') && <Tile href="/looks" icon={Layers} label="My looks" />}
        {user && <Tile href="/invite" icon={UserPlus} label="Bring a shop" />}
        {user && <Tile href={`/profile?id=${user.uid}`} icon={CircleUserRound} label={role === 'seller' ? 'My shop profile' : 'My profile'} />}
        {user && role !== 'seller' && <Tile href="/learn/new" icon={GraduationCap} label="Teach" />}
        {user && <Tile href="/verify" icon={BadgeCheck} label="Get verified" />}
        {user && (role === 'seller'
          ? <Tile icon={Repeat} label="Switch to shopping" onClick={() => updateAccount({ role: 'buyer' }).then(() => router.push('/'))} />
          : <Tile href="/sell" icon={Store} label={shop ? 'Switch to my shop' : 'Start selling'} />)}
        {user && <Tile href={role === 'seller' ? '/dashboard/settings' : '/my-account/settings'} icon={Settings} label="Settings" />}
        <Tile href="/download" icon={Smartphone} label="Android app" />
        <Tile href="/policies" icon={FileText} label="Policies" />
        {user && <Tile icon={LogOut} label="Log out" tone="danger" onClick={async () => { await logout(); router.push('/'); }} />}
      </div>

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSwitchToRegister={() => { setLoginOpen(false); setTimeout(() => setRegisterOpen(true), 150); }} />
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onSwitchToLogin={() => { setRegisterOpen(false); setTimeout(() => setLoginOpen(true), 150); }} />
    </div>
  );
}
