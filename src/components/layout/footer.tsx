
'use client';

import { useT } from '@/lib/i18n';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/auth/auth-provider';
import { navFor, isActive } from './nav';

export default function Footer() {
  const pathname = usePathname();
  const { user, role } = useAuth();
  const t = useT();
  // Lives fill the whole screen, like TikTok.
  if (/\/live\/(studio|watch)/.test(pathname)) return null;
  return (
    <>
      {/* Phones: the app's main destinations, each once. */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 pb-[var(--sab)] backdrop-blur md:hidden">
        <div className="flex h-16 items-stretch justify-around">
          {navFor(role, !!user).map(({ href, label, icon: Icon }) => {
            const active = isActive(href, pathname);
            return (
              <Link
                key={href}
                href={href}
                className={cn('flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[10px] font-semibold leading-tight min-[360px]:text-[11px]', active ? 'text-primary' : 'text-muted-foreground')}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className={cn('h-6 w-6 shrink-0', active && 'stroke-[2.5]')} />
                <span className="w-full truncate">{t(label)}</span>
              </Link>
            );
          })}
        </div>
      </nav>

    </>
  );
}
