'use client';

import { useCallback, useEffect, useState } from 'react';
import { Brain, Gauge, Sparkles, Timer, Wand2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { categoryLabel } from '@/lib/categories';
import { cn } from '@/lib/utils';

type Engine = { engine: string; category: string; made: number; failed: number; kept: number; rejected: number; ms_total: number };
type Learning = {
  days: number;
  writing: { written: number; kept: number; edited: number; rewritten: number; examples: number };
  tryOn: { kept: number; rejected: number; engines: Engine[]; orders: { category: string; order: string[] }[] };
  // Asked = questions the AI answered; followed = pieces opened afterwards, the only sign the advice was worth it.
  styling: { asked: number; followed: number; perAsk: number | null };
  usage: { model: string; purpose: string; calls: number; tokens: number }[];
};

const ENGINE: Record<string, string> = { own: 'Our own Studio', fashn: 'FASHN (paid)', free: 'Free public models' };
const PURPOSE: Record<string, string> = { write: 'Writing an item', look: 'Describing a look', style: 'Dressing a shopper', other: 'Other' };
// The same minimum the chain itself needs before a kept-rate is allowed to move it (server/ai-learn.mjs).
const ENOUGH = 8;

const percent = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
const pace = (ms: number, tries: number) => (tries > 0 ? `${(ms / tries / 1000).toFixed(1)} s` : '—');

/**
 * Admin → Platform → What the AI has learned.
 *
 * The memory around the models, read from GET /api/ai/learning (server/ai-learn.mjs): the descriptions sellers kept
 * (those become the writer's examples), how often shoppers keep each engine's realistic looks, the order the try-on
 * chain will actually try next, and the tokens spent. Nothing here trains a model, so the numbers are counters that
 * cannot quietly learn the wrong thing — and the order is asked of the chain itself, never re-derived on this page.
 */
export function AiLearningAdmin() {
  const [data, setData] = useState<Learning | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => api<Learning>('/ai/learning').then(setData).catch(() => setFailed(true)), []);
  useEffect(() => void load(), [load]);

  if (failed) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">What the AI has learned</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">These numbers are for INDECIANA only, and could not be read.</CardContent>
      </Card>
    );
  }
  if (!data) return <Skeleton className="h-96" />;

  const { writing, tryOn, styling, usage } = data;
  const answered = writing.kept + writing.edited + writing.rewritten;
  const keptRate = percent(writing.kept, answered);
  const looks = tryOn.kept + tryOn.rejected;
  const tokens = usage.reduce((sum, u) => sum + u.tokens, 0);
  const calls = usage.reduce((sum, u) => sum + u.calls, 0);
  const byCategory = new Map<string, Engine[]>();
  for (const row of tryOn.engines) byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row]);

  const tiles: [string, number, string][] = [
    ['Descriptions drafted', writing.written, 'every AI draft waiting for or given an answer'],
    ['Kept word for word', writing.kept, `${keptRate}% of the ones sellers answered`],
    ['Lightly edited', writing.edited, 'kept, with the shop’s own touches'],
    ['Rewritten', writing.rewritten, 'the draft was not worth publishing'],
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-primary" /> What the writer learned
            {writing.examples > 0 && <Badge variant="secondary">{writing.examples} example{writing.examples === 1 ? '' : 's'} in use</Badge>}
          </CardTitle>
          <CardDescription>
            Every description the AI writes is kept until the seller saves the item, then compared word for word with what
            they actually published. Nothing trains a model: the descriptions sellers keep become the examples the next
            draft follows — their own shop&apos;s voice first, the rest of the marketplace after.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {writing.written === 0 ? (
            <p className="text-muted-foreground">No description has been drafted yet. The first one teaches nothing; the first one kept teaches everything.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {tiles.map(([label, value, hint]) => (
                  <div key={label} className="min-w-0 rounded-xl border bg-card p-3" title={hint}>
                    <p className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</p>
                    <p className="truncate text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {answered === 0
                  ? 'No draft has been answered yet — a seller teaches it by saving an item with a description.'
                  : `${keptRate}% of the answered drafts were worth keeping. Kept ones are shown to the AI as examples; a rewritten one is never used as a model of good writing.`}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-5 w-5 text-primary" /> Which AI pleases shoppers
            {looks > 0 && <Badge variant="secondary">{looks.toLocaleString()} answers</Badge>}
          </CardTitle>
          <CardDescription>
            A shopper keeps the realistic look they wear or buy, and throws away the one that is wrong. When the free models
            are clearly kept and the paid one clearly is not, the chain tries the free ones first — otherwise the honest
            order stands: our own Studio, then the paid model, then the free ones.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {byCategory.size === 0 ? (
            <p className="text-muted-foreground">No realistic look has been made yet.</p>
          ) : (
            [...byCategory.entries()].map(([category, rows]) => {
              const order = tryOn.orders.find((o) => o.category === category)?.order ?? [];
              return (
                <div key={category} className="space-y-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="font-semibold">{categoryLabel(category)}</p>
                    <p className="text-xs text-muted-foreground">
                      next looks try: <b className="text-foreground">{order.map((e) => ENGINE[e] ?? e).join(' → ') || '—'}</b>
                    </p>
                  </div>
                  {rows.map((row) => {
                    const seen = row.kept + row.rejected;
                    const tries = row.made + row.failed;
                    const rate = percent(row.kept, seen);
                    return (
                      <div key={row.engine} className="rounded-xl border bg-card p-3">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-medium">{ENGINE[row.engine] ?? row.engine}</span>
                          <span className="text-xs text-muted-foreground">
                            {seen >= ENOUGH ? `kept ${row.kept} of ${seen} (${rate}%)` : `not enough answers yet (${seen} of ${ENOUGH})`}
                          </span>
                          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                            <Timer className="h-3.5 w-3.5" /> {pace(row.ms_total, tries)}
                            {row.failed > 0 && <span className="text-amber-600"> · {row.failed} failed</span>}
                          </span>
                        </div>
                        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted">
                          <span
                            className={cn('block h-full rounded-full', rate >= 70 ? 'bg-emerald-500' : rate >= 45 ? 'bg-primary' : 'bg-amber-500')}
                            style={{ width: `${seen >= ENOUGH ? rate : 0}%` }}
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
          <p className="text-xs text-muted-foreground">
            A kept-rate only moves the chain once an engine has {ENOUGH} answers: a handful of shoppers is not proof.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wand2 className="h-5 w-5 text-primary" /> What the stylist was asked
            {styling.asked > 0 && <Badge variant="secondary">{styling.asked.toLocaleString()} question{styling.asked === 1 ? '' : 's'}</Badge>}
          </CardTitle>
          <CardDescription>
            A shopper says where they are going and the stylist picks one to four real items. It may only choose ids from a
            shortlist that server/recommend.mjs has already ordered by what this shopper looks at and wears, so it cannot
            suggest something Saligue does not sell, and every price comes from the shop&apos;s own data. Opening a piece
            afterwards is the only honest sign the advice was worth the tokens.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {styling.asked === 0 ? (
            <p className="text-muted-foreground">Nobody has asked the stylist yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="min-w-0 rounded-xl border bg-card p-3">
                  <p className="text-2xl font-bold tabular-nums">{styling.asked.toLocaleString()}</p>
                  <p className="truncate text-xs text-muted-foreground">questions answered</p>
                </div>
                <div className="min-w-0 rounded-xl border bg-card p-3">
                  <p className="text-2xl font-bold tabular-nums">{styling.followed.toLocaleString()}</p>
                  <p className="truncate text-xs text-muted-foreground">pieces opened afterwards</p>
                </div>
                <div className="min-w-0 rounded-xl border bg-card p-3">
                  <p className="text-2xl font-bold tabular-nums">{styling.perAsk === null ? '—' : styling.perAsk.toFixed(2)}</p>
                  <p className="truncate text-xs text-muted-foreground">opened per answer</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Only a question the AI actually answered is counted. A shopper with no key, a shop with nothing in their size,
                or a model that is busy is served from the catalogue instead — and counted nowhere, so these numbers never
                flatter the AI.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-5 w-5 text-primary" /> What the AI cost
            <Badge variant="secondary">last {data.days} days</Badge>
          </CardTitle>
          <CardDescription>
            Tokens per model and purpose, counted per account (server/ai-learn.mjs). A key that has been cut off, or a
            prompt that grew without anyone noticing, shows up here first.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {usage.length === 0 ? (
            <p className="text-muted-foreground">Nothing spent yet.</p>
          ) : (
            <>
              <div className="divide-y">
                {usage.map((u) => (
                  <div key={`${u.model}-${u.purpose}`} className="flex flex-wrap items-baseline gap-x-2 py-2">
                    <span className="font-medium">{PURPOSE[u.purpose] ?? u.purpose}</span>
                    <span className="text-xs text-muted-foreground">{u.model}</span>
                    <span className="ml-auto tabular-nums">{u.tokens.toLocaleString()} tokens</span>
                    <span className="text-xs text-muted-foreground">in {u.calls.toLocaleString()} call{u.calls === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
              <p className="border-t pt-2 text-xs text-muted-foreground">
                <b className="text-foreground">{tokens.toLocaleString()}</b> tokens in {calls.toLocaleString()} calls over the last {data.days} days.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
