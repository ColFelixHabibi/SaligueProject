
'use client';

import { onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import { setUpgradeListener } from '@/lib/auth-actions';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { createContext, useContext, useEffect, useState } from 'react';
import { useUserRoleStore, type UserRole } from '@/hooks/use-user-role-store';
import type { Shop } from '@/lib/types';
import { subscribeToWishlist } from '@/hooks/use-wishlist';
import { subscribeToCart } from '@/hooks/use-cart-store';
import { subscribeToLikes } from '@/hooks/use-likes';
import { subscribeToProducts } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '../ui/skeleton';

interface AuthContextType {
  // The signed-in account, or null for visitors (who still have a silent guest account for likes, saves and cart).
  user: User | null;
  role: 'seller' | 'buyer';
  isAuthLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: 'buyer',
  isAuthLoading: true,
});

// Loads the user's role from Firestore, creating their profile on first sign-in.
// A role picked in the login/register dialog overrides the saved one.
type Profile = { role: UserRole; official: boolean; shop: Shop | null };

async function resolveProfile(user: User, pendingRole: UserRole | null): Promise<Profile> {
  const ref = doc(db, 'users', user.uid);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    const role = pendingRole ?? 'buyer';
    await setDoc(ref, { role, email: user.email ?? null, createdAt: serverTimestamp() });
    return { role, official: false, shop: null };
  }
  const data = snapshot.data();
  let role: UserRole = data.role === 'seller' ? 'seller' : 'buyer';
  if (pendingRole && pendingRole !== role) {
    await setDoc(ref, { role: pendingRole }, { merge: true });
    role = pendingRole;
  }
  if (user.email && data.email !== user.email) {
    // A guest who just registered: record their email on the profile.
    await setDoc(ref, { email: user.email }, { merge: true });
  }
  return { role, official: data.official === true, shop: data.shop ?? null };
}

function FullPageLoader() {
    return (
        <div className="flex min-h-screen w-full flex-col">
            <header className="sticky top-0 flex h-16 items-center gap-4 border-b bg-background px-4 md:px-6">
                <Skeleton className="h-8 w-32" />
                <div className="flex-1"></div>
                <Skeleton className="h-8 w-8 rounded-full" />
            </header>
            <main className="flex-1 p-8">
                <div className="flex flex-col space-y-3">
                    <Skeleton className="h-[125px] w-full rounded-xl" />
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-[250px]" />
                        <Skeleton className="h-4 w-[200px]" />
                    </div>
                </div>
            </main>
        </div>
    );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const { role, isInitialized: isRoleInitialized } = useUserRoleStore();
  const { toast } = useToast();

  useEffect(() => subscribeToProducts(), []);

  useEffect(() => {
    let isFirstCallback = true;
    // Previous account as (uid, registered) so we notice logins and guest upgrades.
    let previous: { uid: string; registered: boolean } | null = null;
    let unsubscribeUserData = () => {};

    const handle = async (currentUser: User | null) => {
      if (!currentUser) {
        // No account on this device yet: create a silent guest so likes, saves and cart work right away.
        previous = null;
        isFirstCallback = false;
        setUser(null);
        useUserRoleStore.setState({ role: 'buyer', official: false, shop: null, isInitialized: true });
        setIsAuthLoading(false);
        signInAnonymously(auth).catch((error) => console.error('Guest sign-in failed:', error));
        return;
      }

      const registered = !currentUser.isAnonymous;
      // Logged in or created an account after the page loaded (not a restored session).
      const isFreshSignIn = !isFirstCallback && registered && !previous?.registered;
      const uidChanged = previous?.uid !== currentUser.uid;
      const upgradedGuest = !uidChanged && previous?.registered === false && registered;
      isFirstCallback = false;
      previous = { uid: currentUser.uid, registered };

      if (uidChanged) {
        unsubscribeUserData();
        const stopCart = subscribeToCart(currentUser.uid);
        const stopWishlist = subscribeToWishlist(currentUser.uid);
        const stopLikes = subscribeToLikes(currentUser.uid);
        unsubscribeUserData = () => {
          stopCart();
          stopWishlist();
          stopLikes();
        };
      }

      let profile: Profile = { role: 'buyer', official: false, shop: null };
      try {
        profile = await resolveProfile(currentUser, registered ? useUserRoleStore.getState().pendingRole : null);
      } catch (error) {
        console.error('Failed to load user profile:', error);
      }
      useUserRoleStore.setState({ ...profile, pendingRole: null, isInitialized: true });

      if (isFreshSignIn) {
        const isNewUser = upgradedGuest || currentUser.metadata.creationTime === currentUser.metadata.lastSignInTime;
        toast({
          title: isNewUser ? 'Welcome to Saligue!' : 'Welcome back!',
          description: profile.role === 'seller' ? 'You are signed in as a seller.' : `Signed in as ${currentUser.displayName || currentUser.email}.`,
        });
      }

      setUser(registered ? currentUser : null);
      setIsAuthLoading(false);
    };

    const unsubscribe = onAuthStateChanged(auth, handle);
    // Upgrading a guest keeps the same account object, so listen for that explicitly.
    setUpgradeListener(() => handle(auth.currentUser));

    return () => {
      unsubscribe();
      setUpgradeListener(null);
      unsubscribeUserData();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finalIsLoading = isAuthLoading || !isRoleInitialized;

  const value = {
    user,
    role,
    isAuthLoading: finalIsLoading,
  };
  
  if (finalIsLoading) {
    return <FullPageLoader />;
  }

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
