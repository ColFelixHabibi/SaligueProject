'use client';

import { FeatureCountries, ruleSummary, type CountryRule } from '@/components/admin/feature-countries';
import { ask } from '@/components/confirm-dialog';
import { useCallback, useEffect, useState } from 'react';
import { Ban, ChevronDown, Eraser, History, Loader2, Plus, RotateCcw, ScrollText, Search, ShieldCheck, SlidersHorizontal, Trash2, UserCog, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { api, apiUrl, getToken } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { DEFAULT_POLICIES, type Policy, type PolicyKey } from '@/lib/policies';
import { cn } from '@/lib/utils';

function useAct() {
  const { toast } = useToast();
  return async <T,>(fn: () => Promise<T>, done?: string): Promise<T | null> => {
    try {
      const r = await fn();
      if (done) toast({ title: done });
      return r;
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) });
      return null;
    }
  };
}

/** Switch the main parts of Saligue on and off, at once, for everyone (web and app). */
export function FeaturesAdmin({ features }: { features: Record<string, string> }) {
  const act = useAct();
  const [state, setState] = useState<Record<string, boolean> | null>(null);
  const [rules, setRules] = useState<Record<string, CountryRule>>({});
  useEffect(() => {
    void api<Record<string, boolean>>('/admin/features').then(setState).catch(() => {});
    void api<Record<string, CountryRule>>('/admin/feature-countries').then(setRules).catch(() => {});
  }, []);
  const saveCountries = (key: string, rule: CountryRule | null) =>
    act(() => api<Record<string, CountryRule>>('/admin/feature-countries', { method: 'PUT', body: { feature: key, mode: rule?.mode, countries: rule?.countries ?? [], reason: rule?.reason ?? null } }), `${features[key]}: ${ruleSummary(rule ?? undefined).toLowerCase()}`)
      .then((r) => r && setRules(r));
  const toggle = async (key: string, on: boolean) => {
    const next = await act(() => api<Record<string, boolean>>('/admin/features', { method: 'PUT', body: { [key]: on } }), `${features[key]} ${on ? 'on' : 'off'}`);
    if (next) setState(next);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><SlidersHorizontal className="h-5 w-5 text-primary" /> Features</CardTitle>
        <CardDescription>Turned-off features disappear from the website and the app at once, and the server refuses them. Nothing is deleted: turn them back on any time. 🌍 limits a feature to some countries (e.g. monetization where it’s useful, or a feature closed where the law asks).</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {!state && <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}
        {state && Object.entries(features).map(([key, label]) => (
          <div key={key} className="flex items-center justify-between gap-2 py-2.5">
            <Label htmlFor={`f-${key}`} className="min-w-0 flex-1 text-sm font-medium">{label}</Label>
            {state[key] !== false && <FeatureCountries label={label} rule={rules[key]} onSave={(r) => saveCountries(key, r)} />}
            <Switch id={`f-${key}`} checked={state[key] !== false} onCheckedChange={(v) => toggle(key, v)} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

type Rules = { followers: number; views90: number; accountDays: number; creatorShare: number; cpm: number; minBudget: number; tipShare: number; tipAmounts: number[]; verificationPrice: number; saleFee: number; freeDays: number; shareRate: number; shareDays: number; shareCap: number };

/** The numbers behind monetization, ads and tips. */
export function RulesAdmin() {
  const act = useAct();
  const [r, setR] = useState<Rules | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<Rules>('/admin/rules').then((d) => {
      setR(d);
      setForm({ followers: String(d.followers), views90: String(d.views90), accountDays: String(d.accountDays), creatorShare: String(Math.round(d.creatorShare * 100)), cpm: String(d.cpm), minBudget: String(d.minBudget), tipShare: String(Math.round(d.tipShare * 100)), tipAmounts: d.tipAmounts.join(', '), verificationPrice: String(d.verificationPrice), saleFee: String(Math.round(d.saleFee * 10000) / 100), freeDays: String(d.freeDays), shareRate: String(Math.round(d.shareRate * 10000) / 100), shareDays: String(d.shareDays), shareCap: String(d.shareCap) });
    }).catch(() => setFailed(true));
  }, []);
  if (failed) return <p className="text-sm text-muted-foreground">The money rules could not be loaded. Reload the page.</p>;
  if (!r) return <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />;
  const field = (key: string, label: string, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`r-${key}`}>{label}</Label>
      <Input id={`r-${key}`} value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} inputMode="decimal" />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
  const save = () => act(() => api<Rules>('/admin/rules', { method: 'PUT', body: {
    followers: Number(form.followers), views90: Number(form.views90), accountDays: Number(form.accountDays),
    creatorShare: Number(form.creatorShare) / 100, cpm: Number(form.cpm), minBudget: Number(form.minBudget),
    tipShare: Number(form.tipShare) / 100, tipAmounts: form.tipAmounts.split(/[,\s]+/).map(Number).filter(Boolean), verificationPrice: Number(form.verificationPrice), saleFee: Number(form.saleFee) / 100, freeDays: Number(form.freeDays), shareRate: Number(form.shareRate) / 100, shareDays: Number(form.shareDays), shareCap: Number(form.shareCap),
  } }), 'Rules saved').then((d) => d && setR(d));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5 text-primary" /> Money rules</CardTitle>
        <CardDescription>Used by Saligue immediately. If you change a number, also update the policy text below so it says the same.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm font-semibold">Creator monetization: who can join</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {field('followers', 'Clients needed')}
          {field('views90', 'Item views in 90 days')}
          {field('accountDays', 'Days since joining')}
        </div>
        <p className="text-sm font-semibold">Saligue’s fee on each sale</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('saleFee', 'Fee per sale (%)', 'Up to 30%. Fixed on each order when it is placed')}
          {field('freeDays', 'Free days for a new shop', 'No fee during a shop’s first days')}
        </div>
        <p className="text-sm font-semibold">Share & earn: anyone earns from sales their links bring (no minimum)</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('shareRate', 'Share & earn reward (%)', 'Up to 20%. Saligue pays it to whoever shared the link, on delivered sales')}
          {field('shareDays', 'Share link counts for (days)', 'A purchase within these days of opening the link earns the sharer')}
          {field('shareCap', 'Largest reward per item ($)', 'Limits what a faked sale could earn. Sales not paid online also wait for your approval (Money)')}
        </div>
        <p className="text-sm font-semibold">Ads and creators’ share</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {field('cpm', 'Price per 1,000 views ($)')}
          {field('minBudget', 'Smallest ad budget ($)')}
          {field('creatorShare', 'Creators’ share of ad income (%)', 'Up to 90%')}
        </div>
        <p className="text-sm font-semibold">Tips</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('tipShare', 'Receiver’s share (%)', 'Saligue keeps the rest')}
          {field('tipAmounts', 'Amounts offered ($)', 'Separated by commas, e.g. 1, 2, 5, 10, 20')}
        </div>
        <p className="text-sm font-semibold">Verification badge (optional for users)</p>
        <div className="grid gap-3 sm:grid-cols-2">{field('verificationPrice', 'Price per month ($)', 'Each payment gives 30 days; cents only, e.g. 2.53')}</div>
        <Button onClick={save}>Save rules</Button>
      </CardContent>
    </Card>
  );
}

