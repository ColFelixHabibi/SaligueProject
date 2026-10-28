'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpenCheck, Clock, HeartHandshake, Layers, MessageCircleQuestion, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { topicOf } from '@/lib/lessons';

type Week = { lessons: number; minutes: number; topics: Record<string, number>; recent: { id: string; title: string }[]; thanked: number; answers: number; looks: number; saved: number; newFromFollowed: number };

/** "Your week": a calm summary of what someone learned and kept, instead of a stream of alerts. */
export function WeekCard() {
  const t = useT();
  const [week, setWeek] = useState<Week | null>(null);
  useEffect(() => {
    api<Week>('/me/week').then(setWeek).catch(() => {});
  }, []);
  if (!week) return null;
  const stats = [
    { icon: BookOpenCheck, value: week.lessons, label: 'Lessons' },
    { icon: Clock, value: week.minutes, label: 'Minutes' },
    { icon: Layers, value: week.saved, label: 'Saved to looks' },
    { icon: MessageCircleQuestion, value: week.answers, label: 'Answers' },
  ];
  const topics = Object.entries(week.topics).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const quiet = !week.lessons && !week.saved && !week.answers;
  return (
    <section id="week" className="scroll-mt-20 rounded-2xl border bg-gradient-to-br from-amber-50 to-rose-50 p-4 dark:from-amber-950/30 dark:to-rose-950/30">
      <p className="flex items-center gap-2 font-bold"><Sparkles className="h-5 w-5 text-amber-500" /> {t('Your week')}</p>
      {quiet ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {t('A quiet week.')}{' '}
          <Link href="/learn" className="font-semibold text-primary">{t('Learn something')}</Link>
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-4 gap-1 text-center">
            {stats.map((s) => (
              <div key={s.label} className="min-w-0">
                <s.icon className="mx-auto h-5 w-5 text-primary" />
                <p className="text-lg font-extrabold leading-tight">{s.value}</p>
                <p className="truncate text-[11px] text-muted-foreground">{t(s.label)}</p>
              </div>
            ))}
          </div>
          {topics.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {topics.map(([topic, n]) => {
                const tp = topicOf(topic);
                return <span key={topic} className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-xs font-semibold"><tp.icon className="h-3.5 w-3.5 text-primary" /> {t(tp.label)} · {n}</span>;
              })}
              {week.thanked > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-xs font-semibold"><HeartHandshake className="h-3.5 w-3.5 text-primary" /> {week.thanked}</span>}
            </div>
          )}
        </>
      )}
      {week.newFromFollowed > 0 && <p className="mt-2 text-xs text-muted-foreground">{week.newFromFollowed} {t('new from people you follow')}</p>}
    </section>
  );
}
