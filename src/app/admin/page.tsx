'use client';

import { TipsAdmin } from '@/components/admin/tips-admin';

import { AppealsAdmin } from '@/components/admin/appeals-admin';

import { MonetizationAdmin } from '@/components/admin/monetization-admin';
import { AccountsAdmin, AdminLog, AdminsAdmin, FeaturesAdmin, PoliciesAdmin, RulesAdmin, VerificationsAdmin } from '@/components/admin/control-admin';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, CircleDashed, Copy, Cpu, CreditCard, Download, Eye, KeyRound, Loader2, Mail, Radio, Shirt, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/auth-provider';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { useToast } from '@/hooks/use-toast';
import { api, getToken } from '@/lib/api';
import { friendlyError } from '@/lib/errors';

type Platform = {
  site: string;
  mail: { connected: boolean; from: string; outbox: number; fromEnv: boolean };
  payments: { enabled: boolean; currency: string; rate: number; key: string | null; webhook: string; fromEnv: boolean };
  tryon: { unlimited: boolean; key: string | null; fromEnv: boolean };
  hf?: { key: string | null; fromEnv: boolean };
  aiServer: { url: string; ok: boolean; reason?: string; gpu?: string | null; memoryGb?: number | null; ready?: boolean; busy?: boolean; fromEnv: boolean } | null;
  live: { enabled: boolean };
  stats: { users: number; sellers: number; products: number; orders: number };
};

function Status({ on, label }: { on: boolean; label: [string, string] }) {
  return on ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> {label[0]}</span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-600"><CircleDashed className="h-3.5 w-3.5" /> {label[1]}</span>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ol>
  );
}

