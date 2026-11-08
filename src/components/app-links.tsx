'use client';

import { useEffect } from 'react';
import { siteHost } from '@/lib/paths';

/**
 * Shared links open the app, the way they do in every other social app: a Saligue link sent on WhatsApp opens
 * Saligue on that product, look, live or lesson, not a browser tab.
 *
 * Android is told the app owns Saligue's address by public/.well-known/assetlinks.json (which carries this build's
 * signing key) together with the autoVerify filter in android/app/src/main/AndroidManifest.xml. Once the phone
 * agrees, it hands the link here; this turns the address into the page inside the app.
 */
export function AppLinks() {
  useEffect(() => {
    const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (capacitor?.isNativePlatform?.() !== true) return;

    const site = siteHost();
    // The app owns every path on the address, so a link that is not a page must not leave someone on a blank
    // screen: the APK download link (which the app itself hands out) opens the download page instead, and a
    // server address (API, media, a build file) is simply left alone.
    const isPage = (pathname: string) => !/^\/(api|media|models|_next)\//.test(pathname) && !/\.[a-z0-9]{1,6}$/i.test(pathname);
    const here = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const bare = (path: string) => path.replace(/(.)\/+(\?|#|$)/, '$1$2');

    const open = (url?: string | null) => {
      if (!url) return;
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return;
      }
      // A link to another site is not ours to show.
      if (target.host !== site) return;
      const path = isPage(target.pathname) ? `${target.pathname}${target.search}${target.hash}` : '/download/';
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
  }, []);

  return null;
}
