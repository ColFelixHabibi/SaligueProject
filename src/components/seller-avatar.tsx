import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/** A seller's (or anyone's) profile photo, with their initial when there is none. */
export function SellerAvatar({ src, name, className }: { src?: string | null; name: string; className?: string }) {
  return (
    <Avatar className={cn('h-9 w-9', className)}>
      <AvatarImage src={src ?? undefined} alt={name} className="object-cover" />
      <AvatarFallback className="bg-primary/10 font-semibold text-primary">{name.charAt(0).toUpperCase() || '?'}</AvatarFallback>
    </Avatar>
  );
}
