'use client';

import { useT } from '@/lib/i18n';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** Long text shows a few lines with "more"; tapping opens all of it ("less" closes it). Short text shows as is. */
export function ExpandableText({ text, lines = 2, className }: { text: string; lines?: 1 | 2 | 3 | 4; className?: string }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const [long, setLong] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 2);
  }, [text, open]);
  const clamp = { 1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4' }[lines];
  return (
    <div className={className}>
      <p ref={ref} className={cn('whitespace-pre-wrap break-words', !open && clamp)}>{text}</p>
      {(long || open) && (
        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }} className="mt-0.5 text-sm font-semibold text-foreground/80 hover:text-foreground">
          {open ? t('less') : t('more')}
        </button>
      )}
    </div>
  );
}
