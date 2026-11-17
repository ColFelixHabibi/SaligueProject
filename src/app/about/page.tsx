'use client';

import Link from 'next/link';
import { BadgeCheck, ChevronRight } from 'lucide-react';
import { Logo } from '@/components/layout/header';
import { useBrand } from '@/lib/brand';
import { useT } from '@/lib/i18n';

/** About Saligue: what it is and who made it (INDECIANA). The words are set in Admin Center → Rules & policies. */
export default function AboutPage() {
  const t = useT();
  const [brand] = useBrand();
  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10 md:py-16">
      <div className="space-y-3 text-center">
        <div className="flex justify-center"><Logo /></div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-muted-foreground">{t(brand.saligue.tagline)}</p>
        <p className="whitespace-pre-line text-lg leading-relaxed">{t(brand.saligue.about)}</p>
      </div>
      <Link href="/indeciana" className="flex items-center gap-4 rounded-2xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-md">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-foreground font-serif text-xl text-background">I</span>
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-lg tracking-[0.2em]">INDECIANA</span>
          <span className="flex items-center gap-1 text-sm text-muted-foreground"><BadgeCheck className="h-4 w-4 text-primary" /> {t(brand.indeciana.kicker)}</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </Link>
    </div>
  );
}
