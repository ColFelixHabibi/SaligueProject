'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Plus, Trophy, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LessonFeed } from '@/components/community/lesson-feed';
import { useWide } from '@/hooks/use-wide';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { getChallenge, timeLeft, type Challenge } from '@/lib/lessons';

/** The challenge in full, beside the entries on a computer: what it is, how long is left, and how to enter. */
function ChallengePanel({ c }: { c: Challenge }) {
  const t = useT();
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-2xl border bg-card p-4 shadow-sm">
        <p className="flex items-center gap-2 font-bold"><Trophy className="h-5 w-5 text-amber-500" /> <span className="min-w-0 flex-1 truncate">{c.title}</span></p>
        <p className="text-sm text-muted-foreground">{c.description || t('A theme and a deadline. Anyone joins with a short lesson video.')}</p>
        <p className="flex items-center gap-3 text-sm font-semibold"><span className="flex items-center gap-1"><Users className="h-4 w-4" /> {c.entries}</span> <span className="text-muted-foreground">{timeLeft(c.endsAt)}</span></p>
        {c.open && (
          <Button asChild className="w-full rounded-full">
            <Link href={`/learn/new?challenge=${c.id}`}><Plus className="mr-1.5 h-4 w-4" /> {t('Join')}</Link>
          </Button>
        )}
        <Link href="/challenges" className="block text-sm font-semibold text-primary hover:underline">{t('All challenges')}</Link>
      </div>
      <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground shadow-sm">{t('The top three entries win, and everyone can watch and vote with likes.')}</p>
    </div>
  );
}

/** One challenge: its rules and deadline, then the entries ranked by likes (top 3 get medals). */
function ChallengeView() {
  const id = useSearchParams().get('id');
  const wide = useWide();
  const t = useT();
  const [c, setC] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (id) getChallenge(id).then(setC).catch((e) => setError(friendlyError(e)));
  }, [id]);
  if (error || !id) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-10 text-center text-muted-foreground">
        <p>{error ?? 'This challenge does not exist.'}</p>
        <Button asChild variant="outline" className="rounded-full"><Link href="/challenges">{t('All challenges')}</Link></Button>
      </div>
    );
  }
  if (!c) return <Skeleton className="mx-auto h-[80vh] max-w-md" />;
  return (
    // Phone: entries fill the screen. Computer: the same column, with the challenge and its deadline beside it.
    <div className="lg:flex lg:h-dvh lg:justify-center lg:gap-6 lg:bg-muted/50 lg:px-6">
      <div className="mx-auto flex h-[calc(100dvh-8rem-var(--sat)-var(--sab))] max-w-md flex-col md:h-dvh lg:mx-0 lg:w-[28rem] lg:shrink-0 lg:shadow-xl">
        <div className="space-y-1 bg-gradient-to-r from-amber-300 to-amber-200 p-3 text-amber-950">
          <div className="flex items-center gap-2">
            <Link href="/challenges" aria-label={t('All challenges')}><ArrowLeft className="h-5 w-5" /></Link>
            <Trophy className="h-5 w-5" />
            <h1 className="min-w-0 flex-1 truncate font-extrabold">{c.title}</h1>
            {c.open && <Link href={`/learn/new?challenge=${c.id}`} className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground"><Plus className="h-4 w-4" /> {t('Join')}</Link>}
          </div>
          <p className="flex items-center gap-3 text-xs font-semibold"><span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {c.entries}</span> <span>{timeLeft(c.endsAt)}</span></p>
          {c.description && <p className="line-clamp-2 text-xs">{c.description}</p>}
        </div>
        <LessonFeed challenge={c.id} className="min-h-0 flex-1" />
      </div>
      {wide && (
        <aside className="hidden h-dvh w-[22rem] shrink-0 overflow-y-auto overflow-x-hidden py-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:block xl:w-[26rem]">
          <ChallengePanel c={c} />
        </aside>
      )}
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
