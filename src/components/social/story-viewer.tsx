'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, BellOff, Eye, Mic, Pause, Play, Send, Trash2, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { productHref } from '@/lib/links';
import { formatPrice } from '@/lib/orders';
import { deleteStory, hoursLeft, markStorySeen, muteStatuses, replyToStory, storyPhoto, storyVoice, type StoryGroup } from '@/lib/stories';

/** How long a photo stays on screen before the next one, like any status app. */
const PHOTO_MS = 5000;

const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';

/**
 * One person's stories, played full screen: the bars at the top, tap the right half for the next one and the left
 * half for the one before. A voice status plays its sound, moves on when the sound ends, and holds still while a
 * finger is down. Your own stories show how many people watched and can be taken down early; someone else's can be
 * answered, which reaches them as a notification.
 */
export function StoryViewer({ group, onClose, onChanged }: { group: StoryGroup; onClose: () => void; onChanged?: () => void }) {
  const { toast } = useToast();
  const t = useT();
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [playing, setPlaying] = useState(false);
  // The server only says how many watched on your own stories, so that is how this one knows whose it is.
  const mine = group.stories.some((s) => s.views !== undefined);
  const story = group.stories[index];
  const photo = story ? storyPhoto(story) : null;
  const voice = story ? storyVoice(story) : null;
  const sound = useRef<HTMLAudioElement>(null);
  // A finger held down pauses a voice status. The click that follows a real hold must not move on, so it is eaten
  // (a quick tap is left alone: that is still "next" or "previous").
  const holding = useRef(false);
  const heldAt = useRef(0);
  const swallow = useRef(false);
  // How long a voice status runs, in whole seconds, for the number under the play button.
  const spoken = Math.max(1, Math.round(story?.seconds ?? 30));

  // Watching it counts as seen, and it moves on by itself.
  useEffect(() => {
    if (!story) {
      onClose();
      return;
    }
    void markStorySeen(story.id);
    onChanged?.();
    setProgress(0);
    setPlaying(false);
    // A voice status moves on when the sound ends, so there the sound fills the bar and not a timer.
    if (story.kind === 'voice') return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const pct = Math.min(100, ((Date.now() - started) / PHOTO_MS) * 100);
      setProgress(pct);
      if (pct < 100) return;
      window.clearInterval(timer);
      if (index + 1 < group.stories.length) setIndex(index + 1);
      else onClose();
    }, 100);
    return () => window.clearInterval(timer);
  }, [index, story?.id]);

  if (!story) return null;

  // True once, for the click that a hold leaves behind: that click must not also move on.
  const eatsTheClick = () => {
    if (!swallow.current) return false;
    swallow.current = false;
    return true;
  };

  const back = () => {
    if (eatsTheClick() || index === 0) return;
    setIndex(index - 1);
  };
  const forward = () => {
    if (eatsTheClick()) return;
    if (index + 1 < group.stories.length) setIndex(index + 1);
    else onClose();
  };
  const close = () => {
    if (eatsTheClick()) return;
    onClose();
  };

  /** The play button (and the middle of a voice status) stops and starts the sound. */
  const toggleSound = () => {
    if (eatsTheClick()) return;
    const player = sound.current;
    if (!player) return;
    if (player.paused) void player.play().catch(() => setPlaying(false));
    else player.pause();
  };

  /** A finger down on a voice status holds it: the sound stops, and starts again when the finger lifts. */
  const hold = () => {
    if (!voice) return;
    holding.current = true;
    heldAt.current = Date.now();
    sound.current?.pause();
  };
  const letGo = () => {
    if (!holding.current) return;
    holding.current = false;
    // A real hold (not a quick tap) eats the click it leaves behind; either way the sound comes back.
    if (Date.now() - heldAt.current >= 250) {
      swallow.current = true;
      window.setTimeout(() => (swallow.current = false), 400);
    }
    void sound.current?.play().catch(() => setPlaying(false));
  };

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      await replyToStory(story.id, reply.trim());
      setReply('');
      toast({ title: t('Reply sent'), description: `${t('It reached')} ${group.user.displayName}.` });
    } catch (error) {
      toast({ variant: 'destructive', title: t('Could not send that reply'), description: friendlyError(error) });
    } finally {
      setSending(false);
    }
  };

  const remove = async () => {
    try {
      await deleteStory(story.id);
      onChanged?.();
      if (index + 1 < group.stories.length) setIndex(index + 1);
      else onClose();
    } catch (error) {
      toast({ variant: 'destructive', title: t('Could not remove that story'), description: friendlyError(error) });
    }
  };

  /** Hides this person's ring from the bar, or brings it back. Their statuses are untouched and they are not told. */
  const toggleMuted = async () => {
    const muted = !group.user.muted;
    try {
      await muteStatuses(group.user.id, muted);
      toast({ title: t(muted ? 'Their statuses are hidden' : 'Their statuses are back') });
      // Muted means the ring is gone from the bar, so there is nothing left to watch here.
      if (muted) onClose();
      else onChanged?.();
    } catch (error) {
      toast({ variant: 'destructive', title: t('That did not work'), description: friendlyError(error) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      {/* The bars: one for each story, filling as it plays. */}
      <div className="flex gap-1 px-3 pt-3" aria-hidden="true">
        {group.stories.map((s, i) => (
          <span key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
            <span className="block h-full bg-white transition-none" style={{ width: `${i < index ? 100 : i === index ? progress : 0}%` }} />
          </span>
        ))}
      </div>

      <div className="flex items-center gap-3 px-3 py-2">
        <Avatar className="h-9 w-9">
          {group.user.avatar && <AvatarImage src={group.user.avatar} alt="" />}
          <AvatarFallback>{initials(group.user.displayName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{group.user.displayName}</p>
          <p className="text-xs text-white/70">{hoursLeft(story.expiresAt)} {t('left')}</p>
        </div>
        {mine && story.audience === 'close' && (
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px]" title={t('Only your close friends can see this')}>
            {t('Close friends')}
          </span>
        )}
        {mine && <span className="flex items-center gap-1 text-xs text-white/70"><Eye className="h-4 w-4" /> {story.views ?? 0}</span>}
        {mine && (
          <button onClick={remove} aria-label={t('Remove this story')} className="rounded-full p-2 hover:bg-white/10">
            <Trash2 className="h-5 w-5" />
          </button>
        )}
        {!mine && (
          // Their ring leaves this account's bar; their statuses themselves are untouched and they are not told.
          <button
            onClick={() => void toggleMuted()}
            aria-label={t(group.user.muted ? 'Show their statuses again' : 'Hide their statuses')}
            title={t(group.user.muted ? 'Show their statuses again' : 'Hide their statuses')}
            aria-pressed={!!group.user.muted}
            className="rounded-full p-2 hover:bg-white/10"
          >
            {group.user.muted ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
          </button>
        )}
        <button onClick={close} aria-label={t('Close')} className="rounded-full p-2 hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Holding a finger down on a voice status pauses it; letting go brings the sound back (see `hold`). */}
      <div
        className="relative flex-1 overflow-hidden"
        onPointerDown={hold}
        onPointerUp={letGo}
        onPointerCancel={letGo}
        onPointerLeave={letGo}
      >
        {voice ? (
          // A voice status: the words on the colour they were posted with, a play button, and the sound underneath.
          <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-8" style={{ backgroundColor: story.background }}>
            <audio
              key={story.id}
              ref={sound}
              src={voice}
              autoPlay
              playsInline
              preload="auto"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={forward}
              // A sound that will not play must not hold someone on a story: it moves on like a photo would.
              onError={forward}
              onTimeUpdate={(e) => {
                const player = e.currentTarget;
                const total = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : spoken;
                setProgress(Math.min(100, (player.currentTime / total) * 100));
              }}
              className="hidden"
            />
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15">
              <Mic className="h-8 w-8" />
            </span>
            {story.caption && <p className="max-w-xl whitespace-pre-wrap text-center text-2xl font-semibold leading-snug">{story.caption}</p>}
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={toggleSound}
                // The play button is its own control: a press on it must not read as a hold on the story.
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={t(playing ? 'Pause' : 'Play')}
                className="flex items-center gap-2 rounded-full bg-white/20 px-5 py-3 text-sm font-medium hover:bg-white/30"
              >
                {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                {t(playing ? 'Pause' : 'Play')}
              </button>
              <span className="h-1 w-40 overflow-hidden rounded-full bg-white/25" aria-hidden="true">
                <span className="block h-full bg-white" style={{ width: `${progress}%` }} />
              </span>
              <span className="text-xs text-white/70">
                {Math.floor(spoken / 60)}:{String(spoken % 60).padStart(2, '0')}
              </span>
            </div>
          </div>
        ) : photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={story.caption || `${group.user.displayName}'s story`} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-8" style={{ backgroundColor: story.background }}>
            <p className="max-w-xl whitespace-pre-wrap text-center text-2xl font-semibold leading-snug">{story.caption}</p>
          </div>
        )}

        {/* Tap zones: back on the left, on on the right. A voice status keeps its middle for the play button. */}
        <button onClick={back} aria-label={t('Previous story')} className="absolute inset-y-0 left-0 w-1/3" />
        <button onClick={forward} aria-label={t('Next story')} className="absolute inset-y-0 right-0 w-1/3" />
        {!voice && <button onClick={close} aria-label={t('Close')} className="absolute inset-y-0 left-1/3 right-1/3" />}

        {photo && story.caption && (
          <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pb-6 text-base">{story.caption}</p>
        )}

        {/* A story can be about an item: this is the part a plain status does not have. */}
        {story.product && (
          <Link
            href={productHref({ id: story.product.id, official: group.user.official })}
            className="absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-full bg-white/95 p-2 pr-4 text-black shadow-lg"
          >
            {story.product.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={story.product.image} alt="" className="h-10 w-10 rounded-full object-cover" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{story.product.name}</span>
              <span className="block text-xs text-muted-foreground">{formatPrice(story.product.price)}</span>
            </span>
            <span className="text-sm font-semibold text-primary">{t('View')}</span>
          </Link>
        )}
      </div>

      {!mine && (
        <form onSubmit={sendReply} className="flex items-center gap-2 border-t border-white/15 p-3">
          <Input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={`${t('Reply to')} ${group.user.displayName}`}
            aria-label={t('Reply to this story')}
            maxLength={500}
            className="h-11 flex-1 border-white/30 bg-white/10 text-white placeholder:text-white/50"
          />
          <Button type="submit" size="icon" className="h-11 w-11 rounded-full" disabled={sending || !reply.trim()} aria-label={t('Send reply')}>
            <Send className="h-5 w-5" />
          </Button>
        </form>
      )}
    </div>
  );
}
