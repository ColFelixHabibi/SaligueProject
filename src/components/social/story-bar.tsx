'use client';

import { useMemo, useRef, useState } from 'react';
import { Check, Image as ImageIcon, Mic, Plus, Square, Type } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useProductStore } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { compressImage } from '@/lib/image';
import { formatPrice } from '@/lib/orders';
import { closeFriends, postStory, setCloseFriend, useStories, type CloseFriend, type StoryGroup } from '@/lib/stories';
import { cn } from '@/lib/utils';
import { VOICE_MAX_SECONDS, useVoiceRecorder } from '@/lib/voice';
import { StoryViewer } from './story-viewer';

/** The colours words are written on. Kept dark enough for white text to stay readable. */
const BACKGROUNDS = ['#111111', '#7c2d12', '#065f46', '#1e3a8a', '#4c1d95', '#831843'];

const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';

const firstName = (name: string) => name.split(' ')[0] ?? name;

/**
 * Stories at the top of the feed: your own ring first (tap the + to post), then everyone whose status you can watch.
 * A ring that is still bright holds something you have not seen. Posting offers a photo or words on a colour, and
 * both clear themselves after 24 hours.
 */
export function StoryBar({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { toast } = useToast();
  const t = useT();
  const { authUid } = useAuth();
  const { products } = useProductStore();
  const stories = useStories();
  const [watching, setWatching] = useState<StoryGroup | null>(null);
  const [composing, setComposing] = useState(false);
  const [mode, setMode] = useState<'photo' | 'text' | 'voice'>('photo');
  const [photo, setPhoto] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [background, setBackground] = useState(BACKGROUNDS[0]);
  const [productId, setProductId] = useState<string | null>(null);
  // Who the status is for, and — when that is the small list — the list itself (loaded only when it is chosen).
  const [audience, setAudience] = useState<'everyone' | 'close'>('everyone');
  const [friends, setFriends] = useState<CloseFriend[] | null>(null);
  const [candidates, setCandidates] = useState<CloseFriend[]>([]);
  const [picking, setPicking] = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const voice = useVoiceRecorder();

  const groups = stories?.groups ?? [];
  // The server only reports how many watched on your own stories, so that is how the rings know which is yours.
  const mine = groups.find((g) => g.stories.some((s) => s.views !== undefined)) ?? null;
  const others = groups.filter((g) => g !== mine);
  // Your own items on sale, offered as something the status can be about. A shopper with no shop sees nothing here.
  const myItems = useMemo(() => products.filter((p) => p.sellerId === authUid && p.status === 'active'), [products, authUid]);

  const reset = () => {
    setPhoto(null);
    setCaption('');
    setBackground(BACKGROUNDS[0]);
    setProductId(null);
    setAudience('everyone');
    setFriends(null);
    setCandidates([]);
    setPicking(false);
    setMode('photo');
    // Closing the composer throws the recording away (and lets the microphone go either way).
    voice.discard();
  };

  /** Switching away from Voice while recording finishes it there and then, so no microphone is left on. */
  const chooseMode = (next: 'photo' | 'text' | 'voice') => {
    if (mode === 'voice' && next !== 'voice' && voice.recording) voice.stop();
    setMode(next);
  };

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    setPreparing(true);
    try {
      // Resized on the phone, so a status does not cost a shopper their data (image.ts).
      setPhoto(await compressImage(chosen));
    } catch {
      toast({ variant: 'destructive', title: t('That photo could not be read'), description: t('Try another picture.') });
    } finally {
      setPreparing(false);
    }
  };

  const publish = async (event: React.FormEvent) => {
    event.preventDefault();
    const recording = voice.result;
    if (mode === 'photo' && !photo) {
      toast({ variant: 'destructive', title: t('Choose a photo first') });
      return;
    }
    if (mode === 'text' && !caption.trim()) {
      toast({ variant: 'destructive', title: t('Write something first') });
      return;
    }
    if (mode === 'voice' && !recording) {
      toast({ variant: 'destructive', title: t('Record your voice first') });
      return;
    }
    setBusy(true);
    try {
      await postStory({
        kind: mode === 'text' ? 'text' : mode === 'voice' ? 'voice' : 'image',
        media: mode === 'voice' ? recording?.data : photo ?? undefined,
        caption: caption.trim(),
        background,
        productId,
        audience,
      });
      setComposing(false);
      reset();
    } catch (error) {
      toast({ variant: 'destructive', title: t('Your status was not posted'), description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  /** Loads the close friends list and the people who could go on it: only asked for when that audience is chosen. */
  const openCloseFriends = async () => {
    setLoadingFriends(true);
    try {
      const data = await closeFriends();
      setFriends(data.friends);
      setCandidates(data.people);
    } catch (error) {
      toast({ variant: 'destructive', title: t('Could not open your close friends'), description: friendlyError(error) });
    } finally {
      setLoadingFriends(false);
    }
  };

  const chooseAudience = async (next: 'everyone' | 'close') => {
    setAudience(next);
    if (next === 'close' && !friends) await openCloseFriends();
  };

  /** Adds or removes one person, telling the server at once so a status can never go to someone just taken off. */
  const toggleFriend = async (person: CloseFriend, inside: boolean) => {
    setFriends((list) => (inside ? (list ?? []).filter((f) => f.id !== person.id) : [...(list ?? []), person]));
    try {
      await setCloseFriend(person.id, !inside);
    } catch (error) {
      setFriends((list) => (inside ? [...(list ?? []), person] : (list ?? []).filter((f) => f.id !== person.id)));
      toast({ variant: 'destructive', title: t('That did not work'), description: friendlyError(error) });
    }
  };

  const ring = (unseen: boolean) =>
    cn('rounded-full p-[2.5px]', unseen ? 'bg-gradient-to-tr from-pink-500 via-red-500 to-amber-400' : 'bg-muted');

  // "0:07": counting up while recording, and the length once it has stopped.
  const clock = `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, '0')}`;

  return (
    <div className={cn(compact ? 'pointer-events-auto' : 'space-y-2', className)}>
      {!compact && (
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold tracking-tight">{t('Stories')}</h2>
          {stories?.error && (
            <button onClick={() => stories.reload()} className="text-xs font-medium text-destructive hover:underline">
              {stories.error} · {t('Try again')}
            </button>
          )}
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-1">
        {/* Your own ring: the + posts a new status, the ring itself replays yours. */}
        <div className="flex w-16 shrink-0 flex-col items-center gap-1">
          <div className="relative">
            <button
              onClick={() => (mine ? setWatching(mine) : setComposing(true))}
              aria-label={t(mine ? 'Watch your story' : 'Post a status')}
              className={cn(ring(!!mine && mine.unseen > 0), 'block')}
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-background p-0.5">
                {mine?.user.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mine.user.avatar} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  <span className="text-sm font-semibold text-muted-foreground">You</span>
                )}
              </span>
            </button>
            <button
              onClick={() => setComposing(true)}
              aria-label={t('Post a status')}
              className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <span className="w-full truncate text-center text-xs text-muted-foreground">{t('Your story')}</span>
        </div>

        {others.map((group) => (
          <button
            key={group.user.id}
            onClick={() => setWatching(group)}
            className="flex w-16 shrink-0 flex-col items-center gap-1"
            aria-label={`${group.user.displayName}${group.unseen > 0 ? ', something you have not watched' : ''}`}
          >
            <span className={ring(group.unseen > 0)}>
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-background p-0.5">
                {group.user.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={group.user.avatar} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  <Avatar className="h-full w-full">
                    <AvatarFallback>{initials(group.user.displayName)}</AvatarFallback>
                  </Avatar>
                )}
              </span>
            </span>
            <span className="w-full truncate text-center text-xs">{firstName(group.user.displayName)}</span>
          </button>
        ))}

        {!stories && <p className="px-1 py-4 text-xs text-muted-foreground">{t('Loading stories…')}</p>}
      </div>

      {watching && <StoryViewer group={watching} onClose={() => setWatching(null)} onChanged={() => stories?.reload()} />}

      <Dialog open={composing} onOpenChange={(open) => !open && (setComposing(false), reset())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Post a status')}</DialogTitle>
            <DialogDescription>{t('It goes by itself after 24 hours.')}</DialogDescription>
          </DialogHeader>

          <form onSubmit={publish} className="space-y-4">
            {/* Who can see it. Everything else about posting stays the same. */}
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" className="h-10" variant={audience === 'everyone' ? 'default' : 'outline'} onClick={() => void chooseAudience('everyone')} aria-pressed={audience === 'everyone'}>
                  {t('Everyone')}
                </Button>
                <Button type="button" className="h-10" variant={audience === 'close' ? 'default' : 'outline'} onClick={() => void chooseAudience('close')} aria-pressed={audience === 'close'}>
                  {t('Close friends')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {audience === 'close' ? t('Only the people on your close friends list can see this.') : t('Everyone who follows you can see this.')}
              </p>
              {audience === 'close' && (
                <div className="space-y-2 rounded-lg border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">
                      {loadingFriends ? t('Loading…') : `${friends?.length ?? 0} ${t('close friends')}`}
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPicking((v) => !v)}>
                      {t(picking ? 'Done' : 'Edit')}
                    </Button>
                  </div>
                  {(friends?.length ?? 0) === 0 && !loadingFriends && !picking && (
                    <p className="text-xs text-muted-foreground">{t('Nobody yet: only you would see this status.')}</p>
                  )}
                  {picking && (
                    <div className="max-h-48 space-y-1 overflow-y-auto">
                      {candidates.length === 0 && <p className="p-1 text-xs text-muted-foreground">{t('No connected people to add yet.')}</p>}
                      {candidates.map((person) => {
                        const inside = (friends ?? []).some((f) => f.id === person.id);
                        return (
                          <button
                            key={person.id}
                            type="button"
                            onClick={() => void toggleFriend(person, inside)}
                            aria-pressed={inside}
                            className={cn('flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-muted', inside && 'bg-primary/10')}
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
                              {initials(person.name)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm">{person.name}</span>
                            {inside && <Check className="h-4 w-4 shrink-0 text-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button type="button" className="h-12" variant={mode === 'photo' ? 'default' : 'outline'} onClick={() => chooseMode('photo')} aria-label={t('Photo')} title={t('Photo')} aria-pressed={mode === 'photo'}>
                <ImageIcon className="h-6 w-6" />
              </Button>
              <Button type="button" className="h-12" variant={mode === 'voice' ? 'default' : 'outline'} onClick={() => chooseMode('voice')} aria-label={t('Voice')} title={t('Voice')} aria-pressed={mode === 'voice'}>
                <Mic className="h-6 w-6" />
              </Button>
              <Button type="button" className="h-12" variant={mode === 'text' ? 'default' : 'outline'} onClick={() => chooseMode('text')} aria-label={t('Words')} title={t('Words')} aria-pressed={mode === 'text'}>
                <Type className="h-6 w-6" />
              </Button>
            </div>

            {mode === 'voice' ? (
              // A voice status is recorded here and plays from the ring: one press, at most half a minute, and it
              // stops by itself (voice.ts). The server turns it into one small M4A every phone can play.
              <div className="space-y-2">
                <Label>{t('Voice')}</Label>
                {voice.result ? (
                  <div className="space-y-2">
                    <audio src={voice.result.data} controls className="w-full" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{clock}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={voice.discard}>
                        {t('Record again')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant={voice.recording ? 'destructive' : 'outline'}
                    onClick={() => (voice.recording ? voice.stop() : void voice.start())}
                    className="w-full"
                  >
                    {voice.recording ? (
                      <>
                        <Square className="mr-2 h-4 w-4" /> {t('Stop')} · {clock}
                      </>
                    ) : (
                      <>
                        <Mic className="mr-2 h-4 w-4" /> {t('Record')}
                      </>
                    )}
                  </Button>
                )}
                <p className={cn('text-xs', voice.problemText ? 'text-destructive' : 'text-muted-foreground')}>
                  {voice.problemText
                    ? t(voice.problemText)
                    : `${t('Up to')} ${VOICE_MAX_SECONDS} ${t('seconds.')}`}
                </p>
              </div>
            ) : mode === 'photo' ? (
              <div className="space-y-2">
                <Label htmlFor="status-photo">{t('Photo')}</Label>
                <input ref={file} id="status-photo" type="file" accept="image/*" onChange={pick} className="block w-full text-sm" />
                {preparing && <p className="text-xs text-muted-foreground">{t('Getting the photo ready…')}</p>}
                {photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt={t('The photo in your status')} className="max-h-72 w-full rounded-lg object-cover" />
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="status-colour">{t('Colour')}</Label>
                <div id="status-colour" className="flex gap-2">
                  {BACKGROUNDS.map((colour) => (
                    <button
                      key={colour}
                      type="button"
                      onClick={() => setBackground(colour)}
                      aria-label={`${t('Write on')} ${colour}`}
                      aria-pressed={background === colour}
                      style={{ backgroundColor: colour }}
                      className={cn('h-8 w-8 rounded-full border-2', background === colour ? 'border-foreground' : 'border-transparent')}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* A status can be about one of your items: the ring then opens straight onto it, which is what a plain
                status cannot do. Only shops with something on sale see this, so a shopper's composer is unchanged. */}
            {myItems.length > 0 && (
              <div className="space-y-2">
                <Label>{t('An item with this status (optional)')}</Label>
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-1">
                  {myItems.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setProductId(productId === p.id ? null : p.id)}
                      aria-pressed={productId === p.id}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-muted',
                        productId === p.id && 'bg-primary/10 ring-1 ring-primary',
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.cutout || p.image} alt="" className="h-9 w-9 shrink-0 rounded bg-muted object-contain p-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block text-xs text-muted-foreground">{formatPrice(Number(p.price))}</span>
                      </span>
                      {productId === p.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t('People watching can tap it and go straight to the item.')}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="status-caption">
                {t(mode === 'text' ? 'Your words' : mode === 'voice' ? 'A line with the voice note (optional)' : 'A line with the photo (optional)')}
              </Label>
              <Textarea
                id="status-caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                maxLength={280}
                rows={mode === 'text' ? 4 : 2}
                placeholder={t(mode === 'text' ? 'What is happening?' : mode === 'voice' ? 'Say something about this voice note' : 'Say something about this photo')}
              />
              <p className="text-right text-xs text-muted-foreground">{caption.length}/280</p>
            </div>

            {/* Nothing is posted until there is something to post: a recording that is still running, or none at all, holds the button. */}
            <Button type="submit" size="lg" className="w-full" disabled={busy || preparing || voice.recording || (mode === 'voice' && !voice.result)}>
              {busy ? t('Posting…') : t('Post status')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
