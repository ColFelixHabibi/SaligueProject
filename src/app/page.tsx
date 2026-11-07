
'use client';

import { useFeatures } from '@/lib/features';

import { useT } from '@/lib/i18n';

import { useBlockedIds } from '@/lib/blocks';

import { mixSponsored, useSponsored } from '@/lib/ads';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, MapPin, PlusCircle, Radio, RefreshCw, Users } from 'lucide-react';
import { LessonFeed } from '@/components/community/lesson-feed';
import { LessonSlide } from '@/components/community/lesson-slide';
import { BreakReminder, CaughtUp } from '@/components/calm/break-reminder';
import { useLessons } from '@/lib/lessons';
import { cn } from '@/lib/utils';
import { useLives } from '@/lib/lives';
import { StoryBar } from '@/components/social/story-bar';
import { SellerAvatar } from '@/components/seller-avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FeedSlide } from '@/components/social/feed-slide';
import { FeedSidePanel } from '@/components/social/feed-side-panel';
import { retryProducts, useProductStore } from '@/hooks/use-product-store';
import { useLikesStore } from '@/hooks/use-likes';
import { useWishlistStore } from '@/hooks/use-wishlist';
import { forYou, similarTo } from '@/lib/recommend';
import { interests, sendInterestsNow } from '@/lib/taste';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { api } from '@/lib/api';
import { useCartStore } from '@/hooks/use-cart-store';
import { useOrders } from '@/lib/orders';
import type { Product } from '@/lib/types';

type FeedItem = { id: string; reason: string | null; resaliguedBy?: { id: string; name: string } };
type FriendRepost = { productId: string; at: string; by: { id: string; name: string } };
type Mode = 'foryou' | 'following' | 'local' | 'learn';
type SavedFeed = { feed: FeedItem[]; mode: Mode; current: string | null; at: number };
const FEED_STATE = 'saligue-feed-state';

