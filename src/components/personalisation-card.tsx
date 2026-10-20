'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';

const KEY = 'saligue-cookie-choice';

/** Turn For You learning on or off, and clear what it learned. */
export function PersonalisationCard() {
  const { toast } = useToast();
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
      toast({ title: 'For You history cleared', description: 'Your feed starts fresh. Likes and saves stay.' });
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
        <Button variant="outline" onClick={clear}>Clear my For You history</Button>
      </CardContent>
    </Card>
  );
}
