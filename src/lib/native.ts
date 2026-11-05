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