// "For You": a full-screen, swipeable feed ranked by what the visitor likes and saves.
export default function ForYouPage() {
  const { products, isInitialized, error } = useProductStore();
  const { liked, isInitialized: likesInitialized } = useLikesStore();
  const { ids: savedIds, isInitialized: savesInitialized } = useWishlistStore();
  const cartEntries = useCartStore((s) => s.entries);
  const lives = useLives()?.lives ?? [];
  const orders = useOrders('buyer');
  const bought = useMemo(() => new Set((orders ?? []).filter((o) => o.status !== 'cancelled').flatMap((o) => o.items.map((i) => i.productId))), [orders]);
  // Refresh the ranking when catalog membership or ranking metadata changes, but
  // leave it stable when like counts update so slides do not jump while browsing.
  const catalogKey = products
    .map((p) => `${p.id}:${p.status}:${p.createdAt ?? ''}:${p.official ? 1 : 0}:${p.embedding?.join(',') ?? ''}`)
    .join('|');
  // Rank once per visit and when ranking metadata changes, not on every like or save.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // The server's feed, learned from everyone's behaviour (server/recommend.mjs); the device's own ranking
  // is used until it arrives or when offline.
  const [serverFeed, setServerFeed] = useState<FeedItem[] | null>(null);
  // Back from an item, a profile or another page: the feed comes back as it was (same order, same tab, same
  // item on screen) instead of starting over. Kept for this visit only (sessionStorage), for 30 minutes.
  const restoreTo = useRef<string | null>(null);
  const restored = useRef(false);
  const [mode, setMode] = useState<'foryou' | 'following' | 'local' | 'learn'>('foryou');
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(FEED_STATE) ?? 'null') as SavedFeed | null;
      if (!saved || Date.now() - saved.at > 30 * 60_000 || !Array.isArray(saved.feed) || !saved.feed.length) return;
      restored.current = true;
      restoreTo.current = saved.current;
      setServerFeed(saved.feed);
      setMode(saved.mode);
    } catch {
      // Storage blocked or old format: start fresh.
    }
  }, []);
  // The feed snaps to whole items, and the browser keeps the item it snapped to on screen when the order
  // changes: when the server's order replaces the phone's first guess, it would jump to wherever that item went.
  // So it goes back to the first item, unless the viewer already started scrolling.
  const touched = useRef(false);
  const toTop = useRef(false);
  useEffect(() => {
    if (!likesInitialized || restored.current) return;
    api<{ items: FeedItem[] }>('/feed').then((d) => {
      toTop.current = !touched.current;
      setServerFeed(d.items);
    }).catch(() => setServerFeed(null));
  }, [likesInitialized]);
  const reasons = useMemo(() => new Map((serverFeed ?? []).map((x) => [x.id, x.reason])), [serverFeed]);
  const resaliguers = useMemo(() => new Map((serverFeed ?? []).filter((x) => x.resaliguedBy).map((x) => [x.id, x.resaliguedBy!])), [serverFeed]);
  const ranked = useMemo(() => {
    if (serverFeed?.length) {
      const known = new Map(products.map((p) => [p.id, p]));
      return serverFeed.map((x) => known.get(x.id)).filter(Boolean) as Product[];
    }
    return forYou(products, liked, new Set(savedIds), { cart: new Set(Object.keys(cartEntries)), bought, interest: interests() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogKey, isInitialized, likesInitialized, savesInitialized, orders === null, serverFeed]);

  // "More like this": liking an item brings two look-alikes right after it.
  const [feed, setFeed] = useState<Product[]>([]);
  useEffect(() => setFeed(ranked), [ranked]);
  const knownLikes = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!likesInitialized) return;
    const before = knownLikes.current;
    knownLikes.current = new Set(liked);
    if (!before) return;
    const fresh = [...liked].filter((id) => !before.has(id));
    if (!fresh.length) return;
    setFeed((current) => {
      let next = [...current];
      for (const id of fresh) {
        const at = next.findIndex((p) => p.id === id);
        if (at < 0) continue;
        const shownSoFar = new Set(next.slice(0, at + 1).map((p) => p.id));
        const alike = similarTo(next[at], products, 2, shownSoFar);
        next = next.filter((p) => !alike.some((a) => a.id === p.id));
        next.splice(at + 1, 0, ...alike);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liked, likesInitialized]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const sponsored = useSponsored('feed', 3);

  // The viewer chooses what to watch: For You (picked for them), Network (only people they
  // follow, newest first), Local (shops in a city they choose) or Learn (Community fashion lessons).
  const [followingIds, setFollowingIds] = useState<Set<string> | null>(null);
  // Items the people you follow Resaligued (reposted), with who and when.
  const [friendReposts, setFriendReposts] = useState<FriendRepost[]>([]);
  const loadFollowing = async () => {
    const [ids, reposts] = await Promise.all([api<string[]>('/me/following'), api<FriendRepost[]>('/me/following/resaligues').catch(() => [])]);
    setFollowingIds(new Set(ids));
    setFriendReposts(reposts);
  };
  useEffect(() => {
    if (mode === 'following') loadFollowing().catch(() => setFollowingIds(new Set()));
  }, [mode]);
  const [city, setCity] = useState<string | null>(null);
  useEffect(() => {
    try {
      setCity(localStorage.getItem('saligue-city'));
    } catch {
      // Storage blocked.
    }
  }, []);
  const chooseCity = (c: string | null) => {
    setCity(c);
    try {
      if (c) localStorage.setItem('saligue-city', c);
      else localStorage.removeItem('saligue-city');
    } catch {
      // Storage blocked.
    }
  };
  const cities = useMemo(() => [...new Set(products.filter((p) => p.status === 'active' && p.shop?.city).map((p) => p.shop!.city.trim()))].sort(), [products]);
  // Following also brings lessons from teachers the viewer follows.
  const followedLessons = useLessons({ following: true });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const blocked = useBlockedIds();
  const tr = useT();
  const on = useFeatures();
  const shown = useMemo(() => {
    const active = feed.map((p) => byId.get(p.id)).filter((p): p is Product => p?.status === 'active' && !hidden.has(p.id) && !blocked.has(p.sellerId ?? ''));
    if (mode === 'following') return followingIds ? [...active].filter((p) => followingIds.has(p.sellerId ?? '')) : [];
    if (mode === 'local') return city ? active.filter((p) => p.shop?.city?.trim().toLowerCase() === city.toLowerCase()) : [];
    return active;
  }, [feed, byId, hidden, mode, followingIds, city, blocked]);
  // Following: the shops' own posts and what the people followed Resaligued, newest first, each item once.
  const followingEntries = useMemo(() => {
    if (mode !== 'following') return [];
    const entries = new Map<string, { p: Product; at: string; by: FriendRepost['by'] | null }>();
    for (const p of shown) entries.set(p.id, { p, at: p.createdAt ?? '', by: null });
    for (const r of friendReposts) {
      const p = byId.get(r.productId);
      if (!p || p.status !== 'active' || hidden.has(p.id) || blocked.has(p.sellerId ?? '') || blocked.has(r.by.id)) continue;
      if (!entries.has(p.id) || entries.get(p.id)!.at < r.at) entries.set(p.id, { p, at: r.at, by: r.by });
    }
    return [...entries.values()];
  }, [mode, shown, friendReposts, byId, hidden, blocked]);
  // Which item is on screen, for the panel beside the feed on computers.
  const scroller = useRef<HTMLDivElement>(null);
  // Pull down at the top (or tap For You again): a fresh mix, counting what was just watched.
  const refresh = async () => {
    await sendInterestsNow();
    const d = await api<{ items: { id: string; reason: string | null }[] }>(`/feed?r=${Date.now().toString(36)}`);
    setServerFeed(d.items);
    if (mode === 'following') await loadFollowing();
    scroller.current?.scrollTo({ top: 0 });
  };
  const { pull, refreshing, ready } = usePullToRefresh(scroller, refresh, mode !== 'learn');
  const [current, setCurrent] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setCurrent((e.target as HTMLElement).dataset.feedProduct ?? null);
    }, { root, threshold: 0.6 });
    const watch = () => root.querySelectorAll('[data-feed-product]').forEach((el) => io.observe(el));
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [mode]);
  // Remember where the viewer is, for coming back.
  useEffect(() => {
    if (!serverFeed?.length) return;
    try {
      sessionStorage.setItem(FEED_STATE, JSON.stringify({ feed: serverFeed, mode, current, at: Date.now() } satisfies SavedFeed));
    } catch {
      // Storage full or blocked: the feed simply starts over next time.
    }
  }, [serverFeed, mode, current]);
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const mark = () => (touched.current = true);
    root.addEventListener('touchstart', mark, { passive: true });
    root.addEventListener('wheel', mark, { passive: true });
    root.addEventListener('keydown', mark);
    return () => {
      root.removeEventListener('touchstart', mark);
      root.removeEventListener('wheel', mark);
      root.removeEventListener('keydown', mark);
    };
  }, []);
  useEffect(() => {
    if (!toTop.current || !serverFeed) return;
    toTop.current = false;
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: 0 }));
  }, [serverFeed]);
  // Back on the feed: scroll to the item that was on screen, once it is there.
  useEffect(() => {
    const id = restoreTo.current;
    const root = scroller.current;
    if (!id || !root) return;
    const el = root.querySelector<HTMLElement>(`[data-feed-product="${CSS.escape(id)}"]`);
    if (!el) return;
    restoreTo.current = null;
    root.scrollTo({ top: el.offsetTop });
  });

  const tabs = [
    { value: 'following', label: 'Network' },
    { value: 'local', label: 'Local' },
    { value: 'foryou', label: 'For You' },
    { value: 'learn', label: 'Learn' },
  ].filter((t) => t.value !== 'learn' || on('lessons')) as { value: 'following' | 'local' | 'foryou' | 'learn'; label: string }[];

  return (
    // Computers (lg): the feed column with a panel beside it about the item on screen; phones: the feed only.
    <div className="lg:flex lg:h-dvh lg:justify-center lg:gap-6 lg:bg-muted/50 lg:px-6">
    <div ref={scroller} className="relative mx-auto h-[calc(100dvh-8rem-var(--sat)-var(--sab))] max-w-md snap-y snap-mandatory overflow-y-auto overscroll-y-contain bg-background [scrollbar-width:none] md:h-dvh [&::-webkit-scrollbar]:hidden lg:mx-0 lg:w-[28rem] lg:shrink-0 lg:shadow-xl">
      {/* Pull to refresh: the spinner follows the finger, and turns once a refresh starts. */}
      <div className="pointer-events-none sticky top-0 z-[60] flex h-0 justify-center" aria-live="polite">
        {(pull > 0 || refreshing) && (
          <span className="mt-14 flex h-10 w-10 items-center justify-center rounded-full bg-background/95 shadow-md" style={{ transform: `translateY(${pull * 0.6}px)`, opacity: Math.min(1, pull / 50) || 1 }}>
            {refreshing ? <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label={tr('Refreshing')} /> : <RefreshCw className={cn('h-5 w-5', ready ? 'text-primary' : 'text-muted-foreground')} style={{ transform: `rotate(${pull * 2.5}deg)` }} />}
          </span>
        )}
      </div>
      {/* Says what this page is: a feed picked for you (Explore is the shop, the Fitting Room is for trying on). */}
      {/* What to watch: chosen by the viewer, not only by the algorithm. */}
      <div className="pointer-events-none sticky top-0 z-50 flex h-0 items-start justify-center">
        <nav className="pointer-events-auto mt-2 flex items-center gap-0.5 rounded-full bg-background/95 p-1 text-[13px] font-semibold shadow-md backdrop-blur">
          {tabs.map((t) => (
            <button key={t.value} type="button" aria-pressed={mode === t.value}
              onClick={() => {
                if (mode !== t.value) return setMode(t.value);
                if (t.value === 'learn' || refreshing) return;
                scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
                void refresh().catch(() => {});
              }}
              className={cn('rounded-full px-2.5 py-1', mode === t.value ? 'bg-primary text-primary-foreground' : 'text-foreground/70')}>{tr(t.label)}</button>
          ))}
        </nav>
      </div>
      <div className={cn('pointer-events-none sticky top-0 z-40 flex h-0 justify-start gap-3 px-3', mode !== 'foryou' && 'hidden')}>
        {/* Who is live: the seller's photo in a pink ring with a LIVE tag, like stories. */}
        {on('live') && lives.length > 0 && (
          <Link href={lives.length === 1 ? `/live/watch?id=${lives[0].id}` : '/live'} aria-label={`${lives.length} live now`} className="pointer-events-auto relative mt-14 flex flex-col items-center">
            <span className="rounded-full bg-gradient-to-tr from-primary to-[#e30613] p-[3px] shadow-lg">
              <SellerAvatar src={lives[0].sellerAvatar} name={lives[0].sellerName} className="h-12 w-12 ring-2 ring-background" />
            </span>
            <span className="-mt-2.5 flex items-center gap-0.5 rounded-md bg-primary px-1.5 py-px text-[10px] font-extrabold tracking-wide text-primary-foreground ring-2 ring-background">
              <Radio className="h-3 w-3" /> LIVE{lives.length > 1 ? ` ${lives.length}` : ''}
            </span>
          </Link>
        )}
        {/* Stories, beside the live ring: your own first, then everyone whose status you can watch. */}
        <StoryBar compact className="mt-14 min-w-0 flex-1" />
      </div>
      {mode === 'learn' ? (
        <LessonFeed breakReminder={false} className="h-full pt-0 [&>div:first-child]:top-12" />
      ) : !isInitialized ? (
        <Skeleton className="h-full w-full rounded-none" />
      ) : error ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-2xl font-bold">Couldn’t load the feed</p>
          <p className="text-muted-foreground">Check your connection and try again.</p>
          <Button onClick={retryProducts}>Retry</Button>
        </div>
      ) : mode === 'following' && followingIds && followingEntries.length === 0 && !followedLessons?.length ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <Users className="h-14 w-14 text-primary" />
          <p className="text-xl font-bold">{tr('Follow people to add them to your Network')}</p>
          <p className="text-muted-foreground">{tr('Only your Network, newest first. No algorithm.')}</p>
          <Button onClick={() => setMode('foryou')}>Find shops in For You</Button>
        </div>
      ) : mode === 'local' && !city ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 pt-20 text-center">
          <MapPin className="h-14 w-14 text-primary" />
          <p className="text-xl font-bold">{tr('Shops near you')}</p>
          <p className="text-muted-foreground">{tr('Choose your city. It stays on this phone only.')}</p>
          <div className="flex max-w-sm flex-wrap justify-center gap-2">
            {cities.map((c) => <Button key={c} variant="outline" className="rounded-full" onClick={() => chooseCity(c)}>{c}</Button>)}
          </div>
        </div>
      ) : mode === 'local' && shown.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <MapPin className="h-14 w-14 text-primary" />
          <p className="text-xl font-bold">Nothing in {city} yet</p>
          <Button variant="outline" onClick={() => chooseCity(null)}>Choose another city</Button>
        </div>
      ) : mode === 'following' ? (
        // Newest first from everyone followed: their items and their lessons together.
        [...followingEntries.map(({ p, at, by }) => ({ at, el: <FeedSlide key={p.id} product={p} reason={by ? `Resaligued by ${by.name}` : 'From your Network'} resaliguedBy={by} onHide={() => setHidden((h) => new Set(h).add(p.id))} /> })),
          ...(followedLessons ?? []).map((l) => ({ at: l.createdAt, el: <LessonSlide key={l.id} lesson={l} /> }))]
          .sort((a, b) => b.at.localeCompare(a.at))
          .map((x) => x.el)
          .concat(<CaughtUp key="caught-up" onLearn={() => setMode('learn')} />)
      ) : feed.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-2xl font-bold">Nothing here yet</p>
          <p className="text-muted-foreground">Be the first to post an item on Saligue.</p>
          <Button asChild>
            <Link href="/sell"><PlusCircle className="mr-2 h-4 w-4" /> Sell an item</Link>
          </Button>
        </div>
      ) : (
        // Live data (like counts) from the store, order from the ranking.
        mixSponsored(
          shown,
          // Ads only in For You: Following and Local show exactly what the viewer chose.
          (mode === 'foryou' ? sponsored : []).map((a) => ({ item: byId.get(a.productId)!, campaignId: a.serveId })).filter((a) => a.item?.status === 'active'),
          3,
          7
        ).map((p) => (
          <FeedSlide key={`${p.id}${p.sponsoredBy ?? ''}`} product={p} reason={p.sponsoredBy ? null : mode === 'local' ? `A shop in ${city}` : reasons.get(p.id) ?? null} sponsoredBy={p.sponsoredBy}
            resaliguedBy={p.sponsoredBy || mode !== 'foryou' ? null : resaliguers.get(p.id) ?? null}
            onHide={() => setHidden((h) => new Set(h).add(p.id))} />
        )).concat(<CaughtUp key="caught-up" onLearn={() => setMode('learn')} />)
      )}
      <BreakReminder />
    </div>
    {wide && mode !== 'learn' && (
      <aside className="hidden h-dvh w-[22rem] shrink-0 overflow-y-auto py-6 lg:block xl:w-[26rem]">
        <FeedSidePanel product={byId.get(current ?? '') ?? shown[0] ?? null} />
      </aside>
    )}
    </div>
  );
}
