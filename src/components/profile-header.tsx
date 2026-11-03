'use client';

import Link from 'next/link';
import { BadgeCheck, Clock, GraduationCap, MapPin, Radio, Store } from 'lucide-react';
import { ExpandableText } from '@/components/expandable-text';
import { ProfileAvatar } from '@/components/profile-avatar';
import { SellerAvatar } from '@/components/seller-avatar';
import { Stars } from '@/components/stars';
import { VerifiedBadge } from '@/components/verified-badge';
import { useHideLikes } from '@/lib/hide-likes';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type Person = { id: string; name: string; avatar: string | null; isShop: boolean; official: boolean; verified?: boolean };
export type Profile = Person & {
  username?: string | null;
  bio: string;
  verifiedType?: string | null;
  shop: { city: string; country: string; hours: string | null; phone: string; whatsapp: string | null; street: string; district: string | null; landmark: string | null; mapUrl: string | null } | null;
  email: string | null;
  clients: number;
  following: number;
  items: number;
  lessons: number;
  likes?: number;
  rating: number | null;
  ratingCount: number;
  liveId: string | null;
  isClient: boolean;
  mine: boolean;
};

export type StatKind = 'items' | 'clients' | 'following' | 'likes';

export const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));

/**
 * The top of every profile, the same for a shop, a teacher and your own Me page (like TikTok and Instagram):
 * the photo in the middle, name and @username, the numbers, the buttons, then the bio and the shop's details.
 */
export function ProfileHeader({ profile, avatar, onStat, statHref, children }: {
  profile: Profile;
  // Your own photo on Me: tap it to change it.
  avatar?: React.ReactNode;
  onStat?: (kind: StatKind) => void;
  statHref?: Partial<Record<StatKind, string>>;
  // The buttons: Follow, Message… or Edit and Share on your own.
  children?: React.ReactNode;
}) {
  const t = useT();
  const hideLikes = useHideLikes();
  const stats: { kind: StatKind; label: string; value: number }[] = [
    ...(profile.isShop ? [{ kind: 'items' as const, label: 'Items', value: profile.items }] : []),
    { kind: 'clients', label: profile.isShop ? 'Clients' : 'Followers', value: profile.clients },
    { kind: 'following', label: 'Following', value: profile.following },
    // "Hide like counts" hides them on other people's profiles; your own always shows.
    ...(!hideLikes || profile.mine ? [{ kind: 'likes' as const, label: 'Likes', value: profile.likes ?? 0 }] : []),
  ];

  return (
    <div className="flex flex-col items-center text-center">
      {avatar ?? (profile.liveId ? (
        <Link href={`/live/watch?id=${profile.liveId}`} className="relative" aria-label={`${profile.name} is live: watch`}>
          <span className="block rounded-full bg-gradient-to-tr from-primary to-[#e30613] p-[3px]"><SellerAvatar src={profile.avatar} name={profile.name} className="h-24 w-24 ring-4 ring-background" /></span>
          <span className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-md bg-primary px-1.5 text-[10px] font-extrabold text-primary-foreground ring-2 ring-background"><Radio className="h-3 w-3" /> LIVE</span>
        </Link>
      ) : (
        <ProfileAvatar id={profile.id} name={profile.name} src={profile.avatar} size="lg" />
      ))}

      <h1 className="mt-3 flex max-w-full items-center justify-center gap-1.5 text-xl font-extrabold">
        <span className="truncate">{profile.name}</span>
        {profile.official && <BadgeCheck className="h-5 w-5 shrink-0 text-primary" />}
        {profile.verified && <VerifiedBadge type={profile.verifiedType} className="h-5 w-5 shrink-0" />}
      </h1>
      {profile.username && <p className="text-sm font-semibold text-muted-foreground">@{profile.username}</p>}

      <div className="mt-4 flex w-full max-w-sm justify-center">
        {stats.map((s, i) => {
          const body = (
            <>
              <span className="block text-lg font-extrabold leading-tight">{compact(s.value)}</span>
              <span className="block truncate text-xs text-muted-foreground">{t(s.label)}</span>
            </>
          );
          const className = cn('min-w-0 flex-1 rounded-xl px-1 py-1 transition hover:bg-muted', i > 0 && 'relative before:absolute before:left-0 before:top-1/2 before:h-4 before:-translate-y-1/2 before:border-l');
          const href = statHref?.[s.kind];
          return href ? <Link key={s.kind} href={href} className={className}>{body}</Link>
            : <button key={s.kind} type="button" onClick={() => onStat?.(s.kind)} disabled={!onStat} className={cn(className, 'disabled:hover:bg-transparent')}>{body}</button>;
        })}
      </div>

      {children && <div className="mt-4 flex w-full max-w-md items-center justify-center gap-2">{children}</div>}

      <div className="mt-3 w-full max-w-md space-y-1">
        {profile.bio ? <ExpandableText text={profile.bio} lines={3} className="text-sm" /> : profile.mine && <p className="text-sm text-muted-foreground">{t('Add a bio so clients know what you sell or teach.')}</p>}
        <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {profile.isShop ? <span className="flex items-center gap-1"><Store className="h-3.5 w-3.5" /> {t('Shop')}</span> : profile.lessons > 0 && <span className="flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" /> {t('Teacher')}</span>}
          {profile.shop && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {profile.shop.city}</span>}
          {profile.rating != null && <span className="flex items-center gap-1"><Stars rating={profile.rating} size="h-3 w-3" /> {profile.rating} ({profile.ratingCount})</span>}
          {profile.shop?.hours && <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {profile.shop.hours}</span>}
        </p>
      </div>
    </div>
  );
}
