'use client';

import { useEffect, useState } from 'react';
import { api, onServerEvent } from './api';

export type DayStats = { date: string; revenue: number; orders: number; units: number; views: number; conversion: number };
type Totals = { revenue: number; orders: number; units: number; views: number; conversion: number };

export type SellerStats = {
  days: number;
  series: DayStats[];
  totals: Totals;
  previous: Totals;
  perProduct: Record<string, { units: number; revenue: number; orders: number; views?: number }>;
  statusCounts: Record<string, number>;
  unpaid: number;
  unreadMessages: number;
  lowStock: { id: string; name: string; image: string; stock: number }[];
  productCount: number;
  activeCount: number;
};

/** The seller's dashboard numbers for the last `days` days, refreshed live when orders or items change. */
export function useSellerStats(days: number) {
  const [stats, setStats] = useState<SellerStats | null>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      api<SellerStats>(`/seller/stats?days=${days}`)
        .then((s) => active && setStats(s))
        .catch((error) => console.error('Failed to load shop numbers:', error));
    void load();
    const stops = ['orders', 'products', 'messages'].map((e) => onServerEvent(e, () => void load()));
    return () => {
      active = false;
      stops.forEach((stop) => stop());
    };
  }, [days]);
  return stats;
}

/** Change from the previous period, in percent (null when there is nothing to compare with). */
export function change(now: number, before: number) {
  if (!before) return now ? null : 0;
  return Math.round(((now - before) / before) * 100);
}

/** Downloads rows as a CSV file (opens in Excel / Google Sheets). */
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
