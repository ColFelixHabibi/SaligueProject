import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Header that says what a page is for, so For You (feed), Explore (shop the catalog) and
 * Fitting Room (see it on you) are never confused. `links` point to the other two.
 */
export function PageIntro({ icon: Icon, title, subtitle, links = [], className, children }: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  links?: { href: string; label: string; icon: LucideIcon }[];
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary/70 p-5 text-primary-foreground shadow-lg md:p-7', className)}>
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-16 right-24 h-32 w-32 rounded-full bg-white/10" />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 md:h-14 md:w-14">
            <Icon className="h-6 w-6 md:h-7 md:w-7" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{title}</h1>
            <p className="text-sm text-primary-foreground/85 md:text-base">{subtitle}</p>
          </div>
        </div>
        {links.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {links.map(({ href, label, icon: LinkIcon }) => (
              <Link key={href} href={href} className="inline-flex h-10 items-center gap-2 rounded-full bg-white/15 px-4 text-sm font-semibold transition hover:bg-white/25">
                <LinkIcon className="h-4 w-4" /> {label}
              </Link>
            ))}
          </div>
        )}
      </div>
      {children && <div className="relative mt-4">{children}</div>}
    </div>
  );
}
