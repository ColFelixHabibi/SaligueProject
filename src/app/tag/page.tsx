'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { GraduationCap, Hash, Play, Share2, Sparkles, TrendingUp } from 'lucide-react';
import ProductCard from '@/components/product-card';
import { hashtagsIn } from '@/components/rich-text';
import { SellerAvatar } from '@/components/seller-avatar';
import { profileHref } from '@/components/profile-avatar';
import { shareLink } from '@/components/share-sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useProductStore } from '@/hooks/use-product-store';
import { useT } from '@/lib/i18n';
import { useLessons } from '@/lib/lessons';
import { absoluteUrl } from '@/lib/paths';
import { similarTo } from '@/lib/recommend';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

const tagHref = (tag: string) => `/tag?t=${encodeURIComponent(tag)}`;
const textOf = (p: Product) => `${p.name} ${p.description ?? ''}`;
// How many tagged items before "related" items are no longer needed to fill the page.
const FILL_TO = 12;

/** Tags used most in items listed in the last two weeks — what people are tagging right now. */
function trendingTags(products: Product[], limit = 12, except?: string) {
  const since = Date.now() - 14 * 86_400_000;
  const counts = new Map<string, number>();
  for (const p of products) {
    if (p.status !== 'active' || (p.createdAt && Date.parse(p.createdAt) < since)) continue;
    for (const tag of new Set(hashtagsIn(textOf(p)))) if (tag !== except) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag, n]) => ({ tag, n }));
}

