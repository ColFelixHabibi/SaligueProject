'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { BadgeCheck, Eye, HelpCircle, MicOff, ShoppingBag, VideoOff, Wand2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { attach, type Burst, type Live, type LiveComment, type Tile } from '@/lib/live';
import { formatPrice } from '@/lib/orders';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

function VideoView({ tile, cover }: { tile: Tile; cover?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => attach(tile.video, video.current), [tile.video]);
  // Your own voice is never played back to you.
  useEffect(() => (tile.isLocal ? () => {} : attach(tile.audio, audio.current)), [tile.audio, tile.isLocal]);
  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-neutral-900', tile.speaking && tile.role === 'guest' && 'ring-4 ring-inset ring-primary')}>
      {tile.video ? (
        <video ref={video} autoPlay playsInline muted={tile.isLocal} className={cn('h-full w-full', cover ? 'object-cover' : 'object-contain', tile.isLocal && 'scale-x-[-1]')} />
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
export function LiveStage({ tiles, waiting }: { tiles: Tile[]; waiting: string }) {
  if (!tiles.length) {
    return <div className="flex h-full w-full items-center justify-center bg-neutral-900 p-8 text-center text-white/80">{waiting}</div>;
  }
  if (tiles.length === 1) return <VideoView tile={tiles[0]} cover />;
  return (
    <div className={cn('grid h-full w-full gap-0.5 bg-black', tiles.length === 2 ? 'grid-rows-2' : 'grid-cols-2 grid-rows-2')}>
      {tiles.map((t) => <VideoView key={t.identity} tile={t} cover />)}
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
export function LiveTopBar({ live, viewers, elapsed, children }: { live: Live; viewers: number; elapsed: string; children?: React.ReactNode }) {
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-3 pb-10">
      <div className="flex min-w-0 items-center gap-2 rounded-full bg-black/35 p-1 pr-3 text-white backdrop-blur">
        <Avatar className="h-9 w-9 ring-2 ring-primary">
          <AvatarImage src={live.sellerAvatar ?? undefined} className="object-cover" />
          <AvatarFallback className="bg-primary text-primary-foreground">{live.sellerName.charAt(0)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 leading-tight">
          <p className="flex items-center gap-1 truncate text-sm font-bold">{live.sellerName}{live.official && <BadgeCheck className="h-3.5 w-3.5" />}</p>
          <p className="truncate text-[11px] text-white/80">{live.likeCount.toLocaleString()} likes</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className={cn('rounded-md px-2 py-1 text-xs font-extrabold tracking-wide text-white', live.status === 'live' ? 'bg-primary' : 'bg-neutral-600')}>
          {live.status === 'live' ? 'LIVE' : 'ENDED'} · {elapsed}
        </span>
        <span className="flex items-center gap-1 rounded-md bg-black/45 px-2 py-1 text-xs font-semibold text-white"><Eye className="h-3.5 w-3.5" /> {viewers}</span>
        {children}
      </div>
    </div>
  );
}

/** Chat over the video, newest at the bottom; questions and the pinned comment stand out. */
export function LiveChat({ comments, pinned, onAction, className }: { comments: LiveComment[]; pinned?: LiveComment | null; onAction?: (c: LiveComment) => void; className?: string }) {
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
