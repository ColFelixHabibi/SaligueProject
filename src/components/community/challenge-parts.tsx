'use client';

import Link from 'next/link';
import { Heart, Trophy, Video, Megaphone } from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { ChallengeWinner } from '@/lib/lessons';
import { cn } from '@/lib/utils';

/**
 * What a challenge is, in three steps, for anyone who has never seen one: Saligue sets a theme and a deadline,
 * people answer with a short lesson video, and likes decide the top three.
 */
export function ChallengeHow({ className }: { className?: string }) {
  const t = useT();
  const steps = [
    { icon: Megaphone, title: t('Saligue sets a theme'), text: t('Each challenge has a fashion theme, its rules and a deadline.') },
    { icon: Video, title: t('You join with a video'), text: t('Tap Join and post a short lesson that answers the theme, before the deadline.') },
    { icon: Heart, title: t('Likes decide'), text: t('Everyone watches and likes. The three most liked win a medal and are told.') },
  ];
  return (
    <section className={cn('rounded-2xl border bg-card p-4 shadow-sm', className)} aria-label={t('How challenges work')}>
      <p className="mb-3 font-bold">{t('How challenges work')}</p>
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-amber-700 dark:text-amber-300"><s.icon className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{i + 1}. {s.title}</span>
              <span className="block text-xs text-muted-foreground">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const MEDAL = ['🥇', '🥈', '🥉'];

/** A finished challenge's top three, each opening the winning lesson. */
export function ChallengeWinners({ winners, className }: { winners: ChallengeWinner[]; className?: string }) {
  const t = useT();
  if (!winners.length) return null;
  return (
    <section className={cn('space-y-2', className)}>
      <p className="flex items-center gap-2 text-sm font-bold"><Trophy className="h-4 w-4 text-amber-500" /> {t('Winners')}</p>
      <div className="grid grid-cols-3 gap-2">
        {winners.map((w) => (
          <Link key={w.lessonId} href={`/learn?lesson=${w.lessonId}`} className="overflow-hidden rounded-xl border bg-card text-center">
            <span className="relative block aspect-[3/4] bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {w.poster && <img src={w.poster} alt="" className="h-full w-full object-cover opacity-90" />}
              <span className="absolute left-1 top-1 text-xl">{MEDAL[w.place - 1]}</span>
            </span>
            <span className="block truncate px-1.5 pt-1 text-xs font-semibold">{w.name}</span>
            <span className="flex items-center justify-center gap-1 pb-1.5 text-[11px] text-muted-foreground"><Heart className="h-3 w-3" /> {w.likes}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
