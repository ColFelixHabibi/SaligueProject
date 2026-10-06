
'use client';

import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUserRoleStore, type UserRole } from '@/hooks/use-user-role-store';
import { subscribeToWishlist } from '@/hooks/use-wishlist';
import { subscribeToCart } from '@/hooks/use-cart-store';
import { subscribeToProducts } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '../ui/skeleton';

interface AuthContextType {
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
async function resolveRole(user: User, pendingRole: UserRole | null): Promise<UserRole> {
  const ref = doc(db, 'users', user.uid);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    const role = pendingRole ?? 'buyer';
    await setDoc(ref, { role, email: user.email, createdAt: serverTimestamp() });
    return role;
  }
  if (pendingRole && pendingRole !== snapshot.data().role) {
    await setDoc(ref, { role: pendingRole }, { merge: true });
    return pendingRole;
  }
  return snapshot.data().role === 'seller' ? 'seller' : 'buyer';
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
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => subscribeToProducts(), []);

  useEffect(() => {
    let isFirstCallback = true;
    let previousUser: User | null = null;
    let unsubscribeUserData = () => {};

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
        // A sign-in that happens after the page has loaded (not a restored session).
        const isFreshSignIn = !isFirstCallback && !previousUser && !!currentUser;
        isFirstCallback = false;
        previousUser = currentUser;

        unsubscribeUserData();
        const uid = currentUser?.uid ?? null;
        const stopCart = subscribeToCart(uid);
        const stopWishlist = subscribeToWishlist(uid);
        unsubscribeUserData = () => {
          stopCart();
          stopWishlist();
        };

        let currentRole: UserRole = 'buyer';
        if (currentUser) {
          try {
            currentRole = await resolveRole(currentUser, useUserRoleStore.getState().pendingRole);
          } catch (error) {
            console.error('Failed to load user profile:', error);
          }
        }
        useUserRoleStore.setState({ role: currentRole, pendingRole: null, isInitialized: true });

        if (currentUser && isFreshSignIn) {
           const isNewUser = currentUser.metadata.creationTime === currentUser.metadata.lastSignInTime;

            if (isNewUser) {
                 toast({
                    title: 'Account Created!',
                    description: `Welcome! You are signed up as a ${currentRole}.`,
                });
            } else {
                toast({
                    title: 'Login Successful!',
                    description: `Welcome back, ${currentUser.displayName}! You are logged in as a ${currentRole}.`,
                });
            }

          const dashboardPath = currentRole === 'seller' ? '/dashboard' : '/my-account';
          router.replace(dashboardPath);
        }

        setUser(currentUser);
        setIsAuthLoading(false);
    });

    return () => {
      unsubscribe();
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
