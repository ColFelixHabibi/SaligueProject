'use client';

import { useState } from 'react';
import { completeTwoFactor, type TwoFactorChallenge } from '@/lib/auth-actions';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { CodeField } from './code-field';

/**
 * The second step of signing in: the 6-digit code emailed to the account's own address (never an authenticator app).
 * Nothing is signed in until the code is right, and the account can go back to the password form from here.
 */
export function TwoFactorCode({ challenge, onDone, onBack }: { challenge: TwoFactorChallenge; onDone: () => void; onBack: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      await completeTwoFactor(challenge, code);
      onDone();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <CodeField label={t('Sign-in code')} action={t('Sign in')} busy={busy} error={error} onSubmit={submit} onCancel={onBack} cancelLabel={t('Use a different account')}>
      <div className="rounded-xl border bg-muted/40 p-3 text-sm">
        <p className="font-semibold">{t('Enter the 6-digit code we emailed you.')}</p>
        <p className="mt-1 break-all text-muted-foreground">{challenge.email}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('The code works once and expires in 10 minutes. Check Spam if it has not arrived.')}</p>
      </div>
    </CodeField>
  );
}
