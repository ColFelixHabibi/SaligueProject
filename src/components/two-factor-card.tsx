'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { askTwoFactor, confirmTwoFactor, twoFactorStatus } from '@/lib/auth-actions';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { CodeField } from './auth/code-field';

type Status = { on: boolean; email: string | null; ready: boolean };

/**
 * Settings: two-step sign-in by a 6-digit code emailed to the account's own address — never an authenticator app, so
 * there is nothing to install. Turning it on and turning it off both need a code read from that inbox, so a password
 * alone can change neither, and it cannot be switched on by accident where email is not connected.
 */
export function TwoFactorCard({ userId }: { userId?: string }) {
  const t = useT();
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [ask, setAsk] = useState<{ ticket: string; email: string; on: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    twoFactorStatus().then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(() => load(), [load, userId]);

  const start = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const answer = await askTwoFactor(on);
      setAsk({ ticket: answer.ticket, email: answer.email, on });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (code: string) => {
    if (!ask) return;
    setBusy(true);
    setError(null);
    try {
      await confirmTwoFactor(ask.ticket, code, ask.on);
      setStatus({ on: ask.on, email: ask.email, ready: true });
      toast({ title: ask.on ? t('Two-step sign-in is on') : t('Two-step sign-in is off') });
      setAsk(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const on = status?.on ?? false;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> {t('Two-step sign-in')}</CardTitle>
        <CardDescription>
          {on
            ? t('On. A 6-digit code sent to your email is asked for when you sign in with your password.')
            : t('Off. Turn it on to also need a 6-digit code sent to your email when signing in.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {ask ? (
          <CodeField
            label={t('Code from the email')}
            action={ask.on ? t('Turn on') : t('Turn off')}
            busy={busy}
            error={error}
            onSubmit={finish}
            onCancel={() => { setAsk(null); setError(null); }}
          >
            <div className="rounded-xl border bg-muted/40 p-3 text-sm">
              <p className="font-semibold">{ask.on ? t('We emailed a code to turn two-step sign-in on.') : t('We emailed a code to turn two-step sign-in off.')}</p>
              <p className="mt-1 break-all text-muted-foreground">{ask.email}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('It works once and expires in 10 minutes.')}</p>
            </div>
          </CodeField>
        ) : (
          <>
            {status && !status.ready && (
              <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">{t('This site has no email account connected yet, so a code cannot be sent. An admin adds one in Platform settings → Email.')}</p>
            )}
            <Button className="w-full" variant={on ? 'outline' : 'default'} disabled={busy || (!on && status?.ready === false)} onClick={() => start(!on)}>
              <KeyRound className="mr-2 h-4 w-4" /> {on ? t('Turn off two-step sign-in') : t('Turn on two-step sign-in')}
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">{t('The code goes to your email, so there is no app to install. Your password alone stops being enough.')}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
