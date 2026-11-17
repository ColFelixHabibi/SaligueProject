'use client';

import { useState } from 'react';
import { Ban, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';

export type SuspendedProof = { email: string; password: string } | { credential: string };

/**
 * Shown on the sign-in screen to a suspended person: why, until when (or that Saligue is reviewing it), and a box to
 * ask for a review — once per suspension, proven with the same password or Google account they just used.
 */
export function SuspendedPanel({ message, proof, onBack }: { message: string; proof: SuspendedProof; onBack: () => void }) {
  const t = useT();
  const received = /request for a review was received/i.test(message);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(received);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/suspension-appeal', { body: { ...proof, text } });
      setSent(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <Ban className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <p>{message.replace(/ ?(You can ask for a review below\.|Your request for a review was received\.)$/, '')}</p>
      </div>
      {sent ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-600"><CheckCircle2 className="h-5 w-5" /> {t('Your request for a review was received. Saligue will answer by email.')}</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold">{t('Ask for a review')}</p>
          <Textarea rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Why should your account be restored?')} />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button className="w-full" disabled={busy || text.trim().length < 10} onClick={send}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {t('Send')}
          </Button>
        </div>
      )}
      <Button variant="ghost" className="w-full" onClick={onBack}>{t('Back')}</Button>
    </div>
  );
}
