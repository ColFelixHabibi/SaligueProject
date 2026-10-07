'use client';

import { useEffect, useState } from 'react';
import { Loader2, Send, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/auth/auth-provider';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import type { Comment } from '@/lib/types';
import { cn } from '@/lib/utils';

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
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await supabase.from('product_comments').select('*')
        .eq('product_id', productId).order('created_at', { ascending: false }).limit(50);
      if (!active) return;
      if (error) { setComments([]); return; }
      setComments((data ?? []).map((row) => ({ id: row.id, uid: row.user_id, name: row.name, text: row.text, createdAt: row.created_at })));
    };
    void load();
    const channel = supabase.channel(`comments-${productId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_comments', filter: `product_id=eq.${productId}` }, () => { void load(); })
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [productId]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setSending(true);
    try {
      const name = user.user_metadata?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Guest';
      const { error } = await supabase.from('product_comments').insert({ product_id: productId, user_id: user.id, name: name.slice(0, 60), text: value.slice(0, 500) });
      if (error) throw error;
      setText('');
    } catch (error) {
      toast({ variant: 'destructive', title: 'Comment not sent', description: friendlyError(error) });
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('product_comments').delete().eq('id', id);
    if (error) toast({ variant: 'destructive', title: 'Could not delete comment', description: friendlyError(error) });
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
        {comments === null ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /> : comments.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">No comments yet. Be the first!</p>
        ) : comments.map((comment) => (
          <div key={comment.id} className="flex items-start gap-2">
            <Avatar className="h-7 w-7"><AvatarFallback className="text-xs">{comment.name.charAt(0).toUpperCase()}</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1 text-sm">
              <span className="font-semibold">{comment.name}</span>{' '}
              <span className="text-xs text-muted-foreground">{timeAgo(comment.createdAt)}</span>
              <p className="break-words">{comment.text}</p>
            </div>
            {(comment.uid === authUid || sellerId === authUid) && (
              <button type="button" aria-label="Delete comment" className="text-muted-foreground hover:text-destructive" onClick={() => void remove(comment.id)}>
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={send} className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" maxLength={500} className="h-10" />
        <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={sending || !text.trim()} aria-label="Send comment">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
