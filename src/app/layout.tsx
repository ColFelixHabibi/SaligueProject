
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import Header from '@/components/layout/header';
import Footer from '@/components/layout/footer';
import Sidebar from '@/components/layout/sidebar';
import { cn } from '@/lib/utils';
import { AuthProvider } from '@/components/auth/auth-provider';
import { PwaRegister } from '@/components/pwa-register';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const metadata: Metadata = {
  title: 'Saligue by INDECIANA',
  description: 'Drip? AI’s got you. See yourself wearing any item, then contact the owner.',
  manifest: `${basePath}/manifest.webmanifest`,
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={cn('font-body antialiased', 'min-h-screen bg-background text-foreground')}>
        <AuthProvider>
          <div className="relative flex min-h-screen flex-col">
            <Header />
            <Sidebar />
            <main className="flex-1 pb-16 md:pb-0 md:pl-[72px] lg:pl-60">{children}</main>
            <Footer />
          </div>
          <Toaster />
          <PwaRegister />
        </AuthProvider>
      </body>
    </html>
  );
}
