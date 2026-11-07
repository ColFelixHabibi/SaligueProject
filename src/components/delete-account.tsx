'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileDown, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ask } from '@/components/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import { api, apiUrl, getToken } from '@/lib/api';
import { saveImage } from '@/lib/save-file';
import { logout } from '@/lib/auth-actions';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';

/** Settings → Delete my account: what goes and what stays is said before; typing DELETE confirms. */
export function DeleteAccount({ seller }: { seller?: boolean }) {
  const t = useT();
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    const typed = await ask({
      title: t('Delete your account?'),
      description: t(seller
        ? 'Your shop, items, lessons, replays, comments, likes and follows are removed, and you can’t log in again. Past orders stay in your customers’ records. This can’t be undone.'
        : 'Your profile, comments, likes, follows, looks and history are removed, and you can’t log in again. Past orders stay for the shops’ records, without your name. This can’t be undone.'),
      input: { label: t('Type DELETE to confirm') },
      confirm: 'Delete',
      destructive: true,
    });
    if (typeof typed !== 'string') return;
    setBusy(true);
    try {
      await api('/auth/me/delete', { body: { confirm: typed } });
      await logout();
      toast({ title: t('Your account was deleted') });
      router.replace('/');
    } catch (error) {
      toast({ variant: 'destructive', title: t('Not deleted'), description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">{t('Delete my account')}</CardTitle>
        <CardDescription>{t('Removes your account and what you made on Saligue. Finish open orders first.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={remove} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />} {t('Delete my account')}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Settings → Download my data: one file with everything Saligue keeps about you. */
export function DownloadData() {
  const t = useT();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const token = getToken();
      const r = await fetch(apiUrl('/auth/me/export'), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new Error('export failed');
      const url = URL.createObjectURL(await r.blob());
      await saveImage(url, `saligue-my-data-${new Date().toISOString().slice(0, 10)}.json`);
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      toast({ variant: 'destructive', title: t('Not downloaded'), description: t('Try again in a moment.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileDown className="h-5 w-5 text-primary" /> {t('Download my data')}</CardTitle>
        <CardDescription>{t('One file with your account, orders, comments, messages, likes, follows, looks and history. Yours to keep.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={download} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />} {t('Download my data')}</Button>
      </CardContent>
    </Card>
  );
}
