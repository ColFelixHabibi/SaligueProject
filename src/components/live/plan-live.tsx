'use client';

import { useState } from 'react';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';

/** Studio: announce a live ahead, so followers can tap "Remind me" (a regular audience, like a TV show). */
export function PlanLive({ onPlanned }: { onPlanned?: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  const min = new Date(Date.now() + 15 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return (
    <form className="space-y-3 rounded-2xl border p-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        await api('/live-schedules', { body: { title, startsAt: new Date(at).toISOString() } });
        toast({ title: t('Live planned'), description: t('Followers can tap Remind me. Go live at that time from here.') });
        setTitle('');
        setAt('');
        onPlanned?.();
      } catch (error) {
        toast({ variant: 'destructive', title: t('Not planned'), description: friendlyError(error) });
      } finally {
        setBusy(false);
      }
    }}>
      <p className="flex items-center gap-2 font-semibold"><CalendarPlus className="h-5 w-5 text-primary" /> {t('Plan a live')}</p>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder={t('e.g. New kitenge dresses')} />
      <div className="flex gap-2">
        <Input type="datetime-local" value={at} min={min} onChange={(e) => setAt(e.target.value)} className="flex-1" />
        <Button type="submit" disabled={busy || title.trim().length < 3 || !at}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {t('Announce')}</Button>
      </div>
    </form>
  );
}
