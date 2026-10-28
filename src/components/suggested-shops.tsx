'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MapPin, Store } from 'lucide-react';
import { FollowButton } from '@/components/follow-button';
import { SellerAvatar } from '@/components/seller-avatar';
import { VerifiedBadge } from '@/components/verified-badge';
import { profileHref } from '@/components/profile-avatar';
import { api, mediaUrl } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type Shop = { id: string; name: string; avatar: string | null; verified: boolean; city: string | null; items: number; clients: number };

/** Shops worth following, as a sideways row: fills empty pages and helps new people find someone to follow. */
export function SuggestedShops({ title = 'Shops to follow', className }: { title?: string; className?: string }) {
  const t = useT();
  const [shops, setShops] = useState<Shop[] | null>(null);
  useEffect(() => {
    api<Shop[]>('/shops/suggested').then((l) => setShops(l.map((s) => ({ ...s, avatar: mediaUrl(s.avatar ?? undefined) ?? null })))).catch(() => setShops([]));
  }, []);
  if (!shops?.length) return null;
  return (
    <section className={cn('space-y-2', className)}>
      <p className="flex items-center gap-2 font-bold"><Store className="h-5 w-5 text-primary" /> {t(title)}</p>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {shops.map((s) => (
          <div key={s.id} className="flex w-36 shrink-0 flex-col items-center gap-1.5 rounded-2xl border bg-card p-3 text-center">
            <Link href={profileHref(s.id)} className="flex flex-col items-center gap-1.5">
              <SellerAvatar src={s.avatar} name={s.name} className="h-14 w-14" />
              <span className="line-clamp-1 text-sm font-semibold">{s.name}{s.verified && <VerifiedBadge className="ml-0.5" />}</span>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">{s.city && <><MapPin className="h-3 w-3" /> {s.city} · </>}{s.items} {t('Items').toLowerCase()}</span>
            </Link>
            <FollowButton sellerId={s.id} className="h-8 w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}
