'use client';

import { useState } from 'react';
import { Check, Loader2, ShoppingBag, Ticket, Timer, X } from 'lucide-react';
import { useCountdown } from '@/components/live/deal-tag';
import { Button } from '@/components/ui/button';
import type { LiveDrop } from '@/lib/live';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

/**
 * Saligue Live drops: the host holds one item up during the live and shoppers claim a place, first come
 * first served (the seller's queue, like "comment SOLD" — but with a timer and a paid way out).
 * A claim keeps the place for ten minutes; paying happens in the normal bag and checkout, so the price
 * shown here is exactly what checkout charges.
 */
export function LiveDropCard({ drop, signedIn, busy, onClaim, onPay, onRelease, className }: {
  drop: LiveDrop;
  signedIn: boolean;
  busy?: boolean;
  onClaim: (dropId: string) => void;
  onPay: (drop: LiveDrop) => void;
  onRelease: (dropId: string) => void;
  className?: string;
}) {
  // My place runs out after ten minutes; the clock is the same one live deals use.
  const left = useCountdown(drop.mine?.expiresAt);
  const mine = !!drop.mine && !!left;
  const places = Math.max(0, drop.slots - drop.claimed);
  const saving = drop.was > drop.price;
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl bg-white/95 p-2 pr-3 text-foreground shadow-lg', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={drop.image ?? undefined} alt="" className="h-14 w-14 shrink-0 rounded-xl bg-muted object-contain p-1" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-primary">
          <Ticket className="h-3 w-3" /> {mine ? 'Yours to pay for' : drop.open ? 'Live drop · claim it' : 'Live drop'}
        </p>
        <p className="truncate text-sm font-semibold">{drop.name}</p>
        <p className="text-sm font-extrabold">
          {formatPrice(drop.price)}
          {saving && <s className="ml-2 text-xs font-semibold text-muted-foreground">{formatPrice(drop.was)}</s>}
          {!mine && drop.open && <span className="ml-2 text-xs font-semibold text-amber-600">{places === 1 ? 'Last one' : `${places} left`}</span>}
        </p>
        {mine ? (
          <p className="flex items-center gap-1 text-xs font-semibold text-primary" title="Pay before the timer ends or the place goes to someone else">
            <span className="inline-flex items-center gap-0.5 rounded-full bg-primary px-1.5 py-0.5 font-extrabold tabular-nums text-primary-foreground"><Timer className="h-3 w-3" /> {left}</span>
            <span className="truncate">to pay, then it goes to the next one</span>
          </p>
        ) : drop.claimed > 0 ? (
          <p className="truncate text-xs text-muted-foreground">
            {drop.claimers.map((c) => c.name).slice(0, 2).join(', ')} {drop.claimed === 1 ? 'claimed one' : 'claimed'}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        {mine ? (
          <>
            <button type="button" onClick={() => onPay(drop)} className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">
              <ShoppingBag className="h-3.5 w-3.5" /> Pay now
            </button>
            <button type="button" onClick={() => onRelease(drop.id)} disabled={busy} className="flex items-center justify-center gap-1 rounded-full bg-muted px-3 py-1.5 text-xs font-bold disabled:opacity-50">
              <X className="h-3.5 w-3.5" /> Let it go
            </button>
          </>
        ) : drop.open ? (
          <button type="button" onClick={() => onClaim(drop.id)} disabled={busy || !signedIn} title={signedIn ? 'Take a place' : 'Create an account to claim'} className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {signedIn ? 'Claim' : 'Sign in to claim'}
          </button>
        ) : (
          <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground">All claimed</span>
        )}
      </div>
    </div>
  );
}

/** The host's side: every drop of this live, who claimed it, and a way to take it down. */
export function DropsPanel({ drops, busy, onClose, bare }: { drops: LiveDrop[]; busy?: string | null; onClose: (dropId: string) => void; bare?: boolean }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const list = drops.length ? (
    <div className="grid gap-2">
      {drops.map((d) => (
        <div key={d.id} className="rounded-xl border p-2">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.image ?? undefined} alt="" className="h-10 w-10 shrink-0 rounded-lg bg-muted object-contain p-0.5" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{d.name}</p>
              <p className="text-xs text-muted-foreground">{formatPrice(d.price)} · {d.claimed}/{d.slots} claimed</p>
            </div>
            {confirm === d.id ? (
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="destructive" onClick={() => { setConfirm(null); onClose(d.id); }}>Take down</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>No</Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirm(d.id)} className="shrink-0">Take down</Button>
            )}
          </div>
          {d.claimers.length > 0 && (
            // Who the item is kept for: a check beside those who already ordered it, a timer beside those still paying.
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {d.claimers.map((c, i) => (
                <span key={i} className="inline-flex items-center gap-0.5 font-semibold text-foreground" title={c.paid ? 'Ordered' : 'Has ten minutes to pay'}>
                  {c.paid ? <Check className="h-3 w-3 text-primary" /> : <Timer className="h-3 w-3 text-amber-600" />} {c.name}
                </span>
              ))}
            </p>
          )}
        </div>
      ))}
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">No drops yet. Hold an item up with <b>Drop it</b> in your items, and it appears on everyone&apos;s screen to claim.</p>
  );
  if (bare) return list;
  return (
    <div className="rounded-2xl border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 font-bold"><Ticket className="h-4 w-4 text-primary" /> Drops{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}</h2>
      {list}
    </div>
  );
}
