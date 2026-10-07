'use client';

import type { User as SupabaseUser } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useUserRoleStore, type UserRole } from '@/hooks/use-user-role-store';
import type { Shop } from '@/lib/types';
import { subscribeToWishlist } from '@/hooks/use-wishlist';
import { subscribeToCart } from '@/hooks/use-cart-store';
import { subscribeToLikes } from '@/hooks/use-likes';
import { subscribeToProducts } from '@/hooks/use-product-store';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '../ui/skeleton';

export type AppUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  isAnonymous: boolean;
  metadata: { creationTime: string; lastSignInTime: string };
};

interface AuthContextType {
  user: AppUser | null;
  authUid: string | null;
  role: 'seller' | 'buyer';
  isAuthLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, authUid: null, role: 'buyer', isAuthLoading: true });

function appUser(user: SupabaseUser): AppUser {
  const meta = user.user_metadata ?? {};
  return {
    uid: user.id,
    email: user.email ?? null,
    displayName: meta.display_name ?? meta.full_name ?? meta.name ?? null,
    photoURL: meta.avatar_url ?? meta.picture ?? null,
    isAnonymous: user.is_anonymous === true,
    metadata: {
      creationTime: user.created_at,
      lastSignInTime: user.last_sign_in_at ?? user.created_at,
    },
  };
}

async function resolveProfile(user: SupabaseUser, pendingRole: UserRole | null) {
  const { data, error } = await supabase.from('profiles')
    .select('role, official, shop')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;

  if (!data) {
    const role = pendingRole ?? 'buyer';
    const { error: insertError } = await supabase.from('profiles').insert({
      id: user.id,
      email: user.email ?? null,
      role,
      official: false,
    });
    if (insertError) throw insertError;
    return { role, official: false, shop: null as Shop | null };
  }

  let role: UserRole = data.role === 'seller' ? 'seller' : 'buyer';
  if (pendingRole && pendingRole !== role) {
    const { error: updateError } = await supabase.from('profiles').update({ role: pendingRole }).eq('id', user.id);
    if (updateError) throw updateError;
    role = pendingRole;
  }
  if (user.email) await supabase.from('profiles').update({ email: user.email }).eq('id', user.id);
  return { role, official: data.official === true, shop: (data.shop as Shop | null) ?? null };
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
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const { role, isInitialized: isRoleInitialized } = useUserRoleStore();
  const { toast } = useToast();

  useEffect(() => subscribeToProducts(), []);

  useEffect(() => {
    let previous: { id: string; registered: boolean } | null = null;
    let firstEvent = true;
    let stopUserData = () => {};
    let active = true;

    const handle = async (current: SupabaseUser | null, event: string) => {
      if (!active) return;
      if (!current) {
        stopUserData();
        previous = null;
        setUser(null);
        setAuthUid(null);
        useUserRoleStore.setState({ role: 'buyer', official: false, shop: null, isInitialized: true });
        setIsAuthLoading(false);
        if (isSupabaseConfigured && (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT')) {
          const { error } = await supabase.auth.signInAnonymously();
          if (error) console.error('Guest sign-in failed:', error);
        }
        firstEvent = false;
        return;
      }

      const registered = current.is_anonymous !== true;
      const uidChanged = previous?.id !== current.id;
      const isFreshSignIn = !firstEvent && registered && !previous?.registered;
      firstEvent = false;
      previous = { id: current.id, registered };
      setAuthUid(current.id);

      if (uidChanged) {
        stopUserData();
        const stopCart = subscribeToCart(current.id);
        const stopWishlist = subscribeToWishlist(current.id);
        const stopLikes = subscribeToLikes(current.id);
        stopUserData = () => { stopCart(); stopWishlist(); stopLikes(); };
      }

      try {
        const profile = await resolveProfile(current, registered ? useUserRoleStore.getState().pendingRole : null);
        if (!active) return;
        useUserRoleStore.setState({ ...profile, pendingRole: null, isInitialized: true });
      } catch (error) {
        console.error('Failed to load user profile:', error);
        useUserRoleStore.setState({ role: 'buyer', official: false, shop: null, pendingRole: null, isInitialized: true });
      }

      setUser(registered ? appUser(current) : null);
      setIsAuthLoading(false);
      if (isFreshSignIn && registered) {
        const name = current.user_metadata?.display_name ?? current.user_metadata?.full_name ?? current.email;
        toast({
          title: current.created_at === current.last_sign_in_at ? 'Welcome to Saligue!' : 'Welcome back!',
          description: useUserRoleStore.getState().role === 'seller' ? 'You are signed in as a seller.' : `Signed in as ${name ?? 'your account'}.`,
        });
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Defer Supabase queries until its auth callback has returned.
      queueMicrotask(() => { void handle(session?.user ?? null, event); });
    });
    return () => {
      active = false;
      subscription.unsubscribe();
      stopUserData();
    };
  }, [toast]);

  const finalIsLoading = isAuthLoading || !isRoleInitialized;
  if (finalIsLoading) return <FullPageLoader />;
  return <AuthContext.Provider value={{ user, authUid, role, isAuthLoading: finalIsLoading }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
