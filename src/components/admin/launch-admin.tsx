'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Eye, Info, PackageCheck, Receipt, ShoppingBag, Wand2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/orders';
import { cn } from '@/lib/utils';

type Metric = { key: string; label: string; value: number | null; unit: 'n' | '%' | '$'; status: 'good' | 'warn' | 'bad' | 'none'; target: string; note?: string; sample: number | null };
type Step = { key: string; label: string; value: number; ofTop: number | null; ofPrevious: number | null };
type Launch = { trackingSince: string | null; groups: { title: string; metrics: Metric[] }[]; ready: { label: string; met: boolean }[]; funnel?: Step[] };

const STEP_ICON = { saw: Eye, tried: Wand2, bag: ShoppingBag, ordered: Receipt, delivered: PackageCheck } as const;
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 1000) / 10}%`);

/**
 * Where buyers drop off (last 30 days, different people per step). One series, so one colour and no legend:
 * each bar is the share of the people who saw an item, with its count and the share of the step before written
 * beside it (the numbers are the table; the bar is only the picture of them).
 */
function Funnel({ steps }: { steps: Step[] }) {
  // The biggest fall between two steps: the place to work on first.
  const worst = steps.slice(1).reduce<Step | null>((w, s) => (s.ofPrevious !== null && (w === null || s.ofPrevious < (w.ofPrevious ?? 1)) ? s : w), null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Where buyers drop off</CardTitle>
        <CardDescription>People who reached each step in the last 30 days. The bar is the share of everyone who saw an item.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.map((s, i) => {
          const Icon = STEP_ICON[s.key as keyof typeof STEP_ICON] ?? Circle;
          const tip = `${s.label}: ${s.value.toLocaleString()} ${s.value === 1 ? 'person' : 'people'} · ${pct(s.ofTop)} of those who saw an item${i ? ` · ${pct(s.ofPrevious)} of the step before` : ''}`;
          return (
            <div key={s.key} className="group rounded-lg p-1 -m-1 hover:bg-muted/60" title={tip}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2 font-medium"><Icon className="h-4 w-4 shrink-0 text-muted-foreground" /> <span className="truncate">{s.label}</span></span>
                <span className="shrink-0 tabular-nums">
                  <b>{s.value.toLocaleString()}</b>
                  {i > 0 && s.ofPrevious !== null && <span className="ml-2 text-xs text-muted-foreground">{pct(s.ofPrevious)} of the step before</span>}
                </span>
              </div>
              <div className="mt-1 h-2.5 w-full overflow-hidden rounded-[4px] bg-muted" role="img" aria-label={tip}>
                <div className="h-full rounded-[4px] bg-primary" style={{ width: `${Math.max(s.value ? 1.5 : 0, (s.ofTop ?? 0) * 100)}%` }} />
              </div>
            </div>
          );
        })}
        {worst && steps[0].value > 0 && (
          <p className="flex items-start gap-2 pt-1 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>The biggest drop is into <b className="text-foreground">{worst.label.toLowerCase()}</b> ({pct(worst.ofPrevious)} of the step before). Try-on is optional, so a person can order without it.</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const TONE = {
  good: 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40',
  warn: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40',
  bad: 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40',
  none: 'bg-card',
} as const;
const WORD = { good: 'On target', warn: 'Below target', bad: 'Warning', none: 'Too few people to tell yet' } as const;

function show(m: Metric) {
  if (m.value === null) return '—';
  if (m.unit === '%') return `${Math.round(m.value * 1000) / 10}%`;
  if (m.unit === '$') return formatPrice(m.value);
  return (Math.round(m.value * 10) / 10).toLocaleString();
}

/** Admin → Launch: the numbers that say whether the first release works and when to open the next step. */
export function LaunchAdmin() {
  const [data, setData] = useState<Launch | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => void api<Launch>('/admin/launch').then(setData).catch(() => setFailed(true)), []);
  if (failed) return <p className="text-sm text-muted-foreground">The launch numbers could not be loaded. Reload the page.</p>;
  if (!data) return <Skeleton className="h-96" />;
  const met = data.ready.filter((r) => r.met).length;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ready for the next step? {met}/{data.ready.length}</CardTitle>
          <CardDescription>Switch on shops and checkout (then live, try-on, courses) in Features when most of these hold for 4 to 6 weeks. If people don’t come back, fix the core first: shopping won’t help an app people don’t return to.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {data.ready.map((r) => (
            <p key={r.label} className="flex items-center gap-2">
              {r.met ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />} {r.label}
            </p>
          ))}
        </CardContent>
      </Card>
      {data.funnel && <Funnel steps={data.funnel} />}
      {data.groups.map((g) => (
        <section key={g.title} className="space-y-2">
          <h2 className="text-sm font-bold">{g.title}</h2>
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3">
            {g.metrics.map((m) => (
              <div key={m.key} className={cn('min-w-0 rounded-xl border p-3', TONE[m.status])}>
                <p className="text-2xl font-bold tabular-nums">{show(m)}</p>
                <p className="text-sm font-medium leading-tight">{m.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">Target: {m.target}</p>
                <p className="text-[11px] font-semibold text-muted-foreground">{WORD[m.status]}{m.sample !== null && m.status === 'none' ? ` (${m.sample} so far)` : ''}</p>
                {m.note && <p className="mt-1 text-[11px] text-muted-foreground">{m.note}</p>}
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {data.trackingSince ? `Daily use counted since ${data.trackingSince}; "come back" numbers include only people who joined since then.` : 'Daily use is counted from now on.'} Watching numbers come only from people who accepted personalisation in the cookie banner. Targets are starting points: adjust them as you learn.
      </p>
    </div>
  );
}