/** Platform settings (admins with the Platform right): connect email, online payments and the AI. */
function PlatformSettings() {
  const { toast } = useToast();
  const { user, isAuthLoading } = useAuth();
  const admin = useUserRoleStore((s) => s.admin);
  const [data, setData] = useState<Platform | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mail, setMail] = useState({ email: '', password: '', host: '', name: 'Saligue by INDECIANA' });
  const [testTo, setTestTo] = useState('');
  const [pay, setPay] = useState({ secretKey: '', secretHash: '', currency: 'RWF', rate: '1450' });
  const [falKey, setFalKey] = useState('');
  const [hfToken, setHfToken] = useState('');
  const [aiServer, setAiServer] = useState({ url: '', key: '' });
  const [signing, setSigning] = useState<{ available: boolean; alias?: string } | null>(null);
  const [signingPassword, setSigningPassword] = useState<string | null>(null);
  const [keySaved, setKeySaved] = useState(false);

  const load = useCallback(() => api<Platform>('/admin/platform').then(setData).catch(() => setData(null)), []);
  useEffect(() => {
    if (!admin) return;
    void load();
    api<{ available: boolean; alias?: string }>('/admin/signing-key').then(setSigning).catch(() => setSigning(null));
  }, [admin, load]);

  // The file needs the admin's session, so it is fetched and then saved from the page.
  const downloadKey = async () => {
    setBusy('key');
    try {
      const token = getToken();
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/admin/signing-key/file`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error('The key file could not be downloaded.');
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'saligue-android-signing-key.p12';
      a.click();
      URL.revokeObjectURL(url);
      setKeySaved(true);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not downloaded', description: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    if (user?.email) setTestTo((t) => t || user.email!);
  }, [user]);

  const act = async (name: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(name);
    try {
      await fn();
      toast({ title: done });
      await load();
      return true;
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not saved', description: friendlyError(error) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (isAuthLoading || !data) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground">Connect the services Saligue needs. Keys are kept on your server and never shown again.</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[['Accounts', data.stats.users], ['Sellers', data.stats.sellers], ['Items on sale', data.stats.products], ['Orders', data.stats.orders]].map(([k, v]) => (
            <div key={k as string} className="rounded-xl border bg-card p-3"><p className="text-2xl font-bold">{v}</p><p className="text-xs text-muted-foreground">{k}</p></div>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-primary" /> Email</CardTitle>
            <Status on={data.mail.connected} label={['Sending emails', 'Not connected']} />
          </div>
          <CardDescription>
            Welcome, order, message and password-reset emails.{' '}
            {data.mail.connected ? <>Sending as <b className="text-foreground">{data.mail.from}</b>.</> : <>Until connected, {data.mail.outbox} emails were kept on the server instead of sent.</>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Steps items={[
            <>Use a Gmail account for Saligue (or your business email).</>,
            <>In Google Account → Security, turn on <b>2-Step Verification</b>.</>,
            <>Open <b>App passwords</b>, create one named “Saligue”, and copy the 16 letters.</>,
            <>Paste the email and the app password below. Saligue logs in to check before saving.</>,
          ]} />
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
            e.preventDefault();
            void act('mail', () => api('/admin/platform/mail', { method: 'PUT', body: mail }), 'Email connected').then((ok) => ok && setMail((m) => ({ ...m, password: '' })));
          }}>
            <div className="space-y-1.5"><Label htmlFor="mail-email">Email address</Label><Input id="mail-email" type="email" required value={mail.email} onChange={(e) => setMail({ ...mail, email: e.target.value })} placeholder="saligue.shop@gmail.com" /></div>
            <div className="space-y-1.5"><Label htmlFor="mail-pass">App password</Label><Input id="mail-pass" type="password" required value={mail.password} onChange={(e) => setMail({ ...mail, password: e.target.value })} placeholder="abcd efgh ijkl mnop" autoComplete="new-password" /></div>
            <div className="space-y-1.5"><Label htmlFor="mail-name">Sender name</Label><Input id="mail-name" value={mail.name} onChange={(e) => setMail({ ...mail, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="mail-host">Mail server <span className="font-normal text-muted-foreground">(only if not Gmail/Outlook/Yahoo)</span></Label><Input id="mail-host" value={mail.host} onChange={(e) => setMail({ ...mail, host: e.target.value })} placeholder="smtp.yourdomain.com" /></div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy === 'mail'}>{busy === 'mail' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Check and connect</Button>
              {data.mail.connected && !data.mail.fromEnv && <Button type="button" variant="ghost" onClick={() => act('mail-off', () => api('/admin/platform/mail', { method: 'PUT', body: { off: true } }), 'Email disconnected')}>Disconnect</Button>}
            </div>
          </form>
          {data.mail.connected && (
            <form className="flex flex-wrap items-end gap-2 border-t pt-4" onSubmit={(e) => {
              e.preventDefault();
              void act('test', () => api('/admin/platform/test-email', { body: { to: testTo } }), `Test email sent to ${testTo}`);
            }}>
              <div className="min-w-0 flex-1 space-y-1.5"><Label htmlFor="test-to">Send a test email to</Label><Input id="test-to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} /></div>
              <Button type="submit" variant="outline" disabled={busy === 'test'}>{busy === 'test' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send test</Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-primary" /> Online payments</CardTitle>
            <Status on={data.payments.enabled} label={[`On · ${data.payments.currency}`, 'Off']} />
          </div>
          <CardDescription>Card and MTN / Airtel Mobile Money through Flutterwave. Until it is on, shoppers pay the shop by Mobile Money, on delivery or at pickup.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Steps items={[
            <>Create a business account at <b>flutterwave.com</b> and finish the verification for Rwanda.</>,
            <>Settings → API keys: copy the <b>Secret key</b> (starts with FLWSECK).</>,
            <>Settings → Webhooks: URL <code className="break-all rounded bg-muted px-1 text-foreground">{data.payments.webhook}</code>, and type a secret hash of your choice.</>,
            <>Paste both below with the exchange rate (prices on Saligue are in dollars).</>,
          ]} />
          {data.payments.key && <p className="text-sm">Saved key: <b>{data.payments.key}</b> · 1 USD = {data.payments.rate} {data.payments.currency}</p>}
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
            e.preventDefault();
            void act('pay', () => api('/admin/platform/payments', { method: 'PUT', body: { ...pay, rate: Number(pay.rate) } }), 'Online payments are on').then((ok) => ok && setPay((p) => ({ ...p, secretKey: '', secretHash: '' })));
          }}>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="flw-key">Secret key</Label><Input id="flw-key" type="password" required value={pay.secretKey} onChange={(e) => setPay({ ...pay, secretKey: e.target.value })} placeholder="FLWSECK-…" autoComplete="off" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="flw-hash">Webhook secret hash</Label><Input id="flw-hash" type="password" required minLength={8} value={pay.secretHash} onChange={(e) => setPay({ ...pay, secretHash: e.target.value })} autoComplete="off" /></div>
            <div className="space-y-1.5">
              <Label>Charge in</Label>
              <Select value={pay.currency} onValueChange={(v) => setPay({ ...pay, currency: v, rate: v === 'USD' ? '1' : pay.rate })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{['RWF', 'USD', 'KES', 'UGX', 'TZS'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="flw-rate">1 USD = how many {pay.currency}</Label><Input id="flw-rate" type="number" min="0.01" step="0.01" disabled={pay.currency === 'USD'} value={pay.rate} onChange={(e) => setPay({ ...pay, rate: e.target.value })} /></div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy === 'pay'}>{busy === 'pay' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Check and turn on</Button>
              {data.payments.enabled && !data.payments.fromEnv && <Button type="button" variant="ghost" onClick={() => act('pay-off', () => api('/admin/platform/payments', { method: 'PUT', body: { off: true } }), 'Online payments are off')}>Turn off</Button>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-primary/40">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2"><Cpu className="h-5 w-5 text-primary" /> Own AI server</CardTitle>
            <Status on={!!data.aiServer?.ok} label={[data.aiServer?.ready === false ? 'Connected · loading' : 'Connected', data.aiServer ? 'Not answering' : 'Not set up']} />
          </div>
          <CardDescription>
            Saligue’s own try-on AI (Leffa) on your own GPU server: no daily limit and no outside company. When it is connected, every try-on uses it first.
            {data.aiServer?.ok && data.aiServer.gpu && <> Running on <b className="text-foreground">{data.aiServer.gpu}</b>{data.aiServer.memoryGb ? ` (${data.aiServer.memoryGb} GB)` : ''}.</>}
            {data.aiServer && !data.aiServer.ok && <> <span className="text-destructive">{data.aiServer.reason}</span></>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Steps items={[
            <>Order a <b>GPU server</b> at Hetzner (Dedicated → GPU, e.g. GEX44) with Ubuntu 24.04.</>,
            <>On it, copy the <b>ai-server</b> folder from this project and run <code className="rounded bg-muted px-1 text-foreground">bash install.sh</code> (about 30 minutes).</>,
            <>Paste the address and secret key it prints below.</>,
          ]} />
          {data.aiServer && <p className="text-sm">Address: <b className="break-all">{data.aiServer.url}</b></p>}
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
            e.preventDefault();
            void act('ai', () => api('/admin/platform/aiserver', { method: 'PUT', body: aiServer }), 'Own AI server connected').then((ok) => ok && setAiServer({ url: '', key: '' }));
          }}>
            <div className="space-y-1.5"><Label htmlFor="ai-url">Address</Label><Input id="ai-url" required value={aiServer.url} onChange={(e) => setAiServer({ ...aiServer, url: e.target.value })} placeholder="https://1-2-3-4.sslip.io" /></div>
            <div className="space-y-1.5"><Label htmlFor="ai-key">Secret key</Label><Input id="ai-key" type="password" required value={aiServer.key} onChange={(e) => setAiServer({ ...aiServer, key: e.target.value })} autoComplete="off" /></div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy === 'ai'}>{busy === 'ai' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Check and connect</Button>
              {data.aiServer && !data.aiServer.fromEnv && <Button type="button" variant="ghost" onClick={() => act('ai-off', () => api('/admin/platform/aiserver', { method: 'PUT', body: { off: true } }), 'Own AI server disconnected')}>Disconnect</Button>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2"><Shirt className="h-5 w-5 text-primary" /> Unlimited try-on</CardTitle>
            <Status on={data.tryon.unlimited} label={['Unlimited', 'Free AI · daily limit']} />
          </div>
          <CardDescription>FASHN on fal.ai: no daily limit, allowed for selling, paid per picture. Looks already made are reused, so the same photo and item are never paid twice.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Steps items={[
            <>Sign up at <b>fal.ai</b> and add credit (Billing).</>,
            <>Dashboard → <b>Keys</b> → create a key and copy it.</>,
            <>Paste it below. Every search result in the Fitting Room is then dressed automatically.</>,
          ]} />
          {data.tryon.key && <p className="text-sm">Saved key: <b>{data.tryon.key}</b></p>}
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
            e.preventDefault();
            void act('fal', () => api('/admin/platform/tryon', { method: 'PUT', body: { falKey } }), 'Unlimited try-on is on').then((ok) => ok && setFalKey(''));
          }}>
            <div className="min-w-0 flex-1 space-y-1.5"><Label htmlFor="fal-key">fal.ai key</Label><Input id="fal-key" type="password" required value={falKey} onChange={(e) => setFalKey(e.target.value)} autoComplete="off" /></div>
            <Button type="submit" disabled={busy === 'fal'}>{busy === 'fal' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Turn on</Button>
            {data.tryon.unlimited && !data.tryon.fromEnv && <Button type="button" variant="ghost" onClick={() => act('fal-off', () => api('/admin/platform/tryon', { method: 'PUT', body: { off: true } }), 'Back to the free try-on')}>Turn off</Button>}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2"><Shirt className="h-5 w-5 text-primary" /> More free try-ons (Hugging Face)</CardTitle>
            <Status on={!!data.hf?.key} label={['Token added', 'Anonymous · small daily limit']} />
          </div>
          <CardDescription>Until Saligue’s own AI server is running, try-on uses free AI models with a daily limit shared by everyone. A Hugging Face token raises it; a PRO account (about $9/month) raises it much more.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Steps items={[
            <>Create a free account at <b>huggingface.co</b> (PRO for a much bigger allowance).</>,
            <>Settings → <b>Access Tokens</b> → New token → type <b>Read</b> → copy it (starts with hf_).</>,
            <>Paste it below.</>,
          ]} />
          {data.hf?.key && <p className="text-sm">Saved token: <b>{data.hf.key}</b></p>}
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
            e.preventDefault();
            void act('hf', () => api('/admin/platform/hftoken', { method: 'PUT', body: { token: hfToken } }), 'Token saved: try-on has a bigger daily allowance').then((ok) => ok && setHfToken(''));
          }}>
            <div className="min-w-0 flex-1 space-y-1.5"><Label htmlFor="hf-token">Hugging Face token</Label><Input id="hf-token" type="password" required value={hfToken} onChange={(e) => setHfToken(e.target.value)} autoComplete="off" placeholder="hf_…" /></div>
            <Button type="submit" disabled={busy === 'hf'}>{busy === 'hf' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save</Button>
            {data.hf?.key && !data.hf.fromEnv && <Button type="button" variant="ghost" onClick={() => act('hf-off', () => api('/admin/platform/hftoken', { method: 'PUT', body: { off: true } }), 'Token removed')}>Remove</Button>}
          </form>
        </CardContent>
      </Card>

      {signing?.available && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Back up the app signing key</CardTitle>
            <CardDescription>
              Every update of the Android app must be signed with this key, or phones refuse to install it. If the server is ever lost, this
              copy is the only way to keep updating the app. Keep the file and the password in two different safe places (for example the file
              in Google Drive and the password in a password manager), never in the public code on GitHub.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={downloadKey} disabled={busy === 'key'}>{busy === 'key' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />} Download key file</Button>
              <Button variant="outline" onClick={() => api<{ password: string }>('/admin/signing-key/password', { body: {} }).then((d) => setSigningPassword(d.password)).catch((e) => toast({ variant: 'destructive', title: 'Not shown', description: friendlyError(e) }))}>
                <Eye className="mr-2 h-4 w-4" /> Show password
              </Button>
            </div>
            {keySaved && <p className="text-sm text-emerald-600">Key file downloaded: saligue-android-signing-key.p12. Move it from Downloads to a safe place.</p>}
            {signingPassword && (
              <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Password (key alias: <b>{signing.alias}</b>)</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 select-all break-all rounded bg-background px-2 py-1.5 text-sm">{signingPassword}</code>
                  <Button size="icon" variant="outline" aria-label="Copy password" onClick={() => navigator.clipboard.writeText(signingPassword).then(() => toast({ title: 'Password copied' })).catch(() => {})}><Copy className="h-4 w-4" /></Button>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setSigningPassword(null)}>Hide</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2"><Radio className="h-5 w-5 text-primary" /> Live and app</CardTitle>
            <Status on={data.live.enabled} label={['Live is on', 'Live is off']} />
          </div>
          <CardDescription>Live video runs on your own server. The Android app is ready to install.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><Link href="/live">Open Live</Link></Button>
          <Button variant="outline" asChild><a href="/download/saligue.apk">Download the Android app</a></Button>
        </CardContent>
      </Card>
    </div>
  );
}

type AdminInfo = { level: number; perms: string[]; allPerms: Record<string, string>; features: Record<string, string> };

/** The admin dashboard: each tab needs a right; the main admin (type 1) has them all and manages sub-admins. */
export default function AdminPage() {
  const { isAuthLoading } = useAuth();
  const admin = useUserRoleStore((s) => s.admin);
  const [me, setMe] = useState<AdminInfo | null>(null);
  useEffect(() => {
    if (admin) api<AdminInfo>('/admin/me').then(setMe).catch(() => setMe(null));
  }, [admin]);
  if (isAuthLoading || (admin && !me)) return <Skeleton className="mx-auto mt-10 h-96 max-w-3xl" />;
  if (!admin || !me) {
    return (
      <div className="mx-auto max-w-md p-10 text-center text-muted-foreground">
        <SlidersHorizontal className="mx-auto mb-3 h-10 w-10" />
        This page is for Saligue admins. <Link href="/me" className="text-primary underline">Back</Link>
      </div>
    );
  }
  const has = (perm: string) => me.perms.includes(perm);
  const tabs = [
    { value: 'features', label: 'Features', show: has('features'), body: <FeaturesAdmin features={me.features} /> },
    { value: 'rules', label: 'Rules & policies', show: has('policies'), body: <div className="space-y-6"><RulesAdmin /><PoliciesAdmin /></div> },
    { value: 'moderation', label: 'Moderation', show: has('moderation'), body: <AppealsAdmin /> },
    { value: 'money', label: 'Money & ads', show: has('money') || has('ads'), body: <div className="space-y-6">{has('money') && <TipsAdmin />}<MonetizationAdmin /></div> },
    { value: 'accounts', label: 'Accounts', show: has('users'), body: <div className="space-y-6"><VerificationsAdmin /><AccountsAdmin /></div> },
    { value: 'admins', label: 'Admins', show: me.level === 1, body: <div className="space-y-6"><AdminsAdmin allPerms={me.allPerms} /><AdminLog /></div> },
    { value: 'platform', label: 'Platform', show: has('platform'), body: <PlatformSettings /> },
  ].filter((t) => t.show);
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Saligue admin · {me.level === 1 ? 'Main admin' : 'Sub-admin'}</p>
        <h1 className="text-3xl font-extrabold tracking-tight">Admin dashboard</h1>
      </div>
      <Tabs defaultValue={tabs[0]?.value}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          {tabs.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
        </TabsList>
        {tabs.map((t) => <TabsContent key={t.value} value={t.value} className="mt-5">{t.body}</TabsContent>)}
      </Tabs>
    </div>
  );
}
