
'use client';

import { useFeatures } from '@/lib/features';

import { useT } from '@/lib/i18n';

import { useBlockedIds } from '@/lib/blocks';

import { mixSponsored, useSponsored } from '@/lib/ads';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { MapPin, PlusCircle, Radio, Users } from 'lucide-react';
import { LessonFeed } from '@/components/community/lesson-feed';
import { LessonSlide } from '@/components/community/lesson-slide';
import { BreakReminder, CaughtUp } from '@/components/calm/break-reminder';
import { useLessons } from '@/lib/lessons';
import { cn } from '@/lib/utils';
import { useLives } from '@/lib/lives';
import { SellerAvatar } from '@/components/seller-avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FeedSlide } from '@/components/social/feed-slide';
import { retryProducts, useProductStore } from '@/hooks/use-product-store';
import { useLikesStore } from '@/hooks/use-likes';
import { useWishlistStore } from '@/hooks/use-wishlist';
import { forYou, similarTo } from '@/lib/recommend';
import { interests } from '@/lib/taste';
import { api } from '@/lib/api';
import { useCartStore } from '@/hooks/use-cart-store';
import { useOrders } from '@/lib/orders';
import type { Product } from '@/lib/types';

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
  const [serverFeed, setServerFeed] = useState<{ id: string; reason: string | null }[] | null>(null);
  useEffect(() => {
    if (!likesInitialized) return;
    api<{ items: { id: string; reason: string | null }[] }>('/feed').then((d) => setServerFeed(d.items)).catch(() => setServerFeed(null));
  }, [likesInitialized]);
  const reasons = useMemo(() => new Map((serverFeed ?? []).map((x) => [x.id, x.reason])), [serverFeed]);
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

  // The viewer chooses what to watch: For You (picked for them), Following (only shops and teachers they
  // follow, newest first), Local (shops in a city they choose) or Learn (Community fashion lessons).
  const [mode, setMode] = useState<'foryou' | 'following' | 'local' | 'learn'>('foryou');
  const [followingIds, setFollowingIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (mode === 'following') api<string[]>('/me/following').then((ids) => setFollowingIds(new Set(ids))).catch(() => setFollowingIds(new Set()));
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
    if (mode === 'following') return followingIds ? [...active].filter((p) => followingIds.has(p.sellerId ?? '')).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')) : [];
    if (mode === 'local') return city ? active.filter((p) => p.shop?.city?.trim().toLowerCase() === city.toLowerCase()) : [];
    return active;
  }, [feed, byId, hidden, mode, followingIds, city, blocked]);
  const tabs = [
    { value: 'following', label: 'Following' },
    { value: 'local', label: 'Local' },
    { value: 'foryou', label: 'For You' },
    { value: 'learn', label: 'Learn' },
  ].filter((t) => t.value !== 'learn' || on('lessons')) as { value: 'following' | 'local' | 'foryou' | 'learn'; label: string }[];

  return (
    <div className="relative mx-auto h-[calc(100dvh-4rem-4rem)] max-w-md snap-y snap-mandatory overflow-y-auto bg-background md:h-dvh">
      {/* Says what this page is: a feed picked for you (Explore is the shop, the Fitting Room is for trying on). */}
      {/* What to watch: chosen by the viewer, not only by the algorithm. */}
      <div className="pointer-events-none sticky top-0 z-50 flex h-0 items-start justify-center">
        <nav className="pointer-events-auto mt-2 flex items-center gap-0.5 rounded-full bg-background/95 p-1 text-[13px] font-semibold shadow-md backdrop-blur">
          {tabs.map((t) => (
            <button key={t.value} type="button" onClick={() => setMode(t.value)} aria-pressed={mode === t.value}
              className={cn('rounded-full px-2.5 py-1', mode === t.value ? 'bg-primary text-primary-foreground' : 'text-foreground/70')}>{tr(t.label)}</button>
          ))}
        </nav>
      </div>
      <div className={cn('pointer-events-none sticky top-0 z-40 flex h-0 justify-start px-3', mode !== 'foryou' && 'hidden')}>
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
      ) : mode === 'following' && followingIds && shown.length === 0 && !followedLessons?.length ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <Users className="h-14 w-14 text-primary" />
          <p className="text-xl font-bold">{tr('Follow shops and teachers to see them here')}</p>
          <p className="text-muted-foreground">{tr('Only people you follow, newest first. No algorithm.')}</p>
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
        [...shown.map((p) => ({ at: p.createdAt ?? '', el: <FeedSlide key={p.id} product={p} reason="From a shop you follow" onHide={() => setHidden((h) => new Set(h).add(p.id))} /> })),
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
            onHide={() => setHidden((h) => new Set(h).add(p.id))} />
        )).concat(<CaughtUp key="caught-up" onLearn={() => setMode('learn')} />)
      )}
      <BreakReminder />
    </div>
  );
}
