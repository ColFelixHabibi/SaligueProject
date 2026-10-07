
'use client';

import { useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { Loader2, Send, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { auth, db } from '@/lib/firebase';
import { friendlyError } from '@/lib/errors';
import type { Comment } from '@/lib/types';
import { cn } from '@/lib/utils';

function timeAgo(seconds?: number) {
  if (!seconds) return 'now';
  const diff = Date.now() / 1000 - seconds;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

/** Live comments for a product, shown below its image. Anyone can comment, no login needed. */
export function CommentsPanel({ productId, sellerId, className }: { productId: string; sellerId?: string; className?: string }) {
  const { toast } = useToast();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const uid = auth.currentUser?.uid;

  useEffect(() => {
    const q = query(collection(db, 'products', productId, 'comments'), orderBy('createdAt', 'desc'), limit(50));
    return onSnapshot(
      q,
      (snapshot) => setComments(snapshot.docs.map((d) => ({ ...(d.data() as Omit<Comment, 'id'>), id: d.id }))),
      () => setComments([])
    );
  }, [productId]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!text.trim() || !user) return;
    setSending(true);
    try {
      await addDoc(collection(db, 'products', productId, 'comments'), {
        uid: user.uid,
        name: (user.isAnonymous ? 'Guest' : user.displayName || user.email?.split('@')[0] || 'Saligue user').slice(0, 60),
        text: text.trim().slice(0, 500),
        createdAt: serverTimestamp(),
      });
      setText('');
    } catch (error) {
      toast({ variant: 'destructive', title: 'Comment not sent', description: friendlyError(error) });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
        {comments === null ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        ) : comments.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">No comments yet. Be the first!</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-xs">{c.name.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">{c.name}</span>{' '}
                <span className="text-xs text-muted-foreground">{timeAgo(c.createdAt?.seconds)}</span>
                <p className="break-words">{c.text}</p>
              </div>
              {(c.uid === uid || sellerId === uid) && (
                <button
                  type="button"
                  aria-label="Delete comment"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => deleteDoc(doc(db, 'products', productId, 'comments', c.id)).catch(() => {})}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))
        )}
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
