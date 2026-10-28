'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, HelpCircle, Loader2, Send, Store, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SellerAvatar } from '@/components/seller-avatar';
import { useAuth } from '@/components/auth/auth-provider';
import { ask } from '@/components/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import { api, mediaUrl, onServerEvent } from '@/lib/api';
import { useBlockedIds } from '@/lib/blocks';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { RichText } from '@/components/rich-text';

type Question = { id: string; uid: string; name: string; avatar: string | null; text: string; answer: string | null; answeredAt: string | null; createdAt: string; mine: boolean; canAnswer: boolean };

/** Ask the shop: questions on an item. Answers stay, so the next shopper finds them without asking again. */
export function ProductQuestions({ productId, sellerId }: { productId: string; sellerId?: string }) {
  const t = useT();
  const { toast } = useToast();
  const { user, authUid } = useAuth();
  const blocked = useBlockedIds();
  const [list, setList] = useState<Question[] | null>(null);
  const [text, setText] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const shop = !!authUid && authUid === sellerId;

  useEffect(() => {
    const load = () => api<Question[]>(`/products/${productId}/questions`).then((l) => setList(l.map((q) => ({ ...q, avatar: mediaUrl(q.avatar ?? undefined) ?? null })))).catch(() => setList([]));
    void load();
    return onServerEvent('questions', (d: { productId?: string }) => d.productId === productId && void load());
  }, [productId, authUid]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not sent', description: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };

  const shown = (list ?? []).filter((q) => !blocked.has(q.uid));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-xl"><HelpCircle className="h-5 w-5 text-primary" /> {t('Ask the shop')}{shown.length > 0 && <span className="text-base font-normal text-muted-foreground">{shown.length}</span>}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {user && !shop && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 3) void run('ask', () => api(`/products/${productId}/questions`, { body: { text: text.trim() } }).then(() => setText(''))); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={t('Size, fabric, delivery…?')}
              className="h-11 min-w-0 flex-1 rounded-full border bg-background px-4 text-sm outline-none focus:border-primary" />
            <button type="submit" disabled={text.trim().length < 3 || !!busy} aria-label={t('Ask')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50">
              {busy === 'ask' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </button>
          </form>
        )}
        {!user && <p className="text-sm text-muted-foreground">{t('Log in to ask the shop.')}</p>}
        {list === null && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}
        {list !== null && shown.length === 0 && <p className="text-sm text-muted-foreground">{t('No questions yet.')}</p>}
        {shown.map((q) => (
          <div key={q.id} className="space-y-2 border-t pt-3 first:border-t-0 first:pt-0">
            <div className="flex gap-2.5">
              <SellerAvatar src={q.avatar} name={q.name} className="h-8 w-8" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  {q.name}
                  {q.answer
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-label={t('Answered')} />
                    : <Clock className="h-3.5 w-3.5 text-amber-600" aria-label={t('Waiting')} />}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm"><RichText text={q.text} /></p>
              </div>
              {q.canAnswer && (
                <button type="button" aria-label={t('Delete')} title={t('Delete')} className="self-start text-muted-foreground hover:text-destructive"
                  onClick={async () => { if (await ask({ title: t('Delete this question?'), confirm: 'Delete', destructive: true })) void run(q.id, () => api(`/questions/${q.id}`, { method: 'DELETE' })); }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            {q.answer && (
              <div className="ml-10 flex gap-2 rounded-2xl bg-muted p-3 text-sm">
                <Store className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="whitespace-pre-wrap break-words"><RichText text={q.answer} /></p>
              </div>
            )}
            {q.canAnswer && !q.answer && (
              <form className="ml-10 flex gap-2" onSubmit={(e) => { e.preventDefault(); const a = answers[q.id]?.trim(); if (a) void run(q.id, () => api(`/questions/${q.id}/answer`, { method: 'PUT', body: { answer: a } })); }}>
                <input value={answers[q.id] ?? ''} onChange={(e) => setAnswers((all) => ({ ...all, [q.id]: e.target.value }))} maxLength={600} placeholder={t('Your answer…')}
                  className="h-10 min-w-0 flex-1 rounded-full border bg-background px-4 text-sm outline-none focus:border-primary" />
                <button type="submit" disabled={!answers[q.id]?.trim() || !!busy} aria-label={t('Answer')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50">
                  {busy === q.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </form>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
