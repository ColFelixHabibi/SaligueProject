'use client';

import { Flag } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/components/auth/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useT } from '@/lib/i18n';

const REASONS = [
  { value: 'rude', label: 'Rude or hurtful' },
  { value: 'spam', label: 'Spam' },
  { value: 'not_fashion', label: 'Not about fashion' },
] as const;

/** A small flag on a comment or reply: report it (3 reports hide it until a moderator looks). */
export function ReportComment({ kind, id, authorId }: { kind: 'item' | 'lesson'; id: string; authorId: string }) {
  const t = useT();
  const { toast } = useToast();
  const { user, authUid } = useAuth();
  if (!user || authorId === authUid) return null;
  const report = (reason: string) =>
    api('/comment-reports', { body: { kind, id, reason } })
      .then(() => toast({ title: t('Thank you for reporting'), description: t('Saligue’s moderators will look at it.') }))
      .catch((error) => toast({ variant: 'destructive', title: t('Not sent'), description: friendlyError(error) }));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={t('Report')} title={t('Report')} className="text-muted-foreground/60 hover:text-destructive"><Flag className="h-3.5 w-3.5" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('Report')}</DropdownMenuLabel>
        {REASONS.map((r) => <DropdownMenuItem key={r.value} onSelect={() => void report(r.value)}>{t(r.label)}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
