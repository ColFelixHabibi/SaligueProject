'use client';

import { format } from 'date-fns';
import { HelpCircle, TrendingDown, TrendingUp } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Tooltip as Hint, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { change, type DayStats, type SellerStats } from '@/lib/seller';
import { cn } from '@/lib/utils';

export type Metric = 'revenue' | 'orders' | 'views' | 'conversion';

// Saligue's own colours: pink, black (white in dark mode), red, and a deep plum.
export const METRICS: { key: Metric; label: string; color: string; text: string; help: string; format: (n: number) => string }[] = [
  { key: 'revenue', label: 'Total sales', color: 'hsl(var(--primary))', text: 'text-primary-foreground', help: 'Money from orders that were not cancelled.', format: (n) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
  { key: 'orders', label: 'Orders', color: 'hsl(var(--foreground))', text: 'text-background', help: 'Orders placed with your shop (cancelled ones excluded).', format: (n) => n.toLocaleString() },
  { key: 'views', label: 'Item views', color: 'hsl(var(--secondary))', text: 'text-secondary-foreground', help: 'How many times shoppers opened your items (once per shopper per day).', format: (n) => n.toLocaleString() },
  { key: 'conversion', label: 'Conversion', color: 'hsl(331 60% 30%)', text: 'text-white', help: 'Orders per 100 item views.', format: (n) => `${n.toFixed(1)}%` },
];

/** Search Console-style tiles: tap one to show or hide its line on the chart. */
export function MetricTiles({ stats, selected, onToggle }: { stats: SellerStats; selected: Metric[]; onToggle: (m: Metric) => void }) {
  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 overflow-hidden rounded-t-2xl md:grid-cols-4">
        {METRICS.map((m) => {
          const on = selected.includes(m.key);
          const delta = change(stats.totals[m.key], stats.previous[m.key]);
          return (
            <button
              key={m.key}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(m.key)}
              className={cn('flex min-h-28 flex-col justify-between gap-2 border-b border-r p-4 text-left transition-colors last:border-r-0', on ? m.text : 'bg-card hover:bg-muted/60')}
              style={on ? { background: m.color, borderColor: m.color } : undefined}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className={cn('flex h-4 w-4 items-center justify-center rounded-sm border text-[10px]', on ? 'border-current bg-white/20' : 'border-muted-foreground')}>{on && '✓'}</span>
                {m.label}
              </span>
              <span className="text-2xl font-bold md:text-3xl">{m.format(stats.totals[m.key])}</span>
              <span className="flex items-center justify-between text-xs">
                {delta === null ? (
                  <span className={on ? 'opacity-80' : 'text-muted-foreground'}>New this period</span>
                ) : (
                  <span className={cn('flex items-center gap-1 font-semibold', on ? 'opacity-90' : delta >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                    {delta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                    {delta > 0 ? '+' : ''}{delta}% vs previous
                  </span>
                )}
                <Hint>
                  <TooltipTrigger asChild>
                    <span role="img" aria-label={m.help} onClick={(e) => e.stopPropagation()}><HelpCircle className="h-4 w-4 opacity-70" /></span>
                  </TooltipTrigger>
                  <TooltipContent>{m.help}</TooltipContent>
                </Hint>
              </span>
            </button>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

/** Daily lines for the selected metrics. One or two metrics get labelled axes; more share a hidden scale each. */
export function MetricChart({ series, selected, height = 300 }: { series: DayStats[]; selected: Metric[]; height?: number }) {
  const shown = METRICS.filter((m) => selected.includes(m.key));
  return (
    <div style={{ height }} className="w-full">
      {shown.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Tap a tile above to show it on the chart.</div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} tickMargin={8} fontSize={12}
              tickFormatter={(d) => format(new Date(`${d}T00:00:00`), 'd MMM')} />
            {shown.map((m, i) => (
              <YAxis key={m.key} yAxisId={m.key} orientation={i === 1 ? 'right' : 'left'} hide={shown.length > 2 || i > 1}
                tickLine={false} axisLine={false} fontSize={12} width={48} allowDecimals={m.key === 'revenue' || m.key === 'conversion'}
                tickFormatter={(v) => (m.key === 'revenue' ? `$${v}` : m.key === 'conversion' ? `${v}%` : String(v))} />
            ))}
            <Tooltip
              contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))' }}
              labelFormatter={(d) => format(new Date(`${d}T00:00:00`), 'EEEE d MMMM')}
              formatter={(value: number, key: string) => {
                const m = METRICS.find((x) => x.key === key)!;
                return [m.format(value), m.label];
              }}
            />
            {shown.map((m) => (
              <Line key={m.key} yAxisId={m.key} type="monotone" dataKey={m.key} stroke={m.color} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
