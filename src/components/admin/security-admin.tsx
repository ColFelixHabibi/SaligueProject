'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { cn } from '@/lib/utils';

type Event = { id: number; kind: string; ip: string | null; country: string | null; user_id: string | null; detail: string; alerted: number; created_at: string };
type Blocked = { ip: string; reason: string; until: string | null; by: string; created_at: string };
type Check = { key: string; ok: boolean; label: string; fix: string };
type Security = { last24h: Record<string, number>; topAddresses: { ip: string; country: string | null; n: number; kinds: string }[]; events: Event[]; blocked: Blocked[]; server: Check[] };

const KIND: Record<string, string> = {
  login_failed: 'Wrong password', account_locked: 'Account locked', admin_login: 'Admin signed in', admin_denied: 'Admin function refused',
  probe: 'Scan for weak spots', injection: 'Attack text', flood: 'Request flood', webhook_forged: 'Fake payment call',
  signup_burst: 'Many new accounts', reset: 'Password reset asked', admin_change: 'Admin change', ssh_login: 'Server sign-in (SSH)', ssh_failed: 'Server password guesses (SSH)', chat_spam: 'Messaging many people',
};
// The worrying ones are shown in red.
const SERIOUS = new Set(['chat_spam', 'webhook_forged', 'admin_change', 'ssh_login', 'injection', 'account_locked', 'flood']);
const TILES: [string, string][] = [
  ['ssh_failed_attempts', 'Server password guesses'], ['login_failed', 'Wrong passwords'], ['probe', 'Scans'], ['injection', 'Attack texts'],
  ['admin_denied', 'Admin refused'], ['webhook_forged', 'Fake payments'], ['flood', 'Floods'], ['admin_change', 'Admin changes'],
];

/** Admin → Security: attacks noticed, blocked addresses, and how the server is set up. Alerts also come by push and email. */
export function SecurityAdmin() {
  const { toast } = useToast();
  const [data, setData] = useState<Security | null>(null);
  const [ip, setIp] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const load = useCallback(() => api<Security>('/admin/security').then(setData).catch(() => {}), []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);
  const act = (p: Promise<Security>, done: string) =>
    p.then((d) => { setData(d); toast({ title: done }); }).catch((e) => toast({ variant: 'destructive', title: 'Not done', description: friendlyError(e) }));
  const block = (target: string) => act(api<Security>('/admin/security/block', { body: { ip: target, hours: 24 * 30, reason: 'Blocked by an admin' } }), `${target} blocked for 30 days`);
  const unblock = (target: string) => act(api<Security>(`/admin/security/block/${encodeURIComponent(target)}`, { method: 'DELETE' }), `${target} unblocked`);
  if (!data) return <Skeleton className="h-96" />;
  const weak = data.server.filter((c) => !c.ok);
  const events = filter ? data.events.filter((e) => e.kind === filter) : data.events;

  return (
    <div className="space-y-6">
      <Card className={cn(weak.length && 'border-red-300 dark:border-red-800')}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">{weak.length ? <ShieldAlert className="h-5 w-5 text-red-600" /> : <ShieldCheck className="h-5 w-5 text-emerald-600" />} The server</CardTitle>
          <CardDescription>The doors attackers try first. Saligue can’t change these by itself: they need someone signed in to the server.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.server.length === 0 && <p className="text-muted-foreground">Could not read the server’s settings.</p>}
          {data.server.map((c) => (
            <div key={c.key} className="flex items-start gap-2">
              {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
              <span><b>{c.label}</b>{!c.ok && <span className="block text-xs text-muted-foreground">{c.fix}</span>}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-bold">Last 24 hours</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TILES.map(([key, label]) => {
            const n = data.last24h[key] ?? 0;
            const kind = key === 'ssh_failed_attempts' ? 'ssh_failed' : key;
            return (
              <button key={key} type="button" onClick={() => setFilter(filter === kind ? null : kind)}
                className={cn('min-w-0 rounded-xl border p-3 text-left', n && SERIOUS.has(kind) ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40' : 'bg-card', filter === kind && 'ring-2 ring-primary')}>
                <p className="text-2xl font-bold tabular-nums">{n.toLocaleString()}</p>
                <p className="truncate text-xs text-muted-foreground">{label}</p>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">You get a push and an email for anything serious: an admin or server sign-in from a new place, admin changes, fake payments, attacks that got blocked. Every morning at 9:00 (Kigali) comes a summary.</p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Ban className="h-5 w-5 text-primary" /> Blocked addresses {data.blocked.length > 0 && <Badge>{data.blocked.length}</Badge>}</CardTitle>
          <CardDescription>Clear attackers are blocked automatically for a while. Phone networks put many people behind one address, so blocks are short unless you choose.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (ip.trim()) void block(ip.trim()).then(() => setIp('')); }}>
            <Input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="IP address to block" aria-label="IP address to block" />
            <Button type="submit" variant="outline">Block 30 days</Button>
          </form>
          {data.blocked.map((b) => (
            <div key={b.ip} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-3">
              <span className="min-w-0 flex-1"><b className="select-all">{b.ip}</b> · {b.reason} · {b.until ? `until ${new Date(b.until).toLocaleString()}` : 'until lifted'} · by {b.by}</span>
              <Button size="sm" variant="ghost" onClick={() => void unblock(b.ip)}>Unblock</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {data.topAddresses.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Most active addresses (24 hours)</CardTitle></CardHeader>
          <CardContent className="divide-y text-sm">
            {data.topAddresses.map((a) => (
              <div key={a.ip} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1"><b className="select-all">{a.ip}</b> {a.country && `(${a.country})`} · {a.n} · {a.kinds.split(',').map((k) => KIND[k] ?? k).join(', ')}</span>
                {!data.blocked.some((b) => b.ip === a.ip) && <Button size="sm" variant="outline" onClick={() => void block(a.ip)}>Block</Button>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What happened {filter && <button type="button" className="ml-2 text-xs font-normal text-primary underline" onClick={() => setFilter(null)}>show all</button>}</CardTitle>
          <CardDescription>The latest 200 events, newest first. Kept 90 days.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y text-sm">
          {events.length === 0 && <p className="text-muted-foreground">Nothing yet.</p>}
          {events.map((e) => (
            <div key={e.id} className="py-2">
              <p className="flex flex-wrap items-center gap-x-2">
                <b className={cn(SERIOUS.has(e.kind) && 'text-red-600')}>{KIND[e.kind] ?? e.kind}</b>
                {e.ip && <span className="select-all text-muted-foreground">{e.ip}{e.country ? ` (${e.country})` : ''}</span>}
                {!!e.alerted && <Badge variant="secondary">alerted</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
              </p>
              {e.detail && <p className="break-words text-xs text-muted-foreground">{e.detail}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
