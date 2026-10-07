'use client';

import { friendlyError } from '@/lib/errors';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { googleClientId, loginWithGoogle } from '@/lib/auth-actions';

declare global {
  interface Window {
    google?: any;
  }
}

let gsiScript: Promise<void> | null = null;
function loadGoogleScript() {
  if (!gsiScript) {
    gsiScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not reach Google. Check your internet connection.'));
      document.head.appendChild(script);
    });
    gsiScript.catch(() => (gsiScript = null));
  }
  return gsiScript;
}

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

/**
 * "Continue with Google" using Google's own sign-in button. New accounts get the buyer/seller role
 * chosen in the dialog. Until the server has a Google client ID, the button explains that instead.
 */
export function GoogleButton({ role, onDone }: { role?: 'buyer' | 'seller'; onDone?: () => void }) {
  const { toast } = useToast();
  const slot = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'off'>('loading');
  // Read inside Google's callback, which is registered only once.
  const latest = useRef({ role, onDone });
  latest.current = { role, onDone };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const clientId = await googleClientId();
        if (!clientId) {
          if (!cancelled) setState('off');
          return;
        }
        await loadGoogleScript();
        if (cancelled || !slot.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async ({ credential }: { credential: string }) => {
            try {
              await loginWithGoogle(credential, latest.current.role);
              latest.current.onDone?.();
            } catch (error: any) {
              toast({ variant: 'destructive', title: 'Google sign-in failed', description: friendlyError(error) });
            }
          },
        });
        window.google.accounts.id.renderButton(slot.current, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: Math.min(slot.current.offsetWidth || 320, 400),
        });
        setState('ready');
      } catch (error) {
        console.error('Google sign-in unavailable:', error);
        if (!cancelled) setState('off');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
      <div ref={slot} className={state === 'ready' ? 'flex min-h-11 justify-center' : 'hidden'} />
      {state !== 'ready' && (
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-14 w-full text-base"
          disabled={state === 'loading'}
          onClick={() =>
            toast({
              title: 'Google sign-in is not switched on yet',
              description: 'Use email for now. Saligue needs a Google client ID on the server to turn this on.',
            })
          }
        >
          <span className="mr-3"><GoogleLogo /></span> Continue with Google
        </Button>
      )}
      <p className="text-center text-xs text-muted-foreground">
        By continuing with Google you accept the{' '}
        <Link href="/terms" target="_blank" className="underline">Terms of Service</Link> and{' '}
        <Link href="/privacy" target="_blank" className="underline">Privacy Policy</Link>.
      </p>
    </div>
  );
}
