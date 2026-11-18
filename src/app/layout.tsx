
import { PageTranslator } from '@/components/page-translator';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import Header from '@/components/layout/header';
import Footer from '@/components/layout/footer';
import Sidebar from '@/components/layout/sidebar';
import { cn } from '@/lib/utils';
import { AuthProvider } from '@/components/auth/auth-provider';
import { PwaRegister } from '@/components/pwa-register';
import { CookieBanner } from '@/components/cookie-banner';
import { AppUpdate } from '@/components/app-update';
import { PresenceHeartbeat } from '@/components/presence-heartbeat';
import { BackButton } from '@/components/back-button';
import { ConfirmHost } from '@/components/confirm-dialog';
import { ShareHost } from '@/components/share-sheet';
import { LookPickerHost } from '@/components/look-picker';
import { Welcome } from '@/components/welcome';
import { NativeLinks } from '@/components/native-links';
import { AppLinks } from '@/components/app-links';
import { Safe } from '@/components/safe';
import { SplashGate } from '@/components/splash';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
// The site's own address, so a shared card's picture is a link WhatsApp and Facebook can fetch instead of a
// page-relative path they ignore.
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_API_URL || 'https://78-47-151-100.sslip.io').replace(/\/+$/, '');

// The Android app (Capacitor) writes the system bar sizes onto <html> as soon as the page shows, before React
// starts, and React then wipes them. This copies them into their own stylesheet the moment they arrive (and
// again whenever they change), so the top bar and bottom bar always clear the phone's own bars.
// Self-repair for a browser stuck on the loading screen: if the app has not started 20 s after the page loaded
// (window.__saligueStarted, set by PwaRegister once React runs), the site's caches are emptied, its service worker
// removed, and the page reloaded, once per visit. Inline, because broken cached app code could not run it.
const UNSTICK = `(function(){try{if(window.Capacitor)return;setTimeout(function(){try{if(window.__saligueStarted||sessionStorage.getItem('saligue-unstuck'))return;sessionStorage.setItem('saligue-unstuck','1');var jobs=[];if(window.caches)jobs.push(caches.keys().then(function(k){return Promise.all(k.filter(function(n){return n.indexOf('saligue-app-')===0}).map(function(n){return caches.delete(n)}))}));if(navigator.serviceWorker)jobs.push(navigator.serviceWorker.getRegistrations().then(function(r){return Promise.all(r.map(function(x){return x.unregister()}))}));Promise.all(jobs).then(function(){location.reload()},function(){location.reload()})}catch(e){}},20000)}catch(e){}})();`;

const KEEP_SAFE_AREA = `(function(){try{var s=document.createElement('style');s.id='saligue-safe-area';document.head.appendChild(s);var r=document.documentElement;function copy(){var t=r.style.getPropertyValue('--safe-area-inset-top'),b=r.style.getPropertyValue('--safe-area-inset-bottom');if(t||b)s.textContent=':root{--cap-sat:'+(t||'0px')+';--cap-sab:'+(b||'0px')+'}'}new MutationObserver(copy).observe(r,{attributes:true,attributeFilter:['style']});copy()}catch(e){}})();`;

