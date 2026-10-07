
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV, isActive } from './nav';

export default function Footer() {
  const pathname = usePathname();
  return (
    <>
      {/* Phones: the app's main destinations, each once. */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="flex h-16 items-stretch justify-around">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(href, pathname);
            return (
              <Link
                key={href}
                href={href}
                className={cn('flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', active ? 'text-primary' : 'text-muted-foreground')}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className={cn('h-6 w-6', active && 'stroke-[2.5]')} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>

    </>
  );
}
