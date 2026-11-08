'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { format, isToday, isYesterday } from 'date-fns';
import { Archive, ArchiveRestore, ArrowLeft, BadgeCheck, CheckCheck, Forward, Loader2, MessageCircle, Package, Search, Send, Store, Trash2, User, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { mediaUrl } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ask } from '@/components/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/components/auth/auth-provider';
import { useProductStore } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';
import { friendlyError } from '@/lib/errors';
import { productHref } from '@/lib/links';
import { clearConversation, forwardMessage, setArchived, useConversation, useInbox } from '@/lib/messages';
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

function ConversationRow({ c, active, onOpen, onClear, onArchive }: { c: Conversation; active: boolean; onOpen: () => void; onClear: () => void; onArchive: () => void }) {
  const t = useT();
  return (
    // The bin sits beside the row, not inside it: a button inside a button is not valid and swallows the tap.
    <div className={cn('group flex items-center rounded-xl transition-colors hover:bg-muted', active && 'bg-primary/10 hover:bg-primary/10')}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 text-left">
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
              {/* Shop or customer, as an icon: the avatar may be a photo, so this tells them apart. */}
              {c.role === 'buyer'
                ? <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Shop" />
                : <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Customer" />}
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
        </span>
      </button>
      {/* Puts the chat away, or brings it back: nothing is deleted and the other person is not told. */}
      <button
        type="button"
        onClick={onArchive}
        aria-label={`${c.archived ? t('Bring back the chat with') : t('Archive the chat with')} ${c.other.name}`}
        title={c.archived ? t('Bring back') : t('Archive')}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
      >
        {c.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
      </button>
      {/* Clears this chat for this account only. Always shown on a phone, on hover on a computer. */}
      <button
        type="button"
        onClick={onClear}
        aria-label={`${t('Clear chat')} · ${c.other.name}`}
        title={t('Clear chat')}
        className="mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
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

// onClear gets the thread's own conversation: one opened from a link may not be in the loaded list.
function Thread({ id, onBack, onClear }: { id: string; onBack: () => void; onClear: (c: Conversation) => void }) {
  const { authUid } = useAuth();
  const { toast } = useToast();
  const t = useT();
  const { data, error, send } = useConversation(id);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // The other chats, offered when a message is forwarded.
  const conversations = useInbox((s) => s.conversations);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
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

  /** Sends a copy of a message into another chat, marked "Forwarded". */
  const doForward = async (to: Conversation) => {
    if (!forwardingMessage) return;
    const source = forwardingMessage;
    setForwardingMessage(null);
    try {
      await forwardMessage(source.id, to.id);
      toast({ title: `${t('Forwarded to')} ${to.other.name}` });
    } catch (e) {
      toast({ variant: 'destructive', title: t('Could not forward that message'), description: friendlyError(e) });
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
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate font-semibold">{c.other.name}{c.other.official && <BadgeCheck className="h-4 w-4 text-primary" />}</p>
          <p className="text-xs text-muted-foreground">{c.role === 'buyer' ? 'Shop · usually replies in Saligue and by email' : c.other.isGuest ? 'Customer (guest, sees replies in the app)' : 'Customer'}</p>
        </div>
        <button
          type="button"
          onClick={() => onClear(c)}
          aria-label="Clear this chat"
          title="Clear chat"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-5 w-5" />
        </button>
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
                    {m.forwarded && (
                      <p className={cn('mb-0.5 flex items-center gap-1 text-[10px] font-semibold', mine ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                        <Forward className="h-3 w-3" /> {t('Forwarded')}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    <p className={cn('mt-0.5 flex items-center justify-end gap-1 text-[10px]', mine ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
                      {format(new Date(m.createdAt), 'HH:mm')}
                      {mine && m.id === lastMine?.id && otherReadAt && otherReadAt >= m.createdAt && <><CheckCheck className="h-3 w-3" /> Seen</>}
                      {/* Only what travels safely: the text, an item, an order (see the server's forward route). */}
                      {!m.deleted && (m.text || m.productId || m.orderId) && (
                        <button
                          type="button"
                          onClick={() => setForwardingMessage(m)}
                          aria-label={t('Forward this message')}
                          title={t('Forward this message')}
                          className={cn('rounded-full p-0.5', mine ? 'hover:bg-white/25' : 'hover:bg-muted')}
                        >
                          <Forward className="h-3 w-3" />
                        </button>
                      )}
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

      {/* Forwarding: pick the chat the copy goes to. */}
      {forwardingMessage && (
        <Dialog open onOpenChange={(open) => !open && setForwardingMessage(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{t('Forward to')}</DialogTitle>
              <DialogDescription>{t('The message, an item and an order travel with it. A photo or voice note stays where it was sent.')}</DialogDescription>
            </DialogHeader>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {conversations.filter((x) => x.id !== id).length === 0 && <p className="p-2 text-sm text-muted-foreground">{t('No other conversation to forward to yet.')}</p>}
              {conversations
                .filter((x) => x.id !== id)
                .map((x) => (
                  <button key={x.id} type="button" onClick={() => void doForward(x)} className="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-muted">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={mediaUrl(x.other.avatar ?? undefined)} alt="" className="object-cover" />
                      <AvatarFallback className="text-xs font-semibold">{initials(x.other.name)}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{x.other.name}</span>
                  </button>
                ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * The inbox and the open conversation. `base` is where it lives: /messages for shoppers, /dashboard/messages
 * for shops (inside Seller Center, so its menu stays).
 */
export function Inbox({ base = '/messages', embedded = false }: { base?: string; embedded?: boolean }) {
  const { role } = useAuth();
  const { toast } = useToast();
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get('c');
  const { conversations, isInitialized } = useInbox();
  const [query, setQuery] = useState('');
  const [showArchive, setShowArchive] = useState(false);
  const shown = useMemo(
    () => conversations.filter((c) => !query.trim() || c.other.name.toLowerCase().includes(query.trim().toLowerCase())),
    [conversations, query]
  );
  const open = (id: string | null) => router.replace(id ? `${base}?c=${id}` : base, { scroll: false });
  const active = shown.filter((c) => !c.archived);
  const archived = shown.filter((c) => c.archived);

  // Putting a chat away (or bringing it back): nothing is deleted and the other person is not told.
  const archive = async (c: Conversation) => {
    try {
      await setArchived(c.id, !c.archived);
      if (!c.archived && openId === c.id) open(null);
      toast({ title: c.archived ? t('Chat brought back') : t('Chat archived') });
    } catch (e) {
      toast({ variant: 'destructive', title: t('Could not archive this chat'), description: friendlyError(e) });
    }
  };

  // Clearing asks first: it is one tap away by accident and there is no undo in the app.
  const clear = async (c: Conversation) => {
    const answer = await ask({
      title: `${t('Clear chat')}: ${c.other.name}?`,
      description: t('It leaves your list and its messages stop showing here. The other person keeps their copy and is not told, and an order or a payment is never affected.'),
      confirm: t('Delete'),
      destructive: true,
    });
    if (!answer) return;
    try {
      await clearConversation(c.id);
      if (openId === c.id) open(null);
      toast({ title: t('Chat cleared') });
    } catch (e) {
      toast({ variant: 'destructive', title: t('Could not clear this chat'), description: friendlyError(e) });
    }
  };

  const none = isInitialized && conversations.length === 0 && !openId;
  return (
    <div className={cn('mx-auto flex flex-col', embedded
      ? '-mx-3 h-[calc(100dvh-17rem-var(--sat)-var(--sab))] min-h-[420px] w-[calc(100%+1.5rem)] min-[360px]:-mx-4 min-[360px]:w-[calc(100%+2rem)] md:mx-0 md:h-[calc(100dvh-15rem)] md:w-full'
       : 'w-full h-[calc(100dvh-8rem-var(--sat)-var(--sab))] max-w-6xl px-0 md:h-[100dvh] md:px-6 md:py-6')}>
      <div className="flex min-h-0 flex-1 overflow-hidden border-y bg-background md:rounded-2xl md:border md:shadow-sm">
        {/* No conversations at all: one message across the whole box, not an empty list beside an empty thread. */}
        <aside className={cn('flex w-full min-w-0 flex-col', !none && 'border-r md:w-80 lg:w-96', openId && 'hidden md:flex')}>
          <div className={cn('space-y-3 border-b p-4', none && embedded && 'hidden md:block')}>
            <h1 className={cn('text-2xl font-extrabold tracking-tight', embedded && 'hidden md:block')}>Messages</h1>
            <div className={cn('relative', none && 'hidden')}>
              <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations" className={cn('rounded-full pl-9', query && 'pr-10')} />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear the search"
                  title="Clear"
                  className="absolute inset-y-0 right-2 my-auto flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
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
                    {role === 'seller' ? (
                      <>
                        <p className="mt-1">Customers’ questions about your items arrive here.</p>
                        <Button asChild className="mt-4 rounded-full"><Link href="/sell">Add item</Link></Button>
                      </>
                    ) : (
                      <>
                        <p className="mt-1">Tap “Message seller” on any item to ask about sizes, price or delivery.</p>
                        <Button asChild className="mt-4 rounded-full"><Link href="/search">Explore items</Link></Button>
                      </>
                    )}
                  </>
                ) : (
                  'No conversation matches.'
                )}
              </div>
            ) : (
              <>
                {active.map((c) => (
                  <ConversationRow key={c.id} c={c} active={c.id === openId} onOpen={() => open(c.id)} onClear={() => void clear(c)} onArchive={() => void archive(c)} />
                ))}
                {/* Chats put away: out of the list until this is opened, and only on this account. */}
                {archived.length > 0 && (
                  <div className="mt-2 border-t pt-2">
                    <button
                      type="button"
                      onClick={() => setShowArchive((v) => !v)}
                      aria-expanded={showArchive}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-muted"
                    >
                      <Archive className="h-4 w-4" /> {t('Archived')} <span className="text-xs font-normal">({archived.length})</span>
                    </button>
                    {showArchive &&
                      archived.map((c) => (
                        <ConversationRow key={c.id} c={c} active={c.id === openId} onOpen={() => open(c.id)} onClear={() => void clear(c)} onArchive={() => void archive(c)} />
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>
        <section className={cn('min-w-0 flex-1 flex-col', openId ? 'flex' : none ? 'hidden' : 'hidden md:flex')}>
          {openId ? (
            <Thread id={openId} onBack={() => open(null)} onClear={(c) => void clear(c)} />
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