function TagChips({ tags, className }: { tags: { tag: string; n: number }[]; className?: string }) {
  return (
    <div className={cn('flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}>
      {tags.map(({ tag, n }) => (
        <Link key={tag} href={tagHref(tag)} className="shrink-0 rounded-full border bg-card px-3 py-1.5 text-sm font-semibold hover:border-primary hover:text-primary">
          #{tag} <span className="text-xs font-normal text-muted-foreground">{n}</span>
        </Link>
      ))}
    </div>
  );
}

/**
 * Everything with one #hashtag, and what is around it: the items and lessons that carry it (most liked or newest),
 * the people who use it most, tags used together with it, and — when only a few things carry it — items that look
 * like them or name the word without the #, marked as related rather than tagged.
 */
function TagView({ tag }: { tag: string }) {
  const t = useT();
  const { products, isInitialized } = useProductStore();
  const serverLessons = useLessons({ tag });
  const [order, setOrder] = useState<'top' | 'new'>('top');

  // The server finds lessons by text; keep only those really carrying the tag (#tag, not #tagging).
  const lessons = useMemo(() => serverLessons?.filter((l) => hashtagsIn(`${l.title} ${l.description}`).includes(tag)) ?? null, [serverLessons, tag]);
  const tagged = useMemo(() => {
    const list = products.filter((p) => p.status === 'active' && hashtagsIn(textOf(p)).includes(tag));
    return order === 'top'
      ? list.sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0))
      : list.sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));
  }, [products, tag, order]);

  // Tags people put together with this one, most often first.
  const related = useMemo(() => {
    const counts = new Map<string, number>();
    const texts = [...tagged.map(textOf), ...(lessons ?? []).map((l) => `${l.title} ${l.description}`)];
    for (const text of texts) for (const other of new Set(hashtagsIn(text))) if (other !== tag) counts.set(other, (counts.get(other) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([other, n]) => ({ tag: other, n }));
  }, [tagged, lessons, tag]);

  // The shops and teachers who use the tag most.
  const people = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; avatar?: string | null; n: number }>();
    for (const p of tagged) if (p.sellerId) byId.set(p.sellerId, { id: p.sellerId, name: p.seller, avatar: p.sellerAvatar, n: (byId.get(p.sellerId)?.n ?? 0) + 1 });
    for (const l of lessons ?? []) byId.set(l.authorId, { id: l.authorId, name: l.authorName, avatar: l.authorAvatar, n: (byId.get(l.authorId)?.n ?? 0) + 1 });
    return [...byId.values()].sort((a, b) => b.n - a.n).slice(0, 10);
  }, [tagged, lessons]);

  // When few items carry the tag: items that name the word without the #, then items that look like the tagged ones.
  const nearby = useMemo(() => {
    if (tagged.length >= FILL_TO) return [];
    const taken = new Set(tagged.map((p) => p.id));
    const word = new RegExp(`(^|[^\\p{L}\\p{N}_])${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu');
    const named = products.filter((p) => p.status === 'active' && !taken.has(p.id) && word.test(`${textOf(p)} ${p.type ?? ''} ${p.category ?? ''}`));
    named.forEach((p) => taken.add(p.id));
    const lookAlike = tagged.slice(0, 4).flatMap((p) => similarTo(p, products, 6, taken)).filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i);
    return [...named, ...lookAlike].slice(0, FILL_TO * 2 - tagged.length);
  }, [tagged, products, tag]);

  const trending = useMemo(() => trendingTags(products, 12, tag), [products, tag]);
  const count = tagged.length + (lessons?.length ?? 0);
  const loading = !isInitialized || lessons === null;

  return (
    <div className="container mx-auto space-y-5 px-3 py-4 min-[360px]:px-4 md:py-8">
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Hash className="h-7 w-7" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-extrabold">#{tag}</h1>
          <p className="text-sm text-muted-foreground">{count} {t('posts')}{people.length ? ` · ${people.length} ${t('people')}` : ''}</p>
        </div>
        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full border hover:bg-muted" aria-label={t('Share')} title={t('Share')}
          onClick={() => shareLink({ title: `#${tag}`, text: `#${tag} on Saligue`, url: absoluteUrl(tagHref(tag)) })}>
          <Share2 className="h-4 w-4" />
        </button>
      </div>

      {related.length > 0 && (
        <section className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Used with')}</p>
          <TagChips tags={related} />
        </section>
      )}

      {people.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {people.map((p) => (
            <Link key={p.id} href={profileHref(p.id)} className="flex w-16 shrink-0 flex-col items-center gap-1 text-center">
              <SellerAvatar src={p.avatar} name={p.name} className="h-12 w-12" />
              <span className="w-full truncate text-[11px] font-medium">{p.name}</span>
            </Link>
          ))}
        </div>
      )}

      {!!lessons?.length && (
        <section className="space-y-2">
          <p className="flex items-center gap-1.5 font-bold"><GraduationCap className="h-5 w-5 text-primary" /> {t('Lessons')}</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {lessons.map((l) => (
              <Link key={l.id} href={`/learn?lesson=${l.id}`} className="relative block aspect-[9/16] w-28 shrink-0 overflow-hidden rounded-xl bg-black text-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {l.poster && <img src={l.poster} alt="" className="h-full w-full object-cover opacity-90" />}
                <Play className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 fill-white" />
                <p className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/80 p-1.5 text-[11px] font-semibold">{l.title}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {loading ? <Skeleton className="h-64 rounded-2xl" /> : (
        <>
          {tagged.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                {(['top', 'new'] as const).map((o) => (
                  <button key={o} type="button" onClick={() => setOrder(o)} aria-pressed={order === o}
                    className={cn('rounded-full px-4 py-1.5 text-sm font-semibold', order === o ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground')}>
                    {o === 'top' ? t('Top') : t('Latest')}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">{tagged.map((p) => <ProductCard key={p.id} product={p} />)}</div>
            </section>
          )}
          {nearby.length > 0 && (
            <section className="space-y-3">
              <p className="flex items-center gap-1.5 font-bold"><Sparkles className="h-5 w-5 text-primary" /> {t('Related to')} #{tag}</p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">{nearby.map((p) => <ProductCard key={p.id} product={p} />)}</div>
            </section>
          )}
          {count === 0 && nearby.length === 0 && (
            <p className="py-12 text-center text-muted-foreground">{t('Nothing with this tag yet. Add it to an item or lesson description.')}</p>
          )}
        </>
      )}

      {trending.length > 0 && (
        <section className="space-y-1.5 border-t pt-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><TrendingUp className="h-4 w-4" /> {t('Trending tags')}</p>
          <TagChips tags={trending} />
        </section>
      )}
    </div>
  );
}

function TagFromQuery() {
  const tag = (useSearchParams().get('t') ?? '').toLowerCase().replace(/^#/, '');
  return tag ? <TagView tag={tag} /> : null;
}

export default function TagPage() {
  return (
    <Suspense>
      <TagFromQuery />
    </Suspense>
  );
}
