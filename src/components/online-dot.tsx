'use client';

import { useOnline } from '@/lib/presence';
import { cn } from '@/lib/utils';

/** The green dot on a photo while that account is online. Place it inside a `relative` box around the photo. */
export function OnlineDot({ userId, className }: { userId?: string | null; className?: string }) {
  const online = useOnline(userId);
  if (!online) return null;
  return (
    <span
      role="img"
      aria-label="Online"
      title="Online"
      className={cn('absolute bottom-0 right-0 h-[28%] max-h-3.5 min-h-2.5 w-[28%] min-w-2.5 max-w-3.5 rounded-full bg-emerald-500 ring-2 ring-background', className)}
    />
  );
}
