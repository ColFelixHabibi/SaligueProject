'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, BellRing, CalendarClock, Trash2 } from 'lucide-react';
import { SellerAvatar } from '@/components/seller-avatar';
import { useAuth } from '@/components/auth/auth-provider';
import { ask } from '@/components/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import { api, mediaUrl, onServerEvent } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { profileHref } from '@/components/profile-avatar';
import { cn } from '@/lib/utils';

export type Schedule = { id: string; title: string; startsAt: string; liveId: string | null; sellerId: string; sellerName: string; sellerAvatar: string | null; sellerVerified: boolean; reminders: number; reminded: boolean };

export function useSchedules(seller?: string) {
  const [list, setList] = useState<Schedule[] | null>(null);
  const load = useCallback(() => api<Schedule[]>(`/live-schedules${seller ? `?seller=${seller}` : ''}`)
    .then((l) => setList(l.map((x) => ({ ...x, sellerAvatar: mediaUrl(x.sellerAvatar ?? undefined) ?? null }))))
    .catch(() => setList([])), [seller]);
  useEffect(() => {
    void load();
    return onServerEvent('lives', () => void load());
  }, [load]);
  return { list, setList, reload: load };
}

const when = (iso: string) => {
  const d = new Date(iso);
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return days === 0 ? `Today ${time}` : days === 1 ? `Tomorrow ${time}` : `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
};

/** Lives shops have planned, with "Remind me" (15 minutes before, and when it starts). */
export function ComingUp({ seller, className }: { seller?: string; className?: string }) {
  const t = useT();
  const { toast } = useToast();
  const { user, authUid } = useAuth();
  const { list, setList, reload } = useSchedules(seller);
  if (!list?.length) return null;
  const remind = async (s: Schedule) => {
    if (!user) return toast({ title: t('Log in to get a reminder') });
    try {
      const next = await api<Schedule>(`/live-schedules/${s.id}/remind`, { body: {} });
      setList((l) => l?.map((x) => (x.id === s.id ? { ...x, reminded: next.reminded, reminders: next.reminders } : x)) ?? l);
      if (next.reminded) toast({ title: t('We’ll remind you'), description: t('15 minutes before, and when it starts.') });
    } catch (error) {
      toast({ variant: 'destructive', title: t('Not done'), description: friendlyError(error) });
    }
  };
  return (
    <section className={cn('space-y-2', className)}>
      <p className="flex items-center gap-2 font-bold"><CalendarClock className="h-5 w-5 text-primary" /> {t('Coming up')}</p>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {list.map((s) => (
          <div key={s.id} className="flex w-60 shrink-0 flex-col gap-2 rounded-2xl border bg-card p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-primary">{when(s.startsAt)}</p>
            <p className="line-clamp-2 font-semibold leading-tight">{s.title}</p>
            <Link href={profileHref(s.sellerId)} className="flex items-center gap-2 text-sm">
              <SellerAvatar src={s.sellerAvatar} name={s.sellerName} className="h-7 w-7" />
              <span className="truncate">{s.sellerName}</span>
            </Link>
            {s.sellerId === authUid ? (
              <button type="button" className="mt-auto flex items-center justify-center gap-1.5 rounded-full border py-1.5 text-xs font-semibold text-destructive"
                onClick={async () => { if (await ask({ title: t('Cancel this planned live?'), description: t('People who asked to be reminded are told.'), confirm: 'Remove', destructive: true })) { await api(`/live-schedules/${s.id}`, { method: 'DELETE' }).catch(() => {}); void reload(); } }}>
                <Trash2 className="h-3.5 w-3.5" /> {s.reminders} {t('waiting')}
              </button>
            ) : (
              <button type="button" onClick={() => remind(s)} aria-pressed={s.reminded}
                className={cn('mt-auto flex items-center justify-center gap-1.5 rounded-full py-1.5 text-sm font-semibold', s.reminded ? 'bg-primary/10 text-primary' : 'bg-primary text-primary-foreground')}>
                {s.reminded ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />} {s.reminded ? t('Reminder on') : t('Remind me')}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
