/**
 * Whether we are inside the Saligue phone app (the Capacitor shell) rather than on the website.
 *
 * Used where the two must behave differently for a store rule: coins, for example, are not sold inside the
 * app, because Apple and Google require their own billing for digital currency spent in an app.
 */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { Capacitor?: { isNativePlatform?: () => boolean } };
  return w.Capacitor?.isNativePlatform?.() === true;
}

/**
 * Opens a link where it can actually work: the phone's own browser, when we are inside the app.
 *
 * Inside the app every page is drawn in a WebView, which has no tabs and cannot save a file — so the APK that
 * updates the app, and the download page that carries it, did nothing at all when tapped. `capacitor.config.ts`
 * sets no `server.allowNavigation`, and Capacitor's documented default is that external addresses (anything
 * outside the app's own `https://localhost`) open in the external browser. That is the road
 * src/components/native-links.tsx already sends WhatsApp, maps and other sites down. The site's own address is
 * external to the app, so a download takes it too and the browser installs the update the way this window cannot.
 *
 * On the website this is simply a navigation, so the same call is right on both.
 */
export function openInBrowser(url: string): void {
  if (typeof window === 'undefined') return;
  window.location.href = url;
}
