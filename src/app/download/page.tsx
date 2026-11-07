import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck, Smartphone } from 'lucide-react';
import { AppVersion, DownloadApp } from '@/components/app-update';
import { BASE_PATH } from '@/lib/paths';

export const metadata: Metadata = { title: 'Get the Saligue app' };

const APK = '/download/saligue.apk';
// The APK comes from the Saligue server (server/index.mjs), not from this static page: a full link to whichever
// address the site was built for, and a relative one (with the site's sub-path) only when none is known.
// DownloadApp replaces it with the address the page was opened on, so the file still downloads where the
// built-in name cannot be looked up (see src/components/app-update.tsx).
const SITE = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
const apkUrl = SITE ? `${SITE}${APK}` : `${BASE_PATH}${APK}`;

/** Download page for the Android app, with the steps Android asks for when installing from outside the Play Store. */
export default function DownloadPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <div className="space-y-2 text-center">
        <Smartphone className="mx-auto h-12 w-12 text-primary" />
        <h1 className="text-3xl font-extrabold tracking-tight">Saligue for Android</h1>
        <p className="text-muted-foreground"><AppVersion /> · Android 7 or newer</p>
      </div>
      <DownloadApp path={APK} fallback={apkUrl} />
      <ol className="space-y-3 rounded-2xl border bg-card p-5 text-sm leading-relaxed">
        <li><b>1. Open this page on your Android phone</b> (not a computer) and tap <b>Download the app</b>.</li>
        <li><b>2. Already have an older Saligue app?</b> Uninstall it first (hold its icon → Uninstall). Otherwise Android says “App not installed”.</li>
        <li><b>3. Open the downloaded file</b> (from the notification or Files → Downloads).</li>
        <li><b>4. Allow the install:</b> if Android asks, tap <b>Settings → Allow from this source</b>, then go back.</li>
        <li><b>5. If Play Protect warns</b> “Unknown app”, tap <b>More details → Install anyway</b>. Saligue is not on the Play Store yet, so Google doesn’t know it.</li>
        <li><b>6. Open Saligue</b> and allow the camera and microphone when you go live.</li>
      </ol>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        The app is signed by INDECIANA. On iPhone, use the website: open it in Safari and choose Share → Add to Home Screen.
      </p>
      <p className="text-center text-sm"><Link href="/" className="text-primary underline">Use Saligue in the browser instead</Link></p>
    </div>
  );
}
