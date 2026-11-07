'use client';

import { useT } from '@/lib/i18n';

import { useState } from 'react';
import { Check, Coffee, Compass, GraduationCap, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBreakReminder } from '@/lib/break-reminder';

/** A calm pause screen over the feed after the chosen watching time (Settings → Break reminder). */
export function BreakReminder() {
  const { due, minutes, snooze, takeBreak } = useBreakReminder();
  const [resting, setResting] = useState(false);
  const t = useT();
  if (!due && !resting) return null;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#2a0a1a] to-black p-8 text-center text-white" role="dialog" aria-label="Time for a break">
      {resting ? (
        <>
          <span className="h-28 w-28 animate-pulse rounded-full bg-primary/40 ring-8 ring-primary/20" aria-hidden />
          <p className="text-2xl font-bold">{t('Breathe in… and out.')}</p>
          <p className="max-w-xs text-white/75">Stretch, drink some water, look away from the screen. Saligue will be here.</p>
          <Button variant="secondary" className="rounded-full" onClick={() => setResting(false)}>{t('I’m back')}</Button>
        </>
      ) : (
        <>
          <Moon className="h-14 w-14 text-primary" />
          <p className="text-2xl font-bold">You’ve been watching for {minutes} minutes</p>
          <p className="max-w-xs text-white/75">{t('How about a short break?')}</p>
          <div className="flex w-full max-w-xs flex-col gap-2">
            <Button className="h-12 rounded-full" onClick={() => { takeBreak(); setResting(true); }}><Coffee className="mr-2 h-5 w-5" /> {t('Take a break')}</Button>
            <Button variant="ghost" className="h-12 rounded-full text-white hover:bg-white/10 hover:text-white" onClick={snooze}>{t('15 more minutes')}</Button>
          </div>
          <p className="text-xs text-white/50">Change this in Settings → Break reminder</p>
        </>
      )}
    </div>
  );
}

/** The end of a feed: nothing new left, with calm next steps instead of endless scrolling. */
export function CaughtUp({ onLearn }: { onLearn?: () => void }) {
  const t = useT();
  return (
    <section className="flex h-full snap-start flex-col items-center justify-center gap-5 bg-muted p-8 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary"><Check className="h-10 w-10" /></span>
      <p className="text-2xl font-bold">{t('All caught up')}</p>
      {/* Two next steps as icons: learn something, or explore the shop. */}
      <div className="flex justify-center gap-6 text-xs font-semibold">
        {onLearn && (
          <button type="button" onClick={onLearn} className="flex flex-col items-center gap-1.5">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow transition hover:opacity-90"><GraduationCap className="h-6 w-6" /></span>
            {t('Learn')}
          </button>
        )}
        <a href="/search" className="flex flex-col items-center gap-1.5">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border bg-background shadow-sm transition hover:bg-muted"><Compass className="h-6 w-6" /></span>
          {t('Explore')}
        </a>
      </div>
    </section>
  );
}
