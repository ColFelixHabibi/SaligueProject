'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { isNativeApp, openInBrowser } from '@/lib/native';
import { absoluteUrl } from '@/lib/paths';

// Set by scripts/build-app.mjs: the version code of this Android app. Empty on the website.
const MINE = Number(process.env.NEXT_PUBLIC_APP_VERSION || 0);
const KEY = 'saligue-update-dismissed';

/** Inside the Android app: a banner when the server has a newer version, with a button to download it. */
export function AppUpdate() {
  const t = useT();
  const [latest, setLatest] = useState<{ versionCode: number; versionName: string; url: string } | null>(null);
  useEffect(() => {
    if (!MINE) return;
    api<typeof latest>('/app/version').then((v) => {
      let dismissed = 0;
      try {
        dismissed = Number(localStorage.getItem(KEY) || 0);
      } catch {
        // Storage blocked: always offer it.
      }
      if (v && v.versionCode > MINE && v.versionCode !== dismissed) setLatest(v);
    }).catch(() => {});
  }, []);
  if (!latest) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, String(latest.versionCode));
    } catch {
      // Storage blocked.
    }
    setLatest(null);
  };
  return (
    <div className="fixed inset-x-3 top-[calc(0.75rem+var(--sat))] z-[70] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-foreground p-3 text-background shadow-xl">
      <Download className="h-5 w-5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 text-sm"><b>Saligue {latest.versionName}</b> {t('is ready')}</span>
      {/* A WebView has no tabs and cannot save the file, so inside the app this link goes to the phone's browser:
          without that, tapping "Update" on an outdated app did nothing at all. */}
      <a
        href={latest.url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          if (!isNativeApp()) return;
          e.preventDefault();
          openInBrowser(latest.url);
        }}
        className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground"
      >{t('Update')}</a>
      <button type="button" onClick={close} aria-label={t('Later')} title={t('Later')} className="shrink-0 rounded-full p-1 opacity-70"><X className="h-4 w-4" /></button>
    </div>
  );
}

/** "Version 2.22 · about 35 MB": the newest app on the server (download page). The size comes from the file itself. */
export function AppVersion() {
  const [info, setInfo] = useState<{ versionName: string; bytes?: number } | null>(null);
  useEffect(() => void api<{ versionName: string; bytes?: number } | null>('/app/version')
    .then((v) => setInfo(v ? { versionName: v.versionName, bytes: v.bytes } : null))
    .catch(() => {}), []);
  const size = info?.bytes ? ` · about ${Math.round(info.bytes / 1_000_000)} MB` : '';
  return <>{info ? `Version ${info.versionName}${size}` : 'Latest version'}</>;
}

// A browser starts only one download on its own; without this, going back to the download page would ask for the
// 35 MB a second time. One tab, one automatic download — the button always works.
const AUTO_KEY = 'saligue-download-started';

// An iPhone and an iPad cannot install an APK: sending 35 MB of mobile data that cannot become an app is worse
// than the button they can ignore (the page tells them to use the website). Since iPadOS 13 an iPad reports itself
// as a Mac, which is what the second test catches.
const cannotInstallApk = () => typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/**
 * "Download the app", linked to the APK the Saligue server serves. `fallback` is the address baked in at build
 * time; once the page is open the link follows the address it was actually opened on, so the download still works
 * where the built-in name cannot be looked up (a network that refuses *.sslip.io) — the address a person can type
 * without any DNS is the bare IP. Inside the app absoluteUrl() keeps the built one, because there is no site on
 * https://localhost to download from.
 *
 * With `auto` the file is asked for as soon as the page opens, exactly as a tapped button would ask for it, so a
 * shared link gives the app at once and the install steps stay on screen while it downloads. Not inside the app:
 * that window is not a browser, the app is already installed, and the pages there are served from the phone. Not
 * on an iPhone either, which cannot install an APK (see cannotInstallApk).
 *
 * Inside the app the button hands the file to the phone's browser (openInBrowser), since this window cannot save it.
 */
export function DownloadApp({ path, fallback, auto = false }: { path: string; fallback: string; auto?: boolean }) {
  const [href, setHref] = useState(fallback);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const url = absoluteUrl(path);
    setHref(url);
    if (!auto || isNativeApp() || cannotInstallApk()) return;
    try {
      if (sessionStorage.getItem(AUTO_KEY) === url) return;
      sessionStorage.setItem(AUTO_KEY, url);
    } catch {
      // Storage blocked: the download may start again on a reload, which does no harm.
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Saligue.apk';
    link.rel = 'noreferrer';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setStarted(true);
  }, [auto, path]);
  return (
    <div className="space-y-2">
      <Button size="lg" className="h-14 w-full text-lg" asChild>
        <a
          href={href}
          download="Saligue.apk"
          rel="noreferrer"
          onClick={(e) => {
            if (!isNativeApp()) return;
            e.preventDefault();
            openInBrowser(href);
          }}
        ><Download className="mr-2 h-5 w-5" /> Download the app</a>
      </Button>
      {auto && (
        <p aria-live="polite" className="text-center text-sm text-muted-foreground">
          {started
            ? 'The download has started — watch your notifications. If nothing happened, tap the button above.'
            : 'Tap the button above if the download does not start by itself.'}
        </p>
      )}
    </div>
  );
}
