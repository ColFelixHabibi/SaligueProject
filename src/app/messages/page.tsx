'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { format, isToday, isYesterday } from 'date-fns';
import { ArrowLeft, BadgeCheck, CheckCheck, Loader2, MessageCircle, Package, Search, Send, Store } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { mediaUrl } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/components/auth/auth-provider';
import { useProductStore } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { productHref } from '@/lib/links';
import { useConversation, useInbox } from '@/lib/messages';
import { formatPrice, shortOrderId } from '@/lib/orders';
import type { Conversation, Message } from '@/lib/types';
import { cn } from '@/lib/utils';

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

function when(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'd MMM');
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEEE d MMMM yyyy');
}

function ConversationRow({ c, active, onOpen }: { c: Conversation; active: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted', active && 'bg-primary/10 hover:bg-primary/10')}
    >
      <Avatar className="h-11 w-11 shrink-0">
        <AvatarImage src={mediaUrl(c.other.avatar ?? undefined)} alt="" className="object-cover" />
        <AvatarFallback className={cn('font-semibold', c.role === 'buyer' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>
          {c.role === 'buyer' ? <Store className="h-5 w-5" /> : initials(c.other.name)}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={cn('flex min-w-0 items-center gap-1 truncate', c.unread ? 'font-bold' : 'font-semibold')}>
            <span className="truncate">{c.other.name}</span>
            {c.other.official && <BadgeCheck className="h-4 w-4 shrink-0 text-primary" />}
          </span>
          {c.lastMessage && <span className={cn('shrink-0 text-xs', c.unread ? 'font-semibold text-primary' : 'text-muted-foreground')}>{when(c.lastMessage.createdAt)}</span>}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={cn('truncate text-sm', c.unread ? 'text-foreground' : 'text-muted-foreground')}>
            {c.lastMessage ? `${c.lastMessage.fromMe ? 'You: ' : ''}${c.lastMessage.text}` : 'No messages yet'}
          </span>
          {c.unread > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{c.unread}</span>
          )}
        </span>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.role === 'buyer' ? 'Shop' : 'Customer'}</span>
      </span>
    </button>
  );
}

