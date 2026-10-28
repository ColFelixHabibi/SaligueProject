'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bookmark, Coins, GraduationCap, Package, ShoppingBag, Store, Wand2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ProductCard from '@/components/product-card';
import { useCart } from '@/hooks/use-cart-store';
import { useWishlist } from '@/hooks/use-wishlist';
import { getCoins } from '@/lib/live';
import { formatPrice, useOrders } from '@/lib/orders';
import { cn } from '@/lib/utils';

const STATUS: Record<string, string> = { placed: 'Placed', confirmed: 'Confirmed', shipped: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' };

/** My Saligue at a glance: orders on their way, saved items, the bag and coins; then the latest orders. */
export default function MySaligue() {
  const orders = useOrders('buyer');
  const { wishlistItems } = useWishlist();
  const { cartItems } = useCart();
  const [coins, setCoins] = useState<number | null>(null);
  useEffect(() => void getCoins().then((c) => setCoins(c.balance)).catch(() => {}), []);
  const open = useMemo(() => (orders ?? []).filter((o) => !['delivered', 'cancelled'].includes(o.status)), [orders]);
  const tiles: [typeof Package, string, string, string][] = [
    [Package, 'On their way', String(open.length), '/my-account/orders'],
    [Bookmark, 'Saved', String(wishlistItems.length), '/my-account/saved'],
    [ShoppingBag, 'In your bag', String(cartItems.reduce((n, i) => n + i.quantity, 0)), '/cart'],
    [Coins, 'Coins', coins == null ? '…' : coins.toLocaleString(), '/my-account/coins'],
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {tiles.map(([Icon, label, value, href]) => (
          <Link key={label} href={href} className="group rounded-2xl border bg-card p-4 transition hover:border-primary">
            <Icon className="h-5 w-5 text-primary" />
            <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
            <p className="flex items-center justify-between text-xs text-muted-foreground">{label} <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></p>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Latest orders</CardTitle>
          <Link href="/my-account/orders" className="text-sm font-semibold text-primary">All</Link>
        </CardHeader>
        <CardContent className="divide-y">
          {orders && orders.length === 0 && <p className="py-2 text-sm text-muted-foreground">No orders yet. <Link href="/search" className="text-primary underline">Explore items</Link></p>}
          {(orders ?? []).slice(0, 4).map((o) => (
            <Link key={o.id} href="/my-account/orders" className="flex items-center gap-3 py-2.5 text-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {o.items[0]?.image && <img src={o.items[0].image} alt="" className="h-11 w-11 shrink-0 rounded-lg bg-muted object-contain p-0.5" />}
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{o.items.map((i) => i.name).join(', ')}</span><span className="text-xs text-muted-foreground">{formatPrice(o.total)}</span></span>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', o.status === 'delivered' ? 'bg-emerald-100 text-emerald-700' : o.status === 'cancelled' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary')}>{STATUS[o.status] ?? o.status}</span>
            </Link>
          ))}
        </CardContent>
      </Card>

      {wishlistItems.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Saved for later</CardTitle>
            <Link href="/my-account/saved" className="text-sm font-semibold text-primary">All</Link>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">{wishlistItems.slice(0, 4).map((p) => <ProductCard key={p.id} product={p} variant="shop" />)}</CardContent>
        </Card>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        {([[Wand2, 'Fitting Room', 'See yourself in any item', '/mirror'], [GraduationCap, 'Teach a lesson', 'Share what you know', '/learn/new'], [Store, 'Start selling', 'Open your own shop', '/sell']] as const).map(([Icon, label, hint, href]) => (
          <Link key={label} href={href} className="flex items-center gap-3 rounded-2xl border bg-card p-3 transition hover:border-primary">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
            <span className="min-w-0"><span className="block text-sm font-semibold">{label}</span><span className="block truncate text-xs text-muted-foreground">{hint}</span></span>
          </Link>
        ))}
      </div>
    </>
  );
}
