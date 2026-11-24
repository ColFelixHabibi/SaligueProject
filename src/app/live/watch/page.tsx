'use client';

import { ReplayPlayer } from '@/components/live/replay-player';
import { absoluteUrl } from '@/lib/paths';
import { shareLink } from '@/components/share-sheet';
import { useBlockedIds } from '@/lib/blocks';

import { ExpandableText } from '@/components/expandable-text';
import { FollowButton, useFollow } from '@/components/follow-button';
import { useFeatures } from '@/lib/features';
import { setLivePref, useLivePref } from '@/lib/live-prefs';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Coins, Crown, Eye, EyeOff, Gift, Heart, Plus, Repeat2, HelpCircle, History, Loader2, MessageCircle, Mic, MicOff, MoreHorizontal, PictureInPicture2, Pin, PinOff, Radio, Reply, Send, Share2, Shield, ShoppingBag, Smile, Trash2, UserPlus, Video, VideoOff, VolumeX, X } from 'lucide-react';
import { ask } from '@/components/confirm-dialog';
import { api } from '@/lib/api';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/auth-provider';
import { MessageSellerButton } from '@/components/message-seller-button';
import { GiftBanner, HeartGoal, Hearts, LiveChat, LiveInput, LiveRail, LiveStage, LiveTopBar, PinnedProduct, PollBubble, ProductStrip, useDoubleTapHeart, type TileExtra } from '@/components/live/live-parts';
import { GiftSheet } from '@/components/live/gift-sheet';
import { LiveDropCard } from '@/components/live/live-drop';
import ProductCard from '@/components/product-card';
import { useCart } from '@/hooks/use-cart-store';
import { useProductStore } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { answerInvite, askToJoin, claimDrop, muteInLive, releaseClaim, removeLiveComment, repostLive, sendLiveComment, updateLive, useElapsed, useHearts, useLive, useLiveRoom, votePoll, type LiveComment, type LiveDrop } from '@/lib/live';
import { formatPrice } from '@/lib/orders';
import type { Product } from '@/lib/types';
import { LiveTryOn } from '@/components/live/live-try-on';
import { cn } from '@/lib/utils';

const REACTIONS = ['🔥', '😍', '👏'];

/** A guest's own Follow, on their tile: a small + that turns into ✓. */
function TileFollow({ uid, small }: { uid: string; small: boolean }) {
  const { following, toggle, own } = useFollow(uid);
  if (own) return null;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); void toggle(); }} aria-pressed={following} aria-label={following ? 'Following' : 'Follow'} title={following ? 'Following' : 'Follow'}
      className={cn('absolute z-[6] flex items-center justify-center rounded-full text-white shadow', following ? 'bg-white/30' : 'bg-primary', small ? 'bottom-1 right-1 h-5 w-5' : 'bottom-24 right-2 h-7 w-7')}>
      {following ? <Check className={small ? 'h-3 w-3' : 'h-4 w-4'} /> : <Plus className={small ? 'h-3 w-3' : 'h-4 w-4'} />}
    </button>
  );
}

