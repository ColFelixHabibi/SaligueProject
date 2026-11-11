'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { History as HistoryIcon, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import ProductCard from '@/components/product-card';
import { ask } from '@/components/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { clearHistory, forgetSeen, reloadHistory, sendHistoryNow, useHistory } from '@/lib/history';

/** "Today", "Yesterday", "3 days ago", then the date: when this item was last on screen. */
function seenWhen(iso: string) {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return '';
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString();
}

/**
 * My Saligue → History: every item this person opened or scrolled past, newest first. It is theirs alone to look
 * at: one item can be taken out, or the whole list cleared, without touching likes, saves or orders.
 */
export default function MyHistory() {
  const { toast } = useToast();
  const items = useHistory(false);
  const [busy, setBusy] = useState(false);

  // What was just watched is still in the sending queue (src/lib/history.ts): it goes first, so the list is complete.
  useEffect(() => {
    void sendHistoryNow().finally(() => void reloadHistory());
  }, []);

  const remove = async (id: string, name: string) => {
    try {
      await forgetSeen(id);
    } catch (error) {
      toast({ variant: 'destructive', title: `Could not remove ${name}`, description: friendlyError(error) });
    }
  };

  const clear = async () => {
    const answer = await ask({
      title: 'Clear your history?',
      description: 'Everything you saw or scrolled past leaves this list. Your likes, saves and orders stay.',
      confirm: 'Delete',
      destructive: true,
    });
    if (!answer) return;
    setBusy(true);
    try {
      await clearHistory();
      toast({ title: 'History cleared', description: 'The list starts again from what you look at next.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not clear your history', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  if (items === null) {
    return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 w-full rounded-2xl" />)}</div>;
  }

  if (!items.length) {
    return (
      <div className="rounded-2xl border-2 border-dashed bg-background py-16 text-center">
        <HistoryIcon className="mx-auto mb-3 h-10 w-10 text-primary" />
        <p className="font-semibold">Nothing here yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Items you open or scroll past in the feed come here, so you can find them again.</p>
        <Button className="mt-4" asChild><Link href="/search">Explore items</Link></Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">What you saw</p>
          {/* Kept for this person alone: nobody else, shop or shopper, can see it. */}
          <p className="text-xs text-muted-foreground">{items.length} {items.length === 1 ? 'item' : 'items'} · only you can see this list</p>
        </div>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => void clear()} disabled={busy}>
          <Trash2 className="mr-1.5 h-4 w-4" /> {busy ? 'Clearing…' : 'Delete all'}
        </Button>
      </div>

      <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
        {items.map((p) => (
          <div key={p.id} className="flex flex-col">
            <ProductCard product={p} variant="shop" />
            <div className="mt-1 flex items-center justify-between gap-2 px-0.5 text-xs text-muted-foreground">
              <span>{seenWhen(p.seenAt)}{p.times > 1 ? ` · ${p.times}×` : ''}</span>
              <button
                type="button"
                onClick={() => void remove(p.id, p.name)}
                aria-label={`Remove ${p.name} from your history`}
                className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium transition hover:bg-muted hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" /> Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
