'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, LogOut, MapPin, ShieldAlert, ShieldQuestion, Smartphone } from 'lucide-react';
import { ask } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type SignIn = { id: number; at: string; place: string | null; device: string; method: string; outcome: string; verdict: 'you' | 'new_place' | 'suspicious' | 'attacker'; reason: string };

// How each verdict (server/signins.mjs) is shown: the owner's own sign-ins calm, someone else's in red.
const VERDICT = {
  you: { label: 'You', icon: CheckCircle2, tone: 'text-emerald-600' },
  new_place: { label: 'New place', icon: ShieldQuestion, tone: 'text-amber-600' },
  suspicious: { label: 'Not recognised', icon: ShieldQuestion, tone: 'text-amber-600' },
  attacker: { label: 'Blocked attempt', icon: ShieldAlert, tone: 'text-destructive' },
} as const;
const OUTCOME: Record<string, string> = { ok: 'Signed in', wrong_password: 'Wrong password', wrong_code: 'Wrong sign-in code', locked: 'Locked after many tries', suspended: 'Refused (suspended)', no_account: 'Wrong email' };

/** Settings: where this account was signed in from, and every try that failed — so a stranger stands out. */
export function SignInActivity() {
  const t = useT();
  const { toast } = useToast();
  const [rows, setRows] = useState<SignIn[] | null>(null);
  const load = useCallback(() => void api<SignIn[]>('/me/sign-ins').then(setRows).catch(() => setRows([])), []);
  useEffect(() => load(), [load]);
  const strangers = rows?.filter((r) => r.verdict === 'suspicious' || r.verdict === 'attacker').length ?? 0;
  const signOutOthers = async () => {
    if (!(await ask({ title: t('Sign out everywhere else?'), description: t('Every other phone and computer is signed out. This one stays signed in.'), confirm: t('Sign out') }))) return;
    try {
      await api('/me/sign-out-others', { method: 'POST' });
      toast({ title: t('Signed out everywhere else') });
    } catch (error) {
      toast({ variant: 'destructive', title: t('Not done'), description: friendlyError(error) });
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5 text-primary" /> {t('Sign-in activity')}</CardTitle>
        <CardDescription>
          {strangers
            ? t('Someone else tried to sign in. They did not get in — choose a strong password you use nowhere else.')
            : t('Where your account was signed in from. Anything you do not recognise is marked.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows?.length === 0 && <p className="text-sm text-muted-foreground">{t('No sign-ins recorded yet.')}</p>}
        {rows?.slice(0, 15).map((r) => {
          const v = VERDICT[r.verdict] ?? VERDICT.suspicious;
          return (
            <div key={r.id} className={cn('flex items-start gap-3 rounded-xl border p-2.5 text-sm', (r.verdict === 'attacker' || r.verdict === 'suspicious') && 'border-destructive/30 bg-destructive/5')}>
              <v.icon className={cn('mt-0.5 h-5 w-5 shrink-0', v.tone)} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{r.place ?? t('Unknown place')} <span className={cn('ml-1 text-xs', v.tone)}>{t(v.label)}</span></p>
                <p className="flex items-center gap-1 truncate text-xs text-muted-foreground"><Smartphone className="h-3.5 w-3.5 shrink-0" /> {r.device}{r.method === 'google' ? ' · Google' : ''}</p>
                <p className="text-xs text-muted-foreground">{t(OUTCOME[r.outcome] ?? r.outcome)} · {new Date(r.at).toLocaleString()}</p>
              </div>
            </div>
          );
        })}
        <Button variant="outline" className="w-full" onClick={signOutOthers}><LogOut className="mr-2 h-4 w-4" /> {t('Sign out everywhere else')}</Button>
      </CardContent>
    </Card>
  );
}
