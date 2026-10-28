'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GraduationCap, MapPin, Radio, Wand2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LanguagePicker } from '@/components/language-picker';
import { useAuth } from '@/components/auth/auth-provider';
import { useT } from '@/lib/i18n';

const KEY = 'saligue-welcomed';

const POINTS = [
  { icon: Wand2, title: 'Try it on first', text: 'See clothes on your own photo before you buy.', tone: 'bg-primary/10 text-primary' },
  { icon: MapPin, title: 'Shops near you', text: 'Real local shops, Mobile Money, delivery or pickup.', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  { icon: Radio, title: 'Live shopping', text: 'Watch shops live, ask, and buy in the moment.', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' },
  { icon: GraduationCap, title: 'Learn fashion', text: 'Short lessons: styling, sewing, traditional wear.', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
];

/** The first screen a new visitor sees on the home page: what Saligue is, in four pictures. Shown once. */
export function Welcome() {
  const t = useT();
  const pathname = usePathname().replace(/\/+$/, '') || '/';
  const { user, isAuthLoading } = useAuth();
  const [open, setOpen] = useState(false);
  // Opened from an invite link (…?ref=<inviter>): remembered until this person creates an account.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (!ref || !/^[\w-]{8,64}$/.test(ref)) return;
    try {
      if (!localStorage.getItem('saligue-ref')) localStorage.setItem('saligue-ref', ref);
    } catch {
      // Storage blocked.
    }
  }, []);
  useEffect(() => {
    if (isAuthLoading || pathname !== '/' || user) return;
    try {
      if (!localStorage.getItem(KEY)) setOpen(true);
    } catch {
      // Storage blocked: skip the welcome rather than show it on every visit.
    }
  }, [pathname, user, isAuthLoading]);
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Storage blocked.
    }
  };
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label="Welcome to Saligue">
      <div className="relative max-h-[100dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-background p-5 pb-[calc(1.25rem+var(--sab))] shadow-2xl sm:rounded-3xl">
        <button type="button" onClick={close} className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-muted" aria-label="Close"><X className="h-5 w-5" /></button>
        <div className="flex items-center gap-3 pr-10">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-secondary text-2xl font-black text-white">S</span>
          <div>
            <p className="text-xl font-extrabold leading-tight">{t('Welcome to Saligue')}</p>
            <p className="text-sm text-muted-foreground">{t('Fashion from shops near you')}</p>
          </div>
        </div>
        <LanguagePicker className="mt-4 justify-center" />
        <div className="mt-4 grid grid-cols-2 gap-2">
          {POINTS.map((p) => (
            <div key={p.title} className="rounded-2xl border p-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-full ${p.tone}`}><p.icon className="h-5 w-5" /></span>
              <p className="mt-2 text-sm font-bold leading-tight">{t(p.title)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t(p.text)}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-2">
          <Button className="h-12 text-base" onClick={close}>{t('Start exploring')}</Button>
          <Button variant="outline" className="h-12 text-base" asChild><Link href="/register" onClick={close}>{t('Create account')}</Link></Button>
        </div>
      </div>
    </div>
  );
}
