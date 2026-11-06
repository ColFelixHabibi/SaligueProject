'use client';

import { useEffect, useState } from 'react';
import { EyeOff, Loader2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { updateAccount, type AccountUser } from '@/lib/auth-actions';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const MODES = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'followers', label: 'My clients (people who follow me)' },
  { value: 'off', label: 'Nobody (comments off)' },
] as const;

/** Settings → Comments on my posts: who may comment on my items and lessons, and words that hide a comment. */
export function CommentControls() {
  const t = useT();
  const { toast } = useToast();
  const [mode, setMode] = useState<'everyone' | 'followers' | 'off'>('everyone');
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ user: AccountUser }>('/auth/me').then(({ user }) => {
      setMode(user.commentMode ?? 'everyone');
      setWords((user.hiddenWords ?? []).join(', '));
    }).catch(() => {});
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      await updateAccount({ commentMode: mode, hiddenWords: words.split(/[,\n]+/).map((w) => w.trim()).filter(Boolean) });
      toast({ title: t('Saved') });
    } catch (error) {
      toast({ variant: 'destructive', title: t('Not saved'), description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-primary" /> {t('Comments on my posts')}</CardTitle>
        <CardDescription>{t('Your items and lessons. You can always remove comments yourself.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('Who can comment')}>
          {MODES.map((m) => (
            <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} onClick={() => setMode(m.value)}
              className={cn('rounded-full border px-3 py-1.5 text-sm font-semibold', mode === m.value ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>
              {t(m.label)}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-sm font-medium"><EyeOff className="h-4 w-4 text-primary" /> {t('Hidden words')}</p>
          <Textarea rows={2} value={words} onChange={(e) => setWords(e.target.value)} placeholder={t('Words separated by commas')} />
          <p className="text-xs text-muted-foreground">{t('A comment with one of these words is hidden from everyone except the person who wrote it.')}</p>
        </div>
        <Button onClick={save} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {t('Save')}</Button>
      </CardContent>
    </Card>
  );
}
