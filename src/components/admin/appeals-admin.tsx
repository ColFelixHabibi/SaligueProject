'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Scale } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';

type Appeal = { id: string; kind: 'product' | 'lesson'; targetId: string; title: string; text: string; reasons: { reason: string; n: number }[]; createdAt: string };

/** Admin: owners asking to show again an item or lesson hidden after reports. */
export function AppealsAdmin() {
  const { toast } = useToast();
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(() => api<Appeal[]>('/admin/appeals').then(setAppeals).catch(() => {}), []);
  useEffect(() => void load(), [load]);
  const decide = async (id: string, decision: 'restore' | 'keep') => {
    try {
      await api(`/admin/appeals/${id}`, { body: { decision, note: notes[id] } });
      toast({ title: decision === 'restore' ? 'Shown again' : 'Kept hidden' });
      void load();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) });
    }
  };
  return (
    <Card id="appeals">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5 text-primary" /> Appeals {appeals.length > 0 && <Badge>{appeals.length}</Badge>}</CardTitle>
        <CardDescription>Items and lessons hidden after reports, whose owners ask for a review. Your note is sent to them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {appeals.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting.</p>}
        {appeals.map((a) => (
          <div key={a.id} className="space-y-2 rounded-xl border p-3 text-sm">
            <p className="font-semibold">
              <Link href={a.kind === 'product' ? `/product?id=${a.targetId}` : `/learn?lesson=${a.targetId}`} className="hover:underline">{a.title}</Link>
              <span className="ml-2 font-normal text-muted-foreground">{a.kind === 'product' ? 'Item' : 'Lesson'} · reported: {a.reasons.map((r) => `${r.reason.replace('_', ' ')} ×${r.n}`).join(', ')}</span>
            </p>
            <p className="rounded-lg bg-muted p-2">“{a.text}”</p>
            <Input placeholder="Note to the owner (optional)" value={notes[a.id] ?? ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => decide(a.id, 'restore')}>Show again</Button>
              <Button size="sm" variant="outline" onClick={() => decide(a.id, 'keep')}>Keep hidden</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
