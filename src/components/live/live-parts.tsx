'use client';

import { VerifiedBadge } from '@/components/verified-badge';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, BarChart3, Camera, Check, Eye, Heart, HelpCircle, ImageUp, MicOff, Radio, ShoppingBag, VideoOff, Wand2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { attach, type Burst, type Live, type LiveComment, type LivePoll, type Tile } from '@/lib/live';
import { useLives } from '@/lib/lives';
import { encodeCanvas, fileToImage } from '@/lib/ai/canvas';
import { formatPrice } from '@/lib/orders';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * True unless the video is already phone-tall (9:16). Such video is shown whole on a blurred copy of
 * itself, so the picture is never cropped into a "zoomed-in" look (cameras often send 4:3 or landscape).
 */
export function useVideoShape(video: React.RefObject<HTMLVideoElement | null>) {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const update = () => el.videoWidth && setWide(el.videoWidth > el.videoHeight * 0.62);
    el.addEventListener('loadedmetadata', update);
    el.addEventListener('resize', update);
    update();
    return () => {
      el.removeEventListener('loadedmetadata', update);
      el.removeEventListener('resize', update);
    };
  }, [video]);
  return wide;
}

function VideoView({ tile, cover }: { tile: Tile; cover?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const backdrop = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const wide = useVideoShape(video);
  useEffect(() => attach(tile.video, video.current), [tile.video]);
  useEffect(() => (wide && !cover ? attach(tile.video, backdrop.current) : () => {}), [tile.video, wide, cover]);
  // Your own voice is never played back to you.
  useEffect(() => (tile.isLocal ? () => {} : attach(tile.audio, audio.current)), [tile.audio, tile.isLocal]);
  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-neutral-900', tile.speaking && tile.role === 'guest' && 'ring-4 ring-inset ring-primary')}>
      {tile.video ? (
        <>
          {wide && !cover && <video ref={backdrop} autoPlay playsInline muted aria-hidden className={cn('absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl', tile.mirror && '-scale-x-110')} />}
          <video ref={video} data-live-video={tile.role} autoPlay playsInline muted={tile.isLocal} className={cn('relative h-full w-full', cover ? 'object-cover' : 'object-contain', tile.mirror && 'scale-x-[-1]')} />
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/70">
          <VideoOff className="h-10 w-10" />
          <span className="text-sm">{tile.name}</span>
        </div>
      )}
      {!tile.isLocal && <audio ref={audio} autoPlay />}
      {tile.role === 'guest' && (
        <span className="absolute left-2 top-16 rounded-full bg-black/55 px-2 py-0.5 text-xs font-semibold text-white">{tile.name}{tile.isLocal ? ' (you)' : ''}</span>
      )}
      {!tile.audio && tile.role !== 'viewer' && (
        <span className="absolute right-2 top-2 rounded-full bg-black/55 p-1 text-white"><MicOff className="h-3.5 w-3.5" /></span>
      )}
    </div>
  );
}

/** Host full screen; up to three guests share the screen with the host, like TikTok and Instagram multi-guest lives. */
export function LiveStage({ tiles, waiting, fill }: { tiles: Tile[]; waiting: string; fill?: boolean }) {
  if (!tiles.length) {
    return <div className="flex h-full w-full items-center justify-center bg-neutral-900 p-8 text-center text-white/80">{waiting}</div>;
  }
  if (tiles.length === 1) return <VideoView tile={tiles[0]} cover={fill} />;
  return (
    <div className={cn('grid h-full w-full gap-0.5 bg-black', tiles.length === 2 ? 'grid-rows-2' : 'grid-cols-2 grid-rows-2')}>
      {tiles.map((t) => <VideoView key={t.identity} tile={t} cover={fill} />)}
    </div>
  );
}

/** Hearts and emojis floating up the right side. */
export function Hearts({ bursts }: { bursts: Burst[] }) {
  return (
    <div className="pointer-events-none absolute bottom-24 right-2 top-1/3 w-24 overflow-hidden">
      {bursts.map((b) => (
        <span key={b.id} className="absolute bottom-0 animate-[live-float_2.6s_ease-out_forwards] text-3xl" style={{ left: `${b.x}%` }}>{b.emoji}</span>
      ))}
    </div>
  );
}

