'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Radio, Repeat2, Users } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { LiveStage } from '@/components/live/live-parts';
import { SellerAvatar } from '@/components/seller-avatar';
import { useToast } from '@/hooks/use-toast';
import { useDataSaver } from '@/lib/data-saver';
import { friendlyError } from '@/lib/errors';
import { repostLive, useLiveRoom, type Live } from '@/lib/live';

/**
 * A live as a full slide in For You: a silent, moving preview of the stage (host and guests as viewers see them)
 * while the slide fills the screen, then "Tap to watch LIVE" opens it with sound. It only connects while in view,
 * and with Data saver on it shows the cover instead. People can switch these slides off (Settings → Lives in For You).
 */
export function LiveSlide({ live }: { live: Live }) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  const saver = useDataSaver();
  const { user } = useAuth();
  const { toast } = useToast();
  const [reposted, setReposted] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.intersectionRatio >= 0.6), { threshold: [0, 0.6] });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const { tiles, viewers } = useLiveRoom(live.id, inView && !saver, false);
  const repost = async () => {
    try {
      await repostLive(live.id);
      setReposted(true);
      toast({ title: 'Reposted to your followers', description: 'They are told this live is on.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Not reposted', description: friendlyError(err) });
    }
  };
  const href = `/live/watch?id=${live.id}`;
  return (
    <section ref={ref} data-feed-live={live.id} className="relative flex h-full snap-start snap-always flex-col overflow-hidden bg-black text-white">
      <Link href={href} className="relative block min-h-0 flex-1" aria-label={`Watch ${live.sellerName} live: ${live.title}`}>
        <LiveStage tiles={inView && !saver ? tiles : []} silent cover={live.cover ?? live.thumbnail} fill={live.videoFit === 'fill'} layout={live.layout} waiting="" />
        <span className="absolute left-3 top-[calc(4.5rem+var(--sat))] flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 text-xs font-extrabold tracking-wide">
          <Radio className="h-3.5 w-3.5" /> LIVE
        </span>
        {viewers > 0 && <span className="absolute right-3 top-[calc(4.5rem+var(--sat))] flex items-center gap-1 rounded-md bg-black/50 px-2 py-1 text-xs font-semibold"><Users className="h-3.5 w-3.5" /> {viewers}</span>}
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-gradient-to-t from-black/80 to-transparent pb-4 pt-16 text-base font-bold">
          <span className="flex h-4 items-end gap-0.5" aria-hidden><span className="h-2 w-1 animate-pulse bg-white" /><span className="h-4 w-1 animate-pulse bg-white [animation-delay:150ms]" /><span className="h-3 w-1 animate-pulse bg-white [animation-delay:300ms]" /></span>
          Tap to watch LIVE
        </span>
      </Link>
      <div className="space-y-2 bg-black px-4 pb-[calc(5.5rem+var(--sab))] pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-pink-600 px-2 py-0.5 text-xs font-bold">LIVE now</span>
          {user && (
            <button type="button" onClick={repost} disabled={reposted} className="flex items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 text-xs font-semibold disabled:opacity-60">
              <Repeat2 className="h-3.5 w-3.5" /> {reposted ? 'Reposted' : 'Repost to followers'}
            </button>
          )}
        </div>
        <Link href={href} className="flex items-center gap-2">
          <SellerAvatar src={live.sellerAvatar} name={live.sellerName} className="h-9 w-9" />
          <span className="min-w-0">
            <span className="block truncate font-bold">{live.sellerName}</span>
            <span className="block truncate text-sm text-white/80">{live.title}</span>
          </span>
        </Link>
      </div>
    </section>
  );
}
