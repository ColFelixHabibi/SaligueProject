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
  // The list of lessons only fits beside a big player from 1280 px; below that the player gets the whole width.
  const wide = useWide(1280);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  return (
    // A phone gets the full-screen feed on its own. A computer gets a big player that grows with the screen (portrait
    // lessons fill its height, landscape General studies fill its width), with the lesson list beside it when it fits.
    <div className="md:flex md:h-dvh md:justify-center md:gap-6 md:bg-muted/50 md:px-6">
      <LessonFeed
        startAt={params.get('lesson')}
        onLessons={setLessons}
        className="mx-auto h-[calc(100dvh-8rem-var(--sat)-var(--sab))] max-w-md md:mx-0 md:h-dvh md:min-w-0 md:max-w-[56rem] md:flex-1 md:shadow-xl"
      />
      {wide && (
        <aside className="hidden h-dvh w-80 shrink-0 overflow-y-auto overflow-x-hidden py-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:block 2xl:w-96">
          <LessonSidePanel lessons={lessons} />
        </aside>
      )}
    </div>
  );
}

// Community: fashion lessons by anyone (styling, sewing & care, traditional, business), up to 4 min 30 s each; General studies up to 10 min.
export default function LearnPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-[80vh] max-w-md md:max-w-[56rem]" />}>
      <Learn />
    </Suspense>
  );
}
