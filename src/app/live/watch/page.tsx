'use client';

import { useBlockedIds } from '@/lib/blocks';

import { ExpandableText } from '@/components/expandable-text';
import { FollowButton } from '@/components/follow-button';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Heart, HelpCircle, Loader2, MessageCircle, Mic, MicOff, Pin, PinOff, Radio, Send, Share2, Shield, Trash2, UserPlus, Video, VideoOff, VolumeX, X } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/auth-provider';
import { MessageSellerButton } from '@/components/message-seller-button';
import { Hearts, LiveChat, LiveInput, LiveStage, LiveTopBar, PinnedProduct } from '@/components/live/live-parts';
import ProductCard from '@/components/product-card';
import { useCart } from '@/hooks/use-cart-store';
import { useProductStore } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { answerInvite, askToJoin, muteInLive, removeLiveComment, sendLiveComment, updateLive, useElapsed, useHearts, useLive, useLiveRoom, type LiveComment } from '@/lib/live';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

const REACTIONS = ['🔥', '😍', '👏'];

function Watch() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get('id');
  const { toast } = useToast();
  const { authUid, user } = useAuth();
  const { products } = useProductStore();
  const { addToCart } = useCart();
  const { live, comments, myGuestStatus, muted, invited, setInvited, bursts, burst, error, reload } = useLive(id, authUid);
  const isGuest = myGuestStatus === 'accepted';
  const { tiles, viewers, status, toggleCam, toggleMic, camOn, micOn, flipCamera } = useLiveRoom(id, live?.status === 'live', isGuest);
  const heart = useHearts(id, burst);
  const elapsed = useElapsed(live?.startedAt);
  const [text, setText] = useState('');
  const [question, setQuestion] = useState(false);
  const [sending, setSending] = useState(false);
  const joined = useRef(false);
  const blocked = useBlockedIds();
  const [selected, setSelected] = useState<LiveComment | null>(null);
  // Moderators chosen by the host look after the chat.
  const isMod = !!authUid && !!live?.moderators?.some((m) => m.uid === authUid);
  const roles = useMemo(() => {
    const r: Record<string, 'Host' | 'Mod'> = {};
    for (const m of live?.moderators ?? []) r[m.uid] = 'Mod';
    if (live) r[live.sellerId] = 'Host';
    return r;
  }, [live]);
  const modAct = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast({ title: done });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(err) });
    }
    setSelected(null);
  };
  const answer = async (accept: boolean) => {
    if (!id) return;
    setInvited(false);
    try {
      await answerInvite(id, accept);
      await reload();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(err) });
    }
  };

  // "joined" in the chat, once.
  useEffect(() => {
    if (id && live?.status === 'live' && authUid && !joined.current && live.sellerId !== authUid) {
      joined.current = true;
      sendLiveComment(id, '', 'join').catch(() => {});
    }
  }, [id, live?.status, live?.sellerId, authUid]);

  // The host watching their own live goes to the studio.
  useEffect(() => {
    if (live && authUid && live.sellerId === authUid && live.status === 'live') router.replace(`/live/studio?id=${live.id}`);
  }, [live, authUid, router]);

  const featured = useMemo(() => (live?.productIds ?? []).map((pid) => products.find((p) => p.id === pid)).filter(Boolean) as typeof products, [live?.productIds, products]);
  const pinned = products.find((p) => p.id === live?.pinnedProductId) ?? null;
  const pinnedComment = comments.find((c) => c.id === live?.pinnedCommentId) ?? null;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !text.trim()) return;
    setSending(true);
    try {
      await sendLiveComment(id, text.trim(), question ? 'question' : 'comment');
      setText('');
      setQuestion(false);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Not sent', description: friendlyError(err) });
    } finally {
      setSending(false);
    }
  };

  const buy = async (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    try {
      await addToCart(product);
      toast({ title: 'Added to your bag', description: `${product.name} · ${formatPrice(Number(product.price))}` });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Not added', description: friendlyError(err) });
    }
  };

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: live?.title, text: `${live?.sellerName} is live on Saligue`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast({ title: 'Link copied', description: 'Share it so friends can watch.' });
      }
    } catch {
      // Cancelled.
    }
  };

  const requestJoin = async () => {
    if (!id) return;
    if (!user) {
      toast({ title: 'Create an account first', description: 'Guests on camera need a Saligue account.' });
      return;
    }
    try {
      await askToJoin(id);
      toast({ title: 'Request sent', description: 'The host will see it. Your camera turns on if they accept.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Not sent', description: friendlyError(err) });
    }
  };

  if (error) return <div className="p-10 text-center text-muted-foreground">{error} <Link href="/live" className="text-primary underline">See who is live</Link></div>;
  if (!live) return <Skeleton className="mx-auto h-[80vh] max-w-md" />;

  if (live.status === 'ended') {
    return (
      <div className="container mx-auto max-w-4xl space-y-6 px-4 py-10 text-center">
        <Radio className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-extrabold">This live has ended</h1>
        <p className="text-muted-foreground">{live.sellerName} · {live.title}</p>
        <div className="flex justify-center gap-2">
          <Button asChild><Link href="/live">Other lives</Link></Button>
          <MessageSellerButton product={featured[0] ?? ({ id: '', sellerId: live.sellerId, name: live.title, price: 0, image: '', category: '', seller: live.sellerName, status: 'active' } as any)} label={`Message ${live.sellerName}`} variant="outline" size="default" />
        </div>
        {featured.length > 0 && (
          <div className="grid grid-cols-2 gap-4 pt-4 text-left md:grid-cols-4">{featured.map((p) => <ProductCard key={p.id} product={p} variant="shop" />)}</div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[100dvh] max-w-6xl gap-6 md:h-dvh md:p-6">
      <div className="relative h-full w-full overflow-hidden bg-black md:aspect-[9/16] md:w-auto md:rounded-3xl md:shadow-2xl">
        <LiveStage tiles={tiles} fill={live.videoFit === 'fill'} waiting={status === 'connecting' ? 'Connecting to the live…' : status === 'error' ? 'Connection lost. Reconnecting…' : 'The host’s camera is starting…'} />
        <LiveTopBar live={live} viewers={viewers} elapsed={elapsed}>
          <FollowButton sellerId={live.sellerId} onDark className="h-7 px-3 text-xs" />
          <button type="button" onClick={() => router.push('/live')} className="rounded-full bg-black/45 p-1.5 text-white" aria-label="Close"><X className="h-4 w-4" /></button>
        </LiveTopBar>
        <Hearts bursts={bursts} />

        <div className="absolute inset-x-0 bottom-0 z-10 space-y-2 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-3 pt-16">
          <div className="flex items-end gap-2">
            <LiveChat comments={comments.filter((c) => !blocked.has(c.uid))} pinned={pinnedComment} roles={roles} onAction={isMod ? (c) => c.kind !== 'join' && c.uid !== live.sellerId && setSelected(c) : undefined} className="min-w-0 flex-1" />
            <div className="flex shrink-0 flex-col items-center gap-2 pb-1">
              {REACTIONS.map((e) => (
                <button key={e} type="button" onClick={() => heart(e)} className="flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-xl backdrop-blur active:scale-90">{e}</button>
              ))}
              <button type="button" onClick={() => heart('❤️')} className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg active:scale-90" aria-label="Send a heart">
                <Heart className="h-6 w-6 fill-current" />
              </button>
            </div>
          </div>
          {pinned && <PinnedProduct product={pinned} onBuy={() => buy(pinned.id)} />}
          {invited && !isGuest && (
            <div className="flex items-center gap-2 rounded-2xl bg-white/95 p-3 text-sm text-foreground shadow-lg">
              <Video className="h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1"><b>{live.sellerName}</b> invites you on camera</span>
              <Button size="sm" onClick={() => answer(true)}>Join</Button>
              <Button size="sm" variant="ghost" onClick={() => answer(false)}>No</Button>
            </div>
          )}
          {isMod && <p className="flex items-center gap-1 text-xs font-semibold text-sky-300"><Shield className="h-3.5 w-3.5" /> You are a moderator · tap a comment to manage it</p>}
          {isGuest && (
            <div className="flex items-center justify-center gap-2">
              <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">You are on camera</span>
              <button type="button" onClick={toggleMic} className="rounded-full bg-black/45 p-2 text-white">{micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}</button>
              <button type="button" onClick={toggleCam} className="rounded-full bg-black/45 p-2 text-white">{camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}</button>
              <button type="button" onClick={flipCamera} className="rounded-full bg-black/45 px-3 py-2 text-xs font-semibold text-white">Flip</button>
            </div>
          )}
          <form onSubmit={send} className="flex items-end gap-2">
            <button type="button" onClick={() => setQuestion((q) => !q)} aria-pressed={question} title="Ask as a question"
              className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', question ? 'bg-primary text-white' : 'bg-black/40 text-white')}>
              <HelpCircle className="h-5 w-5" />
            </button>
            <LiveInput value={text} onChange={setText} disabled={muted} placeholder={muted ? 'Comments are off for you' : live.chatMode === 'off' && !isGuest ? 'The host turned comments off' : live.chatMode === 'followers' && !isGuest ? 'Clients can comment · follow to join' : question ? 'Ask the host a question…' : live.slowSeconds ? `Slow mode · one comment every ${live.slowSeconds} s` : 'Say something…'} />
            <button type="submit" disabled={sending || !text.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-50" aria-label="Send">
              {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </button>
            <button type="button" onClick={share} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/40 text-white" aria-label="Share"><Share2 className="h-5 w-5" /></button>
            {!isGuest && (
              <button type="button" onClick={requestJoin} disabled={myGuestStatus === 'requested'} title="Ask to join on camera"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/40 text-white disabled:opacity-60" aria-label="Ask to join on camera">
                <UserPlus className="h-5 w-5" />
              </button>
            )}
          </form>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          {selected && id && (
            <div className="space-y-3">
              <p className="text-sm"><b>{selected.name}</b>: {selected.text}</p>
              <div className="grid gap-2">
                <Button variant="outline" onClick={() => modAct(() => updateLive(id, { pinnedCommentId: live.pinnedCommentId === selected.id ? null : selected.id }), live.pinnedCommentId === selected.id ? 'Unpinned' : 'Pinned')}>
                  {live.pinnedCommentId === selected.id ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />} {live.pinnedCommentId === selected.id ? 'Unpin' : 'Pin for everyone'}
                </Button>
                <Button variant="outline" onClick={() => modAct(() => removeLiveComment(id, selected.id), 'Comment removed')}><Trash2 className="mr-2 h-4 w-4" /> Remove comment</Button>
                {selected.uid !== authUid && !roles[selected.uid] && (
                  <Button variant="outline" className="text-destructive" onClick={() => modAct(() => muteInLive(id, selected.uid), `${selected.name} can no longer comment`)}><VolumeX className="mr-2 h-4 w-4" /> Mute {selected.name}</Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Computers: the live's details and every featured item beside the video. */}
      <aside className="hidden min-w-0 flex-1 flex-col gap-4 overflow-y-auto md:flex">
        <div className="space-y-2 rounded-2xl border bg-card p-5">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2 py-0.5 text-xs font-extrabold text-primary-foreground"><Radio className="h-3.5 w-3.5" /> LIVE</span>
          <h1 className="text-2xl font-extrabold">{live.title}</h1>
          {live.description && <ExpandableText text={live.description} lines={3} className="text-muted-foreground" />}
          <div className="flex flex-wrap gap-2 pt-2">
            {featured[0] && <MessageSellerButton product={featured[0]} label={`Message ${live.sellerName}`} size="default" variant="secondary" />}
            <Button variant="outline" onClick={share}><Share2 className="mr-2 h-4 w-4" /> Share</Button>
            {!isGuest && <Button variant="outline" onClick={requestJoin} disabled={myGuestStatus === 'requested'}><UserPlus className="mr-2 h-4 w-4" /> {myGuestStatus === 'requested' ? 'Request sent' : 'Join on camera'}</Button>}
          </div>
        </div>
        {featured.length > 0 && (
          <div className="rounded-2xl border bg-card p-5">
            <h2 className="mb-4 flex items-center gap-2 font-bold"><MessageCircle className="h-4 w-4 text-primary" /> In this live ({featured.length})</h2>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">{featured.map((p) => <ProductCard key={p.id} product={p} variant="shop" />)}</div>
          </div>
        )}
      </aside>
    </div>
  );
}

export default function WatchLivePage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-[80vh] max-w-md" />}>
      <Watch />
    </Suspense>
  );
}