/** Top bar: who is live, LIVE badge, how long, how many watching. */
export function LiveTopBar({ live, viewers, elapsed, onViewers, children }: { live: Live; viewers: number; elapsed: string; onViewers?: () => void; children?: React.ReactNode }) {
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-3 pb-10">
      <div className="flex min-w-0 items-center gap-2 rounded-full bg-black/35 p-1 pr-3 text-white backdrop-blur">
        <Link href={`/profile?id=${live.sellerId}`} aria-label={`${live.sellerName}: profile`}>
          <Avatar className="h-9 w-9 ring-2 ring-primary">
            <AvatarImage src={live.sellerAvatar ?? undefined} className="object-cover" />
            <AvatarFallback className="bg-primary text-primary-foreground">{live.sellerName.charAt(0)}</AvatarFallback>
          </Avatar>
        </Link>
        <div className="min-w-0 leading-tight">
          <p className="flex items-center gap-1 truncate text-sm font-bold">{live.sellerName}{live.official && <BadgeCheck className="h-3.5 w-3.5" />}{live.sellerVerified && <VerifiedBadge className="h-3.5 w-3.5" />}</p>
          <p className="truncate text-[11px] text-white/80">{live.likeCount.toLocaleString()} likes</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className={cn('rounded-md px-2 py-1 text-xs font-extrabold tracking-wide text-white', live.status === 'live' ? 'bg-primary' : 'bg-neutral-600')}>
          {live.status === 'live' ? 'LIVE' : 'ENDED'} · {elapsed}
        </span>
        {onViewers ? (
          <button type="button" onClick={onViewers} className="flex items-center gap-1 rounded-md bg-black/45 px-2 py-1 text-xs font-semibold text-white" aria-label={`${viewers} watching: see who`}><Eye className="h-3.5 w-3.5" /> {viewers}</button>
        ) : (
          <span className="flex items-center gap-1 rounded-md bg-black/45 px-2 py-1 text-xs font-semibold text-white"><Eye className="h-3.5 w-3.5" /> {viewers}</span>
        )}
        {children}
      </div>
    </div>
  );
}

