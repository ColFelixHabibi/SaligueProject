'use client';

import { Languages } from 'lucide-react';
import { LANGUAGES, setLang, useLang, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** English · Kinyarwanda · Français. */
export function LanguagePicker({ className }: { className?: string }) {
  const lang = useLang();
  const t = useT();
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Languages className="h-5 w-5 shrink-0 text-primary" aria-label={t('Language')} />
      <div className="flex flex-wrap gap-1.5">
        {LANGUAGES.map((l) => (
          <button key={l.value} type="button" onClick={() => setLang(l.value)} aria-pressed={lang === l.value}
            className={cn('rounded-full border px-3 py-1 text-sm font-medium', lang === l.value ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
