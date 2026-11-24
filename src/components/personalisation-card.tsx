'use client';

import { useEffect, useState } from 'react';
import { Gauge, Gift, Radio, Sparkles, HeartOff } from 'lucide-react';
import { setLivePref, useLivePref } from '@/lib/live-prefs';
import { setDataSaver, useDataSaver } from '@/lib/data-saver';
import { setHideLikes, useHideLikes } from '@/lib/hide-likes';
import { BREAK_CHOICES, setBreakMinutes, useBreakMinutes } from '@/lib/break-reminder';
import { Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { clearHistory } from '@/lib/history';

const KEY = 'saligue-cookie-choice';

/** Turn For You learning on or off, and clear what it learned. */
export function PersonalisationCard() {
  const { toast } = useToast();
  const saver = useDataSaver();
  const hideLikes = useHideLikes();
  const liveInFeed = useLivePref('liveInFeed');
  const giftNudge = useLivePref('giftNudge');
  const breakMinutes = useBreakMinutes();
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      setOn(JSON.parse(localStorage.getItem(KEY) || 'null')?.choice === 'accepted');
    } catch {
      // Storage blocked.
    }
  }, []);
  const change = (value: boolean) => {
    setOn(value);
    const choice = value ? 'accepted' : 'essential';
    try {
      localStorage.setItem(KEY, JSON.stringify({ choice, at: new Date().toISOString() }));
    } catch {
      // Ignore.
    }
    document.cookie = `saligue_consent=${value ? 'all' : 'essential'}; Path=/; Max-Age=${365 * 86_400}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  };
  const clear = async () => {
    try {
      await api('/interactions', { method: 'DELETE' });
      localStorage.removeItem('saligue-taste-v1');
      toast({ title: 'Recommendations reset', description: 'Your feed starts fresh. Likes and saves stay.' });
    } catch {
      toast({ variant: 'destructive', title: 'Could not clear', description: 'Try again in a moment.' });
    }
  };
  const clearSeen = async () => {
    try {
      await clearHistory();
      toast({ title: 'History cleared', description: 'What you saw and scrolled past is gone from My Saligue → History.' });
    } catch {
      toast({ variant: 'destructive', title: 'Could not clear', description: 'Try again in a moment.' });
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> For You</CardTitle>
        <CardDescription>For You learns from what you open, watch, try on and skip, together with what shoppers like you enjoy.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="personalise" className="font-medium">Personalise my feed</Label>
          <Switch id="personalise" checked={on} onCheckedChange={change} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={clear}>Reset my recommendations</Button>
          {/* History is a list of its own (My Saligue → History): clearing the feed's learning leaves it alone. */}
          <Button variant="outline" onClick={clearSeen}>Clear my history</Button>
        </div>
        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <Label htmlFor="data-saver" className="flex items-center gap-2 font-medium"><Gauge className="h-4 w-4 text-primary" /> Data saver <span className="font-normal text-muted-foreground">· videos play when you tap</span></Label>
          <Switch id="data-saver" checked={saver} onCheckedChange={setDataSaver} />
        </div>
        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <Label htmlFor="hide-likes" className="flex items-center gap-2 font-medium"><HeartOff className="h-4 w-4 text-primary" /> Hide like counts <span className="font-normal text-muted-foreground">· less comparing</span></Label>
          <Switch id="hide-likes" checked={hideLikes} onCheckedChange={setHideLikes} />
        </div>
        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <Label htmlFor="live-in-feed" className="flex items-center gap-2 font-medium"><Radio className="h-4 w-4 text-primary" /> Lives in For You <span className="font-normal text-muted-foreground">· a silent preview while you scroll</span></Label>
          <Switch id="live-in-feed" checked={liveInFeed} onCheckedChange={(v) => setLivePref('liveInFeed', v)} />
        </div>
        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <Label htmlFor="gift-nudge" className="flex items-center gap-2 font-medium"><Gift className="h-4 w-4 text-primary" /> Gift reminders in lives <span className="font-normal text-muted-foreground">· once, after a minute</span></Label>
          <Switch id="gift-nudge" checked={giftNudge} onCheckedChange={(v) => setLivePref('giftNudge', v)} />
        </div>
        <div className="space-y-2 border-t pt-4">
          <p className="flex items-center gap-2 text-sm font-medium"><Moon className="h-4 w-4 text-primary" /> Break reminder</p>
          <div className="flex flex-wrap gap-2">
            {BREAK_CHOICES.map((m) => (
              <Button key={m} type="button" size="sm" className="rounded-full" variant={breakMinutes === m ? 'default' : 'outline'} onClick={() => setBreakMinutes(m)}>{m ? `${m} min` : 'Off'}</Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
