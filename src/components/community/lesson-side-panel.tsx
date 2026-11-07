'use client';

import Link from 'next/link';
import { GraduationCap, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatLength } from '@/components/video-field';
import { useT } from '@/lib/i18n';
import type { Lesson } from '@/lib/lessons';

/**
 * Computers: the lessons themselves are a full-screen column, so this sits beside it (like the feed's panel on
 * For You) instead of leaving a phone-width strip of video in the middle of a big empty page: how to teach, and
 * the lessons offered right now, each one a tap away.
 */
export function LessonSidePanel({ lessons }: { lessons: Lesson[] | null }) {
  const t = useT();
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-2xl border bg-card p-4 shadow-sm">
        <p className="flex items-center gap-2 font-bold"><GraduationCap className="h-5 w-5 text-primary" /> {t('Teach a lesson')}</p>
        <Button asChild className="w-full rounded-full">
          <Link href="/learn/new"><Plus className="mr-1.5 h-4 w-4" /> {t('Teach a lesson')}</Link>
        </Button>
      </div>

      {lessons && lessons.length > 0 && (
        <section className="space-y-2">
          <p className="flex items-center gap-2 font-bold"><GraduationCap className="h-5 w-5 text-primary" /> {t('Lessons')}</p>
          <ul className="space-y-2">
            {lessons.slice(0, 12).map((lesson) => (
              // Tapping one plays that lesson: the feed below scrolls to it (same card, no page reload).
              <li key={lesson.id}>
                <Link href={`/learn?lesson=${lesson.id}`} scroll={false} className="group flex items-center gap-3 rounded-xl border bg-card p-2 transition hover:bg-muted">
                  <span className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md bg-muted">
                    {lesson.poster && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={lesson.poster} alt="" loading="lazy" className="h-full w-full object-cover" />
                    )}
                    {lesson.duration != null && (
                      <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[10px] font-bold text-white">{formatLength(lesson.duration)}</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-semibold leading-snug group-hover:underline">{lesson.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">@{lesson.authorName}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