/** Chat over the video, newest at the bottom; questions and the pinned comment stand out. */
export function LiveChat({ comments, pinned, onAction, roles, className }: { comments: LiveComment[]; pinned?: LiveComment | null; onAction?: (c: LiveComment) => void; roles?: Record<string, 'Host' | 'Mod'>; className?: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [comments.length]);
  return (
    <div className={cn('flex max-h-[38vh] flex-col gap-1.5', className)}>
      {pinned && (
        <div className="rounded-xl bg-white/90 px-3 py-2 text-sm text-foreground shadow">
          <span className="text-[10px] font-bold uppercase tracking-wide text-primary">📌 Pinned</span>
          <p><b>{pinned.name}</b> {pinned.text}</p>
        </div>
      )}
      <div className="flex flex-col gap-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_25%)]">
        {comments.map((c) => (
          <button
            type="button"
            key={c.id}
            onClick={() => onAction?.(c)}
            disabled={!onAction}
            className={cn('w-fit max-w-full rounded-2xl px-3 py-1.5 text-left text-sm text-white', c.kind === 'question' ? 'bg-primary/85' : c.kind === 'join' ? 'bg-transparent py-0.5 text-xs text-white/70' : 'bg-black/40 backdrop-blur-sm')}
          >
            {c.kind === 'question' && <HelpCircle className="mr-1 inline h-3.5 w-3.5" />}
            {roles?.[c.uid] && <span className={cn('mr-1 rounded px-1 py-px text-[10px] font-extrabold uppercase', roles[c.uid] === 'Host' ? 'bg-primary text-white' : 'bg-sky-500 text-white')}>{roles[c.uid]}</span>}
            <b className="mr-1.5">{c.name}</b>
            <span className="line-clamp-3 break-words">{c.text}</span>
          </button>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}

/** The item the host is showing right now, with Buy and Try on (live shopping). */
export function PinnedProduct({ product, onBuy, compact }: { product: Product; onBuy?: () => void; compact?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/95 p-2 pr-3 text-foreground shadow-lg">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={product.cutout || product.image} alt="" className="h-14 w-14 shrink-0 rounded-xl bg-muted object-contain p-1" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-primary">Now showing</p>
        <p className="truncate text-sm font-semibold">{product.name}</p>
        <p className="text-sm font-extrabold">{formatPrice(Number(product.price))}{product.stock != null && product.stock <= 3 && <span className="ml-2 text-xs font-semibold text-amber-600">{product.stock === 0 ? 'Sold out' : `${product.stock} left`}</span>}</p>
      </div>
      {!compact && (
        <div className="flex shrink-0 flex-col gap-1">
          <button type="button" onClick={onBuy} disabled={product.stock === 0} className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50">
            <ShoppingBag className="h-3.5 w-3.5" /> Buy
          </button>
          <Link href={`/mirror?item=${product.id}`} className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary">
            <Wand2 className="h-3.5 w-3.5" /> Try on
          </Link>
        </div>
      )}
    </div>
  );
}

/** The live typing box: grows up to four lines, Enter sends, Shift+Enter starts a new line; up to about 400 words. */
export function LiveInput({ value, onChange, placeholder, disabled }: { value: string; onChange: (v: string) => void; placeholder: string; disabled?: boolean }) {
  return (
    <textarea
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        e.currentTarget.style.height = 'auto';
        e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 104)}px`;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.form?.requestSubmit();
        }
      }}
      rows={1}
      maxLength={2500}
      disabled={disabled}
      placeholder={placeholder}
      className="max-h-[104px] min-h-11 w-full min-w-0 flex-1 resize-none rounded-3xl border-0 bg-white/20 px-4 py-2.5 text-sm text-white placeholder:text-white/70 focus:outline-none focus:ring-2 focus:ring-primary"
    />
  );
}

/** The host's heart goal as a thin bar under the top bar (like TikTok's live goals). */
export function HeartGoal({ likes, goal }: { likes: number; goal?: number }) {
  if (!goal) return null;
  const done = likes >= goal;
  return (
    <div className="pointer-events-none absolute inset-x-3 top-[60px] z-10 flex items-center gap-2 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
      <Heart className="h-3.5 w-3.5 shrink-0 fill-primary text-primary" />
      <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/25">
        <span className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.min(100, (likes / goal) * 100)}%` }} />
      </span>
      <span className="shrink-0 tabular-nums">{done ? <Check className="inline h-3.5 w-3.5" /> : null} {likes.toLocaleString()}/{goal.toLocaleString()}</span>
    </div>
  );
}

