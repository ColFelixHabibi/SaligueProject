'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CircleFadingPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StoryViewer } from '@/components/social/story-viewer';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { getStory, type StoryGroup } from '@/lib/stories';

/** A shared status: opens straight onto it while it lasts (24 hours), then says it has gone. */
function StatusView() {
  const t = useT();
  const router = useRouter();
  const id = useSearchParams().get('id') ?? '';
  const [group, setGroup] = useState<StoryGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (id) getStory(id).then(setGroup).catch((e) => setError(friendlyError(e)));
  }, [id]);
  if (error || !id) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-6 py-20 text-center">
        <CircleFadingPlus className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">{error ?? t('This status has gone. Statuses last 24 hours.')}</p>
        <Button asChild className="rounded-full"><Link href="/">{t('Open Saligue')}</Link></Button>
      </div>
    );
  }
  if (!group) return <Skeleton className="mx-auto h-[80vh] max-w-md" />;
  return <StoryViewer group={group} onClose={() => (window.history.length > 1 ? router.back() : router.push('/'))} />;
}

export default function StatusPage() {
  return (
    <Suspense>
      <StatusView />
    </Suspense>
  );
}
