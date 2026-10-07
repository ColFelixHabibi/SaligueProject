
'use client';

import Link from 'next/link';
import { Bookmark, Clapperboard, Heart, MessageCircle, Share2, Wand2 } from 'lucide-react';
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
  onMakeVideo?: () => void;
  // "overlay": white icons in a column over an image (feed); "bar": a compact row below an image (cards).
  variant: 'overlay' | 'bar';
}

/**
 * Like (public count) · Save (private) · Comments · Share · Try on · Video.
 * Works for guests too — no login needed.
 */
export function ActionRail({ product, commentsOpen, onToggleComments, onMakeVideo, variant }: ActionRailProps) {
  const { toast } = useToast();
  const liked = useLiked(product.id);
  const { wishlistItems, addToWishlist, removeFromWishlist } = useWishlist();
  const saved = wishlistItems.some((p) => p.id === product.id);
  const likeCount = Math.max(0, (product.likeCount ?? 0));

  const run = (action: () => Promise<unknown>) => action().catch((error) => toast({ variant: 'destructive', title: 'Try again', description: friendlyError(error) }));

  const share = async () => {
    const url = absoluteUrl(productHref(product));
    try {
      if (navigator.share) {
        await navigator.share({ title: product.name, text: `${product.name} on Saligue`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({ title: 'Link copied' });
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') toast({ variant: 'destructive', title: 'Could not share', description: friendlyError(error) });
    }
  };

  const overlay = variant === 'overlay';
  const button = cn(
    'flex items-center gap-1.5 text-xs font-semibold transition-transform active:scale-90',
    overlay ? 'flex-col text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]' : 'rounded-full px-2 py-1.5 text-foreground hover:bg-muted'
  );
  const icon = overlay ? 'h-8 w-8' : 'h-5 w-5';

  return (
    <div className={cn(overlay ? 'flex flex-col items-center gap-5' : 'flex items-center justify-between gap-1')}>
      <button type="button" className={button} onClick={() => run(() => toggleLike(product.id))} aria-pressed={liked} aria-label="Like">
        <Heart className={cn(icon, liked && 'fill-primary text-primary')} />
        <span>{likeCount > 0 ? compact(likeCount) : 'Like'}</span>
      </button>
      <button type="button" className={button} onClick={onToggleComments} aria-expanded={commentsOpen} aria-label="Comments">
        <MessageCircle className={cn(icon, commentsOpen && 'fill-current')} />
        <span>Comment</span>
      </button>
      <button
        type="button"
        className={button}
        onClick={() => run(() => (saved ? removeFromWishlist(product.id) : addToWishlist(product)))}
        aria-pressed={saved}
        aria-label="Save"
      >
        <Bookmark className={cn(icon, saved && 'fill-current')} />
        <span>{saved ? 'Saved' : 'Save'}</span>
      </button>
      <Link href={`/mirror?item=${product.id}`} className={button} aria-label="Try it on">
        <Wand2 className={icon} />
        <span>Try on</span>
      </Link>
      {onMakeVideo && (
        <button type="button" className={button} onClick={onMakeVideo} aria-label="Make a video">
          <Clapperboard className={icon} />
          <span>Video</span>
        </button>
      )}
      <button type="button" className={button} onClick={share} aria-label="Share">
        <Share2 className={icon} />
        <span>Share</span>
      </button>
    </div>
  );
}
