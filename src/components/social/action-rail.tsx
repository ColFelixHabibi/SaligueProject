
'use client';

import { shareLink } from '@/components/share-sheet';
import { useFeatures } from '@/lib/features';

import Link from 'next/link';
import { Bookmark, Heart, Layers, MessageCircle, Share2, Wand2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { addToLook } from '@/components/look-picker';
import { useToast } from '@/hooks/use-toast';
import { toggleLike, useLiked } from '@/hooks/use-likes';
import { useWishlist } from '@/hooks/use-wishlist';
import { friendlyError } from '@/lib/errors';
import { productHref } from '@/lib/links';
import { absoluteUrl } from '@/lib/paths';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

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
 * Like (public count) · Comments · Save (private) · Look (with an account) · Wear it · Share.
 * Works for guests too — no login needed.
 */
export function ActionRail({ product, commentsOpen, onToggleComments, variant, hideWearIt }: ActionRailProps) {
  const { toast } = useToast();
  const on = useFeatures();
  const { user } = useAuth();
  const liked = useLiked(product.id);
  const { wishlistItems, addToWishlist, removeFromWishlist } = useWishlist();
  const saved = wishlistItems.some((p) => p.id === product.id);
  const likeCount = Math.max(0, (product.likeCount ?? 0));

  const run = (action: () => Promise<unknown>) => action().catch((error) => toast({ variant: 'destructive', title: 'Try again', description: friendlyError(error) }));

  const share = async () => {
    await shareLink({ title: product.name, text: `${product.name} on Saligue`, url: absoluteUrl(productHref(product)) });
  };

  const overlay = variant === 'overlay';
  const button = cn(
    'flex items-center gap-1.5 text-xs font-semibold transition-transform active:scale-90',
    overlay ? 'flex-col text-foreground' : 'min-w-0 rounded-full p-2 text-foreground hover:bg-muted'
  );
  // On the feed each icon sits in a white circle so it reads on any photo.
  const icon = overlay ? 'h-11 w-11 rounded-full bg-background/90 p-2.5 shadow' : 'h-5 w-5';

  return (
    <div className={cn(overlay ? 'flex flex-col items-center gap-5 [@media(max-height:700px)]:gap-2.5' : 'flex flex-wrap items-center justify-between gap-x-1')}>
      <button type="button" className={button} onClick={() => run(() => toggleLike(product.id))} aria-pressed={liked} aria-label="Like" title="Like">
        <Heart className={cn(icon, liked && 'fill-primary text-primary')} />
        {likeCount > 0 && <span>{compact(likeCount)}</span>}
      </button>
      {on('comments') && <button type="button" className={button} onClick={onToggleComments} aria-expanded={commentsOpen} aria-label="Comments" title="Comments">
        <MessageCircle className={cn(icon, commentsOpen && 'fill-current')} />
      </button>}
      <button
        type="button"
        className={button}
        onClick={() => run(() => (saved ? removeFromWishlist(product.id) : addToWishlist(product)))}
        aria-pressed={saved}
        aria-label={saved ? 'Saved' : 'Save'}
        title={saved ? 'Saved' : 'Save'}
      >
        <Bookmark className={cn(icon, saved && 'fill-current')} />
      </button>
      {user && on('looks') && (
        <button type="button" className={button} onClick={() => addToLook({ kind: 'product', id: product.id })} aria-label="Add to a look" title="Add to a look">
          <Layers className={icon} />
        </button>
      )}
      {!hideWearIt && (
        <Link href={`/mirror?item=${product.id}`} className={button} aria-label="Wear it" title="Wear it">
          <Wand2 className={icon} />
        </Link>
      )}
      <button type="button" className={button} onClick={share} aria-label="Share" title="Share">
        <Share2 className={icon} />
      </button>
    </div>
  );
}