const POLICY_NAMES: Record<PolicyKey, string> = { monetization: 'Monetization Policy', ads: 'Ads Policy', verification: 'Verification Policy', terms: 'Terms of Service', privacy: 'Privacy Policy', cookies: 'Cookie Policy', takedown: 'Notice and Takedown Policy', dataprotection: 'Data Protection' };
// Where each policy's page lives: most are the plain key, the rest have their own address.
const POLICY_PATHS: Record<PolicyKey, string> = { monetization: '/monetization-policy', ads: '/ads-policy', verification: '/verification-policy', terms: '/terms', privacy: '/privacy', cookies: '/cookies', takedown: '/takedown-policy', dataprotection: '/data-protection' };
type Draft = { intro: string; sections: { heading: string; text: string }[] };
const toDraft = (p: Partial<Policy>, base: Policy): Draft => ({ intro: p.intro ?? base.intro, sections: (p.sections ?? base.sections).map((s) => ({ heading: s.heading, text: s.paragraphs.join('\n\n') })) });

/** Edit the text of any policy page; "Back to Saligue's text" restores the default. */
export function PoliciesAdmin() {
  const act = useAct();
  const [key, setKey] = useState<PolicyKey>('monetization');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [edited, setEdited] = useState(false);
  const load = useCallback(() => {
    setDraft(null);
    api<Partial<Policy> | null>(`/policies/${key}`).then((p) => {
      setEdited(!!p);
      setDraft(toDraft(p ?? {}, DEFAULT_POLICIES[key]));
    }).catch(() => setDraft(toDraft({}, DEFAULT_POLICIES[key])));
  }, [key]);
  useEffect(load, [load]);
  const save = () => draft && act(() => api(`/admin/policies/${key}`, { method: 'PUT', body: { intro: draft.intro, sections: draft.sections.map((s) => ({ heading: s.heading, paragraphs: s.text.split(/\n\s*\n/) })) } }), 'Policy published').then((r) => r && setEdited(true));
  const reset = () => act(() => api(`/admin/policies/${key}`, { method: 'PUT', body: { reset: true } }), 'Back to Saligue’s text').then(load);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ScrollText className="h-5 w-5 text-primary" /> Policies</CardTitle>
        <CardDescription>Changes are published on the policy page as soon as you save. Separate paragraphs with an empty line.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(POLICY_NAMES) as PolicyKey[]).map((k) => (
            <Button key={k} size="sm" variant={k === key ? 'default' : 'outline'} className="rounded-full" onClick={() => setKey(k)}>{POLICY_NAMES[k]}</Button>
          ))}
        </div>
        {!draft ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /> : (
          <>
            <p className="text-xs text-muted-foreground">{edited ? 'This policy has been edited by an admin.' : 'This is Saligue’s default text.'} <a className="text-primary underline" href={POLICY_PATHS[key]} target="_blank" rel="noreferrer">Open the page</a></p>
            <div className="space-y-1.5"><Label>Introduction</Label><Textarea rows={3} value={draft.intro} onChange={(e) => setDraft({ ...draft, intro: e.target.value })} /></div>
            {draft.sections.map((s, i) => (
              <div key={i} className="space-y-2 rounded-xl border p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{i + 1}.</span>
                  <Input value={s.heading} onChange={(e) => setDraft({ ...draft, sections: draft.sections.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)) })} placeholder="Heading" />
                  <Button size="icon" variant="ghost" aria-label="Remove section" onClick={() => setDraft({ ...draft, sections: draft.sections.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
                <Textarea rows={Math.min(12, 2 + s.text.split('\n').length)} value={s.text} onChange={(e) => setDraft({ ...draft, sections: draft.sections.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setDraft({ ...draft, sections: [...draft.sections, { heading: '', text: '' }] })}><Plus className="mr-1 h-4 w-4" /> Add section</Button>
              <Button onClick={save}>Publish</Button>
              {edited && <Button variant="ghost" onClick={reset}><RotateCcw className="mr-1 h-4 w-4" /> Back to Saligue’s text</Button>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type Account = {
  id: string; name: string; email: string; role: string; official: boolean; adminLevel: number; createdAt: string; items: number; orders: number;
  suspended: boolean; suspendReason: string | null; suspendedAt?: string | null; suspendedUntil?: string | null;
  closureRequestedAt?: string | null; closureRequestedBy?: string | null; deleteAfter?: string | null; canConfirmClosure?: boolean;
  appeal?: string | null; appealAt?: string | null;
};

const SUSPEND_FOR = [{ days: 1, label: '1 day' }, { days: 3, label: '3 days' }, { days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: 0, label: 'Until reviewed' }];
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');

/**
 * Accounts, closed in three steps and never in one: (1) suspended for a set time, which ends by itself; (2) closure
 * asked for, with a 14-day notice in which the person can ask for a review; (3) closed for good only when a second
 * admin (or the main admin) confirms it after the notice.
 */
export function AccountsAdmin() {
  const act = useAct();
  const [q, setQ] = useState('');
  const [onlySuspended, setOnlySuspended] = useState(false);
  const [list, setList] = useState<Account[] | null>(null);
  // The account whose suspension is being set up (reason and how long), inline under its row.
  const [editing, setEditing] = useState<string | null>(null);
  const [reason, setReason] = useState('Breaking the Terms of Service');
  const [days, setDays] = useState(7);
  const search = useCallback(
    () => api<Account[]>(onlySuspended ? '/admin/users?only=suspended' : `/admin/users?q=${encodeURIComponent(q)}`).then(setList).catch(() => setList([])),
    [q, onlySuspended]
  );
  useEffect(() => {
    const t = setTimeout(search, 300);
    return () => clearTimeout(t);
  }, [search]);
  const suspend = async (a: Account) => {
    await act(() => api(`/admin/users/${a.id}/suspend`, { body: { suspended: true, reason, days } }), 'Account suspended');
    setEditing(null);
    void search();
  };
  const restore = async (a: Account) => {
    if (!(await ask({ title: `Restore ${a.name}?`, description: 'They can sign in again at once, and any closure is cancelled.', confirm: 'Restore' }))) return;
    await act(() => api(`/admin/users/${a.id}/suspend`, { body: { suspended: false } }), 'Account restored');
    void search();
  };
  const closure = async (a: Account, action: 'request' | 'cancel' | 'confirm') => {
    const answer =
      action === 'request'
        ? await ask({ title: `Ask to close ${a.name} for good?`, description: 'They are told today and have 14 days to ask for a review. After that, another admin (or the main admin) must confirm it.', confirm: 'Ask to close', destructive: true, input: { label: 'Reason (shown to them)', value: a.suspendReason ?? 'Breaking the Terms of Service' } })
        : action === 'confirm'
          ? await ask({ title: `Delete ${a.name} permanently?`, description: 'The account is deleted with all its data: shop, items, lessons, lives, chats, comments, files. Only orders and money records stay, without their name or address. This cannot be undone.', confirm: 'Delete permanently', destructive: true })
          : await ask({ title: `Keep ${a.name}?`, description: 'The closure is cancelled. The account stays suspended until you restore it.', confirm: 'Cancel closure' });
    if (answer === null) return;
    await act(() => api(`/admin/users/${a.id}/closure`, { body: { action, reason: typeof answer === 'string' ? answer : undefined } }),
      action === 'request' ? 'Closure asked for' : action === 'confirm' ? 'Account deleted permanently' : 'Closure cancelled');
    void search();
  };
  const step = (a: Account) =>
    a.closureRequestedAt
      ? `Step 2 · closure asked by ${a.closureRequestedBy ?? 'Saligue'} · ${a.canConfirmClosure ? 'ready for your check' : `notice ends ${day(a.deleteAfter)}`}`
      : `Step 1 · suspended${a.suspendedUntil ? ` until ${day(a.suspendedUntil)}` : ' until reviewed'}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><UserCog className="h-5 w-5 text-primary" /> Accounts</CardTitle>
        <CardDescription>
          Three steps, never one: <b>1.</b> suspend for a set time (it ends by itself) · <b>2.</b> ask to close — they get 14 days to ask for a review · <b>3.</b> a second admin confirms — the account is deleted with all its data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Name, email or shop" value={q} disabled={onlySuspended} onChange={(e) => setQ(e.target.value)} /></div>
          <Button variant={onlySuspended ? 'default' : 'outline'} onClick={() => setOnlySuspended((v) => !v)} aria-pressed={onlySuspended}><Ban className="mr-1 h-4 w-4" /> Suspended</Button>
        </div>
        {list === null && <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}
        {list?.length === 0 && <p className="text-sm text-muted-foreground">No account found.</p>}
        {list?.map((a) => (
          <div key={a.id} className={cn('space-y-2 rounded-xl border p-3 text-sm', a.suspended && 'border-destructive/40 bg-destructive/5')}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="break-words font-semibold">{a.name} {a.adminLevel ? <Badge variant="outline" className="ml-1">{a.adminLevel === 1 ? 'Main admin' : 'Sub-admin'}</Badge> : null}{a.official && <Badge variant="outline" className="ml-1">INDECIANA</Badge>}</p>
                <p className="truncate text-xs text-muted-foreground">{a.email} · {a.items} items · {a.orders} orders · since {day(a.createdAt)}</p>
                {a.suspended && <p className="text-xs font-semibold text-destructive">{step(a)}{a.suspendReason ? ` · ${a.suspendReason}` : ''}</p>}
              </div>
              {a.adminLevel !== 1 && !a.suspended && (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setEditing(editing === a.id ? null : a.id)}><Ban className="mr-1 h-4 w-4" /> Suspend</Button>
              )}
              {a.suspended && (
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => restore(a)}><RotateCcw className="mr-1 h-4 w-4" /> Restore</Button>
                  {!a.closureRequestedAt && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => closure(a, 'request')}>Ask to close</Button>}
                  {a.closureRequestedAt && <Button size="sm" variant="ghost" onClick={() => closure(a, 'cancel')}>Keep</Button>}
                  {a.canConfirmClosure && <Button size="sm" variant="destructive" onClick={() => closure(a, 'confirm')}><Trash2 className="mr-1 h-4 w-4" /> Delete permanently</Button>}
                </div>
              )}
            </div>
            {a.appeal && (
              <p className="rounded-lg bg-background p-2 text-xs"><b>They asked for a review ({day(a.appealAt)}):</b> {a.appeal}</p>
            )}
            {editing === a.id && (
              <div className="space-y-2 rounded-lg bg-background p-2">
                <Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} aria-label="Reason (shown to them)" placeholder="Reason (shown to them)" />
                <div className="flex flex-wrap gap-1.5">
                  {SUSPEND_FOR.map((o) => (
                    <Button key={o.days} size="sm" type="button" variant={days === o.days ? 'default' : 'outline'} className="rounded-full" onClick={() => setDays(o.days)}>{o.label}</Button>
                  ))}
                </div>
                <Button size="sm" variant="destructive" disabled={!reason.trim()} onClick={() => suspend(a)}>Suspend {days ? `for ${days} day${days > 1 ? 's' : ''}` : 'until reviewed'}</Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

type AdminRow = { id: string; name: string; email: string; level: number; perms: string[] };

/** Main admin only: add sub-admins (type 2) and choose exactly what each may do. */
export function AdminsAdmin({ allPerms }: { allPerms: Record<string, string> }) {
  const act = useAct();
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [email, setEmail] = useState('');
  const [perms, setPerms] = useState<string[]>(['moderation']);
  const [mainAdmin, setMainAdmin] = useState(false);
  const load = useCallback(() => api<AdminRow[]>('/admin/admins').then(setAdmins).catch(() => {}), []);
  useEffect(() => void load(), [load]);
  const toggle = (list: string[], p: string) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]);
  const permBoxes = (value: string[], onChange: (v: string[]) => void) => (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {Object.entries(allPerms).map(([p, label]) => (
        <label key={p} className="flex items-start gap-2 rounded-lg border p-2 text-xs">
          <input type="checkbox" className="mt-0.5 accent-primary" checked={value.includes(p)} onChange={() => onChange(toggle(value, p))} />
          <span><b className="capitalize">{p}</b> — {label}</span>
        </label>
      ))}
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Admins</CardTitle>
        <CardDescription>Main admins can do everything and manage admins; Saligue always keeps at least one. Sub-admins see only the tabs of the rights you give them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {admins.map((a) => (
          <div key={a.id} className="space-y-2 rounded-xl border p-3 text-sm">
            {/* Name and email get the full width on their own lines; the role and Remove sit below, so a phone
                never squeezes the email into one letter per line. */}
            <div className="min-w-0">
              <b className="block truncate">{a.name || a.email}</b>
              <span className="block truncate text-xs text-muted-foreground">{a.email}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{a.level === 1 ? 'Main admin · everything' : 'Sub-admin'}</Badge>
              <span className="flex-1" />
              {(a.level === 2 || admins.filter((x) => x.level === 1).length > 1) && <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => (await ask({ title: `Remove ${a.email} as admin?`, description: 'Their account stays; only the admin rights are removed.', confirm: 'Remove', destructive: true })) && act(() => api(`/admin/admins/${a.id}`, { method: 'DELETE' }), 'Admin removed').then(load)}>Remove</Button>}
            </div>
            {a.level === 2 && permBoxes(a.perms, (v) => act(() => api(`/admin/admins/${a.id}`, { method: 'PUT', body: { perms: v } }), 'Rights updated').then(load))}
          </div>
        ))}
        <div className="space-y-2 rounded-xl bg-muted/50 p-3">
          <p className="text-sm font-semibold">Add a sub-admin</p>
          <Input type="email" placeholder="Their Saligue account email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <label className="flex items-start gap-2 text-sm font-medium"><input type="checkbox" className="mt-1 accent-primary" checked={mainAdmin} onChange={(e) => setMainAdmin(e.target.checked)} /> Main admin (every right, can manage admins) — e.g. your own separate admin account</label>
          {!mainAdmin && permBoxes(perms, setPerms)}
          <Button disabled={!email.trim() || (!mainAdmin && !perms.length)} onClick={() => act(() => api('/admin/admins', { body: mainAdmin ? { email, main: true } : { email, perms } }), mainAdmin ? 'Main admin added' : 'Sub-admin added').then((r) => { if (r) { setEmail(''); setMainAdmin(false); void load(); } })}><Plus className="mr-1 h-4 w-4" /> Add</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Older log lines kept the raw settings ({"followers":10000,…}): shown as short words instead.
const LOG_LABEL: Record<string, string> = {
  followers: 'Clients needed', views90: 'Views 90 days', accountDays: 'Account days', creatorShare: 'Creator share', cpm: 'Ad price /1000', minBudget: 'Min. ad budget',
  tipShare: 'Tip share', tipAmounts: 'Tips', verificationPrice: 'Verification', saleFee: 'Sale fee', freeDays: 'Free days', shareRate: 'Share reward', shareDays: 'Share days', shareCap: 'Share cap',
};
const SHARES = new Set(['creatorShare', 'tipShare', 'saleFee', 'shareRate']);
function readable(detail: string) {
  if (!detail.startsWith('{')) return detail;
  try {
    return Object.entries(JSON.parse(detail) as Record<string, unknown>).map(([k, v]) => {
      const value = SHARES.has(k) && typeof v === 'number' ? `${Math.round(v * 10000) / 100}%` : Array.isArray(v) ? v.join(', ') : typeof v === 'number' ? v.toLocaleString() : String(v);
      return `${LOG_LABEL[k] ?? k} ${value}`;
    }).join(' · ');
  } catch {
    // Cut short when it was saved: shown as it is.
    return detail;
  }
}

/** Main admin only: what every admin did, newest first. Folded away until opened, and the main admin can clear it. */
export function AdminLog() {
  const act = useAct();
  const [rows, setRows] = useState<{ id: number; who: string; action: string; detail: string; at: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const load = useCallback(() => void api<typeof rows>('/admin/log').then(setRows).catch(() => {}), []);
  useEffect(() => load(), [load]);
  const clear = async () => {
    if (!(await ask({ title: `Clear the admin log (${rows.length} lines)?`, description: 'This cannot be undone. One line stays, saying you cleared it.', confirm: 'Clear', destructive: true }))) return;
    await act(() => api('/admin/log', { method: 'DELETE' }), 'Admin log cleared');
    load();
  };
  const shown = all ? rows : rows.slice(0, 15);
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <CardTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" /> Admin log</CardTitle>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{rows.length}</span>
          <ChevronDown className={cn('ml-auto h-5 w-5 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
        {rows.length > 0 && (
          <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => void clear()} aria-label="Clear the admin log" title="Clear the admin log">
            <Eraser className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      {open && <CardContent className="divide-y text-sm">
        {rows.length === 0 && <p className="text-muted-foreground">Nothing yet.</p>}
        {shown.map((r) => (
          <div key={r.id} className="py-2"><b>{r.who}</b> · {r.action}{r.detail && <span className="break-words text-muted-foreground"> — {readable(r.detail)}</span>}<span className="block text-xs text-muted-foreground">{new Date(r.at).toLocaleString()}</span></div>
        ))}
        {!all && rows.length > shown.length && (
          <button type="button" onClick={() => setAll(true)} className="w-full pt-3 text-center text-sm font-semibold text-primary">Show all {rows.length}</button>
        )}
      </CardContent>}
    </Card>
  );
}

type VerificationRow = { id: string; type: 'id' | 'passport' | 'business'; legalName: string; businessName: string | null; status: 'pending_payment' | 'in_review'; amount: number; reference: string; docLast4: string; country: string; email: string; account: string; files: string[] };
const FILE_LABEL: Record<string, string> = { front: 'Document', back: 'Back', selfie: 'Holding the document', certificate: 'Registration certificate' };

/** Verification requests: confirm the payment (Mobile Money), look at the documents, approve or refuse. */
export function VerificationsAdmin() {
  const act = useAct();
  const [rows, setRows] = useState<VerificationRow[]>([]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [renewals, setRenewals] = useState<{ id: string; reference: string; amount: number; account: string; email: string }[]>([]);
  const load = useCallback(() => {
    api<VerificationRow[]>('/admin/verifications').then(setRows).catch(() => {});
    api<typeof renewals>('/admin/verification-renewals').then(setRenewals).catch(() => {});
  }, []);
  useEffect(() => void load(), [load]);
  // Documents need the admin's session, so they are fetched and shown from memory (never a public link).
  const show = async (id: string, file: string) => {
    const token = getToken();
    const r = await fetch(apiUrl(`/admin/verifications/${id}/file/${file}`), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob());
    setImages((x) => ({ ...x, [`${id}/${file}`]: url }));
  };
  const decide = (id: string, decision: 'confirm_payment' | 'approve' | 'reject') =>
    act(() => api(`/admin/verifications/${id}`, { body: { decision, note: notes[id] } }), decision === 'approve' ? 'Verified' : decision === 'reject' ? 'Refused' : 'Payment confirmed').then(load);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-sky-500" /> Verification requests {rows.length + renewals.length > 0 && <Badge>{rows.length + renewals.length}</Badge>}</CardTitle>
        <CardDescription>Check that the name, number and face match. Documents are deleted from the server as soon as you decide.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && renewals.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting.</p>}
        {renewals.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-3 text-sm">
            <span className="min-w-0 flex-1 break-words">Monthly renewal · <b>{r.account}</b> ({r.email}) · ${r.amount.toFixed(2)} · ref <b className="select-all">{r.reference}</b></span>
            <Button size="sm" variant="outline" onClick={() => act(() => api(`/admin/verification-renewals/${r.id}`, { body: { decision: 'confirm' } }), '30 days added').then(load)}>Payment received</Button>
            <Button size="sm" variant="ghost" onClick={() => act(() => api(`/admin/verification-renewals/${r.id}`, { body: { decision: 'cancel' } }), 'Cancelled').then(load)}>Cancel</Button>
          </div>
        ))}
        {rows.map((v) => (
          <div key={v.id} className="space-y-2 rounded-xl border p-3 text-sm">
            <p className="break-words font-semibold">{v.type === 'business' ? `${v.businessName} · owner ${v.legalName}` : v.legalName} <span className="font-normal text-muted-foreground">· {v.type === 'id' ? 'ID card' : v.type} …{v.docLast4} · {v.country} · account {v.account} ({v.email})</span></p>
            {v.status === 'pending_payment' ? (
              <div className="flex flex-wrap items-center gap-2">
                <span>Waiting for {v.amount ? `$${v.amount.toFixed(2)}` : 'payment'} · ref <b className="select-all">{v.reference}</b></span>
                <Button size="sm" variant="outline" onClick={() => decide(v.id, 'confirm_payment')}>Payment received</Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {v.files.map((f) => images[`${v.id}/${f}`] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <a key={f} href={images[`${v.id}/${f}`]} target="_blank" rel="noreferrer"><img src={images[`${v.id}/${f}`]} alt={FILE_LABEL[f] ?? f} className="h-28 max-w-full rounded-lg border object-cover" /></a>
                  ) : <Button key={f} size="sm" variant="outline" onClick={() => show(v.id, f)}>Show: {FILE_LABEL[f] ?? f}</Button>)}
                </div>
                <Input placeholder="Note to them (required to refuse)" value={notes[v.id] ?? ''} onChange={(e) => setNotes({ ...notes, [v.id]: e.target.value })} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => decide(v.id, 'approve')}>Approve ✓</Button>
                  <Button size="sm" variant="outline" disabled={!notes[v.id]?.trim()} onClick={() => decide(v.id, 'reject')}>Refuse</Button>
                </div>
              </>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
