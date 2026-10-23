import { BadgeCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const KIND: Record<string, string> = { id: 'ID card', passport: 'passport', business: 'business registration' };

/** Blue check: Saligue checked this account's ID card, passport or business registration. */
export function VerifiedBadge({ type, className }: { type?: string | null; className?: string }) {
  const label = `Verified${type && KIND[type] ? ` (${KIND[type]})` : ''}`;
  return <BadgeCheck className={cn('inline h-4 w-4 shrink-0 fill-sky-500 text-white', className)} aria-label={label}><title>{label}</title></BadgeCheck>;
}
