'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Loader2, Mic, MicOff, Package, Pin, PinOff, Radio, Share2, SwitchCamera, Trash2, UserCheck, UserMinus, Users, Video, VideoOff, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAuth } from '@/components/auth/auth-provider';
import { Hearts, LiveChat, LiveStage, LiveTopBar, PinnedProduct } from '@/components/live/live-parts';
import { useProductStore } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { decideGuest, endLive, goLive, muteInLive, removeLiveComment, sendLiveComment, updateLive, useElapsed, useLive, useLiveRoom, useLives, type LiveComment } from '@/lib/live';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

/** Before going live: camera check, title, description and the items to show. */
function Setup() {
  const router = useRouter();
  const { toast } = useToast();
  const { authUid } = useAuth();
  const { products } = useProductStore();
  const lives = useLives();
  const mine = useMemo(() => products.filter((p) => p.sellerId === authUid && p.status === 'active'), [products, authUid]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [camError, setCamError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  // Camera preview, so the seller sees how they look before going live.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: facing, width: 720, height: 1280 }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        setCamError(null);
        if (video.current) video.current.srcObject = s;
      })
      .catch((e) => setCamError(/NotAllowed|Permission/i.test(String(e)) ? 'Allow the camera in your browser to go live.' : 'No camera found. Connect one or use your phone.'));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  const mineLive = lives?.lives.find((l) => l.sellerId === authUid);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setStarting(true);
    try {
      const live = await goLive({ title, description, productIds: picked });
      router.replace(`/live/studio?id=${live.id}`);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not go live', description: friendlyError(error) });
      setStarting(false);
    }
  };

  if (lives && !lives.enabled) {
    return <p className="p-10 text-center text-muted-foreground">Live is not switched on for this Saligue server yet.</p>;
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-4 md:grid-cols-[minmax(0,360px)_1fr] md:p-8">
      <div className="relative mx-auto aspect-[9/16] w-full max-w-[360px] overflow-hidden rounded-3xl bg-neutral-900 shadow-xl">
        <video ref={video} autoPlay playsInline muted className={cn('h-full w-full object-cover', facing === 'user' && 'scale-x-[-1]')} />
        {camError && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80">{camError}</p>}
        <span className="absolute left-3 top-3 rounded-md bg-black/50 px-2 py-1 text-xs font-bold text-white">Preview</span>
        <button type="button" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-white" aria-label="Switch camera">
          <SwitchCamera className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={start} className="space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Saligue Live</p>
          <h1 className="text-3xl font-extrabold tracking-tight">Go live</h1>
          <p className="text-muted-foreground">Show your items on camera. Shoppers chat, send hearts, buy while you talk, and can join you on camera.</p>
        </div>
        {mineLive && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
            <span>You are already live: <b>{mineLive.title}</b></span>
            <Button size="sm" asChild><Link href={`/live/studio?id=${mineLive.id}`}>Back to it</Link></Button>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="live-title" className="font-semibold">Title <span className="text-destructive">*</span></Label>
          <Input id="live-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required placeholder="e.g. New kitenge dresses — try them on with me" className="h-12" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="live-desc" className="font-semibold">Description</Label>
          <Textarea id="live-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder="What you'll show, sizes available, special prices, delivery…" className="min-h-24" />
        </div>
        <div className="space-y-2">
          <Label className="font-semibold">Items to show ({picked.length})</Label>
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">You have no items on sale. <Link href="/sell" className="text-primary underline">Add one</Link> to sell during the live.</p>
          ) : (
            <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {mine.map((p) => {
                const on = picked.includes(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => setPicked((x) => (on ? x.filter((i) => i !== p.id) : [...x, p.id]))}
                    className={cn('relative rounded-xl border-2 bg-muted p-1 text-left transition', on ? 'border-primary' : 'border-transparent hover:border-primary/40')}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.cutout || p.image} alt="" className="aspect-square w-full object-contain" />
                    <span className="block truncate px-1 text-[11px] font-medium">{p.name}</span>
                    <span className="block px-1 text-[11px] font-bold text-primary">{formatPrice(Number(p.price))}</span>
                    {on && <Check className="absolute right-1 top-1 h-5 w-5 rounded-full bg-primary p-0.5 text-primary-foreground" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <Button type="submit" size="lg" className="h-14 w-full text-lg" disabled={starting || !title.trim() || !!camError}>
          {starting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Radio className="mr-2 h-5 w-5" />} Go live now
        </Button>
        <p className="text-center text-xs text-muted-foreground">Your past customers get a notification that you are live.</p>
      </form>
    </div>
  );
}

/** While live: the stream, chat and hearts, and the host's controls. */
function Studio({ id }: { id: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { authUid } = useAuth();
  const { products } = useProductStore();
  const { live, comments, guests, bursts, error } = useLive(id, authUid);
  const { tiles, viewers, status, error: roomError, camOn, micOn, toggleCam, toggleMic, flipCamera } = useLiveRoom(id, live?.status === 'live', true);
  const elapsed = useElapsed(live?.startedAt);
  const [panel, setPanel] = useState<'products' | 'guests' | null>(null);
  const [selected, setSelected] = useState<LiveComment | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [say, setSay] = useState('');

  // Remember the most viewers at once.
  useEffect(() => {
    if (live?.status === 'live' && viewers > (live.peakViewers ?? 0)) updateLive(id, { viewers }).catch(() => {});
  }, [viewers, live?.status, live?.peakViewers, id]);

  const featured = useMemo(() => (live?.productIds ?? []).map((pid) => products.find((p) => p.id === pid)).filter(Boolean) as typeof products, [live?.productIds, products]);
  const mine = useMemo(() => products.filter((p) => p.sellerId === authUid && p.status === 'active'), [products, authUid]);
  const pinned = products.find((p) => p.id === live?.pinnedProductId) ?? null;
  const pinnedComment = comments.find((c) => c.id === live?.pinnedCommentId) ?? null;
  const requests = guests.filter((g) => g.status === 'requested');
  const onCamera = guests.filter((g) => g.status === 'accepted');

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast({ title: done });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(e) });
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/live/watch?id=${id}`;
    try {
      if (navigator.share) await navigator.share({ title: live?.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast({ title: 'Link copied', description: 'Share it on WhatsApp, Instagram or anywhere.' });
      }
    } catch {
      // Cancelled.
    }
  };

  if (error) return <p className="p-10 text-center text-muted-foreground">{error}</p>;
  if (!live) return <Skeleton className="mx-auto h-[80vh] max-w-md" />;
  if (live.status === 'ended') {
    return (
      <div className="mx-auto max-w-md space-y-4 p-10 text-center">
        <Radio className="mx-auto h-12 w-12 text-primary" />
        <h1 className="text-2xl font-extrabold">Your live has ended</h1>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-muted p-3"><p className="text-xl font-bold">{live.peakViewers}</p><p className="text-xs text-muted-foreground">Most viewers</p></div>
          <div className="rounded-xl bg-muted p-3"><p className="text-xl font-bold">{live.likeCount}</p><p className="text-xs text-muted-foreground">Hearts</p></div>
          <div className="rounded-xl bg-muted p-3"><p className="text-xl font-bold">{comments.filter((c) => c.kind !== 'join').length}</p><p className="text-xs text-muted-foreground">Comments</p></div>
        </div>
        <div className="flex justify-center gap-2">
          <Button asChild><Link href="/dashboard/orders">See orders</Link></Button>
          <Button variant="outline" onClick={() => router.replace('/live/studio')}>Go live again</Button>
        </div>
      </div>
    );
  }

  const controls = (
    <div className="flex items-center justify-center gap-2">
      <button type="button" onClick={toggleMic} className={cn('flex h-12 w-12 items-center justify-center rounded-full text-white', micOn ? 'bg-black/45' : 'bg-destructive')} aria-label={micOn ? 'Mute' : 'Unmute'}>{micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}</button>
      <button type="button" onClick={toggleCam} className={cn('flex h-12 w-12 items-center justify-center rounded-full text-white', camOn ? 'bg-black/45' : 'bg-destructive')} aria-label={camOn ? 'Camera off' : 'Camera on'}>{camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}</button>
      <button type="button" onClick={flipCamera} className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45 text-white" aria-label="Switch camera"><SwitchCamera className="h-5 w-5" /></button>
      <button type="button" onClick={() => setPanel('products')} className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45 text-white" aria-label="Items"><Package className="h-5 w-5" /></button>
      <button type="button" onClick={() => setPanel('guests')} className="relative flex h-12 w-12 items-center justify-center rounded-full bg-black/45 text-white" aria-label="Guests">
        <Users className="h-5 w-5" />
        {requests.length > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold">{requests.length}</span>}
      </button>
      <button type="button" onClick={share} className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45 text-white" aria-label="Share"><Share2 className="h-5 w-5" /></button>
    </div>
  );

  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem-env(safe-area-inset-bottom))] max-w-6xl gap-6 md:h-dvh md:p-6">
      <div className="relative h-full w-full overflow-hidden bg-black md:aspect-[9/16] md:w-auto md:rounded-3xl md:shadow-2xl">
        <LiveStage tiles={tiles} waiting={roomError ?? (status === 'connecting' ? 'Starting your camera…' : 'Reconnecting…')} />
        <LiveTopBar live={live} viewers={viewers} elapsed={elapsed}>
          <button type="button" onClick={() => setConfirmEnd(true)} className="rounded-md bg-destructive px-2.5 py-1 text-xs font-bold text-white">End</button>
        </LiveTopBar>
        <Hearts bursts={bursts} />
        {requests.length > 0 && (
          <button type="button" onClick={() => setPanel('guests')} className="absolute left-3 top-16 z-10 flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-white shadow-lg">
            <Users className="h-4 w-4" /> {requests[0].name}{requests.length > 1 ? ` +${requests.length - 1}` : ''} wants to join
          </button>
        )}
        <div className="absolute inset-x-0 bottom-0 z-10 space-y-2 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-3 pt-16">
          <LiveChat comments={comments} pinned={pinnedComment} onAction={(c) => c.kind !== 'join' && setSelected(c)} />
          {pinned && <PinnedProduct product={pinned} compact />}
          <form className="flex gap-2" onSubmit={(e) => {
            e.preventDefault();
            if (!say.trim()) return;
            void act(() => sendLiveComment(id, say.trim())).then(() => setSay(''));
          }}>
            <Input value={say} onChange={(e) => setSay(e.target.value)} maxLength={300} placeholder="Write to your viewers…" className="h-11 rounded-full border-0 bg-white/20 text-white placeholder:text-white/70" />
          </form>
          {controls}
        </div>
      </div>

      {/* Computers: controls beside the stream. */}
      <aside className="hidden min-w-0 flex-1 flex-col gap-4 overflow-y-auto md:flex">
        <div className="rounded-2xl border bg-card p-5">
          <h1 className="text-xl font-extrabold">{live.title}</h1>
          {live.description && <p className="mt-1 text-sm text-muted-foreground">{live.description}</p>}
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-muted p-2"><p className="text-lg font-bold">{viewers}</p><p className="text-xs text-muted-foreground">Watching</p></div>
            <div className="rounded-xl bg-muted p-2"><p className="text-lg font-bold">{live.likeCount}</p><p className="text-xs text-muted-foreground">Hearts</p></div>
            <div className="rounded-xl bg-muted p-2"><p className="text-lg font-bold">{elapsed}</p><p className="text-xs text-muted-foreground">Live for</p></div>
          </div>
        </div>
        <ProductsPanel id={id} featured={featured} mine={mine} pinnedId={live.pinnedProductId} />
        <GuestsPanel id={id} requests={requests} onCamera={onCamera} />
      </aside>

      <Sheet open={!!panel} onOpenChange={(v) => !v && setPanel(null)}>
        <SheetContent side="bottom" className="max-h-[75vh] overflow-y-auto rounded-t-3xl md:hidden">
          <SheetHeader><SheetTitle>{panel === 'products' ? 'Items in your live' : 'Guests'}</SheetTitle></SheetHeader>
          <div className="mt-4">
            {panel === 'products' ? <ProductsPanel id={id} featured={featured} mine={mine} pinnedId={live.pinnedProductId} bare /> : <GuestsPanel id={id} requests={requests} onCamera={onCamera} bare />}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          {selected && (
            <div className="space-y-3">
              <p className="text-sm"><b>{selected.name}</b>: {selected.text}</p>
              <div className="grid gap-2">
                <Button variant="outline" onClick={() => act(() => updateLive(id, { pinnedCommentId: live.pinnedCommentId === selected.id ? null : selected.id })).then(() => setSelected(null))}>
                  {live.pinnedCommentId === selected.id ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />} {live.pinnedCommentId === selected.id ? 'Unpin' : 'Pin for everyone'}
                </Button>
                <Button variant="outline" onClick={() => act(() => removeLiveComment(id, selected.id), 'Comment removed').then(() => setSelected(null))}><Trash2 className="mr-2 h-4 w-4" /> Remove comment</Button>
                {selected.uid !== authUid && (
                  <Button variant="outline" className="text-destructive" onClick={() => act(() => muteInLive(id, selected.uid), `${selected.name} can no longer comment`).then(() => setSelected(null))}><VolumeX className="mr-2 h-4 w-4" /> Mute {selected.name}</Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End your live?</AlertDialogTitle>
            <AlertDialogDescription>Everyone watching will see that the live has ended. Orders placed during the live stay in your Orders.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => act(() => endLive(id))}>End live</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProductsPanel({ id, featured, mine, pinnedId, bare }: { id: string; featured: ReturnType<typeof useProductStore.getState>['products']; mine: ReturnType<typeof useProductStore.getState>['products']; pinnedId: string | null; bare?: boolean }) {
  const { toast } = useToast();
  const featuredIds = featured.map((p) => p.id);
  const save = (body: Parameters<typeof updateLive>[1]) => updateLive(id, body).catch((e) => toast({ variant: 'destructive', title: 'Not saved', description: friendlyError(e) }));
  return (
    <div className={cn(!bare && 'rounded-2xl border bg-card p-5')}>
      {!bare && <h2 className="mb-1 font-bold">Items in your live</h2>}
      <p className="mb-3 text-xs text-muted-foreground">Tap <b>Show now</b> to pin an item on every viewer’s screen with a Buy button.</p>
      <div className="space-y-2">
        {mine.map((p) => {
          const inLive = featuredIds.includes(p.id);
          const isPinned = pinnedId === p.id;
          return (
            <div key={p.id} className={cn('flex items-center gap-3 rounded-xl border p-2', isPinned && 'border-primary bg-primary/5')}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.cutout || p.image} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-muted object-contain p-1" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{p.name}</p>
                <p className="text-xs text-muted-foreground">{formatPrice(Number(p.price))}{p.stock != null ? ` · ${p.stock} in stock` : ''}</p>
              </div>
              {isPinned ? (
                <Button size="sm" variant="secondary" onClick={() => save({ pinnedProductId: null })}><PinOff className="mr-1 h-3.5 w-3.5" /> Hide</Button>
              ) : (
                <Button size="sm" onClick={() => save({ pinnedProductId: p.id, ...(inLive ? {} : { productIds: [...featuredIds, p.id] }) })}><Pin className="mr-1 h-3.5 w-3.5" /> Show now</Button>
              )}
              <button type="button" title={inLive ? 'Remove from this live' : 'Add to this live'} onClick={() => save({ productIds: inLive ? featuredIds.filter((x) => x !== p.id) : [...featuredIds, p.id] })}
                className={cn('rounded-full p-1.5', inLive ? 'text-primary' : 'text-muted-foreground')}>
                {inLive ? <Check className="h-4 w-4" /> : <X className="h-4 w-4 rotate-45" />}
              </button>
            </div>
          );
        })}
        {mine.length === 0 && <p className="text-sm text-muted-foreground">No items on sale yet.</p>}
      </div>
    </div>
  );
}

function GuestsPanel({ id, requests, onCamera, bare }: { id: string; requests: { uid: string; name: string }[]; onCamera: { uid: string; name: string }[]; bare?: boolean }) {
  const { toast } = useToast();
  const decide = (uid: string, decision: 'accept' | 'decline' | 'remove') => decideGuest(id, uid, decision).catch((e) => toast({ variant: 'destructive', title: 'Not done', description: friendlyError(e) }));
  return (
    <div className={cn(!bare && 'rounded-2xl border bg-card p-5')}>
      {!bare && <h2 className="mb-1 font-bold">Guests on camera</h2>}
      <p className="mb-3 text-xs text-muted-foreground">Viewers can ask to join you on camera (up to 3 at once).</p>
      {onCamera.map((g) => (
        <div key={g.uid} className="mb-2 flex items-center justify-between rounded-xl bg-primary/5 p-2 text-sm">
          <span className="flex items-center gap-2 font-medium"><UserCheck className="h-4 w-4 text-primary" /> {g.name}</span>
          <Button size="sm" variant="outline" onClick={() => decide(g.uid, 'remove')}><UserMinus className="mr-1 h-3.5 w-3.5" /> Remove</Button>
        </div>
      ))}
      {requests.map((g) => (
        <div key={g.uid} className="mb-2 flex items-center justify-between gap-2 rounded-xl border p-2 text-sm">
          <span className="min-w-0 truncate font-medium">{g.name} <span className="font-normal text-muted-foreground">wants to join</span></span>
          <span className="flex shrink-0 gap-1">
            <Button size="sm" onClick={() => decide(g.uid, 'accept')}>Accept</Button>
            <Button size="sm" variant="ghost" onClick={() => decide(g.uid, 'decline')}>Decline</Button>
          </span>
        </div>
      ))}
      {!requests.length && !onCamera.length && <p className="text-sm text-muted-foreground">No requests yet.</p>}
    </div>
  );
}

function StudioPage() {
  const params = useSearchParams();
  const id = params.get('id');
  const router = useRouter();
  const { user, role, isAuthLoading } = useAuth();
  useEffect(() => {
    if (!isAuthLoading && (!user || role !== 'seller')) router.replace('/sell');
  }, [isAuthLoading, user, role, router]);
  if (isAuthLoading || !user || role !== 'seller') return <Skeleton className="mx-auto h-[80vh] max-w-md" />;
  return id ? <Studio id={id} /> : <Setup />;
}

export default function LiveStudio() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-[80vh] max-w-md" />}>
      <StudioPage />
    </Suspense>
  );
}

