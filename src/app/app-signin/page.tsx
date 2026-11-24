'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Smartphone } from 'lucide-react';
import { GoogleButton } from '@/components/auth/google-button';
import { Button } from '@/components/ui/button';

/** Where the phone app is sent back to with the one-time code (AndroidManifest.xml and Info.plist claim the scheme). */
const APP_RETURN = 'com.indeciana.saligue://signin';

/**
 * Google sign-in for the Saligue phone apps, opened in the phone's own browser (Google refuses its sign-in inside an
 * app's WebView). Signing in here does not sign this browser in: Google's answer becomes a one-time code that only
 * the app that opened this page can use (src/lib/auth-actions.ts, startAppGoogleSignIn), and the browser hands it back
 * to the app. Browsers may only open an app from a tap, so a button stays in case the automatic return is blocked.
 */
function AppSignIn() {
  const params = useSearchParams();
  const challenge = params.get('challenge') ?? '';
  const role = params.get('role') === 'buyer' ? 'buyer' : params.get('role') === 'seller' ? 'seller' : undefined;
  const [back, setBack] = useState<string | null>(null);

  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    return (
      <div className="mx-auto max-w-sm space-y-3 px-6 py-16 text-center">
        <Smartphone className="mx-auto h-12 w-12 text-primary" />
        <h1 className="text-xl font-bold">Open this from the Saligue app</h1>
        <p className="text-muted-foreground">In the app, tap Continue with Google on the sign-in screen.</p>
      </div>
    );
  }

  if (back) {
    return (
      <div className="mx-auto max-w-sm space-y-4 px-6 py-16 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
        <h1 className="text-xl font-bold">Signed in with Google</h1>
        <p className="text-muted-foreground">Go back to the Saligue app to continue. This page can be closed.</p>
        <Button asChild size="lg" className="h-14 w-full rounded-full text-base"><a href={back}>Open the Saligue app</a></Button>
        <p className="text-xs text-muted-foreground">The sign-in works once, within three minutes.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 px-6 py-16 text-center">
      <Smartphone className="mx-auto h-12 w-12 text-primary" />
      <h1 className="text-xl font-bold">Sign in to the Saligue app</h1>
      <p className="text-muted-foreground">Choose your Google account. You will then go back to the app, signed in.</p>
      <GoogleButton role={role} forApp={{
        challenge,
        onCode: (code) => {
          const url = `${APP_RETURN}?code=${encodeURIComponent(code)}`;
          setBack(url);
          window.location.href = url;
        },
      }} />
    </div>
  );
}

export default function AppSignInPage() {
  return (
    <Suspense fallback={null}>
      <AppSignIn />
    </Suspense>
  );
}
