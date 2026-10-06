
'use client';

import { useEffect, useState } from 'react';
import { GoogleAuthProvider, signInWithPopup, signInWithRedirect } from 'firebase/auth';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** "Continue with Google". New accounts get the buyer/seller role chosen in the dialog. */
export function GoogleButton({ label = 'Continue with Google' }: { label?: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  // Google's sign-in window can't open inside the installed Android/iOS app's web view.
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    setSupported(!(window as any).Capacitor?.isNativePlatform?.());
  }, []);
  if (!supported) return null;

  const handleClick = async () => {
    setBusy(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
      // Success (toast, redirect, profile) is handled by AuthProvider.
    } catch (error: any) {
      if (error.code === 'auth/popup-blocked') {
        await signInWithRedirect(auth, provider);
        return;
      }
      if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') return;
      const description =
        error.code === 'auth/unauthorized-domain'
          ? `Google sign-in isn't allowed on ${window.location.hostname} yet. Add it under Firebase → Authentication → Settings → Authorized domains.`
          : error.message;
      toast({ variant: 'destructive', title: 'Google sign-in failed', description });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
      <Button type="button" variant="outline" size="lg" className="h-14 w-full text-base" onClick={handleClick} disabled={busy}>
        {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <span className="mr-3"><GoogleLogo /></span>}
        {label}
      </Button>
    </div>
  );
}
