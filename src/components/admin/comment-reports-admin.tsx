'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, EyeOff, Flag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';

type Row = { kind: 'item' | 'lesson'; id: string; text: string; author: string; username: string | null; hidden: boolean; reports: number; reasons: string[]; link: string; createdAt: string };
const REASON: Record<string, string> = { rude: 'rude', spam: 'spam', not_fashion: 'not fashion', other: 'other' };

/** Admin → Moderation: comments and replies people reported. Keep (shown again) or remove (with its replies). */
export function CommentReportsAdmin() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = useCallback(() => api<Row[]>('/admin/comment-reports').then(setRows).catch(() => setRows([])), []);
  useEffect(() => void load(), [load]);
  const decide = (r: Row, decision: 'keep' | 'remove') =>
    api('/admin/comment-reports', { body: { kind: r.kind, id: r.id, decision } })
      .then(() => { toast({ title: decision === 'remove' ? 'Comment removed' : 'Comment kept' }); void load(); })
      .catch((error) => toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) }));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Flag className="h-5 w-5 text-primary" /> Reported comments</CardTitle>
        <CardDescription>Hidden automatically after 3 reports. Keep shows it again; remove deletes it and its replies.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows?.length === 0 && <p className="text-sm text-muted-foreground">Nothing reported.</p>}
        {rows?.map((r) => (
          <div key={`${r.kind}-${r.id}`} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 text-sm">
              <p className="whitespace-pre-wrap break-words">{r.text}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {r.author}{r.username ? ` (@${r.username})` : ''} · {r.kind === 'item' ? 'item' : 'lesson'} · {r.reports} report{r.reports === 1 ? '' : 's'}: {r.reasons.map((x) => REASON[x] ?? x).join(', ')}
                {r.hidden && <span className="ml-1 inline-flex items-center gap-0.5 font-semibold text-amber-600"><EyeOff className="h-3 w-3" /> hidden</span>}
                {' · '}<Link href={r.link} className="text-primary underline">open</Link>
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="icon" variant="outline" onClick={() => decide(r, 'keep')} aria-label="Keep" title="Keep"><Check className="h-4 w-4" /></Button>
              <Button size="icon" variant="outline" className="text-destructive" onClick={() => decide(r, 'remove')} aria-label="Remove" title="Remove"><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
