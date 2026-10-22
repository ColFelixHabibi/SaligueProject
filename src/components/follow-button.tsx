'use client';

import { useT } from '@/lib/i18n';

import { useEffect, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { cn } from '@/lib/utils';

/** Whether I follow a shop or teacher (am their client), their number of clients, and follow/unfollow. */
export function useFollow(sellerId?: string | null) {
  const { toast } = useToast();
  const { authUid } = useAuth();
  const [state, setState] = useState<{ following: boolean; followers: number } | null>(null);
  useEffect(() => {
    if (!sellerId) return;
    api<{ following: boolean; followers: number }>(`/follow/${sellerId}`).then(setState).catch(() => {});
  }, [sellerId, authUid]);
  const toggle = async () => {
    if (!sellerId) return;
    try {
      setState(await api<{ following: boolean; followers: number }>(`/follow/${sellerId}`, { body: {} }));
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) });
    }
  };
  return { following: !!state?.following, clients: state?.followers ?? null, toggle, own: !!sellerId && sellerId === authUid };
}

/** Follow a shop or teacher: you become their client (shows the number of clients when `showCount`). */
export function FollowButton({ sellerId, className, size = 'sm', showCount, onDark }: { sellerId?: string | null; className?: string; size?: ButtonProps['size']; showCount?: boolean; onDark?: boolean }) {
  const { following, clients, toggle, own } = useFollow(sellerId);
  const t = useT();
  if (!sellerId || own) return null;
  return (
    <Button type="button" size={size} onClick={toggle} variant={following ? 'outline' : 'default'}
      className={cn('rounded-full', following && onDark && 'border-white/60 bg-transparent text-white hover:bg-white/10', className)} aria-pressed={!!following}>
      {following ? <Check className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}
      {following ? t('Following') : t('Follow')}
      {showCount && clients != null ? <span className="ml-1.5 opacity-70">{clients.toLocaleString()}</span> : null}
    </Button>
  );
}
