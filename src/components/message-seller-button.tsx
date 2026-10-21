'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MessageCircle, Send } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/components/auth/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/errors';
import { QUICK_QUESTIONS, startConversation } from '@/lib/messages';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

type About = { product: Product; orderId?: never } | { orderId: string; product?: never; title?: string };

/**
 * "Message seller": asks a first question in a small window, then opens the conversation.
 * From an order it works both ways (buyer ↔ shop).
 */
export function MessageSellerButton({ label = 'Message seller', className, size = 'lg', variant = 'default', ...about }: About & { label?: string; className?: string; size?: ButtonProps['size']; variant?: ButtonProps['variant'] }) {
  const router = useRouter();
  const { toast } = useToast();
  const { authUid } = useAuth();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const product = about.product;
  const own = !!product && product.sellerId === authUid;
  const shopName = product ? product.shop?.name ?? product.seller : undefined;

  const send = async (message: string) => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const id = await startConversation(product ? { productId: product.id } : { orderId: about.orderId }, message.trim());
      setOpen(false);
      setText('');
      router.push(`/messages?c=${id}`);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Message not sent', description: friendlyError(error) });
    } finally {
      setSending(false);
    }
  };

  if (own) return null;

  return (
    <>
      <Button type="button" size={size} variant={variant} className={className} onClick={() => setOpen(true)}>
        <MessageCircle className="mr-2 h-5 w-5" /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[92vw] max-w-md">
          <DialogHeader>
            <DialogTitle>{product ? `Message ${shopName}` : 'Message about this order'}</DialogTitle>
            <DialogDescription>
              {product ? <>About <b className="text-foreground">{product.name}</b>. The shop replies here in Saligue and gets an email.</> : 'The other side gets your message in Saligue and by email.'}
            </DialogDescription>
          </DialogHeader>
          {product && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={product.cutout || product.image} alt="" className="h-14 w-14 rounded-md bg-background object-contain p-1" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{product.name}</p>
                <p className="text-sm font-bold text-primary">${Number(product.price).toFixed(2)}</p>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {QUICK_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={sending}
                onClick={() => send(q)}
                className="rounded-full border px-3 py-1.5 text-xs font-medium transition hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Or write your own message…" maxLength={3000} className="min-h-24" />
            <Button type="submit" className={cn('w-full')} disabled={sending || !text.trim()}>
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Send
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
