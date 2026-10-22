'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock, Flag, Heart, Play, Share2, Sparkles, Trash2, Volume2, VolumeX } from 'lucide-react';
import { ExpandableText } from '@/components/expandable-text';
import { FollowButton } from '@/components/follow-button';
import { SellerAvatar } from '@/components/seller-avatar';
import { formatLength } from '@/components/video-field';
import { useSoundStore } from '@/hooks/use-sound';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/auth-provider';
import { useDataSaver } from '@/lib/data-saver';
import { friendlyError } from '@/lib/errors';
import { deleteLesson, likeLesson, reportLesson, topicOf, viewLesson, type Lesson } from '@/lib/lessons';
import { absoluteUrl } from '@/lib/paths';
import { cn } from '@/lib/utils';

/** One full-screen lesson: plays while on screen (or on tap with Data saver), like, share, follow the teacher. */
export function LessonSlide({ lesson }: { lesson: Lesson }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const saver = useDataSaver();
  const { soundOn, unlocked, toggle } = useSoundStore();
  const slide = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [like, setLike] = useState({ liked: lesson.liked, count: lesson.likeCount });
  const topic = topicOf(lesson.topic);
  const TopicIcon = topic.icon;

  useEffect(() => {
    const el = slide.current;
    if (!el) return;
    const observer = new IntersectionObserver(([e]) => setVisible(e.intersectionRatio >= 0.6), { threshold: [0, 0.6] });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Plays while on screen, unless Data saver is on (then it waits for a tap).
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (visible && !saver) v.play().catch(() => {});
    if (!visible) v.pause();
  }, [visible, saver]);
  useEffect(() => {
    if (video.current) video.current.muted = !(soundOn && unlocked);
  }, [soundOn, unlocked]);
  // A view counts after 3 seconds on screen.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => void viewLesson(lesson.id), 3000);
    return () => clearTimeout(t);
  }, [visible, lesson.id]);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast({ title: done });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) });
    }
  };
  const share = async () => {
    const url = absoluteUrl(`/learn?lesson=${lesson.id}`);
    try {
      if (navigator.share) await navigator.share({ title: lesson.title, text: `${lesson.title} · a fashion lesson on Saligue`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast({ title: 'Link copied' });
      }
    } catch {
      // Cancelled.
    }
  };
  const round = 'flex h-11 w-11 items-center justify-center rounded-full bg-background/90 shadow transition active:scale-90';

  return (
    <section ref={slide} id={`lesson-${lesson.id}`} className="relative flex h-full snap-start snap-always flex-col overflow-hidden bg-black text-white">
      {lesson.video && (
        <video
          ref={video}
          src={lesson.video}
          poster={lesson.poster ?? undefined}
          loop
          muted
          playsInline
          preload={saver ? 'none' : 'metadata'}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play().catch(() => {}) : e.currentTarget.pause())}
          className="absolute inset-0 h-full w-full object-contain"
          aria-label={lesson.title}
        />
      )}
      {!playing && (
        <button type="button" onClick={() => video.current?.play().catch(() => {})} className="absolute left-1/2 top-1/2 z-10 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 backdrop-blur" aria-label="Play">
          <Play className="h-8 w-8 fill-white" />
        </button>
      )}

      <button type="button" onClick={toggle} className="absolute right-3 top-28 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/45" aria-label={soundOn ? 'Sound off' : 'Sound on'}>
        {soundOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
      </button>

      <div className="absolute bottom-6 right-3 z-10 flex flex-col items-center gap-4 text-foreground">
        <button type="button" className="flex flex-col items-center gap-1 text-xs font-semibold text-white" aria-label="Like" aria-pressed={like.liked}
          onClick={() => run(async () => { const r = await likeLesson(lesson.id); setLike({ liked: r.liked, count: r.likeCount }); })}>
          <span className={round}><Heart className={cn('h-5 w-5 text-foreground', like.liked && 'fill-primary text-primary')} /></span>
          {like.count > 0 && like.count}
        </button>
        <button type="button" className={round} onClick={share} aria-label="Share" title="Share"><Share2 className="h-5 w-5" /></button>
        {lesson.mine || user?.uid === lesson.authorId ? (
          <button type="button" className={round} aria-label="Delete lesson" title="Delete" onClick={() => confirm('Delete this lesson?') && run(() => deleteLesson(lesson.id), 'Lesson deleted')}><Trash2 className="h-5 w-5 text-destructive" /></button>
        ) : (
          <button type="button" className={round} aria-label="Report: not fashion or not OK" title="Report" onClick={() => run(() => reportLesson(lesson.id, 'not_fashion'), 'Thank you for reporting')}><Flag className="h-5 w-5" /></button>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-4 pr-20 pt-20">
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5"><TopicIcon className="h-3.5 w-3.5" /> {topic.label}</span>
          {lesson.duration != null && <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5"><Clock className="h-3.5 w-3.5" /> {formatLength(lesson.duration)}</span>}
          {lesson.newVoice && <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5" title="Saligue gives new teachers a fair chance to be seen"><Sparkles className="h-3.5 w-3.5" /> New voice</span>}
        </div>
        <h2 className="line-clamp-2 text-xl font-bold leading-tight">{lesson.title}</h2>
        {lesson.description && <ExpandableText text={lesson.description} lines={1} className="mt-1 text-sm text-white/85 [&_button]:text-white" />}
        <div className="mt-2 flex items-center gap-2">
          <SellerAvatar src={lesson.authorAvatar} name={lesson.authorName} className="h-8 w-8 ring-2 ring-white/70" />
          <span className="truncate text-sm font-semibold">{lesson.authorName}</span>
          {!lesson.mine && <FollowButton sellerId={lesson.authorId} onDark className="h-7 px-3 text-xs" />}
        </div>
      </div>
    </section>
  );
}
