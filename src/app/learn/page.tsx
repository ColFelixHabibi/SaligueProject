'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { LessonFeed } from '@/components/community/lesson-feed';
import { LessonSidePanel } from '@/components/community/lesson-side-panel';
import { useWide } from '@/hooks/use-wide';
import type { Lesson } from '@/lib/lessons';

function Learn() {
  const params = useSearchParams();
  const wide = useWide();
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  return (
    // A phone gets the full-screen feed on its own; a computer gets the same feed as a column with room beside it,
    // so the page is not a narrow strip of video in the middle of empty space.
    <div className="lg:flex lg:h-dvh lg:justify-center lg:gap-6 lg:bg-muted/50 lg:px-6">
      <LessonFeed
        startAt={params.get('lesson')}
        onLessons={setLessons}
        className="mx-auto h-[calc(100dvh-8rem-var(--sat)-var(--sab))] max-w-md md:h-dvh lg:mx-0 lg:w-[28rem] lg:shrink-0 lg:shadow-xl"
      />
      {wide && (
        <aside className="hidden h-dvh w-[22rem] shrink-0 overflow-y-auto py-6 lg:block xl:w-[26rem]">
          <LessonSidePanel lessons={lessons} />
        </aside>
      )}
    </div>
  );
}

// Community: fashion lessons by anyone (styling, sewing & care, traditional, business), up to 4 min 30 s each; General studies up to 10 min.
export default function LearnPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-[80vh] max-w-md lg:w-[28rem]" />}>
      <Learn />
    </Suspense>
  );
}
