'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { getToken, setToken } from '@/lib/api';
import { currentAccount, onAccountChange, startGuestSession, type AccountChange, type AccountUser } from '@/lib/auth-actions';
import { useUserRoleStore } from '@/hooks/use-user-role-store';
import { subscribeToWishlist } from '@/hooks/use-wishlist';
import { subscribeToCart } from '@/hooks/use-cart-store';
import { subscribeToNotifications } from '@/hooks/use-notification-store';
import { subscribeToLikes } from '@/hooks/use-likes';
import { subscribeToProducts } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '../ui/skeleton';

export type AppUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
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
  const [isAuthLoading, setIsAuthLoading] = useState(true);
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
        const stopNotifications = subscribeToNotifications(account.id);
        stopUserData = () => {
          stopNotifications();
          stopCart();
          stopWishlist();
          stopLikes();
        };
      }
      useUserRoleStore.setState({ role: account.role, official: account.official, shop: account.shop, pendingRole: null, isInitialized: true });
      setAuthUid(account.id);
      setUser(account.isGuest ? null : { uid: account.id, email: account.email, displayName: account.displayName, photoURL: null });
      setIsAuthLoading(false);
      if (change === 'registered' || change === 'signed-in') {
        toast({
          title: change === 'registered' ? 'Welcome to Saligue!' : 'Welcome back!',
          description: account.role === 'seller' ? 'You are signed in as a seller.' : `Signed in as ${account.displayName || account.email}.`,
        });
      }
    };

    const startAsGuest = async () => {
      try {
        apply(await startGuestSession());
      } catch (error) {
        console.error('Could not start a guest session:', error);
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
        } catch {
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
  }, [toast]);

  if (isAuthLoading) return <FullPageLoader />;
  return <AuthContext.Provider value={{ user, authUid, role, isAuthLoading }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
