'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, getToken, mediaUrl, setToken } from '@/lib/api';
import { currentAccount, onAccountChange, startGuestSession, type AccountChange, type AccountUser } from '@/lib/auth-actions';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { subscribeToWishlist } from '@/hooks/use-wishlist';
import { subscribeToCart } from '@/hooks/use-cart-store';
import { subscribeToNotifications } from '@/hooks/use-notification-store';
import { subscribeToLikes } from '@/hooks/use-likes';
import { subscribeToResaligues } from '@/hooks/use-resaligues';
import { subscribeToProducts } from '@/hooks/use-product-store';
import { subscribeToMessages } from '@/lib/messages';
import { useToast } from '@/hooks/use-toast';
import { refreshPush } from '@/lib/push';
import { RefreshCw, WifiOff } from 'lucide-react';
import { Skeleton } from '../ui/skeleton';

export type AppUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  username?: string | null;
  photoURL: string | null;
};

interface AuthContextType {
  // The signed-in account, or null for visitors (who still have a silent guest account for likes, saves and cart).
  user: AppUser | null;
  // The current account's id, guests included.
  authUid: string | null;
  role: 'seller' | 'buyer';
  isAuthLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, authUid: null, role: 'buyer', isAuthLoading: true });

/** Shown instead of a loader that never ends: Saligue could not be reached at start. */
function CannotReach({ onRetry }: { onRetry: () => void }) {
  const signedIn = !!getToken();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <WifiOff className="h-12 w-12 text-primary" />
      <p className="text-lg font-bold">Saligue can’t be reached</p>
      <p className="max-w-sm text-sm text-muted-foreground">Check your connection, or switch between Wi-Fi and mobile data.{signedIn && ' You are still signed in.'}</p>
      <button type="button" onClick={onRetry} className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-semibold text-primary-foreground">
        <RefreshCw className="h-4 w-4" /> Try again
      </button>
    </div>
  );
}

function FullPageLoader() {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <header className="sticky top-0 flex h-16 items-center gap-4 border-b bg-background px-4 md:px-6">
        <Skeleton className="h-8 w-32" /><div className="flex-1" /><Skeleton className="h-8 w-8 rounded-full" />
      </header>
      <main className="flex-1 p-8"><Skeleton className="h-[125px] w-full rounded-xl" /></main>
    </div>
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [authUid, setAuthUid] = useState<string | null>(null);
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  // Start-up could not reach the server (offline, or a request that stalled): a Retry screen, not an endless loader.
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { role } = useUserRoleStore();
  const { toast } = useToast();

  useEffect(() => subscribeToProducts(), []);

  useEffect(() => {
    let active = true;
    let currentId: string | null = null;
    let stopUserData = () => {};

    const apply = (account: AccountUser, change?: AccountChange) => {
      if (!active) return;
      if (account.id !== currentId) {
        currentId = account.id;
        stopUserData();
        const stopCart = subscribeToCart(account.id);
        const stopWishlist = subscribeToWishlist(account.id);
        const stopLikes = subscribeToLikes(account.id);
        const stopResaligues = subscribeToResaligues(account.id);
        const stopNotifications = subscribeToNotifications(account.id);
        const stopMessages = subscribeToMessages(account.id);
        stopUserData = () => {
          stopNotifications();
          stopMessages();
          stopCart();
          stopWishlist();
          stopLikes();
          stopResaligues();
        };
      }
      useUserRoleStore.setState({ role: account.role, official: account.official, admin: !!account.admin, shop: account.shop, avatar: mediaUrl(account.avatar ?? undefined) ?? null, pendingRole: null, isInitialized: true });
      setAuthUid(account.id);
      setUser(account.isGuest ? null : { uid: account.id, email: account.email, displayName: account.displayName, username: account.username ?? null, photoURL: mediaUrl(account.avatar ?? undefined) ?? null });
      setIsAuthLoading(false);
      setUnreachable(false);
      if (!account.isGuest) void refreshPush();
      if (change === 'registered' || change === 'signed-in') {
        // Straight to their own dashboard, unless they were in the middle of something (paying, starting a shop).
        const path = window.location.pathname.replace(/\/+$/, '');
        if (!/\/(checkout|cart|sell|payment|verify|invite)$/.test(path)) routerRef.current.push(account.role === 'seller' ? '/dashboard' : '/my-account');
        toast({
          title: change === 'registered' ? 'Welcome to Saligue!' : 'Welcome back!',
          description: `Signed in as ${account.displayName || account.email}.`,
        });
      }
    };

    // The server could not be reached (status 0: offline or timed out), as opposed to answering "no".
    const offline = (error: unknown) => error instanceof ApiError && error.status === 0;

    const startAsGuest = async () => {
      try {
        apply(await startGuestSession());
      } catch (error) {
        console.error('Could not start a guest session:', error);
        if (offline(error) && active) {
          setUnreachable(true);
          return;
        }
        useUserRoleStore.setState({ isInitialized: true });
        setIsAuthLoading(false);
      }
    };

    // Restore the saved session, or start a guest one.
    (async () => {
      if (getToken()) {
        try {
          apply(await currentAccount());
          return;
        } catch (error) {
          // Only a server that answered "not signed in" ends the session. A bad connection keeps it:
          // it used to sign people out whenever the network failed at the wrong moment.
          if (offline(error)) {
            if (active) setUnreachable(true);
            return;
          }
          setToken(null);
        }
      }
      await startAsGuest();
    })();

    const stopListening = onAccountChange((account, change) => {
      if (account) apply(account, change);
      else void startAsGuest(); // Logged out: continue as a guest.
    });

    return () => {
      active = false;
      stopListening();
      stopUserData();
    };
  }, [toast, attempt]);

  if (unreachable) return <CannotReach onRetry={() => { setUnreachable(false); setAttempt((n) => n + 1); }} />;
  if (isAuthLoading) return <FullPageLoader />;
  return <AuthContext.Provider value={{ user, authUid, role, isAuthLoading }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
