'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, HelpCircle, Loader2, Send, Store, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SellerAvatar } from '@/components/seller-avatar';
import { ask } from '@/components/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useShopQuestions } from '@/lib/questions';
import { cn } from '@/lib/utils';

/** Seller Center → Questions: every question about the shop's items, waiting ones first, answered in place. */
export default function QuestionsPage() {
  const t = useT();
  const { toast } = useToast();
  const list = useShopQuestions();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'waiting' | 'all'>('waiting');
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
  const waiting = list?.filter((q) => !q.answer).length ?? 0;
  const shown = (list ?? []).filter((q) => filter === 'all' || !q.answer);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center gap-2"><HelpCircle className="h-5 w-5 text-primary" /> {t('Questions')}</CardTitle>
        <div className="flex gap-2 text-sm">
          {(['waiting', 'all'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold', filter === f ? 'bg-foreground text-background' : 'bg-muted')}>
              {f === 'waiting' ? <><Clock className="h-4 w-4" /> {waiting}</> : <>{t('All')} {list?.length ?? ''}</>}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {list === null && <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}
        {list !== null && shown.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">{filter === 'waiting' ? t('Every question is answered.') : t('No questions yet.')}</p>
        )}
        {shown.map((q) => (
          <div key={q.id} className="space-y-2 rounded-2xl border p-3">
            <Link href={`/product?id=${q.productId}#questions`} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {q.productImage && <img src={q.productImage} alt="" className="h-8 w-8 rounded-lg bg-muted object-contain" />}
              <span className="truncate">{q.productName}</span>
            </Link>
            <div className="flex gap-2.5">
              <SellerAvatar src={q.avatar} name={q.name} className="h-8 w-8" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  {q.name}
                  {q.answer ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Clock className="h-3.5 w-3.5 text-amber-600" />}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">{q.text}</p>
              </div>
              <button type="button" aria-label={t('Delete')} title={t('Delete')} className="self-start text-muted-foreground hover:text-destructive"
                onClick={async () => { if (await ask({ title: t('Delete this question?'), confirm: 'Delete', destructive: true })) void run(q.id, () => api(`/questions/${q.id}`, { method: 'DELETE' })); }}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {q.answer ? (
              <div className="ml-10 flex gap-2 rounded-2xl bg-muted p-3 text-sm">
                <Store className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="whitespace-pre-wrap break-words">{q.answer}</p>
              </div>
            ) : (
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
