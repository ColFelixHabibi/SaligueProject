'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, ArrowRight, CircleDollarSign, Clock, MessageCircle, Package, PackagePlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MetricChart, MetricTiles, type Metric } from '@/components/dashboard/metric-chart';
import { useProductStore } from '@/hooks/use-product-store';
import { useAuth } from '@/components/auth/auth-provider';
import { ORDER_STATUSES, formatPrice, shortOrderId, useOrders } from '@/lib/orders';
import { useSellerStats } from '@/lib/seller';
import { cn } from '@/lib/utils';

const RANGES = [7, 30, 90, 365];

function ActionCard({ href, icon: Icon, label, value, hint, tone }: { href: string; icon: typeof Package; label: string; value: number; hint: string; tone?: 'warn' }) {
  return (
    <Link href={href} className={cn('group flex items-center gap-4 rounded-2xl border bg-card p-4 transition hover:border-primary hover:shadow-sm', value > 0 && tone === 'warn' && 'border-amber-300 bg-amber-50 dark:bg-amber-950/20')}>
      <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', value > 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-2xl font-bold leading-none">{value}</span>
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
    </Link>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<Metric[]>(['revenue', 'orders']);
  const stats = useSellerStats(days);
  const orders = useOrders('seller');
  const { products } = useProductStore();
  const { authUid } = useAuth();
  const mine = useMemo(() => products.filter((p) => p.sellerId === authUid), [products, authUid]);
  const toggle = (m: Metric) => setSelected((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));

  const best = useMemo(() => {
    if (!stats) return [];
    return mine
      .map((p) => ({ p, ...(stats.perProduct[p.id] ?? { units: 0, revenue: 0, views: 0 }) }))
      .filter((r) => r.units || r.views)
      .sort((a, b) => b.revenue - a.revenue || (b.views ?? 0) - (a.views ?? 0))
      .slice(0, 5);
  }, [stats, mine]);

  if (!stats) {
    return (
      <div className="grid gap-6">
        <div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        <Skeleton className="h-[420px] rounded-2xl" />
      </div>
    );
  }

  const toHandle = stats.statusCounts.placed ?? 0;

  return (
    <div className="grid gap-6">
      {mine.length === 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <p className="text-lg font-bold">List your first item</p>
              <p className="text-sm text-muted-foreground">Shoppers can wear it in the Fitting Room, message you and order straight away.</p>
            </div>
            <Button size="lg" asChild><Link href="/sell"><PackagePlus className="mr-2 h-5 w-5" /> Add item</Link></Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ActionCard href="/dashboard/orders?status=placed" icon={Clock} label="Orders to confirm" value={toHandle} hint="New orders waiting for you" tone="warn" />
        <ActionCard href="/dashboard/orders?payment=unpaid" icon={CircleDollarSign} label="Not paid yet" value={stats.unpaid} hint="Open orders without payment" />
        <ActionCard href="/messages" icon={MessageCircle} label="Unread messages" value={stats.unreadMessages} hint="Customers waiting for a reply" tone="warn" />
        <ActionCard href="/dashboard/products?filter=low" icon={AlertTriangle} label="Low on stock" value={stats.lowStock.length} hint="3 or fewer left" tone="warn" />
      </div>

      <Card className="overflow-hidden rounded-2xl">
        <MetricTiles stats={stats} selected={selected} onToggle={toggle} />
        <CardContent className="space-y-3 p-4 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Compared with the {days} days before.</p>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{RANGES.map((d) => <SelectItem key={d} value={String(d)}>{d === 365 ? 'Last 12 months' : `Last ${d} days`}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <MetricChart series={stats.series} selected={selected} />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Recent orders</CardTitle>
              <CardDescription>The newest orders for your shop.</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild><Link href="/dashboard/orders">All orders <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!orders ? (
              <Skeleton className="h-40 w-full" />
            ) : orders.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No orders yet. Share your items so shoppers find them.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead className="hidden md:table-cell">When</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {orders.slice(0, 6).map((o) => (
                    <TableRow key={o.id} className="cursor-pointer" onClick={() => router.push(`/dashboard/orders?open=${o.id}`)}>
                      <TableCell className="font-semibold">#{shortOrderId(o.id)}</TableCell>
                      <TableCell className="max-w-[10rem] truncate">{o.delivery.fullName}</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{o.createdAt ? formatDistanceToNow(new Date(o.createdAt), { addSuffix: true }) : ''}</TableCell>
                      <TableCell>
                        <Badge variant={o.status === 'cancelled' ? 'destructive' : o.status === 'placed' ? 'default' : 'secondary'}>{ORDER_STATUSES.find((s) => s.value === o.status)?.label}</Badge>
                        {o.paymentStatus === 'paid' && <Badge variant="outline" className="ml-1 border-emerald-500 text-emerald-600">Paid</Badge>}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{formatPrice(o.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Best sellers</CardTitle>
            <CardDescription>Your items with the most sales and views ({days === 365 ? '12 months' : `${days} days`}).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {best.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No sales or views yet.</p>
            ) : (
              best.map(({ p, units, revenue, views }) => (
                <Link key={p.id} href={`/edit-product?id=${p.id}`} className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.cutout || p.image} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-muted object-contain p-1" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">{units} sold · {views ?? 0} views</span>
                  </span>
                  <span className="text-sm font-bold text-primary">{formatPrice(revenue)}</span>
                </Link>
              ))
            )}
            {stats.lowStock.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
                <p className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" /> Restock soon</p>
                {stats.lowStock.slice(0, 4).map((p) => (
                  <Link key={p.id} href={`/edit-product?id=${p.id}`} className="flex justify-between py-0.5 hover:underline">
                    <span className="truncate">{p.name}</span><span className="font-semibold">{p.stock} left</span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
