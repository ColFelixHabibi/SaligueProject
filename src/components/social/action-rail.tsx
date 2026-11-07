
'use client';

import { shareLink } from '@/components/share-sheet';
import { useFeatures } from '@/lib/features';

import Link from 'next/link';
import { Bookmark, Heart, MessageCircle, Repeat2, Share2, Wand2 } from 'lucide-react';
import { toggleResaligue, useResaligued } from '@/hooks/use-resaligues';
import { useAuth } from '@/components/auth/auth-provider';
import { useT } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { toggleLike, useLiked } from '@/hooks/use-likes';
import { useWishlist, useWishlistStore } from '@/hooks/use-wishlist';
import { friendlyError } from '@/lib/errors';
import { productHref } from '@/lib/links';
import { absoluteUrl } from '@/lib/paths';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useHideLikes } from '@/lib/hide-likes';

function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

interface ActionRailProps {
  product: Product;
  commentsOpen: boolean;
  onToggleComments: () => void;
  // "overlay": a column of round buttons over an image (feed); "bar": a compact row below an image (cards).
  variant: 'overlay' | 'bar';
  // Leave out "Wear it" where the page already has a big Wear it button.
  hideWearIt?: boolean;
}

/**
 * Like (public count) · Comments · Save (private) · Wear it · Share. Add to a look is in the ••• menu,
 * and everything added to the cart is kept in the "Added to cart" collection.
 * Works for guests too — no login needed.
 */
export function ActionRail({ product, commentsOpen, onToggleComments, variant, hideWearIt }: ActionRailProps) {
  const { toast } = useToast();
  const on = useFeatures();
  const liked = useLiked(product.id);
  const likeCount = Math.max(0, (product.likeCount ?? 0));
  const hideLikes = useHideLikes();
  const saved = useWishlistStore((s) => s.ids.includes(product.id));
  const { addToWishlist, removeFromWishlist } = useWishlist();
  const resaligued = useResaligued(product.id);
  const { user } = useAuth();
  const t = useT();
  const mine = !!user && user.uid === product.sellerId;
  const saveCount = Math.max(0, product.saveCount ?? 0);
  const resaligueCount = Math.max(0, product.repostCount ?? 0);

  const run = (action: () => Promise<unknown>) => action().catch((error) => toast({ variant: 'destructive', title: 'Try again', description: friendlyError(error) }));

  const share = async () => {
    await shareLink({ title: product.name, text: `${product.name} on Saligue`, url: absoluteUrl(productHref(product)) });
  };

  const overlay = variant === 'overlay';
  const button = cn(
    'flex items-center gap-1 text-xs font-semibold transition-transform active:scale-90',
    overlay ? 'flex-col text-foreground' : 'min-w-0 rounded-full p-2 text-foreground hover:bg-muted'
  );
  // On the feed every icon sits centred in the same white circle (one size, one line weight), so the column lines up and reads on any photo.
  const icon = (Glyph: typeof Heart, active = false, fill = '') =>
    overlay ? (
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-background/90 shadow [@media(max-height:700px)]:h-10 [@media(max-height:700px)]:w-10">
        <Glyph className={cn('h-6 w-6 [@media(max-height:700px)]:h-5 [@media(max-height:700px)]:w-5', active && fill)} strokeWidth={2} />
      </span>
    ) : (
      <Glyph className={cn('h-5 w-5', active && fill)} />
    );

  return (
    <div className={cn(overlay ? 'flex flex-col items-center gap-4 [@media(max-height:700px)]:gap-2' : 'flex flex-wrap items-center justify-between gap-x-1')}>
      <button type="button" className={button} onClick={() => run(() => toggleLike(product.id))} aria-pressed={liked} aria-label="Like" title="Like">
        {icon(Heart, liked, 'fill-primary text-primary')}
        {likeCount > 0 && !hideLikes && <span>{compact(likeCount)}</span>}
      </button>
      {on('comments') && <button type="button" className={button} onClick={onToggleComments} aria-expanded={commentsOpen} aria-label="Comments" title="Comments">
        {icon(MessageCircle, commentsOpen, 'fill-current')}
      </button>}
      <button type="button" className={button} onClick={() => run(() => (saved ? removeFromWishlist(product.id) : addToWishlist(product)))} aria-pressed={saved} aria-label={saved ? 'Saved' : 'Save'} title={saved ? 'Saved' : 'Save'}>
        {icon(Bookmark, saved, 'fill-current')}
        {saveCount > 0 && <span>{compact(saveCount)}</span>}
      </button>
      {/* Resaligue: repost to your clients' Network, with how many have resaligued it. */}
      {!mine && (
        <button type="button" className={button} onClick={() => run(async () => { const now = await toggleResaligue(product.id); toast({ title: now ? t('Resaligued') : t('Resaligue removed') }); })} aria-pressed={resaligued} aria-label={t('Resaligue')} title={t('Resaligue')}>
          {icon(Repeat2, resaligued, 'text-primary')}
          {resaligueCount > 0 && <span>{compact(resaligueCount)}</span>}
        </button>
      )}
      {!hideWearIt && (
        <Link href={`/mirror?item=${product.id}`} className={button} aria-label="Wear it" title="Wear it">
          {icon(Wand2)}
        </Link>
      )}
      <button type="button" className={button} onClick={share} aria-label="Share" title="Share">
        {icon(Share2)}
      </button>
    </div>
  );
}
