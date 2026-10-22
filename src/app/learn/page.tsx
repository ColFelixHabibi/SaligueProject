'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { LessonFeed } from '@/components/community/lesson-feed';

function Learn() {
  const params = useSearchParams();
  return <LessonFeed startAt={params.get('lesson')} className="mx-auto h-[calc(100dvh-4rem-4rem)] max-w-md md:h-dvh" />;
}

// Community: fashion lessons by anyone (styling, sewing, care, fashion business), up to 4 min 30 s each.
export default function LearnPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-[80vh] max-w-md" />}>
      <Learn />
    </Suspense>
  );
}
