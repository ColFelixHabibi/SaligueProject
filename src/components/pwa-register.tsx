
'use client';

import { useEffect } from 'react';
import { BASE_PATH } from '@/lib/paths';
import { watchErrors } from '@/lib/report-error';

// Registers the service worker so the site can be installed as an app on Android and iOS.
export function PwaRegister() {
  // The app runs: the stuck-page watchdog in layout.tsx (UNSTICK) stands down.
  useEffect(() => {
    (window as { __saligueStarted?: boolean }).__saligueStarted = true;
  }, []);
  useEffect(() => watchErrors(), []);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    // Inside the Android/iOS app the files are already on the device.
    if ((window as any).Capacitor?.isNativePlatform?.()) return;
    navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` }).catch((error) => {
      console.error('Service worker registration failed:', error);
    });
  }, []);
  return null;
}
