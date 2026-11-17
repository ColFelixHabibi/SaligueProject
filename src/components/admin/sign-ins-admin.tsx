'use client';

import { useEffect, useState } from 'react';
import { Globe2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Verdict = 'you' | 'new_place' | 'suspicious' | 'attacker';
type Row = { id: number; at: string; place: string | null; device: string; method: string; outcome: string; verdict: Verdict; reason: string; ip: string | null; account: string };
type Country = { country: string | null; place: string } & Record<Verdict, number>;
type Overview = { totals: Record<Verdict, number>; countries: Country[]; latest: Row[] };

const LABEL: Record<Verdict, { label: string; tone: string }> = {
  you: { label: 'The owners', tone: 'bg-emerald-500' },
  new_place: { label: 'Owners in a new place', tone: 'bg-sky-500' },
  suspicious: { label: 'Not recognised', tone: 'bg-amber-500' },
  attacker: { label: 'Attackers', tone: 'bg-red-600' },
};
const ORDER: Verdict[] = ['attacker', 'suspicious', 'new_place', 'you'];

/**
 * Admin → Security: everyone who signed in or tried to this week, by country, split into the owners themselves and
 * strangers (server/signins.mjs). An attacker is an address guessing on several accounts, trying emails that do not
 * exist, keeping on at one account from somewhere new, or already blocked.
 */
export function SignInsAdmin({ onBlock }: { onBlock: (ip: string) => void }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    void api<Overview>(`/admin/security/sign-ins${verdict ? `?verdict=${verdict}` : ''}`).then(setData).catch(() => {});
  }, [verdict]);
  if (!data) return <Skeleton className="h-64" />;
  const most = Math.max(1, ...data.countries.map((c) => ORDER.reduce((s, v) => s + c[v], 0)));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Globe2 className="h-5 w-5 text-primary" /> Who tried to sign in (7 days)</CardTitle>
        <CardDescription>Each sign-in and wrong password, by the country of its address, told apart from the account&apos;s own history.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={verdict === null ? 'default' : 'outline'} className="rounded-full" onClick={() => setVerdict(null)}>All</Button>
          {ORDER.map((v) => (
            <Button key={v} size="sm" variant={verdict === v ? 'default' : 'outline'} className="rounded-full" onClick={() => setVerdict(v)}>
              <span className={cn('mr-1.5 h-2 w-2 rounded-full', LABEL[v].tone)} /> {LABEL[v].label} <Badge variant="secondary" className="ml-1.5">{data.totals[v]}</Badge>
            </Button>
          ))}
        </div>
        {data.countries.length === 0 && <p className="text-muted-foreground">No sign-ins this week.</p>}
        <div className="space-y-1.5">
          {data.countries.slice(0, 12).map((c) => (
            <div key={c.country ?? 'unknown'} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-xs font-medium">{c.place}</span>
              <div className="flex h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                {ORDER.map((v) => c[v] > 0 && <span key={v} className={LABEL[v].tone} style={{ width: `${(c[v] / most) * 100}%` }} title={`${LABEL[v].label}: ${c[v]}`} />)}
              </div>
              <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{c.attacker + c.suspicious ? <b className="text-destructive">{c.attacker + c.suspicious} strangers</b> : `${c.you + c.new_place} owners`}</span>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          {data.latest.slice(0, 30).map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border p-2 text-xs">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', LABEL[r.verdict].tone)} />
              <span className="font-semibold">{r.place ?? 'Unknown'}</span>
              <span className="text-muted-foreground">{r.device}</span>
              <span className="min-w-0 flex-1 truncate">{r.account}</span>
              <span className="text-muted-foreground">{new Date(r.at).toLocaleString()}</span>
              <span className="basis-full text-muted-foreground">{r.reason}{r.ip ? ` · ${r.ip}` : ''}</span>
              {r.ip && (r.verdict === 'attacker' || r.verdict === 'suspicious') && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={() => onBlock(r.ip!)}>Block address</Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