/** The host's poll: viewers tap an answer, everyone sees the share of each answer. */
export function PollCard({ poll, myVote, onVote, className }: { poll: LivePoll; myVote?: number | null; onVote?: (i: number) => void; className?: string }) {
  const showResults = myVote != null || !poll.open || !onVote;
  return (
    <div className={cn('w-full rounded-2xl bg-white/95 p-3 text-foreground shadow-lg', className)}>
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-primary"><BarChart3 className="h-3.5 w-3.5" /> {poll.open ? 'Poll' : 'Poll closed'} · {poll.total} {poll.total === 1 ? 'vote' : 'votes'}</p>
      <p className="mb-2 break-words text-sm font-semibold">{poll.question}</p>
      <div className="grid gap-1.5">
        {poll.options.map((o, i) => {
          const pct = poll.total ? Math.round((o.votes / poll.total) * 100) : 0;
          return (
            <button key={i} type="button" disabled={!poll.open || !onVote} onClick={() => onVote?.(i)} aria-pressed={myVote === i}
              className={cn('relative overflow-hidden rounded-xl border px-3 py-2 text-left text-sm font-medium transition', myVote === i ? 'border-primary' : 'border-border', poll.open && onVote && 'active:scale-[0.98]')}>
              {showResults && <span className="absolute inset-y-0 left-0 bg-primary/15 transition-[width] duration-500" style={{ width: `${pct}%` }} />}
              <span className="relative flex items-center gap-2">
                <span className="min-w-0 flex-1 break-words">{o.text}</span>
                {myVote === i && <Check className="h-4 w-4 shrink-0 text-primary" />}
                {showResults && <span className="shrink-0 text-xs font-bold tabular-nums">{pct}%</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Every item in the live as a strip that scrolls sideways, each with Buy and Try on (live shopping). */
export function ProductStrip({ products, pinnedId, onBuy }: { products: Product[]; pinnedId?: string | null; onBuy: (id: string) => void }) {
  return (
    <div className="-mx-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {products.map((p) => (
        <div key={p.id} className={cn('flex w-[150px] shrink-0 snap-start flex-col rounded-2xl bg-white/95 p-2 text-foreground shadow-lg', pinnedId === p.id && 'ring-2 ring-primary')}>
          <Link href={`/product?id=${p.id}`} className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.cutout || p.image} alt="" className="aspect-square w-full rounded-xl bg-muted object-contain p-1" />
            <p className="mt-1 truncate text-xs font-semibold">{p.name}</p>
            <p className="text-xs font-extrabold">{formatPrice(Number(p.price))}</p>
          </Link>
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            <button type="button" onClick={() => onBuy(p.id)} disabled={p.stock === 0} aria-label={`Buy ${p.name}`} className="flex items-center justify-center rounded-full bg-primary py-1.5 text-primary-foreground disabled:opacity-50"><ShoppingBag className="h-4 w-4" /></button>
            <Link href={`/mirror?item=${p.id}`} aria-label={`Try on ${p.name}`} className="flex items-center justify-center rounded-full bg-primary/10 py-1.5 text-primary"><Wand2 className="h-4 w-4" /></Link>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Other lives right now as cover pictures in a row that scrolls sideways (like Instagram and TikTok). */
export function LiveRail({ exclude, onDark, className }: { exclude?: string; onDark?: boolean; className?: string }) {
  const lives = useLives()?.lives.filter((l) => l.id !== exclude) ?? [];
  if (!lives.length) return <p className={cn('text-sm', onDark ? 'text-white/70' : 'text-muted-foreground', className)}>No other lives right now.</p>;
  return (
    <div className={cn('flex snap-x gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}>
      {lives.map((l) => (
        <Link key={l.id} href={`/live/watch?id=${l.id}`} className="relative block aspect-[9/14] w-28 shrink-0 snap-start overflow-hidden rounded-xl bg-gradient-to-br from-primary to-foreground shadow">
          {l.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={l.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />
          <span className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded bg-primary px-1 text-[9px] font-extrabold text-white"><Radio className="h-2.5 w-2.5" /> LIVE</span>
          <span className="absolute inset-x-1.5 bottom-1.5 text-white">
            <span className="flex items-center gap-1">
              <Avatar className="h-5 w-5 ring-1 ring-primary"><AvatarImage src={l.sellerAvatar ?? undefined} className="object-cover" /><AvatarFallback className="bg-primary text-[9px] text-primary-foreground">{l.sellerName.charAt(0)}</AvatarFallback></Avatar>
              <span className="min-w-0 truncate text-[11px] font-semibold">{l.sellerName}</span>
            </span>
            <span className="mt-0.5 line-clamp-2 block text-[11px] leading-tight">{l.title}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/** A frame from a <video> as a JPEG (the live's cover). */
export function snapFrame(video: HTMLVideoElement | null, mirror?: boolean): string | null {
  if (!video?.videoWidth) return null;
  const scale = Math.min(1, 720 / video.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d')!;
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

/** The live's cover picture: take it from the camera, or choose a photo. */
export function CoverPicker({ value, onChange, snap, dark }: { value: string | null; onChange: (dataUrl: string | null) => void; snap?: () => string | null; dark?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const btn = cn('flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition', dark ? 'border-white/30 text-white hover:bg-white/10' : 'hover:bg-muted');
  return (
    <div className="flex items-center gap-3">
      <span className="relative aspect-[9/14] w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="Cover" className="h-full w-full object-cover" />
        ) : <ImageUp className="absolute inset-0 m-auto h-6 w-6 text-muted-foreground" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
        {snap && <button type="button" className={btn} onClick={() => { const v = snap(); if (v) onChange(v); }}><Camera className="h-4 w-4 shrink-0" /> Snap</button>}
        <button type="button" className={btn} onClick={() => input.current?.click()}><ImageUp className="h-4 w-4 shrink-0" /> Photo</button>
      </div>
      <input ref={input} type="file" accept="image/*" className="sr-only" onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) onChange(await encodeCanvas(await fileToImage(file), { transparent: false, maxLength: 900_000, maxEdge: 1000 }));
      }} />
    </div>
  );
}
