'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BookOpen, Download, EyeOff, Info, Layers, Loader2, MoreHorizontal, Pin, PinOff, Repeat2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { addToLook } from '@/components/look-picker';
import { ReportButton } from '@/components/social/report-button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toggleResaligue, useResaligued } from '@/hooks/use-resaligues';
import { useToast } from '@/hooks/use-toast';
import { useProductStore } from '@/hooks/use-product-store';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useFeatures } from '@/lib/features';
import { useT } from '@/lib/i18n';
import { downloadItem } from '@/lib/save-file';
import { noteInterest } from '@/lib/taste';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The ⋯ under the side buttons: Resaligue (repost to your followers), Download (with the Saligue logo, saved to the
 * phone), Pin (the shop's own items, to the top of its profile), Add to a look, then why this item is shown,
 * Show less, Report.
 */
export function MoreSheet({ product, reason, sponsored, onHide, className, inline }: { product: Product; reason?: string | null; sponsored?: boolean; onHide?: () => void; className?: string; inline?: boolean }) {
  const { user } = useAuth();
  const on = useFeatures();
  const t = useT();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  const resaligued = useResaligued(product.id);
  const mine = !!user && user.uid === product.sellerId;
  const pinned = !!product.pinnedAt;

  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } catch (error) {
      toast({ variant: 'destructive', title: t('Not done'), description: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };

  const resaligue = () => run('resaligue', async () => {
    const now = await toggleResaligue(product.id);
    setOpen(false);
    toast({ title: now ? t('Resaligued') : t('Resaligue removed'), description: now ? t('Your clients will see it in their Network.') : undefined });
  });
  const download = (kind: 'image' | 'video') => run(`download-${kind}`, async () => {
    const where = await downloadItem(product.id, product.name, kind);
    noteInterest(product.id, 'share');
    setOpen(false);
    if (where === 'gallery') toast({ title: t('Saved to your gallery'), description: kind === 'video' ? 'Movies › Saligue' : 'Pictures › Saligue' });
    else if (where === 'downloaded') toast({ title: t('Downloaded'), description: t('With the Saligue logo and the shop’s name.') });
  });
  const pin = () => run('pin', async () => {
    await api(`/products/${product.id}/pin`, { body: { pinned: !pinned } });
    useProductStore.setState((s) => ({ products: s.products.map((p) => (p.id === product.id ? { ...p, pinnedAt: pinned ? undefined : new Date().toISOString() } : p)) }));
    setOpen(false);
    toast({ title: pinned ? t('Unpinned') : t('Pinned to your profile'), description: pinned ? undefined : t('It stays first on your profile.') });
  });

  // Icons first, one short word each (fewer words to read, in any language).
  const tiles: { key: string; icon: typeof Repeat2; label: string; onClick: () => void; active?: boolean; show: boolean }[] = [
    { key: 'resaligue', icon: Repeat2, label: t('Repost'), onClick: resaligue, active: resaligued, show: !mine },
    { key: 'pin', icon: pinned ? PinOff : Pin, label: pinned ? t('Unpin') : t('Pin'), onClick: pin, active: pinned, show: mine },
    { key: 'download-image', icon: Download, label: t('Photo'), onClick: () => download('image'), show: true },
    { key: 'download-video', icon: Download, label: t('Video'), onClick: () => download('video'), show: !!product.video },
    { key: 'look', icon: Layers, label: t('Look'), onClick: () => { setOpen(false); addToLook({ kind: 'product', id: product.id }); }, show: !!user && on('looks') },
    { key: 'less', icon: EyeOff, label: t('Less'), onClick: () => { setOpen(false); onHide?.(); }, show: !!onHide },
    { key: 'why', icon: Info, label: t('Why?'), onClick: () => setWhy((w) => !w), active: why, show: !inline },
  ];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} aria-label={t('More')} title={t('More')} aria-haspopup="dialog">
        {inline ? (
          <span className="flex h-9 w-9 items-center justify-center rounded-full text-foreground hover:bg-muted"><MoreHorizontal className="h-5 w-5" /></span>
        ) : (
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-background/90 shadow [@media(max-height:700px)]:h-10 [@media(max-height:700px)]:w-10">
            <MoreHorizontal className="h-6 w-6 [@media(max-height:700px)]:h-5 [@media(max-height:700px)]:w-5" />
          </span>
        )}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-3xl px-4 pt-5" onOpenAutoFocus={(e) => e.preventDefault()}>
          <SheetHeader className="text-left">
            <SheetTitle className="line-clamp-1 pr-8 text-base">{product.name}</SheetTitle>
            <SheetDescription className="sr-only">{t('More')}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {tiles.filter((x) => x.show).map((x) => (
              <button key={x.key} type="button" onClick={x.onClick} disabled={!!busy} aria-pressed={x.active} className="flex min-w-0 flex-col items-center gap-1.5 rounded-2xl py-2 text-xs font-semibold transition active:scale-95 disabled:opacity-60">
                <span className={cn('flex h-14 w-14 items-center justify-center rounded-full', x.active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>
                  {busy === x.key ? <Loader2 className="h-6 w-6 animate-spin" /> : <x.icon className="h-6 w-6" />}
                </span>
                <span className="w-full truncate text-center">{x.label}</span>
              </button>
            ))}
            {!mine && (
              <span className="flex min-w-0 flex-col items-center gap-1.5 py-2 text-xs font-semibold">
                <ReportButton product={product} iconOnly className="flex h-14 w-14 items-center justify-center rounded-full bg-muted p-0 text-foreground [&>svg]:h-6 [&>svg]:w-6" />
                <span className="w-full truncate text-center">{t('Report')}</span>
              </span>
            )}
          </div>
          {why && (
            <p className="mt-3 flex items-center gap-2 rounded-2xl bg-muted p-3 text-sm">
              <Info className="h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">{sponsored ? t('Sponsored') : reason ?? t('New and popular')}</span>
              <Link href="/how-feed-works" onClick={() => setOpen(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background" aria-label={t('How For You works')} title={t('How For You works')}><BookOpen className="h-4 w-4" /></Link>
            </p>
          )}
          {busy?.startsWith('download') && <p className="mt-2 text-center text-xs text-muted-foreground">{t('Adding the Saligue logo…')}</p>}
        </SheetContent>
      </Sheet>
    </>
  );
}
