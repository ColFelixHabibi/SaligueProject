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
import { LessonAdSlide } from '@/components/community/lesson-ad-slide';
import { BreakReminder, CaughtUp } from '@/components/calm/break-reminder';
import { LESSON_TOPICS, useChallenges, useLessons, type Lesson } from '@/lib/lessons';
import { cn } from '@/lib/utils';
import { SuggestedShops } from '@/components/suggested-shops';

// Where Learning ads go: after the third lesson, then after every fifth one.
const LEARN_AD_FIRST = 2;
const LEARN_AD_EVERY = 5;

// One word per tab, so every name fits under its icon on a phone (the full name is the tooltip).
const SHORT: Record<string, string> = { sewing: 'Sewing', general: 'Studies' };

const LESSON_IDEAS = [
  { emoji: '🧣', title: '3 ways to tie a headwrap', topic: 'styling' },
  { emoji: '🪡', title: 'Fix a loose button', topic: 'sewing' },
  { emoji: '👘', title: 'How to wear umushanana', topic: 'traditional' },
  { emoji: '📸', title: 'Photograph clothes with a phone', topic: 'business' },
];

/**
 * The row of Learn topics: Challenges, All, each topic, Teach. A row of its own above the lessons, never laid over a
 * video. In the feed (`onTopic`) a topic filters in place; on the Challenges page (`onChallenges`) Challenges is the
 * lit tab and a topic opens Learn on it.
 */
export function TopicBar({ topic = null, onTopic, challenge, onChallenges = false, className }: {
  topic?: string | null; onTopic?: (topic: string | null) => void; challenge?: string | null; onChallenges?: boolean; className?: string;
}) {
  const tr = useT();
  const on = useFeatures();
  // Challenges that are open now: their number sits on the Challenges tab, so people see there is one to join.
  const challenges = useChallenges();
  const openChallenges = challenges?.filter((c) => c.open).length ?? 0;
  // Every topic visible at once, evenly spread: an icon with its whole name underneath (like the Seller Center tabs).
  // Each tab is as wide as its name and the space left is shared between them, so the row fits a phone and fills a
  // computer's wider player (a longer translation can still slide sideways rather than be cut).
  const tab = 'group flex shrink-0 flex-col items-center gap-1 rounded-xl px-0 py-1 text-[10px] font-semibold leading-none tracking-tight outline-none transition focus-visible:ring-2 focus-visible:ring-primary md:text-xs md:tracking-normal';
  const dot = 'flex h-9 w-9 items-center justify-center rounded-full transition md:h-10 md:w-10';
  const label = 'whitespace-nowrap text-center';
  const lit = (active: boolean) => cn(dot, active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground group-hover:bg-muted/70');
  const topicTab = (value: string | null, Icon: typeof Trophy, name: string, title: string) => {
    const active = !onChallenges && topic === value;
    const body = (
      <>
        <span className={lit(active)}><Icon className="h-4 w-4 md:h-5 md:w-5" /></span>
        <span className={cn(label, active && 'text-primary')}>{tr(name)}</span>
      </>
    );
    return onTopic ? (
      <button key={value ?? 'all'} type="button" onClick={() => onTopic(value)} className={tab} aria-pressed={active} title={tr(title)}>{body}</button>
    ) : (
      <Link key={value ?? 'all'} href={value ? `/learn?topic=${value}` : '/learn'} className={tab} title={tr(title)}>{body}</Link>
    );
  };
  return (
    <nav className={cn('z-20 flex shrink-0 items-start justify-between gap-0 overflow-x-auto border-b bg-background/95 px-1.5 py-1.5 backdrop-blur [scrollbar-width:none] md:gap-2 md:px-6 md:py-2 [&::-webkit-scrollbar]:hidden', className)} aria-label={tr('Topics')}>
      {!challenge && on('challenges') && (
        <Link href="/challenges" className={tab} title={tr('Challenges')} aria-current={onChallenges ? 'page' : undefined}>
          <span className={cn(dot, 'relative bg-amber-400 text-black', onChallenges && 'ring-2 ring-amber-500 ring-offset-2 ring-offset-background')}>
            <Trophy className="h-4 w-4 md:h-5 md:w-5" />
            {openChallenges > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{openChallenges}</span>}
          </span>
          <span className={cn(label, onChallenges && 'text-amber-600')}>{tr('Challenges')}</span>
        </Link>
      )}
      {topicTab(null, LayoutGrid, 'All', 'All')}
      {LESSON_TOPICS.map((t) => topicTab(t.value, t.icon, SHORT[t.value] ?? t.label, t.label))}
      <Link href={challenge ? `/learn/new?challenge=${challenge}` : '/learn/new'} className={tab} title={tr('Teach a lesson')}>
        <span className={cn(dot, 'bg-foreground text-background shadow-sm')}><Plus className="h-4 w-4 md:h-5 md:w-5" /></span>
        <span className={label}>{tr('Teach')}</span>
      </Link>
    </nav>
  );
}

/** Community lessons as a full-screen feed, with topic icons on top and a button to teach. */
export function LessonFeed({ startAt, following, challenge, initialTopic = null, className, breakReminder = true, onLessons }: { startAt?: string | null; following?: boolean; challenge?: string | null; initialTopic?: string | null; className?: string; breakReminder?: boolean; onLessons?: (lessons: Lesson[]) => void }) {
  const [topic, setTopic] = useState<string | null>(LESSON_TOPICS.some((t) => t.value === initialTopic) ? initialTopic : null);
  const tr = useT();
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

  return (
    <div className={cn('relative flex h-full flex-col', className)}>
      <TopicBar topic={topic} onTopic={setTopic} challenge={challenge} />
      <div className="min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {lessons === null ? (
          <Skeleton className="h-full w-full rounded-none" />
        ) : lessons.length === 0 ? (
          // No lessons yet: invite people to be the first teacher, with ideas, and suggest shops/teachers to follow.
          <div className="flex h-full flex-col items-center justify-start gap-4 overflow-y-auto bg-muted p-5 pt-10 text-center [scrollbar-width:none] [&>*]:shrink-0 md:gap-5 md:px-8 md:pt-14 [&::-webkit-scrollbar]:hidden">
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
          // Learning ads sit between lessons: never before the third, then one every five (LEARN_AD_*), so they never
          // cut into a lesson and never come one after another.
          [...lessons.flatMap((l, i) => {
            const slide = <LessonSlide key={l.id} lesson={l} />;
            const adHere = i >= LEARN_AD_FIRST && (i - LEARN_AD_FIRST) % LEARN_AD_EVERY === 0 && i < lessons.length - 1;
            return adHere ? [slide, <LessonAdSlide key={`ad-${l.id}`} afterLesson={l.id} />] : [slide];
          }), <CaughtUp key="caught-up" />]
        )}
      </div>
      {breakReminder && <BreakReminder />}
    </div>
  );
}
