'use client';

import { api } from './api';

// Push notifications for this device (server/push.mjs): web push in browsers and the installed web app,
// Firebase in the Android app. Turned on by the person (never asked without a tap); remembered on the device.

type Capacitor = { isNativePlatform?: () => boolean };
const native = () => typeof window !== 'undefined' && (window as { Capacitor?: Capacitor }).Capacitor?.isNativePlatform?.() === true;
const KEY = 'saligue-push';

export type PushState = 'on' | 'off' | 'blocked' | 'unsupported';

const remember = (on: boolean) => {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked.
  }
};
const remembered = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

const fromBase64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

async function server() {
  return api<{ webKey: string; app: boolean }>('/push');
}

export async function pushState(): Promise<PushState> {
  if (native()) {
    if (!(await server().catch(() => null))?.app) return 'unsupported';
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const p = await PushNotifications.checkPermissions();
    return p.receive === 'denied' ? 'blocked' : p.receive === 'granted' && remembered() ? 'on' : 'off';
  }
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

let nativeListening = false;
// Registering for push on Android without Firebase set up (no google-services.json in the app) is not an error the
// app can catch: Android closes the whole app, at every start once push was remembered as on. So the app registers
// only when the server says app push is set up (GET /push → app: true), and otherwise forgets it was on.
async function nativeRegister() {
  const support = await server().catch(() => null);
  if (!support?.app) {
    // Forgotten only when the server answered "no app push"; offline, it simply waits for the next start.
    if (support) remember(false);
    throw new Error('Notifications are not available in the app yet.');
  }
  const { PushNotifications } = await import('@capacitor/push-notifications');
  if (!nativeListening) {
    nativeListening = true;
    await PushNotifications.addListener('registration', (t) => void api('/push', { body: { kind: 'fcm', token: t.value } }).catch(() => {}));
    // Tapping a notification opens its page inside the app.
    await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      const url = String(a.notification.data?.url ?? '');
      try {
        const u = new URL(url);
        window.location.href = `${u.pathname}${u.search}${u.hash}`;
      } catch {
        // No link: stay where we are.
      }
    });
  }
  await PushNotifications.register();
}

/** Asks this device for permission (after a tap) and registers it. Returns the new state. */
export async function enablePush(): Promise<PushState> {
  if (native()) {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const p = await PushNotifications.requestPermissions();
    if (p.receive !== 'granted') return 'blocked';
    await nativeRegister();
    remember(true);
    return 'on';
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready);
  const { webKey } = await server();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(webKey) }));
  await api('/push', { body: { kind: 'web', subscription: sub.toJSON() } });
  remember(true);
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  remember(false);
  if (native()) {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.unregister().catch(() => {});
    return 'off';
  }
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (sub) {
    await api(`/push?target=${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'off';
}

/** After logging in on a device where push was on: register it for this account again (tokens change). */
export async function refreshPush() {
  if (!remembered()) return;
  try {
    if ((await pushState()) === 'off' && !native()) return;
    if (native()) await nativeRegister();
    else {
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      if (sub) await api('/push', { body: { kind: 'web', subscription: sub.toJSON() } });
    }
  } catch {
    // Not now: the next start tries again.
  }
}
