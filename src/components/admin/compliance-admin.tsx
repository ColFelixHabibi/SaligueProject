'use client';

import { useCallback, useEffect, useState } from 'react';
import { Landmark, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/orders';

type Controller = {
  name: string;
  country: string;
  address: string;
  registrationNumber: string | null;
  registeredAt: string | null;
  dpoName: string;
  dpoEmail: string;
  dpoPhone: string;
  lastReview: string | null;
  registered: boolean;
};
type Rules = { mode: 'partner' | 'self' | 'off'; partner: string; licence: string; monthlyCap: number; requireIdentity: boolean };
type State = { open: boolean; mode: string; payer: string | null; message: string | null; monthlyCap: number };
type Data = { controller: Controller; payouts: Rules; state: State; dpia: { version: number; reviewedAt: string | null; risks: unknown[] }; processing: unknown[] };

/**
 * Admin → Rules & policies → Data protection and payouts.
 *
 * Two questions that are normally left to a lawyer's folder, answered where an admin can see and change them:
 * who is the data controller and is it registered, and who physically moves a user's money. Payouts stay
 * stopped until the second question is answered (server/compliance.mjs), because an unconfigured deployment
 * is an unlicensed one.
 */
export function ComplianceAdmin() {
  const { toast } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [who, setWho] = useState<Controller | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    () =>
      api<Data>('/admin/compliance')
        .then((next) => {
          setData(next);
          setWho(next.controller);
          setRules(next.payouts);
        })
        .catch(() => {}),
    [],
  );
  useEffect(() => void load(), [load]);

  const save = async (body: object, done: string) => {
    setSaving(true);
    try {
      await api('/admin/compliance', { method: 'PUT', body });
      toast({ title: done });
      void load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not saved', description: friendlyError(error) });
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof Controller>(key: K, value: Controller[K]) => setWho((w) => (w ? { ...w, [key]: value } : w));
  const rule = <K extends keyof Rules>(key: K, value: Rules[K]) => setRules((r) => (r ? { ...r, [key]: value } : r));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Data protection
            {who && !who.registered && <Badge variant="destructive">not registered yet</Badge>}
          </CardTitle>
          <CardDescription>
            The controller named on every policy page, and the registration number once the data protection authority has
            issued it. The record of processing and the try-on assessment published on <b>/data-protection</b> are generated
            from the server, so what a regulator reads always matches what the code does.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!who ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="controller-name">Controller</Label>
                  <Input id="controller-name" value={who.name} onChange={(e) => set('name', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="controller-country">Country</Label>
                  <Input id="controller-country" value={who.country} onChange={(e) => set('country', e.target.value)} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="controller-address">Address</Label>
                  <Input id="controller-address" value={who.address} onChange={(e) => set('address', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="controller-registration">Registration number</Label>
                  <Input
                    id="controller-registration"
                    value={who.registrationNumber ?? ''}
                    placeholder="Issued by the authority"
                    onChange={(e) => set('registrationNumber', e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave empty until it is issued: the public page then says registration is in progress instead of claiming a number.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="controller-registered">Registered on</Label>
                  <Input id="controller-registered" type="date" value={who.registeredAt ?? ''} onChange={(e) => set('registeredAt', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="controller-dpo">Data protection contact (name)</Label>
                  <Input id="controller-dpo" value={who.dpoName} onChange={(e) => set('dpoName', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="controller-email">Contact email</Label>
                  <Input id="controller-email" type="email" value={who.dpoEmail} onChange={(e) => set('dpoEmail', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="controller-phone">Contact phone</Label>
                  <Input id="controller-phone" value={who.dpoPhone} onChange={(e) => set('dpoPhone', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="controller-review">Last assessment review</Label>
                  <Input id="controller-review" type="date" value={who.lastReview ?? ''} onChange={(e) => set('lastReview', e.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={saving} onClick={() => save({ controller: who }, 'Data protection details saved')}>
                  Save details
                </Button>
                <span className="text-xs text-muted-foreground">
                  Assessment {data?.dpia.version ?? 1}
                  {data?.dpia.risks.length ? ` · ${data.dpia.risks.length} risks assessed` : ''}
                  {data?.dpia.reviewedAt ? ` · reviewed ${data.dpia.reviewedAt}` : ' · review date not set'} ·{' '}
                  {data?.processing.length ?? 0} processing activities
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5 text-primary" /> Who moves users&apos; money
            {data && !data.state.open && <Badge variant="destructive">payouts stopped</Badge>}
          </CardTitle>
          <CardDescription>
            Holding a buyer&apos;s money until delivery is settling the shop&apos;s own sale. Paying users from Saligue&apos;s own
            account — tips, share &amp; earn, creator earnings — is money transmission: it needs a licence, or a licensed
            partner doing the paying. Choose one here; every payout button checks it first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!rules ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="rounded-xl border p-3">
                {data?.state.open ? (
                  <p>
                    Payouts are <b>open</b>. The money is sent through <b>{data.state.payer}</b>
                    {data.state.mode === 'self' ? ' (Saligue&apos;s own account, licence recorded)' : ''}.
                  </p>
                ) : (
                  <p className="text-amber-900">
                    Payouts are <b>stopped</b>: {data?.state.message ?? 'no licensed payer is recorded yet.'} Earned money keeps
                    counting and keeps belonging to the person; nothing is lost, and nothing is sent.
                  </p>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="payout-mode">How users are paid</Label>
                  <Select value={rules.mode} onValueChange={(v) => rule('mode', v as Rules['mode'])}>
                    <SelectTrigger id="payout-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="partner">A licensed payment partner sends it</SelectItem>
                      <SelectItem value="self">Saligue&apos;s own account (licence needed)</SelectItem>
                      <SelectItem value="off">Pause all payouts</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="payout-cap">Monthly limit per person (0 = none)</Label>
                  <Input
                    id="payout-cap"
                    type="number"
                    min={0}
                    value={String(rules.monthlyCap)}
                    onChange={(e) => rule('monthlyCap', Number(e.target.value) || 0)}
                  />
                  {rules.monthlyCap > 0 && <p className="text-xs text-muted-foreground">{formatPrice(rules.monthlyCap)} a month, across all earnings.</p>}
                </div>
                {rules.mode === 'partner' && (
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="payout-partner">Licensed partner that sends the money</Label>
                    <Input
                      id="payout-partner"
                      value={rules.partner}
                      placeholder="e.g. the mobile-money aggregator or payment provider"
                      onChange={(e) => rule('partner', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Payouts stay stopped until this is filled in.</p>
                  </div>
                )}
                {rules.mode === 'self' && (
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="payout-licence">Licence or written authorisation reference</Label>
                    <Input id="payout-licence" value={rules.licence} onChange={(e) => rule('licence', e.target.value)} />
                    <p className="text-xs text-muted-foreground">Checkable: nothing is paid from Saligue&apos;s own account without it.</p>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 rounded-xl border p-3 sm:col-span-2">
                  <div>
                    <Label htmlFor="payout-identity">Only pay a checked identity</Label>
                    <p className="text-xs text-muted-foreground">
                      Refuses a payout until the person has finished Get verified. Off by default so existing earners are not
                      cut off; turn it on once verification is routine.
                    </p>
                  </div>
                  <Switch id="payout-identity" checked={rules.requireIdentity} onCheckedChange={(v) => rule('requireIdentity', v)} />
                </div>
              </div>
              <Button size="sm" disabled={saving} onClick={() => save({ payouts: rules }, 'Payout rules saved')}>
                Save payout rules
              </Button>
              <p className="text-xs text-muted-foreground">
                Every change is written to the admin log, and the public <b>/data-protection</b> page is updated at once.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
