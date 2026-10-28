'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Hash, Store, User } from 'lucide-react';
import { FollowButton } from '@/components/follow-button';
import { SellerAvatar } from '@/components/seller-avatar';
import { VerifiedBadge } from '@/components/verified-badge';
import { profileHref } from '@/components/profile-avatar';
import { api, mediaUrl } from '@/lib/api';
import { useT } from '@/lib/i18n';

type Person = { id: string; name: string; username: string; avatar: string | null; isShop: boolean; verified: boolean };

/** Explore: people and shops whose name or @username matches what is typed, and the #tag page for a hashtag. */
export function PeopleResults({ query }: { query: string }) {
  const t = useT();
  const q = query.trim();
  const tag = /^#([\p{L}\p{N}_]{2,40})$/u.exec(q)?.[1]?.toLowerCase() ?? null;
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    const words = q.replace(/^[@#]/, '');
    if (tag || words.length < 2) return setPeople([]);
    const timer = setTimeout(() => {
      api<Person[]>(`/usernames?q=${encodeURIComponent(words)}`).then((l) => setPeople(l.map((p) => ({ ...p, avatar: mediaUrl(p.avatar ?? undefined) ?? null })))).catch(() => setPeople([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, tag]);

  if (tag) {
    return (
      <Link href={`/tag?t=${encodeURIComponent(tag)}`} className="flex w-fit items-center gap-2 rounded-full border bg-card px-3 py-2 text-sm font-semibold hover:bg-muted">
        <Hash className="h-4 w-4 text-primary" /> {tag} · {t('items and lessons')}
      </Link>
    );
  }
  if (!people.length) return null;
  return (
    <section className="space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-bold"><User className="h-4 w-4 text-primary" /> {t('People and shops')}</p>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {people.map((p) => (
          <div key={p.id} className="flex w-32 shrink-0 flex-col items-center gap-1 rounded-2xl border bg-card p-2.5 text-center">
            <Link href={profileHref(p.id)} className="flex flex-col items-center gap-1">
              <SellerAvatar src={p.avatar} name={p.name} className="h-12 w-12" />
              <span className="line-clamp-1 text-xs font-semibold">{p.name}{p.verified && <VerifiedBadge className="ml-0.5" />}</span>
              <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">{p.isShop && <Store className="h-3 w-3" />}@{p.username}</span>
            </Link>
            {p.isShop && <FollowButton sellerId={p.id} className="h-7 w-full text-xs" />}
          </div>
        ))}
      </div>
    </section>
  );
}
