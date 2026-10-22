'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Plus, Trophy, Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { LessonFeed } from '@/components/community/lesson-feed';
import { friendlyError } from '@/lib/errors';
import { getChallenge, timeLeft, type Challenge } from '@/lib/lessons';

/** One challenge: its rules and deadline, then the entries ranked by likes (top 3 get medals). */
function ChallengeView() {
  const id = useSearchParams().get('id');
  const [c, setC] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (id) getChallenge(id).then(setC).catch((e) => setError(friendlyError(e)));
  }, [id]);
  if (error || !id) return <p className="p-10 text-center text-muted-foreground">{error ?? 'This challenge does not exist.'}</p>;
  if (!c) return <Skeleton className="mx-auto h-[80vh] max-w-md" />;
  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem-4rem)] max-w-md flex-col md:h-dvh">
      <div className="space-y-1 bg-gradient-to-r from-amber-300 to-amber-200 p-3 text-amber-950">
        <div className="flex items-center gap-2">
          <Link href="/challenges" aria-label="All challenges"><ArrowLeft className="h-5 w-5" /></Link>
          <Trophy className="h-5 w-5" />
          <h1 className="min-w-0 flex-1 truncate font-extrabold">{c.title}</h1>
          {c.open && <Link href={`/learn/new?challenge=${c.id}`} className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground"><Plus className="h-4 w-4" /> Join</Link>}
        </div>
        <p className="flex items-center gap-3 text-xs font-semibold"><span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {c.entries}</span> <span>{timeLeft(c.endsAt)}</span></p>
        {c.description && <p className="line-clamp-2 text-xs">{c.description}</p>}
      </div>
      <LessonFeed challenge={c.id} className="min-h-0 flex-1" />
    </div>
  );
}

export default function ChallengePage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-[80vh] max-w-md" />}>
      <ChallengeView />
    </Suspense>
  );
}
