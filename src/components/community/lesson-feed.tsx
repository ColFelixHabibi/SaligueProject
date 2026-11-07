'use client';

import { useFeatures } from '@/lib/features';

import { useT } from '@/lib/i18n';

import { useBlockedIds } from '@/lib/blocks';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { GraduationCap, LayoutGrid, Plus, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LessonSlide } from '@/components/community/lesson-slide';
import { BreakReminder, CaughtUp } from '@/components/calm/break-reminder';
import { LESSON_TOPICS, useLessons, type Lesson } from '@/lib/lessons';
import { cn } from '@/lib/utils';
import { SuggestedShops } from '@/components/suggested-shops';

// One word per tab, so every name fits under its icon on a phone (the full name is the tooltip).
const SHORT: Record<string, string> = { sewing: 'Sewing', general: 'Studies' };

const LESSON_IDEAS = [
  { emoji: '🧣', title: '3 ways to tie a headwrap', topic: 'styling' },
  { emoji: '🪡', title: 'Fix a loose button', topic: 'sewing' },
  { emoji: '👘', title: 'How to wear umushanana', topic: 'traditional' },
  { emoji: '📸', title: 'Photograph clothes with a phone', topic: 'business' },
];

/** Community lessons as a full-screen feed, with topic icons on top and a button to teach. */
export function LessonFeed({ startAt, following, challenge, className, breakReminder = true, onLessons }: { startAt?: string | null; following?: boolean; challenge?: string | null; className?: string; breakReminder?: boolean; onLessons?: (lessons: Lesson[]) => void }) {
  const [topic, setTopic] = useState<string | null>(null);
  const tr = useT();
  const on = useFeatures();
  const blocked = useBlockedIds();
  const all = useLessons({ topic, following, challenge });
  const lessons = useMemo(() => (all ? all.filter((l) => !blocked.has(l.authorId)) : null), [all, blocked]);
  // A computer shows the panel beside the feed: it lists these same lessons without asking the server twice.
  useEffect(() => {
    if (lessons) onLessons?.(lessons);
  }, [lessons, onLessons]);
  // Opened from a shared link: go to that lesson.
  useEffect(() => {
    if (startAt && lessons?.length) document.getElementById(`lesson-${startAt}`)?.scrollIntoView();
  }, [startAt, lessons?.length]);

  // Every topic visible at once, evenly spread: an icon with its whole name underneath (like the Seller Center tabs).
  // Each tab is as wide as its name and the space left is shared between them, so the row fits a phone and fills a
  // computer's wider player (a longer translation can still slide sideways rather than be cut).
  const tab = 'group flex shrink-0 flex-col items-center gap-1 rounded-xl px-0 py-1 text-[10px] font-semibold leading-none tracking-tight outline-none transition focus-visible:ring-2 focus-visible:ring-primary md:text-xs md:tracking-normal';
  const dot = 'flex h-9 w-9 items-center justify-center rounded-full transition md:h-10 md:w-10';
  const label = 'whitespace-nowrap text-center';
  return (
    <div className={cn('relative h-full', className)}>
      <nav className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-0 overflow-x-auto border-b bg-background/95 px-1.5 py-1.5 backdrop-blur [scrollbar-width:none] md:gap-2 md:px-6 md:py-2 [&::-webkit-scrollbar]:hidden" aria-label={tr('Topics')}>
        {!challenge && on('challenges') && (
          <Link href="/challenges" className={tab} title={tr('Challenges')}>
            <span className={cn(dot, 'bg-amber-400 text-black')}><Trophy className="h-4 w-4 md:h-5 md:w-5" /></span>
            <span className={label}>{tr('Challenges')}</span>
          </Link>
        )}
        <button type="button" onClick={() => setTopic(null)} className={tab} aria-pressed={!topic} title={tr('All')}>
          <span className={cn(dot, !topic ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground group-hover:bg-muted/70')}><LayoutGrid className="h-4 w-4 md:h-5 md:w-5" /></span>
          <span className={cn(label, !topic && 'text-primary')}>{tr('All')}</span>
        </button>
        {LESSON_TOPICS.map((t) => (
          <button key={t.value} type="button" onClick={() => setTopic(t.value)} className={tab} aria-pressed={topic === t.value} title={tr(t.label)}>
            <span className={cn(dot, topic === t.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground group-hover:bg-muted/70')}><t.icon className="h-4 w-4 md:h-5 md:w-5" /></span>
            <span className={cn(label, topic === t.value && 'text-primary')}>{tr(SHORT[t.value] ?? t.label)}</span>
          </button>
        ))}
        <Link href={challenge ? `/learn/new?challenge=${challenge}` : '/learn/new'} className={tab} title={tr('Teach a lesson')}>
          <span className={cn(dot, 'bg-foreground text-background shadow-sm')}><Plus className="h-4 w-4 md:h-5 md:w-5" /></span>
          <span className={label}>{tr('Teach')}</span>
        </Link>
      </nav>
      <div className="h-full snap-y snap-mandatory overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {lessons === null ? (
          <Skeleton className="h-full w-full rounded-none" />
        ) : lessons.length === 0 ? (
          // No lessons yet: invite people to be the first teacher, with ideas, and suggest shops/teachers to follow.
          <div className="flex h-full flex-col items-center justify-start gap-4 overflow-y-auto bg-muted p-5 pt-32 text-center [scrollbar-width:none] [&>*]:shrink-0 md:gap-5 md:px-8 md:pt-40 [&::-webkit-scrollbar]:hidden">
            <GraduationCap className="h-12 w-12 text-primary md:h-16 md:w-16" />
            <p className="text-xl font-bold md:text-3xl">{following ? 'No lessons from people you follow yet' : 'Be the first teacher'}</p>
            <div className="grid w-full max-w-sm grid-cols-2 gap-2 text-left text-sm md:max-w-3xl md:grid-cols-4 md:gap-3 md:text-base">
              {LESSON_IDEAS.map((idea) => (
                <Link key={idea.title} href={`/learn/new?topic=${idea.topic}`} className="flex items-center gap-2 rounded-2xl bg-background p-3 font-semibold shadow-sm hover:ring-2 hover:ring-primary md:flex-col md:justify-center md:gap-3 md:p-5 md:text-center">
                  <span className="text-xl md:text-4xl">{idea.emoji}</span> <span className="leading-tight">{tr(idea.title)}</span>
                </Link>
              ))}
            </div>
            <Button asChild className="h-12 rounded-full px-6"><Link href="/learn/new"><Plus className="mr-2 h-5 w-5" /> {tr('Teach')}</Link></Button>
            <SuggestedShops title="Follow" className="w-full max-w-lg text-left md:max-w-3xl" />
          </div>
        ) : (
          [...lessons.map((l) => <LessonSlide key={l.id} lesson={l} />), <CaughtUp key="caught-up" />]
        )}
      </div>
      {breakReminder && <BreakReminder />}
    </div>
  );
}
