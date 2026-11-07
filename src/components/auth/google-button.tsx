'use client';

import { friendlyError } from '@/lib/errors';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { yearsAgo } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';
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
 * "Continue with Google" using Google's own sign-in button. New accounts get the buyer/seller role chosen in the
 * dialog, and the date of birth the dialog collected: the server asks for it when it creates an account (16+), and
 * never when someone signs back in to an account that already stated it. When no dialog collected a date — the login
 * dialog, for instance — the date is asked for right here and the same Google token is retried.
 */
export function GoogleButton({ role, birthDate, onDone }: { role?: 'buyer' | 'seller'; birthDate?: string; onDone?: () => void }) {
  const { toast } = useToast();
  const t = useT();
  const slot = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'off'>('loading');
  // Google's ID token is held here when the server says a new account still has to state its age.
  const pending = useRef<string | null>(null);
  const [askedAge, setAskedAge] = useState(false);
  const [typedDate, setTypedDate] = useState('');
  const [checking, setChecking] = useState(false);
  const ageId = useId();
  // Read inside Google's callback, which is registered only once.
  const latest = useRef({ role, birthDate, onDone, t });
  latest.current = { role, birthDate, onDone, t };

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
              await loginWithGoogle(credential, latest.current.role, latest.current.birthDate || undefined);
              latest.current.onDone?.();
            } catch (error: any) {
              // A brand-new Google account still has to state its age: ask right here, then retry with the same token.
              if (error?.code === 'birth_date_required' || error?.code === 'invalid_birth_date') {
                pending.current = credential;
                setAskedAge(true);
                return;
              }
              toast({
                variant: 'destructive',
                title: latest.current.t('Google sign-in failed'),
                description: friendlyError(error),
              });
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

  /** Retries the Google sign-in with the date of birth typed after the server asked for it. */
  async function confirmAge(event: React.FormEvent) {
    event.preventDefault();
    const credential = pending.current;
    if (!credential) return;
    setChecking(true);
    try {
      await loginWithGoogle(credential, latest.current.role, typedDate);
      latest.current.onDone?.();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: error?.code === 'too_young' ? 'Saligue is for people aged 16 and over' : 'Google sign-in failed',
        description: friendlyError(error),
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> {t('or')} <span className="h-px flex-1 bg-border" />
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
              title: t('Google sign-in is not switched on yet'),
              description: t('Use email for now. Saligue needs a Google client ID on the server to turn this on.'),
            })
          }
        >
          <span className="mr-3"><GoogleLogo /></span> {t('Continue with Google')}
        </Button>
      )}
      {askedAge && (
        <form onSubmit={confirmAge} className="space-y-3 rounded-lg border p-4 text-left">
          <Label htmlFor={`${ageId}-google-birth-date`} className="text-base font-medium">{t('First time here? Your date of birth')}</Label>
          <Input id={`${ageId}-google-birth-date`} type="date" autoComplete="bday" required max={yearsAgo(16)} min={yearsAgo(120)} className="h-12 text-base" value={typedDate} onChange={(e) => setTypedDate(e.target.value)} />
          <p className="text-xs text-muted-foreground">{t('Saligue is for people aged 16 and over. Only your age is kept, and it is never shown to anyone.')}</p>
          <Button type="submit" size="lg" className="h-12 w-full" disabled={checking || !typedDate}>{checking ? t('Signing you in…') : t('Continue')}</Button>
        </form>
      )}
      <p className="text-center text-xs text-muted-foreground">
        {t('By continuing with Google you accept the')}{' '}
        <Link href="/terms" target="_blank" className="underline">{t('Terms of Service')}</Link> {t('and')}{' '}
        <Link href="/privacy" target="_blank" className="underline">{t('Privacy Policy')}</Link>.
      </p>
    </div>
  );
}
