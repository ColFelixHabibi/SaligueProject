'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageCircle, MessageCircleOff } from 'lucide-react';
import { GiftBanner, Hearts } from '@/components/live/live-parts';
import { RichText } from '@/components/rich-text';
import { api } from '@/lib/api';
import type { Burst, Live, LiveComment } from '@/lib/lives';
import { cn } from '@/lib/utils';

type Chat = { comments: (LiveComment & { at: number })[]; hearts: { count: number; emoji: string; at: number }[] };

/**
 * A finished live, watched again: the recording, with the chat, gifts and hearts coming back at the moment they
 * happened (like being there), and a button to hide the chat.
 */
export function ReplayPlayer({ live }: { live: Live }) {
  const video = useRef<HTMLVideoElement>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [t, setT] = useState(0);
  const [showChat, setShowChat] = useState(true);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [gift, setGift] = useState<{ key: number; from: string; emoji: string; name: string } | null>(null);
  const last = useRef(0);
  useEffect(() => {
    api<Chat>(`/lives/${live.id}/replay-chat`).then(setChat).catch(() => setChat({ comments: [], hearts: [] }));
  }, [live.id]);

  // As the video plays: hearts and gifts from the moment just played appear now (not again after seeking back).
  const onTime = () => {
    const now = video.current?.currentTime ?? 0;
    const from = last.current;
    last.current = now;
    setT(now);
    if (!chat || now < from || now - from > 2) return;
    const fresh = chat.hearts.filter((h) => h.at > from && h.at <= now);
    if (fresh.length) {
      const added = fresh.flatMap((h) => Array.from({ length: Math.min(4, h.count) }, () => ({ id: Math.random(), emoji: h.emoji, x: Math.random() * 70 })));
      setBursts((b) => [...b.slice(-30), ...added]);
      setTimeout(() => setBursts((b) => b.filter((x) => !added.includes(x))), 2700);
    }
    const g = chat.comments.find((c) => c.gift && c.at > from && c.at <= now);
    if (g?.gift) {
      const key = Date.now();
      setGift({ key, from: g.name, emoji: g.gift.emoji, name: g.gift.name });
      setTimeout(() => setGift((x) => (x?.key === key ? null : x)), 4000);
    }
  };
  const visible = (chat?.comments ?? []).filter((c) => c.at <= t).slice(-6);

  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-sm overflow-hidden rounded-2xl bg-black shadow-lg">
      <video ref={video} src={live.replay!.video} poster={live.replay!.poster ?? live.thumbnail ?? undefined} controls playsInline autoPlay
        onTimeUpdate={onTime} onSeeked={() => { last.current = video.current?.currentTime ?? 0; }} className="h-full w-full object-contain" />
      <Hearts bursts={bursts} />
      <GiftBanner gift={gift} />
      {showChat && visible.length > 0 && (
        <div className="pointer-events-none absolute inset-x-2 bottom-16 space-y-1 text-left [mask-image:linear-gradient(to_bottom,transparent,black_30%)]">
          {visible.map((c) => (
            <p key={c.id} className={cn('w-fit max-w-[85%] rounded-2xl bg-black/45 px-2.5 py-1 text-xs text-white', c.kind === 'question' && 'bg-primary/80', c.gift && 'bg-amber-500/80')}>
              <b className="mr-1">{c.name}</b>
              {c.gift ? <>sent {c.gift.emoji} {c.gift.name}</> : <RichText text={c.text} />}
            </p>
          ))}
        </div>
      )}
      <button type="button" onClick={() => setShowChat((v) => !v)} aria-pressed={showChat} aria-label={showChat ? 'Hide chat' : 'Show chat'} title={showChat ? 'Hide chat' : 'Show chat'}
        className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white">
        {showChat ? <MessageCircleOff className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
      </button>
    </div>
  );
}
