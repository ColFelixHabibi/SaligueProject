'use client';

import { useT } from '@/lib/i18n';

import { useBlockedIds } from '@/lib/blocks';

import { useEffect, useState } from 'react';
import { CheckCircle2, CornerDownRight, HelpCircle, Loader2, Send, Trash2 } from 'lucide-react';
import { SellerAvatar } from '@/components/seller-avatar';
import { useAuth } from '@/components/auth/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { onServerEvent } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { deleteLessonComment, lessonComments, postLessonComment, type Lesson, type LessonComment } from '@/lib/lessons';
import { cn } from '@/lib/utils';

/** Comments and questions under a lesson, as threads: the teacher's replies are marked and answer the question. */
export function LessonComments({ lesson }: { lesson: Lesson }) {
  const { toast } = useToast();
  const { user, authUid } = useAuth();
  const blocked = useBlockedIds();
  const t = useT();
  const [list, setList] = useState<LessonComment[] | null>(null);
  const [text, setText] = useState('');
  const [question, setQuestion] = useState(false);
  const [replyTo, setReplyTo] = useState<LessonComment | null>(null);
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState<'all' | 'questions'>('all');

  useEffect(() => {
    const load = () => lessonComments(lesson.id).then(setList).catch(() => setList([]));
    void load();
    return onServerEvent('lesson_comments', (d: { lessonId?: string }) => d.lessonId === lesson.id && void load());
  }, [lesson.id]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await postLessonComment(lesson.id, { text: text.trim(), kind: question ? 'question' : 'comment', parentId: replyTo?.id });
      setText('');
      setQuestion(false);
      setReplyTo(null);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not sent', description: friendlyError(error) });
    } finally {
      setSending(false);
    }
  };

  const visible = (list ?? []).filter((c) => !blocked.has(c.uid));
  const top = visible.filter((c) => !c.parentId && (filter === 'all' || c.kind === 'question'));
  const replies = (id: string) => visible.filter((c) => c.parentId === id);
  const Row = ({ c, reply }: { c: LessonComment; reply?: boolean }) => (
    <div className={cn('flex gap-2.5', reply && 'ml-9')}>
      <SellerAvatar src={c.avatar} name={c.name} className={reply ? 'h-7 w-7' : 'h-8 w-8'} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">
          {c.name}
          {c.teacher && <span className="ml-1.5 rounded bg-primary px-1 py-px text-[10px] font-extrabold uppercase text-white">Teacher</span>}
          {c.kind === 'question' && <span className={cn('ml-1.5 inline-flex items-center gap-0.5 rounded px-1 py-px text-[10px] font-bold', c.answered ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>{c.answered ? <CheckCircle2 className="h-3 w-3" /> : <HelpCircle className="h-3 w-3" />}{c.answered ? t('Answered') : t('Question')}</span>}
        </p>
        <p className="whitespace-pre-wrap break-words text-sm">{c.text}</p>
        <div className="mt-0.5 flex gap-3 text-xs text-muted-foreground">
          {!reply && user && <button type="button" onClick={() => setReplyTo(c)} className="font-semibold hover:text-foreground">{t('Reply')}</button>}
          {(c.uid === authUid || lesson.authorId === authUid) && <button type="button" onClick={() => deleteLessonComment(c.id).catch(() => {})} aria-label="Delete" className="hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex gap-2 text-sm">
        {(['all', 'questions'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={cn('rounded-full px-3 py-1 font-semibold', filter === f ? 'bg-foreground text-background' : 'bg-muted')}>
            {f === 'all' ? `${t('All')} ${list?.filter((c) => !c.parentId).length ?? ''}` : `${t('Questions')} ${list?.filter((c) => c.kind === 'question').length ?? ''}`}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-3">
        {list === null && <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}
        {list?.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Be the first to comment or ask the teacher.</p>}
        {top.map((c) => (
          <div key={c.id} className="space-y-2">
            <Row c={c} />
            {replies(c.id).map((r) => <Row key={r.id} c={r} reply />)}
          </div>
        ))}
      </div>
      {user ? (
        <form onSubmit={send} className="space-y-1.5 border-t pt-3">
          {replyTo && <p className="flex items-center gap-1 text-xs text-muted-foreground"><CornerDownRight className="h-3.5 w-3.5" /> Replying to {replyTo.name} <button type="button" className="ml-auto font-semibold" onClick={() => setReplyTo(null)}>Cancel</button></p>}
          <div className="flex items-center gap-2">
            {!replyTo && (
              <button type="button" onClick={() => setQuestion((q) => !q)} aria-pressed={question} title="Ask as a question" aria-label="Ask as a question"
                className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', question ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                <HelpCircle className="h-5 w-5" />
              </button>
            )}
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder={replyTo ? '…' : question ? t('Ask the teacher…') : t('Add a comment…')}
              className="h-10 min-w-0 flex-1 rounded-full border bg-background px-4 text-sm outline-none focus:border-primary" />
            <button type="submit" disabled={sending || !text.trim()} aria-label="Send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50">
              {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </button>
          </div>
        </form>
      ) : (
        <p className="border-t pt-3 text-center text-sm text-muted-foreground">Log in to comment or ask a question.</p>
      )}
    </div>
  );
}
