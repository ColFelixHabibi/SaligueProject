'use client';

import { VerifiedBadge } from '@/components/verified-badge';

import { useFeatures } from '@/lib/features';

import { useT } from '@/lib/i18n';

import { TipButton } from '@/components/tip-button';

import { useEffect, useRef, useState } from 'react';
import { Captions, Clock, Coins, Columns2, Flag, Trophy, Heart, MessageCircle, Play, Share2, Sparkles, Trash2, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { LessonComments } from '@/components/community/lesson-comments';
import { CaptionsEditor } from '@/components/community/captions-editor';
import { useLang } from '@/lib/i18n';
import { ExpandableText } from '@/components/expandable-text';
import Link from 'next/link';
import { ProfileAvatar, profileHref } from '@/components/profile-avatar';
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
  // A duet: the lesson it answers plays beside it, in step, without sound.
  const original = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [like, setLike] = useState({ liked: lesson.liked, count: lesson.likeCount });
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [captionsOpen, setCaptionsOpen] = useState(false);
  // Captions: on unless the viewer turned them off; in the app's language when there is one, else the lesson's.
  const lang = useLang();
  const [cc, setCc] = useState(true);
  useEffect(() => {
    try { setCc(localStorage.getItem('saligue-cc') !== 'off'); } catch { /* storage blocked */ }
  }, []);
  const tracks = lesson.captions ?? [];
  const chosen = tracks.find((c) => c.lang === lang) ?? tracks.find((c) => c.lang === lesson.language) ?? tracks[0];
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const apply = () => { for (const t of Array.from(v.textTracks)) t.mode = cc && t.language === chosen?.lang ? 'showing' : 'disabled'; };
    apply();
    v.textTracks.addEventListener?.('addtrack', apply);
    return () => v.textTracks.removeEventListener?.('addtrack', apply);
  }, [cc, chosen?.lang, chosen?.url]);
  const toggleCc = () => {
    setCc((on) => {
      try { localStorage.setItem('saligue-cc', on ? 'off' : 'on'); } catch { /* storage blocked */ }
      return !on;
    });
  };
  const t = useT();
  const on = useFeatures();
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
          crossOrigin="anonymous"
          onPlay={() => { setPlaying(true); if (original.current) { original.current.currentTime = video.current?.currentTime ?? 0; original.current.play().catch(() => {}); } }}
          onPause={() => { setPlaying(false); original.current?.pause(); }}
          onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play().catch(() => {}) : e.currentTarget.pause())}
          className={cn('absolute inset-y-0 h-full object-contain', lesson.duetOf ? 'right-0 w-1/2 object-cover' : 'inset-x-0 w-full')}
          aria-label={lesson.title}
        >
          {tracks.map((c) => <track key={c.url} kind="subtitles" src={c.url} srcLang={c.lang} label={c.translated ? 'English (translated)' : c.lang} default={c === chosen} />)}
        </video>
      )}
      {lesson.duetOf && (
        <>
          <video ref={original} src={lesson.duetOf.video} poster={lesson.duetOf.poster ?? undefined} muted loop playsInline preload={saver ? 'none' : 'metadata'}
            className="absolute inset-y-0 left-0 h-full w-1/2 border-r-2 border-black object-cover" aria-label={lesson.duetOf.title} />
          <Link href={`/learn?lesson=${lesson.duetOf.id}`} className="absolute left-2 top-28 z-10 flex max-w-[45%] items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[11px] font-semibold">
            <Columns2 className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{lesson.duetOf.authorName}</span>
          </Link>
        </>
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
        <ProfileAvatar id={lesson.authorId} name={lesson.authorName} src={lesson.authorAvatar} />
        <button type="button" className="flex flex-col items-center gap-1 text-xs font-semibold text-white" aria-label="Like" aria-pressed={like.liked}
          onClick={() => run(async () => { const r = await likeLesson(lesson.id); setLike({ liked: r.liked, count: r.likeCount }); })}>
          <span className={round}><Heart className={cn('h-5 w-5 text-foreground', like.liked && 'fill-primary text-primary')} /></span>
          {like.count > 0 && like.count}
        </button>
        {on('comments') && <button type="button" className="flex flex-col items-center gap-1 text-xs font-semibold text-white" aria-label="Comments and questions" onClick={() => setCommentsOpen(true)}>
          <span className={round}><MessageCircle className="h-5 w-5 text-foreground" /></span>
          {(lesson.commentCount ?? 0) > 0 && lesson.commentCount}
        </button>}
        {!lesson.mine && on('tips') && <TipButton toUserId={lesson.authorId} toName={lesson.authorName} lessonId={lesson.id} className={round}><Coins className="h-5 w-5 text-amber-500" /></TipButton>}
        {!lesson.mine && !lesson.duetOf && on('duets') && (
          <Link href={`/learn/new?duet=${lesson.id}`} className="flex flex-col items-center gap-1 text-xs font-semibold text-white" aria-label="Duet: answer with your video" title="Duet">
            <span className={round}><Columns2 className="h-5 w-5 text-foreground" /></span>
            {(lesson.duetCount ?? 0) > 0 && lesson.duetCount}
          </Link>
        )}
        {(tracks.length > 0 || lesson.mine) && (
          <button type="button" className={cn(round, cc && tracks.length > 0 && 'bg-primary text-primary-foreground')} onClick={lesson.mine ? () => setCaptionsOpen(true) : toggleCc}
            aria-label={lesson.mine ? 'Captions' : cc ? 'Captions off' : 'Captions on'} aria-pressed={cc} title="Captions">
            <Captions className="h-5 w-5" />
          </button>
        )}
        <button type="button" className={round} onClick={share} aria-label="Share" title="Share"><Share2 className="h-5 w-5" /></button>
        {lesson.mine || user?.uid === lesson.authorId ? (
          <button type="button" className={round} aria-label="Delete lesson" title="Delete" onClick={() => confirm('Delete this lesson?') && run(() => deleteLesson(lesson.id), 'Lesson deleted')}><Trash2 className="h-5 w-5 text-destructive" /></button>
        ) : (
          <button type="button" className={round} aria-label="Report: not fashion or not OK" title="Report" onClick={() => run(() => reportLesson(lesson.id, 'not_fashion'), 'Thank you for reporting')}><Flag className="h-5 w-5" /></button>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-4 pr-20 pt-20">
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5"><TopicIcon className="h-3.5 w-3.5" /> {t(topic.label)}</span>
          {lesson.duration != null && <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5"><Clock className="h-3.5 w-3.5" /> {formatLength(lesson.duration)}</span>}
          {lesson.rank != null && lesson.rank <= 3 && <span className="inline-flex items-center rounded-full bg-amber-400 px-2 py-0.5 text-black">{['🥇', '🥈', '🥉'][lesson.rank - 1]} #{lesson.rank}</span>}
          {lesson.challenge && (
            <Link href={`/challenge?id=${lesson.challenge.id}`} className="inline-flex max-w-[60%] items-center gap-1 rounded-full bg-amber-400/90 px-2 py-0.5 text-black">
              <Trophy className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{lesson.challenge.title}</span>
            </Link>
          )}
          {lesson.newVoice && <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5" title="Saligue gives new teachers a fair chance to be seen"><Sparkles className="h-3.5 w-3.5" /> {t('New voice')}</span>}
        </div>
        <h2 className="line-clamp-2 text-xl font-bold leading-tight">{lesson.title}</h2>
        {lesson.description && <ExpandableText text={lesson.description} lines={1} className="mt-1 text-sm text-white/85 [&_button]:text-white" />}
        <Link href={profileHref(lesson.authorId)} className="mt-2 flex w-fit max-w-full items-center gap-1 truncate text-sm font-semibold hover:underline">@{lesson.authorName}{lesson.authorVerified && <VerifiedBadge />}</Link>
      </div>
      <Sheet open={captionsOpen} onOpenChange={setCaptionsOpen}>
        <SheetContent side="bottom" className="flex h-[75vh] flex-col rounded-t-3xl">
          <SheetHeader><SheetTitle className="text-left">Captions</SheetTitle></SheetHeader>
          <div className="mt-3 min-h-0 flex-1"><CaptionsEditor lesson={lesson} onSaved={() => setCaptionsOpen(false)} /></div>
          {tracks.length > 0 && <Button variant="outline" className="mt-2" onClick={toggleCc}>{cc ? 'Hide captions on my screen' : 'Show captions'}</Button>}
        </SheetContent>
      </Sheet>
      <Sheet open={commentsOpen} onOpenChange={setCommentsOpen}>
        <SheetContent side="bottom" className="flex h-[75vh] flex-col rounded-t-3xl">
          <SheetHeader><SheetTitle className="line-clamp-1 text-left">{lesson.title}</SheetTitle></SheetHeader>
          <div className="mt-3 min-h-0 flex-1"><LessonComments lesson={lesson} /></div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
