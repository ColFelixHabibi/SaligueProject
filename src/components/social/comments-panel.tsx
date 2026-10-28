'use client';

import { useBlockedIds } from '@/lib/blocks';

import { useEffect, useState } from 'react';
import { CornerDownRight, Loader2, Send, Trash2, X } from 'lucide-react';
import { CommentThread } from '@/components/comment-thread';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/auth-provider';
import { api, onServerEvent } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import type { Comment } from '@/lib/types';
import { cn } from '@/lib/utils';
import { RichText } from '@/components/rich-text';
import { MentionSuggestions } from '@/components/mention-suggestions';

function timeAgo(value?: string | null) {
  if (!value) return 'now';
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (!Number.isFinite(diff) || diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function CommentsPanel({ productId, sellerId, className }: { productId: string; sellerId?: string; className?: string }) {
  const { toast } = useToast();
  const { authUid } = useAuth();
  const blocked = useBlockedIds();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // The comment (or reply) being answered: replies can go as deep as people like.
  const [replyTo, setReplyTo] = useState<Comment | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      api<Comment[]>(`/products/${productId}/comments`)
        .then((list) => active && setComments(list))
        .catch(() => active && setComments([]));
    void load();
    const stop = onServerEvent('comments', (data: { productId?: string }) => {
      if (data.productId === productId) void load();
    });
    return () => {
      active = false;
      stop();
    };
  }, [productId]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setSending(true);
    try {
      await api(`/products/${productId}/comments`, { body: { text: value, parentId: replyTo?.id } });
      setText('');
      setReplyTo(null);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Comment not sent', description: friendlyError(error) });
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    await api(`/comments/${id}`, { method: 'DELETE' }).catch((error) => toast({ variant: 'destructive', title: 'Could not delete comment', description: friendlyError(error) }));
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
        {comments === null ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /> : comments.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">No comments yet. Be the first!</p>
        ) : (
          <CommentThread items={comments.filter((c) => !blocked.has(c.uid))} render={(comment, depth, parent) => (
          <div className="flex items-start gap-2">
            <Avatar className={depth ? 'h-6 w-6' : 'h-7 w-7'}><AvatarFallback className="text-xs">{comment.name.charAt(0).toUpperCase()}</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1 text-sm">
              <span className="font-semibold">{comment.name}</span>{' '}
              <span className="text-xs text-muted-foreground">{timeAgo(comment.createdAt)}</span>
              {/* Deep replies (no more indent) say whom they answer. */}
              <p className="break-words">{depth > 3 && parent && <span className="mr-1 font-semibold text-primary">@{parent.username ?? parent.name}</span>}<RichText text={comment.text} /></p>
              <button type="button" onClick={() => setReplyTo(comment)} className="mt-0.5 text-xs font-semibold text-muted-foreground hover:text-foreground">Reply</button>
            </div>
            {/* Once sent, a comment stays: only the item's shop can remove it. */}
            {!!authUid && sellerId === authUid && (
              <button type="button" aria-label="Delete comment" className="text-muted-foreground hover:text-destructive" onClick={() => void remove(comment.id)}>
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
          )} />
        )}
      </div>
      {replyTo && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CornerDownRight className="h-3.5 w-3.5" /> Replying to <b className="text-foreground">{replyTo.name}</b>
          <button type="button" className="ml-auto flex h-6 w-6 items-center justify-center rounded-full hover:bg-muted" onClick={() => setReplyTo(null)} aria-label="Cancel"><X className="h-4 w-4" /></button>
        </p>
      )}
      <MentionSuggestions value={text} onChange={setText} />
      <form onSubmit={send} className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={replyTo ? `Reply to ${replyTo.name}…` : 'Add a comment…'} maxLength={500} className="h-10" />
        <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={sending || !text.trim()} aria-label="Send comment">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
