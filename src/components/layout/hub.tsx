'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LayoutGrid, type LucideIcon } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SellerAvatar } from '@/components/seller-avatar';
import { cn } from '@/lib/utils';

// One frame for every dashboard (like Instagram's Professional dashboard or TikTok's): a header saying whose
// space it is, a Menu button that opens every section as a grid on phones, and a side menu on computers.
// Each kind of dashboard has its own colour, so shoppers, shops, admins and the main admin never look alike.

export type HubItem = { key: string; icon: LucideIcon; label: string; count?: number; href?: string; onSelect?: () => void };
export type HubTone = 'shopper' | 'shop' | 'admin' | 'main-admin';

const TONES: Record<HubTone, { band: string; kicker: string; title: string; active: string; ring: string }> = {
  shopper: { band: 'bg-background', kicker: 'text-primary', title: 'text-foreground', active: 'bg-primary/10 text-primary', ring: 'border-primary/30' },
  shop: { band: 'bg-gradient-to-r from-primary/10 via-background to-background', kicker: 'text-primary', title: 'text-foreground', active: 'bg-primary/10 text-primary', ring: 'border-primary/40' },
  admin: { band: 'bg-sky-600', kicker: 'text-sky-100', title: 'text-white', active: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200', ring: 'border-white/50' },
  'main-admin': { band: 'bg-neutral-950', kicker: 'text-primary', title: 'text-white', active: 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900', ring: 'border-primary' },
};

export function Hub({ tone, kicker, title, avatar, avatarName, action, items, activeKey, children }: {
  tone: HubTone;
  kicker: string;
  title: string;
  avatar?: string | null;
  avatarName?: string;
  // One main action in the header (e.g. Go live).
  action?: React.ReactNode;
  items: HubItem[];
  activeKey: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const t = TONES[tone];
  const current = items.find((i) => i.key === activeKey) ?? items[0];
  const waiting = items.reduce((n, i) => n + (i.count ?? 0), 0);
  const badge = (count?: number) => !!count && <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{count > 9 ? '9+' : count}</span>;
  // A section is a link (its own page) or a button (a tab on the same page).
  const entry = (i: HubItem, className: string, inner: React.ReactNode) =>
    i.href ? (
      <Link key={i.key} href={i.href} onClick={() => setOpen(false)} aria-current={i.key === activeKey ? 'page' : undefined} className={className}>{inner}</Link>
    ) : (
      <button key={i.key} type="button" onClick={() => { i.onSelect?.(); setOpen(false); }} aria-current={i.key === activeKey ? 'page' : undefined} className={cn(className, 'text-left')}>{inner}</button>
    );

  return (
    <div className="min-h-screen w-full min-w-0 bg-muted/40">
      <div className={cn('border-b', t.band)}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-3 min-[360px]:px-4 md:px-8 md:py-5">
          <div className="flex min-w-0 items-center gap-3">
            {avatarName !== undefined && <SellerAvatar src={avatar ?? null} name={avatarName} className={cn('h-11 w-11 shrink-0 border-2 md:h-12 md:w-12', t.ring)} />}
            <span className="min-w-0">
              <span className={cn('block truncate text-[11px] font-semibold uppercase tracking-[0.2em]', t.kicker)}>{kicker}</span>
              <span className={cn('block truncate text-lg font-extrabold tracking-tight md:text-2xl', t.title)}>{title}</span>
            </span>
          </div>
          {action}
        </div>
        {/* Phones: one Menu button showing where you are; it opens every section. */}
        <div className="px-3 pb-3 min-[360px]:px-4 md:hidden">
          <button type="button" onClick={() => setOpen(true)} className="flex h-12 w-full items-center gap-3 rounded-xl border bg-background px-3 text-left font-semibold text-foreground" aria-haspopup="dialog">
            <current.icon className="h-5 w-5 text-primary" />
            <span className="min-w-0 flex-1 truncate">{current.label}</span>
            {badge(waiting)}
            <span className="flex items-center gap-1 text-sm text-muted-foreground"><LayoutGrid className="h-4 w-4" /> Menu</span>
          </button>
        </div>
      </div>
      <div className="mx-auto flex max-w-7xl gap-6 md:p-8">
        {/* Computers: the sections down the left. */}
        <nav className="sticky top-6 hidden h-fit w-56 shrink-0 flex-col gap-0.5 rounded-2xl border bg-background p-2 md:flex" aria-label={kicker}>
          {items.map((i) => entry(i, cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors', i.key === activeKey ? t.active : 'text-muted-foreground hover:bg-muted hover:text-foreground'),
            <><i.icon className="h-4 w-4 shrink-0" /> <span className="min-w-0 flex-1 truncate">{i.label}</span> {badge(i.count)}</>))}
        </nav>
        {/* One column that never grows past the screen: wide content (charts, tables) scrolls inside itself. */}
        <main className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-6 p-3 min-[360px]:p-4 md:p-0">{children}</main>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl px-4">
          <SheetHeader><SheetTitle>{kicker}</SheetTitle></SheetHeader>
          <nav className="mt-4 grid grid-cols-3 gap-2" aria-label={kicker}>
            {items.map((i) => entry(i, cn('relative flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center text-xs font-semibold', i.key === activeKey ? 'border-primary bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'),
              <><i.icon className="h-6 w-6" /><span className="w-full truncate">{i.label}</span>{!!i.count && <span className="absolute right-1.5 top-1.5">{badge(i.count)}</span>}</>))}
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}
