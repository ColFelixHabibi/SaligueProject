import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A slim page title for computers. On phones the page starts straight with its content, like TikTok and
 * Instagram: the bottom bar already says where you are, so no title box and no repeated shortcuts.
 */
export function PageIntro({ icon: Icon, title, subtitle, className, children }: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  className?: string;
  // A main action shown on the right (e.g. "Go live").
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('hidden items-center justify-between gap-4 md:flex', className)}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {children && <div className="flex shrink-0 gap-2">{children}</div>}
    </div>
  );
}
