'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
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
      <a href={latest.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground">{t('Update')}</a>
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

/**
 * "Download the app", linked to the APK the Saligue server serves. `fallback` is the address baked in at build
 * time; once the page is open the link follows the address it was actually opened on, so the download still works
 * where the built-in name cannot be looked up (a network that refuses *.sslip.io) — the address a person can type
 * without any DNS is the bare IP. Inside the app absoluteUrl() keeps the built one, because there is no site on
 * https://localhost to download from.
 */
export function DownloadApp({ path, fallback }: { path: string; fallback: string }) {
  const [href, setHref] = useState(fallback);
  useEffect(() => setHref(absoluteUrl(path)), [path]);
  return (
    <Button size="lg" className="h-14 w-full text-lg" asChild>
      <a href={href} download="Saligue.apk"><Download className="mr-2 h-5 w-5" /> Download the app</a>
    </Button>
  );
}
