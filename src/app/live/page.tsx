'use client';

import Link from 'next/link';
import { Eye, Heart, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/auth-provider';
import { PageIntro } from '@/components/layout/page-intro';
import { SellerAvatar } from '@/components/seller-avatar';
import { useProductStore } from '@/hooks/use-product-store';
import { useElapsed, useLives, type Live } from '@/lib/lives';

function LiveCard({ live }: { live: Live }) {
  const elapsed = useElapsed(live.startedAt);
  const products = useProductStore((s) => s.products);
  const cover = products.find((p) => p.id === (live.pinnedProductId ?? live.productIds[0]));
  return (
    <Link href={`/live/watch?id=${live.id}`} className="group relative block aspect-[9/14] overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-foreground shadow-md">
      {live.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={live.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105" />
      ) : cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover.cutout || cover.image} alt="" className="absolute inset-0 h-full w-full object-contain p-8 opacity-90 transition group-hover:scale-105" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40" />
      <div className="absolute left-2 top-2 flex items-center gap-1.5">
        <span className="flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-[11px] font-extrabold text-white"><Radio className="h-3 w-3" /> LIVE</span>
        <span className="rounded-md bg-black/50 px-2 py-0.5 text-[11px] font-semibold text-white">{elapsed}</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 space-y-1.5 p-3 text-white">
        <p className="line-clamp-2 font-bold leading-snug">{live.title}</p>
        <div className="flex items-center gap-2">
          <SellerAvatar src={live.sellerAvatar} name={live.sellerName} className="h-7 w-7 ring-2 ring-primary" />
          <span className="min-w-0 flex-1 truncate text-sm">{live.sellerName}</span>
          <span className="flex items-center gap-0.5 text-xs"><Heart className="h-3.5 w-3.5 fill-current" />{live.likeCount}</span>
        </div>
      </div>
    </Link>
  );
}

/** Who is live right now; sellers start their own live from here. */
export default function LivesPage() {
  const lives = useLives();
  const { role } = useAuth();
  return (
    <div className="container mx-auto space-y-6 px-3 py-4 min-[360px]:px-4 md:py-8">
      <PageIntro icon={Radio} title="Live" subtitle="Shops showing their items on camera right now.">
        {role === 'seller' && <Button asChild><Link href="/live/studio"><Radio className="mr-2 h-4 w-4" /> Go live</Link></Button>}
      </PageIntro>
      {role === 'seller' && (
        <Button className="h-12 w-full rounded-full md:hidden" asChild><Link href="/live/studio"><Radio className="mr-2 h-5 w-5" /> Go live</Link></Button>
      )}
      {!lives ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[9/14] rounded-2xl" />)}</div>
      ) : lives.lives.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed py-20 text-center text-muted-foreground">
          <Eye className="mx-auto mb-3 h-10 w-10 text-primary" />
          <p className="font-semibold text-foreground">No one is live right now</p>
          <p className="mt-1 text-sm">{role === 'seller' ? 'Be the first: show your items on camera.' : 'You’ll get a notification when a shop you bought from goes live.'}</p>
          {role === 'seller' && <Button className="mt-4" asChild><Link href="/live/studio"><Radio className="mr-2 h-4 w-4" /> Go live</Link></Button>}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 min-[360px]:gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">{lives.lives.map((l) => <LiveCard key={l.id} live={l} />)}</div>
      )}
    </div>
  );
}
