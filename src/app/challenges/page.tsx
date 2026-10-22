'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Trophy, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { LESSON_TOPICS, createChallenge, timeLeft, topicOf, useChallenges } from '@/lib/lessons';
import { cn } from '@/lib/utils';

/** Fashion challenges: a theme and a deadline; anyone joins with a short lesson video. */
export default function ChallengesPage() {
  const list = useChallenges();
  const canCreate = useUserRoleStore((s) => s.admin || s.official);
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 pb-24 md:p-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold"><Trophy className="h-7 w-7 text-amber-500" /> Challenges</h1>
        {canCreate && <Button className="rounded-full" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" /> New</Button>}
      </div>
      {list === null && <Skeleton className="h-40 rounded-2xl" />}
      {list?.length === 0 && <p className="py-10 text-center text-muted-foreground">No challenges right now. Come back soon!</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {list?.map((c) => {
          const Icon = topicOf(c.topic).icon;
          return (
            <Link key={c.id} href={`/challenge?id=${c.id}`} className={cn('overflow-hidden rounded-2xl border bg-card transition hover:shadow-lg', !c.open && 'opacity-70')}>
              <div className="grid h-32 grid-cols-3 gap-0.5 bg-gradient-to-br from-amber-300 to-primary">
                {c.posters.length ? c.posters.map((p, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  p ? <img key={i} src={p} alt="" className="h-full w-full object-cover" /> : <span key={i} />
                )) : <Trophy className="col-span-3 m-auto h-12 w-12 text-white/90" />}
              </div>
              <div className="space-y-1 p-4">
                <p className="text-lg font-bold">{c.title}</p>
                <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1"><Icon className="h-4 w-4" /> {topicOf(c.topic).label}</span>
                  <span className="flex items-center gap-1"><Users className="h-4 w-4" /> {c.entries}</span>
                  <span className={cn('font-semibold', c.open ? 'text-primary' : '')}>{timeLeft(c.endsAt)}</span>
                </p>
              </div>
            </Link>
          );
        })}
      </div>
      <NewChallenge open={open} onOpenChange={setOpen} />
    </div>
  );
}

function NewChallenge({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ title: '', description: '', topic: 'styling', days: 7 });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await createChallenge(form);
      toast({ title: 'Challenge started' });
      onOpenChange(false);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not started', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] max-w-md">
        <DialogHeader><DialogTitle>Start a challenge</DialogTitle></DialogHeader>
        <Input maxLength={80} placeholder="#KitengeWeek: one kitenge, three looks" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Textarea maxLength={600} rows={3} placeholder="Rules and what to show" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="grid grid-cols-3 gap-2">
          {LESSON_TOPICS.map((t) => (
            <button key={t.value} type="button" onClick={() => setForm({ ...form, topic: t.value })} className={cn('flex flex-col items-center gap-1 rounded-xl border p-2 text-xs font-semibold', form.topic === t.value && 'border-primary bg-primary/10 text-primary')}>
              <t.icon className="h-5 w-5" /> {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {[3, 7, 14, 30].map((d) => (
            <Button key={d} type="button" size="sm" variant={form.days === d ? 'default' : 'outline'} className="flex-1 rounded-full" onClick={() => setForm({ ...form, days: d })}>{d} days</Button>
          ))}
        </div>
        <Button onClick={save} disabled={busy || form.title.trim().length < 3}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Start</Button>
      </DialogContent>
    </Dialog>
  );
}
