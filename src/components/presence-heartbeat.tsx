'use client';

import { useEffect } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { startPresence } from '@/lib/presence';

/** Keeps a signed-in account showing as online (green dot) while the app is open, even on a screen with no avatars. */
export function PresenceHeartbeat() {
  const { user } = useAuth();
  useEffect(() => {
    if (user) startPresence();
  }, [user]);
  return null;
}
