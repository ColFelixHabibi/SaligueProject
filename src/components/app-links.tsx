'use client';

import { useEffect } from 'react';
import { openInBrowser } from '@/lib/native';
import { siteHost } from '@/lib/paths';
import { finishAppGoogleSignIn } from '@/lib/auth-actions';
import { friendlyError } from '@/lib/errors';
import { useToast } from '@/hooks/use-toast';

/**
 * Shared links open the app, the way they do in every other social app: a Saligue link sent on WhatsApp opens
 * Saligue on that product, look, live or lesson, not a browser tab.
 *
 * Android is told the app owns Saligue's address by public/.well-known/assetlinks.json (which carries this build's
 * signing key) together with the autoVerify filter in android/app/src/main/AndroidManifest.xml; the iPhone is told the
 * same thing by public/.well-known/apple-app-site-association plus the Associated Domains entitlement
 * (ios/App/App/App.entitlements). Once the phone agrees, it hands the link here; this turns the address into the page
 * inside the app — except a download, which goes to the phone's browser, because a WebView cannot save a file.
 */
export function AppLinks() {
  const { toast } = useToast();
  useEffect(() => {
    const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (capacitor?.isNativePlatform?.() !== true) return;

    const site = siteHost();
    // /download is not among the paths the app claims (android/app/src/main/AndroidManifest.xml lists the shared
    // pages one by one), so Android hands those links to the browser itself. This stays as the second net: a build
    // from before that change still claims the whole address, and a link that does arrive here must not be shown in
    // a window that cannot save a file.
    const isDownload = (pathname: string) => /^\/download(\/|$)/.test(pathname);
    // Everything else that is not a page — the API, media, a model file — is left alone.
    const isPage = (pathname: string) => !/^\/(api|media|models|_next)\//.test(pathname) && !/\.[a-z0-9]{1,6}$/i.test(pathname);
    const here = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const bare = (path: string) => path.replace(/(.)\/+(\?|#|$)/, '$1$2');

    // Google sign-in coming back from the phone's browser (src/app/app-signin): com.indeciana.saligue://signin?code=…
    const signIn = (url: string) => {
      const code = new URL(url.replace(/^com\.indeciana\.saligue:\/\//, 'https://app/')).searchParams.get('code');
      if (!code) return;
      finishAppGoogleSignIn(code)
        .then(() => {
          toast({ title: 'Signed in with Google' });
          if (/^\/(login|register)(\/|$)/.test(window.location.pathname)) window.location.href = '/';
        })
        .catch((error) => toast({ variant: 'destructive', title: 'Google sign-in failed', description: friendlyError(error) }));
    };
    const handled = new Set<string>();
    const open = (url?: string | null) => {
      if (!url) return;
      if (url.startsWith('com.indeciana.saligue://signin')) {
        // The launch URL and the event can both carry it: a code works once, so use it once.
        if (!handled.has(url)) {
          handled.add(url);
          signIn(url);
        }
        return;
      }
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return;
      }
      // A link to another site is not ours to show.
      if (target.host !== site) return;
      if (isDownload(target.pathname)) {
        // The app is already installed, so the only useful thing this link can still do is update it — and this
        // window cannot save a file. The address is external to the app, so it leaves for the phone's browser.
        openInBrowser(target.toString());
        return;
      }
      if (!isPage(target.pathname)) return;
      const path = `${target.pathname}${target.search}${target.hash}`;
      // A whole page load, like a tapped notification (src/lib/push.ts): it always lands on the right page, even
      // when the app was started by the link and its first page is still settling.
      if (bare(path) !== bare(here())) window.location.href = path;
    };

    let removed: (() => void) | null = null;
    let left = false;
    void (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('appUrlOpen', (event) => open(event.url));
        if (left) void handle.remove();
        else removed = () => void handle.remove();
        // The link that started the app arrives here rather than as an event.
        open((await App.getLaunchUrl())?.url);
      } catch {
        // The plugin is missing (a build older than this one): links keep opening in the browser, which works.
      }
    })();

    return () => {
      left = true;
      removed?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
