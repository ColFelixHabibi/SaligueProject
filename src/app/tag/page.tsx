'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { GraduationCap, Hash, Play, Share2 } from 'lucide-react';
import ProductCard from '@/components/product-card';
import { hashtagsIn } from '@/components/rich-text';
import { shareLink } from '@/components/share-sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useProductStore } from '@/hooks/use-product-store';
import { useT } from '@/lib/i18n';
import { useLessons } from '@/lib/lessons';
import { absoluteUrl } from '@/lib/paths';

/** Everything with one #hashtag: items (name or description) and lessons. */
function TagView({ tag }: { tag: string }) {
  const t = useT();
  const { products, isInitialized } = useProductStore();
  const lessons = useLessons({ tag });
  const items = products.filter((p) => p.status === 'active' && hashtagsIn(`${p.name} ${p.description ?? ''}`).includes(tag));
  const count = items.length + (lessons?.length ?? 0);
  return (
    <div className="container mx-auto space-y-5 px-3 py-4 min-[360px]:px-4 md:py-8">
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Hash className="h-7 w-7" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-extrabold">#{tag}</h1>
          <p className="text-sm text-muted-foreground">{count} {t('posts')}</p>
        </div>
        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full border hover:bg-muted" aria-label={t('Share')} title={t('Share')}
          onClick={() => shareLink({ title: `#${tag}`, text: `#${tag} on Saligue`, url: absoluteUrl(`/tag?t=${encodeURIComponent(tag)}`) })}>
          <Share2 className="h-4 w-4" />
        </button>
      </div>
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
      {!isInitialized ? <Skeleton className="h-64 rounded-2xl" /> : items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">{items.map((p) => <ProductCard key={p.id} product={p} />)}</div>
      ) : lessons !== null && !lessons.length && (
        <p className="py-12 text-center text-muted-foreground">{t('Nothing with this tag yet. Add it to an item or lesson description.')}</p>
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
