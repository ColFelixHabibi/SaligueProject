
'use client';

import { useEffect } from 'react';
import { BASE_PATH } from '@/lib/paths';

// Registers the service worker so the site can be installed as an app on Android and iOS.
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` }).catch((error) => {
      console.error('Service worker registration failed:', error);
    });
  }, []);
  return null;
}
