'use client';

import { useFeatures } from '@/lib/features';

import { useT } from '@/lib/i18n';

import { useBlockedIds } from '@/lib/blocks';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GraduationCap, LayoutGrid, Plus, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LessonSlide } from '@/components/community/lesson-slide';
import { BreakReminder, CaughtUp } from '@/components/calm/break-reminder';
import { LESSON_TOPICS, useLessons } from '@/lib/lessons';
import { cn } from '@/lib/utils';

/** Community lessons as a full-screen feed, with topic icons on top and a button to teach. */
export function LessonFeed({ startAt, following, challenge, className, breakReminder = true }: { startAt?: string | null; following?: boolean; challenge?: string | null; className?: string; breakReminder?: boolean }) {
  const [topic, setTopic] = useState<string | null>(null);
  const tr = useT();
  const on = useFeatures();
  const blocked = useBlockedIds();
  const all = useLessons({ topic, following, challenge });
  const lessons = all && all.filter((l) => !blocked.has(l.authorId));
  // Opened from a shared link: go to that lesson.
  useEffect(() => {
    if (startAt && lessons?.length) document.getElementById(`lesson-${startAt}`)?.scrollIntoView();
  }, [startAt, lessons?.length]);

  const chip = 'flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-primary';
  return (
    <div className={cn('relative h-full', className)}>
      <div className="absolute inset-x-0 top-0 z-20 flex items-start gap-1.5 overflow-x-auto border-b bg-background/95 p-2 backdrop-blur [mask-image:linear-gradient(to_right,black_92%,transparent)] [scrollbar-width:none] md:flex-wrap md:overflow-visible md:[mask-image:none] [&::-webkit-scrollbar]:hidden">
        {!challenge && on('challenges') && (
          <Link href="/challenges" className={cn(chip, 'bg-amber-400 text-black')} aria-label="Challenges">
            <Trophy className="h-5 w-5" /> {tr('Challenges')}
          </Link>
        )}
        <button type="button" onClick={() => setTopic(null)} className={cn(chip, !topic ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/70')} aria-pressed={!topic}>
          <LayoutGrid className="h-5 w-5" /> {tr('All')}
        </button>
        {LESSON_TOPICS.map((t) => (
          <button key={t.value} type="button" onClick={() => setTopic(t.value)} className={cn(chip, topic === t.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/70')} aria-pressed={topic === t.value}>
            <t.icon className="h-5 w-5" /> {tr(t.label)}
          </button>
        ))}
        <Link href={challenge ? `/learn/new?challenge=${challenge}` : '/learn/new'} className={cn(chip, 'ml-auto border border-primary text-primary')} aria-label="Teach a lesson">
          <Plus className="h-5 w-5" /> {tr('Teach')}
        </Link>
      </div>
      <div className="h-full snap-y snap-mandatory overflow-y-auto">
        {lessons === null ? (
          <Skeleton className="h-full w-full rounded-none" />
        ) : lessons.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 bg-muted p-8 pt-24 text-center">
            <GraduationCap className="h-14 w-14 text-primary" />
            <p className="text-xl font-bold">{following ? 'No lessons from people you follow yet' : 'No lessons here yet'}</p>
            <p className="max-w-xs text-sm text-muted-foreground">Teach styling, sewing, traditional wear or fashion business in a video up to 4 min 30 s, or a General studies lesson up to 10 min.</p>
            <Button asChild><Link href="/learn/new"><Plus className="mr-2 h-4 w-4" /> Teach a lesson</Link></Button>
          </div>
        ) : (
          [...lessons.map((l) => <LessonSlide key={l.id} lesson={l} />), <CaughtUp key="caught-up" />]
        )}
      </div>
      {breakReminder && <BreakReminder />}
    </div>
  );
}