function ItemCard({ productId }: { productId: string }) {
  const product = useProductStore((s) => s.products.find((p) => p.id === productId));
  if (!product) return null;
  return (
    <Link href={productHref(product)} className="mb-1.5 flex items-center gap-2 rounded-lg border bg-background/90 p-1.5 text-foreground hover:border-primary">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={product.cutout || product.image} alt="" className="h-12 w-12 rounded-md bg-muted object-contain p-0.5" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">{product.name}</span>
        <span className="block text-xs font-bold text-primary">{formatPrice(Number(product.price))}</span>
      </span>
    </Link>
  );
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const { authUid } = useAuth();
  const { toast } = useToast();
  const { data, error, send } = useConversation(id);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages.length]);

  const submit = async () => {
    const message = text.trim();
    if (!message) return;
    setSending(true);
    try {
      await send(message);
      setText('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Message not sent', description: friendlyError(e) });
    } finally {
      setSending(false);
    }
  };

  if (error) return <div className="flex flex-1 items-center justify-center p-8 text-center text-muted-foreground">{error}</div>;
  if (!data) return <div className="flex-1 space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className={cn('h-12 w-2/3 rounded-2xl', i % 2 && 'ml-auto')} />)}</div>;

  const { conversation: c, messages, otherReadAt } = data;
  const lastMine = [...messages].reverse().find((m) => m.senderId === authUid);
  const groups: { day: string; items: Message[] }[] = [];
  for (const m of messages) {
    const day = dayLabel(m.createdAt);
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
    groups.at(-1)!.items.push(m);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-3 py-2.5">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Avatar className="h-10 w-10">
          <AvatarImage src={mediaUrl(c.other.avatar ?? undefined)} alt="" className="object-cover" />
          <AvatarFallback className={cn('font-semibold', c.role === 'buyer' ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
            {c.role === 'buyer' ? <Store className="h-5 w-5" /> : initials(c.other.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="flex items-center gap-1 truncate font-semibold">{c.other.name}{c.other.official && <BadgeCheck className="h-4 w-4 text-primary" />}</p>
          <p className="text-xs text-muted-foreground">{c.role === 'buyer' ? 'Shop · usually replies in Saligue and by email' : c.other.isGuest ? 'Customer (guest, sees replies in the app)' : 'Customer'}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-muted/30 px-3 py-4">
        {messages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Say hello 👋</p>}
        {groups.map((g) => (
          <div key={g.day} className="space-y-2">
            <p className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.day}</p>
            {g.items.map((m) => {
              const mine = m.senderId === authUid;
              return (
                <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm', mine ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-background')}>
                    {m.productId && <ItemCard productId={m.productId} />}
                    {m.orderId && (
                      <Link href={c.role === 'seller' ? '/dashboard/orders' : '/orders'} className={cn('mb-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold', mine ? 'bg-white/20' : 'bg-muted')}>
                        <Package className="h-3.5 w-3.5" /> Order #{shortOrderId(m.orderId)}
                      </Link>
                    )}
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    <p className={cn('mt-0.5 flex items-center justify-end gap-1 text-[10px]', mine ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
                      {format(new Date(m.createdAt), 'HH:mm')}
                      {mine && m.id === lastMine?.id && otherReadAt && otherReadAt >= m.createdAt && <><CheckCheck className="h-3 w-3" /> Seen</>}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form
        className="flex items-end gap-2 border-t bg-background p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Write a message…"
          maxLength={3000}
          rows={1}
          className="max-h-32 min-h-11 resize-none rounded-2xl"
        />
        <Button type="submit" size="icon" className="h-11 w-11 shrink-0 rounded-full" disabled={sending || !text.trim()} aria-label="Send">
          {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </Button>
      </form>
    </div>
  );
}

function Inbox() {
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get('c');
  const { conversations, isInitialized } = useInbox();
  const [query, setQuery] = useState('');
  const shown = useMemo(
    () => conversations.filter((c) => !query.trim() || c.other.name.toLowerCase().includes(query.trim().toLowerCase())),
    [conversations, query]
  );
  const open = (id: string | null) => router.replace(id ? `/messages?c=${id}` : '/messages', { scroll: false });

  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem-env(safe-area-inset-bottom))] max-w-6xl flex-col px-0 md:h-[100dvh] md:px-6 md:py-6">
      <div className="flex min-h-0 flex-1 overflow-hidden border-y bg-background md:rounded-2xl md:border md:shadow-sm">
        <aside className={cn('flex w-full min-w-0 flex-col border-r md:w-80 lg:w-96', openId && 'hidden md:flex')}>
          <div className="space-y-3 border-b p-4">
            <h1 className="text-2xl font-extrabold tracking-tight">Messages</h1>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations" className="rounded-full pl-9" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {!isInitialized ? (
              [0, 1, 2].map((i) => <Skeleton key={i} className="mb-2 h-16 w-full rounded-xl" />)
            ) : shown.length === 0 ? (
              <div className="px-6 py-16 text-center text-sm text-muted-foreground">
                <MessageCircle className="mx-auto mb-3 h-10 w-10 text-primary" />
                {conversations.length === 0 ? (
                  <>
                    <p className="font-semibold text-foreground">No conversations yet</p>
                    <p className="mt-1">Tap “Message seller” on any item to ask about sizes, price or delivery.</p>
                    <Button asChild className="mt-4 rounded-full"><Link href="/search">Explore items</Link></Button>
                  </>
                ) : (
                  'No conversation matches.'
                )}
              </div>
            ) : (
              shown.map((c) => <ConversationRow key={c.id} c={c} active={c.id === openId} onOpen={() => open(c.id)} />)
            )}
          </div>
        </aside>
        <section className={cn('min-w-0 flex-1 flex-col', openId ? 'flex' : 'hidden md:flex')}>
          {openId ? (
            <Thread id={openId} onBack={() => open(null)} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
              <MessageCircle className="h-12 w-12 text-primary" />
              <p className="font-semibold text-foreground">Talk directly with shops and customers</p>
              <p className="max-w-sm text-sm">Choose a conversation. Messages arrive instantly, and an email lets the other side know.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="p-8"><Skeleton className="h-96 w-full" /></div>}>
      <Inbox />
    </Suspense>
  );
}
