'use client';

import Link from 'next/link';
import { Check, Plus } from 'lucide-react';
import { SellerAvatar } from '@/components/seller-avatar';
import { useFollow } from '@/components/follow-button';
import { cn } from '@/lib/utils';

export const profileHref = (id: string) => `/profile?id=${id}`;

/**
 * A shop's or teacher's photo, like TikTok: tap the photo to open their profile, tap the small ＋ to follow
 * (become their client). The ＋ turns into ✓ once followed, and is hidden on your own photo.
 */
export function ProfileAvatar({ id, name, src, size = 'md', live, className }: { id: string; name: string; src?: string | null; size?: 'sm' | 'md' | 'lg'; live?: boolean; className?: string }) {
  const { following, toggle, own } = useFollow(id);
  const box = { sm: 'h-8 w-8', md: 'h-11 w-11', lg: 'h-24 w-24' }[size];
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <Link href={profileHref(id)} aria-label={`${name}: profile`} className={cn('rounded-full', live ? 'bg-gradient-to-tr from-primary to-[#e30613] p-[2px]' : 'ring-2 ring-white/80')}>
        <SellerAvatar src={src} name={name} className={cn(box, live && 'ring-2 ring-background')} />
      </Link>
      {!own && (
        <button type="button" onClick={toggle} aria-pressed={following} aria-label={following ? `You follow ${name}` : `Follow ${name}`}
          className={cn('absolute -bottom-1.5 left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full ring-2 ring-background transition active:scale-90',
            size === 'lg' ? 'h-7 w-7' : 'h-5 w-5', following ? 'bg-background text-primary' : 'bg-primary text-primary-foreground')}>
          {following ? <Check className={size === 'lg' ? 'h-4 w-4' : 'h-3 w-3'} strokeWidth={3} /> : <Plus className={size === 'lg' ? 'h-4 w-4' : 'h-3 w-3'} strokeWidth={3} />}
        </button>
      )}
    </span>
  );
}
