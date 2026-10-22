'use client';

import { useEffect, useState } from 'react';
import { Loader2, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';

type Appeal = { id: string; kind: string; targetId: string; status: 'open' | 'restored' | 'kept'; note: string | null };

/** For an item or lesson hidden after reports: ask Saligue to review it, and see the answer. */
export function AppealButton({ kind, targetId, title }: { kind: 'product' | 'lesson'; targetId: string; title: string }) {
  const { toast } = useToast();
  const [appeal, setAppeal] = useState<Appeal | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api<Appeal[]>('/me/appeals').then((list) => setAppeal(list.find((a) => a.targetId === targetId) ?? null)).catch(() => {});
  useEffect(() => void load(), [targetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setBusy(true);
    try {
      await api('/appeals', { body: { kind, targetId, text } });
      toast({ title: 'Appeal sent', description: 'Saligue will review it and tell you the answer.' });
      setOpen(false);
      await load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not sent', description: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  };

  if (appeal?.status === 'open') return <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600"><Scale className="h-3.5 w-3.5" /> Appeal in review</span>;
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}>
        <Scale className="mr-1 h-3.5 w-3.5" /> {appeal?.status === 'kept' ? 'Appeal again' : 'Appeal'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[92vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Ask Saligue to review</DialogTitle>
            <DialogDescription>“{title}” was hidden because several people reported it. Tell us why it follows the rules (fashion, honest, respectful).</DialogDescription>
          </DialogHeader>
          {appeal?.status === 'kept' && appeal.note && <p className="rounded-lg bg-muted p-2 text-sm">Last answer: {appeal.note}</p>}
          <Textarea rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. This is my own photo of a real dress I sell…" />
          <Button onClick={send} disabled={busy || text.trim().length < 10}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send appeal</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
