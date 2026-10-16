'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MetricChart, MetricTiles, type Metric } from '@/components/dashboard/metric-chart';
import { useAuth } from '@/components/auth/auth-provider';
import { useProductStore } from '@/hooks/use-product-store';
import { ORDER_STATUSES, formatPrice } from '@/lib/orders';
import { downloadCsv, useSellerStats } from '@/lib/seller';

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<Metric[]>(['revenue', 'views']);
  const stats = useSellerStats(days);
  const { products } = useProductStore();
  const { authUid } = useAuth();

  const rows = useMemo(() => {
    if (!stats) return [];
    return products
      .filter((p) => p.sellerId === authUid)
      .map((p) => {
        const s = stats.perProduct[p.id] ?? { units: 0, revenue: 0, orders: 0, views: 0 };
        const views = s.views ?? 0;
        return { p, views, units: s.units, revenue: s.revenue, conversion: views ? (s.orders / views) * 100 : 0 };
      })
      .sort((a, b) => b.revenue - a.revenue || b.views - a.views);
  }, [stats, products, authUid]);

  if (!stats) return <Skeleton className="h-[600px] w-full rounded-2xl" />;
  const totalOrders = Object.values(stats.statusCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
          <p className="text-sm text-muted-foreground">How shoppers find and buy your items.</p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="h-10 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{[7, 30, 90, 365].map((d) => <SelectItem key={d} value={String(d)}>{d === 365 ? 'Last 12 months' : `Last ${d} days`}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden rounded-2xl">
        <MetricTiles stats={stats} selected={selected} onToggle={(m) => setSelected((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]))} />
        <CardContent className="p-4 md:p-6"><MetricChart series={stats.series} selected={selected} height={340} /></CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Orders by status</CardTitle>
            <CardDescription>All time · {totalOrders} orders</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {ORDER_STATUSES.map((s) => {
              const n = stats.statusCounts[s.value] ?? 0;
              return (
                <Link key={s.value} href={`/dashboard/orders?status=${s.value}`} className="block space-y-1 rounded-lg p-1 hover:bg-muted">
                  <div className="flex justify-between text-sm"><span>{s.label}</span><span className="font-semibold">{n}</span></div>
                  <Progress value={totalOrders ? (n / totalOrders) * 100 : 0} className="h-2" />
                </Link>
              );
            })}
            <div className="grid grid-cols-2 gap-2 pt-2 text-center">
              <div className="rounded-xl bg-muted p-3"><p className="text-xl font-bold">{stats.activeCount}</p><p className="text-xs text-muted-foreground">Items on sale</p></div>
              <div className="rounded-xl bg-muted p-3"><p className="text-xl font-bold">{stats.totals.units}</p><p className="text-xs text-muted-foreground">Pieces sold</p></div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Item performance</CardTitle>
              <CardDescription>Views and sales per item ({days === 365 ? '12 months' : `${days} days`}).</CardDescription>
            </div>
            <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => downloadCsv('saligue-item-performance.csv', [
              ['Item', 'Views', 'Sold', 'Revenue', 'Conversion %'],
              ...rows.map((r) => [r.p.name, r.views, r.units, r.revenue, r.conversion.toFixed(1)]),
            ])}><Download className="mr-1.5 h-4 w-4" /> Export</Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No items yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Item</TableHead><TableHead className="text-right">Views</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Conversion</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 25).map((r) => (
                    <TableRow key={r.p.id}>
                      <TableCell>
                        <Link href={`/edit-product?id=${r.p.id}`} className="flex items-center gap-2 hover:underline">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={r.p.cutout || r.p.image} alt="" className="h-9 w-9 shrink-0 rounded-md bg-muted object-contain p-0.5" />
                          <span className="max-w-[14rem] truncate font-medium">{r.p.name}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">{r.views}</TableCell>
                      <TableCell className="text-right">{r.units}</TableCell>
                      <TableCell className="text-right font-semibold">{formatPrice(r.revenue)}</TableCell>
                      <TableCell className="text-right">{r.conversion.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