function Watch() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get('id');
  const { toast } = useToast();
  const { authUid, user } = useAuth();
  const { products } = useProductStore();
  const { addToCart } = useCart();
  const { live, comments, drops, myGuestStatus, muted, invited, setInvited, bursts, burst, error, reload, myVote, setMyVote, addMine, gift } = useLive(id, authUid);
  // Claiming a dropped item: which drop is being claimed, and the newest one worth showing.
  const [claiming, setClaiming] = useState<string | null>(null);
  const activeDrop = useMemo(() => drops.find((d) => d.mine) ?? drops.find((d) => d.open) ?? null, [drops]);
  // Replying to a comment, and the gift sheet.
  const [replyTo, setReplyTo] = useState<LiveComment | null>(null);
  const [giftsOpen, setGiftsOpen] = useState(false);
  // Who the gift sheet opens on (a guest's coin count on their tile opens it on them), and the supporters list.
  const [giftTo, setGiftTo] = useState<string | null>(null);
  const [supportersOpen, setSupportersOpen] = useState(false);
  const on = useFeatures();
  const giftNudgeOn = useLivePref('giftNudge');
  const [nudge, setNudge] = useState(false);
  const [reposted, setReposted] = useState(false);
  const isGuest = myGuestStatus === 'accepted';
  const { tiles, viewers, status, toggleCam, toggleMic, camOn, micOn, flipCamera } = useLiveRoom(id, live?.status === 'live', isGuest);
  const heart = useHearts(id, burst);
  // Double-tap the video for a heart, like TikTok.
  const tap = useDoubleTapHeart(() => heart('❤️'));
  const elapsed = useElapsed(live?.startedAt);
  const [text, setText] = useState('');
  const [question, setQuestion] = useState(false);
  const [sending, setSending] = useState(false);
  const joined = useRef(false);
  const blocked = useBlockedIds();
  const [selected, setSelected] = useState<LiveComment | null>(null);
  // Bag: every item of the live in a strip; clear: only the video (like TikTok's clear screen); more: extra actions.
  const [bagOpen, setBagOpen] = useState(false);
  const [clear, setClear] = useState(false);
  const [reactions, setReactions] = useState(false);
  const [more, setMore] = useState(false);
  const pipSupported = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
  // Moderators chosen by the host look after the chat.
  const isMod = !!authUid && !!live?.moderators?.some((m) => m.uid === authUid);
  const roles = useMemo(() => {
    const r: Record<string, 'Host' | 'Mod'> = {};
    for (const m of live?.moderators ?? []) r[m.uid] = 'Mod';
    if (live) r[live.sellerId] = 'Host';
    return r;
  }, [live]);
  // No. 1–3 beside the top supporters' names in the chat.
  const ranks = useMemo(() => Object.fromEntries((live?.supporters ?? []).map((s, i) => [s.uid, i + 1])), [live?.supporters]);
  // Everyone a gift can go to: the host, then each guest on camera.
  const recipients = useMemo(() => (live ? [{ uid: live.sellerId, name: live.sellerName }, ...tiles.filter((t) => t.role === 'guest' && t.identity !== authUid).map((t) => ({ uid: t.identity, name: t.name }))] : []), [live, tiles, authUid]);
  // A gift reminder, once per live, after a minute of watching (the viewer can switch these off for good).
  useEffect(() => {
    if (!id || !giftNudgeOn || !on('tips') || !user || live?.status !== 'live' || live.sellerId === authUid) return;
    const key = `saligue-gift-nudge-${id}`;
    try {
      if (sessionStorage.getItem(key)) return;
    } catch { /* storage blocked: the reminder may come back once per visit */ }
    const timer = setTimeout(() => {
      setNudge(true);
      try { sessionStorage.setItem(key, '1'); } catch { /* storage blocked */ }
    }, 60_000);
    return () => clearTimeout(timer);
  }, [id, giftNudgeOn, on, user, live?.status, live?.sellerId, authUid]);
  const openGifts = (to: string | null = null) => {
    setNudge(false);
    setGiftTo(to);
    setGiftsOpen(true);
  };
  // On each person on camera: the coins they received in this live (tap to send them one), and a Follow for guests.
  const tileExtra: TileExtra = (t, small) => {
    if (tiles.length < 2 || t.isLocal) return null;
    const coins = live?.giftsTo?.[t.identity] ?? 0;
    return (
      <>
        <button type="button" onClick={(e) => { e.stopPropagation(); openGifts(t.identity === live?.sellerId ? null : t.identity); }} aria-label={`${coins} coins received: send ${t.name} a gift`} title={`Send ${t.name} a gift`}
          className={cn('absolute z-[6] flex items-center gap-0.5 rounded-full bg-black/55 font-bold text-white', small ? 'left-1 top-1 px-1 py-px text-[10px]' : 'left-2 top-16 px-2 py-0.5 text-xs', !small && t.role === 'guest' && 'top-24')}>
          <Coins className={cn('text-amber-400', small ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5')} /> {coins.toLocaleString()}
        </button>
        {t.role === 'guest' && user && <TileFollow uid={t.identity} small={small} />}
      </>
    );
  };
  const repost = async () => {
    if (!id) return;
    try {
      const r = await repostLive(id);
      setReposted(true);
      toast({ title: 'Reposted to your followers', description: r.reposts > 1 ? `${r.reposts} people shared this live.` : 'They are told this live is on.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Not reposted', description: friendlyError(err) });
    }
    setMore(false);
  };
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
  // Try on during the live: a panel over the stream (the live keeps playing).
  const [trying, setTrying] = useState<Product | null>(null);
  const pinnedComment = comments.find((c) => c.id === live?.pinnedCommentId) ?? null;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !text.trim()) return;
    setSending(true);
    try {
      addMine(await sendLiveComment(id, text.trim(), question ? 'question' : 'comment', replyTo?.id));
      setText('');
      setReplyTo(null);
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
    if (!id) return;
    await shareLink({ title: live?.title ?? 'Saligue Live', text: `${live?.sellerName} is live on Saligue`, url: absoluteUrl(`/live/watch?id=${id}`) });
  };
  // A place in a live drop: ten minutes to pay, then it goes back for someone else.
  const claim = async (dropId: string) => {
    if (!id) return;
    if (!authUid) {
      toast({ title: 'Create an account to claim', description: 'Then the shop can keep the item for you.' });
      return;
    }
    setClaiming(dropId);
    try {
      await claimDrop(id, dropId);
      toast({ title: 'Yours for ten minutes', description: 'Pay now: after that the place goes to someone else.' });
      // Everyone else hears about it over the live channel; my own place (mine, expiresAt) comes from the server.
      await reload();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Not claimed', description: friendlyError(err) });
    } finally {
      setClaiming(null);
    }
  };

  // Paying for a claimed drop goes through the normal bag and checkout, so the live price and the
  // delivery choices behave exactly like any other order.
  const payFor = async (drop: LiveDrop) => {
    const product = products.find((p) => p.id === drop.productId);
    if (!product) {
      toast({ variant: 'destructive', title: 'Not available', description: 'This item is no longer on sale.' });
      return;
    }
    try {
      await addToCart(product);
      router.push('/checkout');
    } catch (err) {
      toast({ variant: 'destructive', title: 'Not added', description: friendlyError(err) });
    }
  };

  const release = async (dropId: string) => {
    if (!id) return;
    try {
      await releaseClaim(id, dropId);
      toast({ title: 'Place given back', description: 'Someone else can claim it now.' });
      await reload();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Not released', description: friendlyError(err) });
    }
  };

  const vote = async (option: number) => {
    if (!id) return;
    setMyVote(option);
    try {
      await votePoll(id, option);
    } catch (err) {
      setMyVote(null);
      toast({ variant: 'destructive', title: 'Vote not counted', description: friendlyError(err) });
    }
  };

  // Keep watching in a small window while using other apps or pages.
  const pictureInPicture = async () => {
    setMore(false);
    const video = document.querySelector<HTMLVideoElement>('video[data-live-video="host"]');
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (video) await video.requestPictureInPicture();
    } catch {
      toast({ title: 'Not available on this phone' });
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
      toast({ title: 'Request sent', description: 'The host will see it. Your camera turns on if they accept, and you will be in the replay.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Not sent', description: friendlyError(err) });
    }
  };

  if (error) return <div className="p-10 text-center text-muted-foreground">{error} <Link href="/live" className="text-primary underline">See who is live</Link></div>;
  if (!live) return <Skeleton className="mx-auto h-[80vh] max-w-md" />;

  if (live.status === 'ended') {
    return (
      <div className="container mx-auto max-w-4xl space-y-6 px-4 py-10 text-center">
        {live.replay ? (
          // Watch again: the host's recording of this live.
          <div className="mx-auto w-full max-w-sm space-y-2">
            <ReplayPlayer live={live} />
            <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <History className="h-4 w-4" /> Replay · {new Date(live.startedAt).toLocaleDateString()}
              {live.sellerId === authUid && (
                <button type="button" aria-label="Delete replay" title="Delete replay" className="ml-2 flex h-8 w-8 items-center justify-center rounded-full text-destructive hover:bg-destructive/10"
                  onClick={async () => { if (await ask({ title: 'Delete this replay?', description: 'People can no longer watch it again.', confirm: 'Delete', destructive: true })) await api(`/lives/${live.id}/replay`, { method: 'DELETE' }).catch(() => {}); }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </p>
          </div>
        ) : live.replayStatus === 'recording' || live.replayStatus === 'processing' ? (
          <p className="mx-auto flex w-fit items-center gap-2 rounded-full bg-muted px-4 py-2 text-sm font-semibold"><Loader2 className="h-4 w-4 animate-spin" /> The replay is being saved…</p>
        ) : null}
        {live.replay ? null : live.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={live.cover} alt="" className="mx-auto aspect-[9/14] w-40 rounded-2xl object-cover opacity-80 shadow-md grayscale-[40%]" />
        ) : <Radio className="mx-auto h-12 w-12 text-muted-foreground" />}
        {!live.replay && <h1 className="text-2xl font-extrabold">This live has ended</h1>}
        <p className={live.replay ? 'text-lg font-bold' : 'text-muted-foreground'}>{live.sellerName} · {live.title}</p>
        <div className="flex justify-center gap-2">
          <Button asChild><Link href="/live">Other lives</Link></Button>
          <MessageSellerButton product={featured[0] ?? ({ id: '', sellerId: live.sellerId, name: live.title, price: 0, image: '', category: '', seller: live.sellerName, status: 'active' } as any)} label={`Message ${live.sellerName}`} variant="outline" size="default" />
        </div>
        <div className="space-y-2 pt-2 text-left">
          <p className="flex items-center gap-2 font-bold"><Radio className="h-4 w-4 text-primary" /> Live now</p>
          <LiveRail exclude={live.id} />
        </div>
        {featured.length > 0 && (
          <div className="grid grid-cols-2 gap-3 pt-4 text-left sm:gap-4 md:grid-cols-4">{featured.map((p) => <ProductCard key={p.id} product={p} variant="shop" />)}</div>
        )}
      </div>
    );
  }

  const rail = 'flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur active:scale-90 min-[360px]:h-11 min-[360px]:w-11';

  return (
    <div className="mx-auto flex h-[100dvh] max-w-6xl gap-6 bg-black md:h-dvh md:bg-transparent md:p-6">
      <div onPointerUp={tap.onPointerUp} className="relative h-full w-full overflow-hidden bg-black md:aspect-[9/16] md:w-auto md:rounded-3xl md:shadow-2xl">
        {tap.layer}
        <GiftBanner gift={gift} />
        <LiveStage tiles={tiles} cover={live.cover ?? live.thumbnail} fill={live.videoFit === 'fill'} layout={live.layout} extra={on('tips') ? tileExtra : undefined} waiting={status === 'connecting' ? 'Connecting to the live…' : status === 'error' ? 'Connection lost. Reconnecting…' : 'The host’s camera is starting…'} />
        {clear ? (
          <button type="button" onClick={() => setClear(false)} className="absolute right-3 top-[calc(0.75rem+var(--sat))] z-10 flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-xs font-semibold text-white" aria-label="Show chat and buttons" title="Show chat and buttons"><Eye className="h-4 w-4" /> Show</button>
        ) : (
        <>
        <LiveTopBar live={live} viewers={viewers} elapsed={elapsed} onSupporters={() => setSupportersOpen(true)}>
          {/* Small phones: just the + icon, so the host's name stays readable. */}
          <FollowButton sellerId={live.sellerId} onDark className="h-7 w-7 px-0 text-xs min-[420px]:w-auto min-[420px]:px-3" labelClassName="hidden min-[420px]:ml-1 min-[420px]:inline" />
          <button type="button" onClick={() => router.push('/live')} className="rounded-full bg-black/45 p-1.5 text-white" aria-label="Close" title="Close"><X className="h-4 w-4" /></button>
        </LiveTopBar>
        <HeartGoal likes={live.likeCount} goal={live.heartGoal} />
        {live.poll && <PollBubble poll={live.poll} myVote={myVote} onVote={live.poll.open ? vote : undefined} lower={!!live.heartGoal} />}
        <Hearts bursts={bursts} />

        <div className="absolute inset-x-0 bottom-0 z-10 space-y-2 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-3 pb-[calc(0.75rem+var(--sab))] pt-16">
          <div className="flex items-end gap-2">
            <LiveChat comments={comments.filter((c) => !blocked.has(c.uid))} pinned={pinnedComment} roles={roles} ranks={ranks} onAction={user ? (c) => c.kind !== 'join' && c.kind !== 'like' && setSelected(c) : undefined} className="min-w-0 flex-1" />
            {/* Actions on the right, like TikTok and Instagram lives. */}
            <div className="relative flex shrink-0 flex-col items-center gap-2 pb-1">
              {featured.length > 0 && (
                <button type="button" onClick={() => setBagOpen((v) => !v)} aria-pressed={bagOpen} className={cn(rail, 'relative', bagOpen && 'bg-primary')} aria-label={`Items in this live (${featured.length})`} title={`Items in this live (${featured.length})`}>
                  <ShoppingBag className="h-5 w-5" />
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-foreground">{featured.length}</span>
                </button>
              )}
              {!isGuest && (
                <button type="button" onClick={requestJoin} disabled={myGuestStatus === 'requested'} title="Ask to join on camera" className={cn(rail, 'disabled:opacity-60')} aria-label="Ask to join on camera"><UserPlus className="h-5 w-5" /></button>
              )}
              <button type="button" onClick={share} className={rail} aria-label="Share" title="Share"><Share2 className="h-5 w-5" /></button>
              <button type="button" onClick={() => setMore(true)} className={rail} aria-label="More" title="More"><MoreHorizontal className="h-5 w-5" /></button>
              {reactions && (
                <div className="absolute bottom-14 right-12 flex gap-1.5 rounded-full bg-black/45 p-1.5 backdrop-blur">
                  {REACTIONS.map((e) => (
                    <button key={e} type="button" onClick={() => heart(e)} className="flex h-9 w-9 items-center justify-center rounded-full text-xl active:scale-90">{e}</button>
                  ))}
                </div>
              )}
              <button type="button" onClick={() => openGifts()} className={cn(rail, 'bg-gradient-to-br from-amber-400/80 to-pink-500/80')} aria-label="Send a gift" title="Send a gift"><Gift className="h-5 w-5" /></button>
              <button type="button" onClick={() => setReactions((v) => !v)} aria-pressed={reactions} className={cn(rail, reactions && 'bg-white/30')} aria-label="Reactions" title="Reactions"><Smile className="h-5 w-5" /></button>
              <button type="button" onClick={() => heart('❤️')} className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg active:scale-90" aria-label="Send a heart" title="Send a heart">
                <Heart className="h-6 w-6 fill-current" />
              </button>
            </div>
          </div>
          {nudge && (
            <div className="relative ml-auto flex w-fit max-w-[15rem] animate-[gift-in_0.4s_ease-out] flex-col items-center gap-1.5 rounded-2xl bg-white/95 p-3 text-center text-foreground shadow-xl">
              <button type="button" onClick={() => setNudge(false)} className="absolute right-2 top-2 text-muted-foreground" aria-label="Not now" title="Not now"><X className="h-3.5 w-3.5" /></button>
              <Gift className="h-7 w-7 text-pink-500" />
              <p className="text-sm font-semibold leading-tight">Enjoying {live.sellerName}? Show your support with a gift</p>
              <Button size="sm" className="w-full rounded-full" onClick={() => openGifts()}>Send a gift</Button>
              <button type="button" onClick={() => { setLivePref('giftNudge', false); setNudge(false); }} className="text-[11px] text-muted-foreground underline">Don’t remind me in lives</button>
            </div>
          )}
          {/* A drop the host has held up: claim a place, pay within ten minutes, or let it go. */}
          {activeDrop && (
            <LiveDropCard drop={activeDrop} signedIn={!!authUid} busy={claiming === activeDrop.id} onClaim={claim} onPay={payFor} onRelease={release} />
          )}
          {bagOpen && featured.length > 0
            ? <ProductStrip products={featured} pinnedId={live.pinnedProductId} onBuy={buy} onTryOn={setTrying} deals={live.deals} />
            : pinned && <PinnedProduct product={pinned} onBuy={() => buy(pinned.id)} onTryOn={() => setTrying(pinned)} deal={live.deals?.[pinned.id]} />}
          {invited && !isGuest && (
            <div className="flex items-center gap-2 rounded-2xl bg-white/95 p-3 text-sm text-foreground shadow-lg">
              <Video className="h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1"><b>{live.sellerName}</b> invites you on camera<span className="block text-xs text-muted-foreground">You will also be in the replay.</span></span>
              <Button size="sm" onClick={() => answer(true)}>Join</Button>
              <Button size="sm" variant="ghost" onClick={() => answer(false)}>No</Button>
            </div>
          )}
          {isMod && <p className="flex items-center gap-1 text-xs font-semibold text-sky-300"><Shield className="h-3.5 w-3.5" /> You are a moderator · tap a comment to manage it</p>}
          {isGuest && (
            <div className="flex items-center justify-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-bold text-white" title="This live is recorded for a replay"><span className="h-2 w-2 animate-pulse rounded-full bg-white" /> You are on camera · REC</span>
              <button type="button" onClick={toggleMic} className="rounded-full bg-black/45 p-2 text-white">{micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}</button>
              <button type="button" onClick={toggleCam} className="rounded-full bg-black/45 p-2 text-white">{camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}</button>
              <button type="button" onClick={flipCamera} className="rounded-full bg-black/45 px-3 py-2 text-xs font-semibold text-white">Flip</button>
            </div>
          )}
          {replyTo && (
            <div className="flex items-center gap-2 rounded-xl bg-black/50 px-3 py-1.5 text-xs text-white backdrop-blur">
              <Reply className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">Replying to <b>{replyTo.name}</b>: {replyTo.text}</span>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" title="Cancel reply"><X className="h-4 w-4" /></button>
            </div>
          )}
          <form onSubmit={send} className="flex items-end gap-1.5 min-[360px]:gap-2">
            <button type="button" onClick={() => setQuestion((q) => !q)} aria-pressed={question} title="Ask as a question"
              className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', question ? 'bg-primary text-white' : 'bg-black/40 text-white')}>
              <HelpCircle className="h-5 w-5" />
            </button>
            <LiveInput value={text} onChange={setText} disabled={muted} placeholder={muted ? 'Comments are off for you' : live.chatMode === 'off' && !isGuest ? 'The host turned comments off' : live.chatMode === 'followers' && !isGuest ? 'Clients can comment · follow to join' : question ? 'Ask the host a question…' : live.slowSeconds ? `Slow mode · one comment every ${live.slowSeconds} s` : 'Say something…'} />
            <button type="submit" disabled={sending || !text.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-50" aria-label="Send" title="Send">
              {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </button>
          </form>
        </div>
        </>
        )}
      </div>

      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="space-y-4 rounded-t-3xl px-4 min-[360px]:px-6">
          <div className="grid grid-cols-3 gap-2 pt-2">
            {pipSupported && (
              <button type="button" onClick={pictureInPicture} className="flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-xs font-semibold"><PictureInPicture2 className="h-6 w-6 text-primary" /> Small window</button>
            )}
            <button type="button" onClick={() => { setClear(true); setMore(false); }} className="flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-xs font-semibold"><EyeOff className="h-6 w-6 text-primary" /> Clear screen</button>
            {user && (
              <button type="button" onClick={repost} disabled={reposted} className="flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-xs font-semibold disabled:opacity-60"><Repeat2 className="h-6 w-6 text-primary" /> {reposted ? 'Reposted' : 'Repost to followers'}{live.reposts ? ` · ${live.reposts}` : ''}</button>
            )}
          </div>
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-bold"><Radio className="h-4 w-4 text-primary" /> More lives</p>
            <LiveRail exclude={live.id} />
          </div>
        </SheetContent>
      </Sheet>

      {id && <GiftSheet liveId={id} open={giftsOpen} onOpenChange={setGiftsOpen} signedIn={!!user} recipients={recipients} to={giftTo} />}

      {/* Top supporters of this live: coins sent in gifts, to the host or a guest. */}
      <Sheet open={supportersOpen} onOpenChange={setSupportersOpen}>
        <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-3xl">
          <p className="flex items-center gap-2 font-bold"><Crown className="h-5 w-5 text-amber-500" /> Top supporters</p>
          <div className="mt-3 space-y-1">
            {(live.supporters ?? []).map((s, i) => (
              <Link key={s.uid} href={`/profile?id=${s.uid}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-muted">
                <span className="w-8 text-sm font-extrabold">No. {i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                <span className="flex items-center gap-1 text-sm font-bold text-amber-600"><Coins className="h-4 w-4" /> {s.coins.toLocaleString()}</span>
              </Link>
            ))}
          </div>
          {on('tips') && <Button className="mt-3 w-full" onClick={() => { setSupportersOpen(false); openGifts(); }}><Gift className="mr-2 h-4 w-4" /> Send a gift</Button>}
        </SheetContent>
      </Sheet>
      <LiveTryOn product={trying} price={trying ? live.deals?.[trying.id]?.price : undefined} onClose={() => setTrying(null)} onBuy={buy} />

      <Sheet open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          {selected && id && (
            <div className="space-y-3">
              <p className="text-sm"><b>{selected.name}</b>: {selected.text}</p>
              <div className="grid gap-2">
                {!muted && live.chatMode !== 'off' && (
                  <Button onClick={() => { setReplyTo(selected); setSelected(null); }}><Reply className="mr-2 h-4 w-4" /> Reply</Button>
                )}
                {isMod && selected.uid !== live.sellerId && <>
                <Button variant="outline" onClick={() => modAct(() => updateLive(id, { pinnedCommentId: live.pinnedCommentId === selected.id ? null : selected.id }), live.pinnedCommentId === selected.id ? 'Unpinned' : 'Pinned')}>
                  {live.pinnedCommentId === selected.id ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />} {live.pinnedCommentId === selected.id ? 'Unpin' : 'Pin for everyone'}
                </Button>
                <Button variant="outline" onClick={() => modAct(() => removeLiveComment(id, selected.id), 'Comment removed')}><Trash2 className="mr-2 h-4 w-4" /> Remove comment</Button>
                {selected.uid !== authUid && !roles[selected.uid] && (
                  <Button variant="outline" className="text-destructive" onClick={() => modAct(() => muteInLive(id, selected.uid), `${selected.name} can no longer comment`)}><VolumeX className="mr-2 h-4 w-4" /> Mute {selected.name}</Button>
                )}
                </>}
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
            <Button size="icon" variant="outline" onClick={share} aria-label="Share" title="Share"><Share2 className="h-4 w-4" /></Button>
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
