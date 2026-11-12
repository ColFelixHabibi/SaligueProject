'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { OnlineDot } from '@/components/online-dot';
import { cn } from '@/lib/utils';

/**
 * A seller's (or anyone's) profile photo, with their initial when there is none. Given the account's id, it also
 * shows the green online dot while that account is signed in and using Saligue.
 */
export function SellerAvatar({ src, name, className, userId }: { src?: string | null; name: string; className?: string; userId?: string | null }) {
  const avatar = (
    <Avatar className={cn('h-9 w-9', className)}>
      <AvatarImage src={src ?? undefined} alt={name} className="object-cover" />
      <AvatarFallback className="bg-primary/10 font-semibold text-primary">{name.charAt(0).toUpperCase() || '?'}</AvatarFallback>
    </Avatar>
  );
  if (!userId) return avatar;
  return (
    <span className="relative inline-flex shrink-0">
      {avatar}
      <OnlineDot userId={userId} />
    </span>
  );
}
