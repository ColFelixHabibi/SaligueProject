'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/push';

/** "Notifications on this device": replies, orders, lives, even when Saligue is closed. Quiet at night. */
export function PushCard() {
  const t = useT();
  const { toast } = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushState().then(setState).catch(() => setState('unsupported'));
  }, []);
  if (!state || state === 'unsupported') return null;
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      const next = on ? await enablePush() : await disablePush();
      setState(next);
      if (next === 'on') toast({ title: t('Notifications on'), description: t('Quiet from 22:00 to 07:00, except orders.') });
    } catch {
      toast({ variant: 'destructive', title: t('Not done'), description: t('This device could not be registered.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">{state === 'blocked' ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t('Notifications on this device')}</p>
        <p className="text-xs text-muted-foreground">{state === 'blocked' ? t('Blocked: allow notifications for Saligue in your browser or phone settings.') : t('Replies, orders and lives, even when Saligue is closed.')}</p>
      </div>
      {busy ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : state !== 'blocked' && <Switch checked={state === 'on'} onCheckedChange={toggle} aria-label={t('Notifications on this device')} />}
    </div>
  );
}
