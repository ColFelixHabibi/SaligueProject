'use client';

import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n';

/**
 * One six-digit code box, shared by the two places that ask for a code: signing in, and turning two-step sign-in on
 * or off. `children` is the explanation above the box, which differs each time; the digits are always six, always
 * numeric, and the button stays disabled until there are six of them.
 */
export function CodeField({ label, action, busy, error, onSubmit, onCancel, cancelLabel, children }: {
  label: string;
  action: string;
  busy: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
  onCancel?: () => void;
  cancelLabel?: string;
  children?: React.ReactNode;
}) {
  const t = useT();
  const id = useId();
  const [code, setCode] = useState('');
  const ready = code.length === 6;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) onSubmit(code);
      }}
    >
      {children}
      <div className="space-y-2">
        <Label htmlFor={`${id}-code`} className="text-base font-medium">{label}</Label>
        <Input
          id={`${id}-code`}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="123456"
          autoFocus
          className="h-14 text-center text-2xl font-semibold tracking-[0.5em]"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" size="lg" className="w-full text-lg h-14" disabled={busy || !ready}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {action}
      </Button>
      {onCancel && <Button type="button" variant="ghost" className="w-full" onClick={onCancel}>{cancelLabel ?? t('Cancel')}</Button>}
    </form>
  );
}
