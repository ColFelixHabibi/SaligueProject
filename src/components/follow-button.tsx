'use client';

import { useEffect, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { cn } from '@/lib/utils';

/** Follow a shop (shows the number of followers when `showCount`). */
export function FollowButton({ sellerId, className, size = 'sm', showCount, onDark }: { sellerId?: string | null; className?: string; size?: ButtonProps['size']; showCount?: boolean; onDark?: boolean }) {
  const { toast } = useToast();
  const { authUid } = useAuth();
  const [state, setState] = useState<{ following: boolean; followers: number } | null>(null);
  useEffect(() => {
    if (!sellerId) return;
    api<{ following: boolean; followers: number }>(`/follow/${sellerId}`).then(setState).catch(() => {});
  }, [sellerId, authUid]);
  if (!sellerId || sellerId === authUid) return null;

  const toggle = async () => {
    try {
      setState(await api<{ following: boolean; followers: number }>(`/follow/${sellerId}`, { body: {} }));
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not done', description: friendlyError(error) });
    }
  };
  const following = state?.following;
  return (
    <Button type="button" size={size} onClick={toggle} variant={following ? 'outline' : 'default'}
      className={cn('rounded-full', following && onDark && 'border-white/60 bg-transparent text-white hover:bg-white/10', className)} aria-pressed={!!following}>
      {following ? <Check className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}
      {following ? 'Following' : 'Follow'}
      {showCount && state ? <span className="ml-1.5 opacity-70">{state.followers.toLocaleString()}</span> : null}
    </Button>
  );
}