// The opening screen: Saligue's logo and "by INDECIANA" while the app opens (components/splash.tsx takes it away).
// Drawn by CSS alone on <html> and <body> (their ::before and ::after), switched on by the class `s-open` that the
// script below puts on <html> before anything is painted. So it is on screen before any code has loaded, React never
// sees it (nothing to hydrate or mismatch), and nothing can be left behind. Once per opening: a reload in the same
// session skips it. If the app never starts, it still goes after six seconds.
const SPLASH_CSS = `html.s-open::before{content:"";position:fixed;inset:0;z-index:2147483000;background:#fff}
html.s-open::after{content:"S";position:fixed;z-index:2147483001;left:50%;top:calc(50% - 28px);width:96px;height:96px;margin:-48px 0 0 -48px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#e21376,#f04a2a);color:#fff;font:800 48px/1 Inter,system-ui,sans-serif;box-shadow:0 18px 40px -12px rgba(226,19,118,.55);animation:s-in .7s cubic-bezier(.2,.8,.2,1) both,s-beat 1.6s ease-in-out .8s infinite}
html.s-open body::before{content:"Saligue";position:fixed;z-index:2147483001;left:0;right:0;top:calc(50% + 44px);text-align:center;font:800 30px/1 Inter,system-ui,sans-serif;letter-spacing:-.02em;color:#1d1418;animation:s-up .6s ease .25s both}
html.s-open body::after{content:"by INDECIANA";position:fixed;z-index:2147483001;left:0;right:0;bottom:calc(36px + env(safe-area-inset-bottom,0px));text-align:center;font:700 11px/1 Inter,system-ui,sans-serif;letter-spacing:.32em;color:#e21376;animation:s-up .6s ease .45s both}
html.s-open.s-out::before,html.s-open.s-out::after,html.s-open.s-out body::before,html.s-open.s-out body::after{opacity:0;pointer-events:none;transition:opacity .45s ease}
@keyframes s-in{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes s-up{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}
@keyframes s-beat{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@media (prefers-color-scheme:dark){html.s-open::before{background:#120c0f}html.s-open body::before{color:#f6eaf0}}`;
const SPLASH = `(function(){var r=document.documentElement;function hide(){if(!r.classList.contains('s-open')||r.classList.contains('s-out'))return;r.classList.add('s-out');setTimeout(function(){r.classList.remove('s-open','s-out')},500)}window.__hideSplash=hide;try{if(sessionStorage.getItem('saligue-opened'))return}catch(e){}r.classList.add('s-open');window.__splashAt=Date.now();setTimeout(hide,6000)})();`;
const DESCRIPTION = 'Drip? AI’s got you. See yourself wearing any item, then contact the owner.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: 'Saligue by INDECIANA',
  description: DESCRIPTION,
  manifest: `${basePath}/manifest.webmanifest`,
  // A link shared into WhatsApp, Facebook, X or Telegram shows a card. Item, look, #tag, live, shop and lesson links
  // get their own card with their own picture from the server (server/index.mjs sharePreview); this is the one
  // everything else falls back to, so a shared page never arrives as a bare link.
  openGraph: {
    type: 'website',
    siteName: 'Saligue',
    title: 'Saligue by INDECIANA',
    description: DESCRIPTION,
    images: [{ url: `${basePath}/icons/icon-512.png`, alt: 'Saligue by INDECIANA' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Saligue by INDECIANA',
    description: DESCRIPTION,
    images: [`${basePath}/icons/icon-512.png`],
  },
  icons: {
    icon: `${basePath}/icons/icon-192.png`,
    apple: `${basePath}/icons/apple-touch-icon.png`,
  },
  appleWebApp: {
    capable: true,
    title: 'Saligue',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: '#e21376',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: SPLASH_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: SPLASH }} />
        <script dangerouslySetInnerHTML={{ __html: KEEP_SAFE_AREA }} />
        <script dangerouslySetInnerHTML={{ __html: UNSTICK }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={cn('font-body antialiased', 'min-h-screen bg-background text-foreground')}>
        {/* Outside AuthProvider: it tells the stuck-page watchdog the app started, even while sign-in is still loading. */}
        <PwaRegister />
        <AuthProvider>
          <div className="relative flex min-h-screen flex-col">
            {/* Each part of the frame stands on its own (components/safe.tsx): if one breaks, it steps aside for a
                moment instead of replacing the whole app with an error page. */}
            <Safe name="header"><Header /></Safe>
            <Safe name="sidebar"><Sidebar /></Safe>
            <main className="flex-1 pb-[calc(4rem+var(--sab))] md:pb-0 md:pl-[72px] lg:pl-60">{children}</main>
            <Safe name="footer"><Footer /></Safe>
          </div>
          <Safe name="toaster"><Toaster /></Safe>
          <Safe name="translator"><PageTranslator /></Safe>
          <Safe name="cookies"><CookieBanner /></Safe>
          <Safe name="update"><AppUpdate /></Safe>
          <Safe name="presence"><PresenceHeartbeat /></Safe>
          <Safe name="back"><BackButton /></Safe>
          <Safe name="confirm"><ConfirmHost /></Safe>
          <Safe name="share"><ShareHost /></Safe>
          <Safe name="look-picker"><LookPickerHost /></Safe>
          <Safe name="welcome"><Welcome /></Safe>
          <Safe name="native-links"><NativeLinks /></Safe>
          <Safe name="app-links"><AppLinks /></Safe>
          <SplashGate />
        </AuthProvider>
      </body>
    </html>
  );
}
