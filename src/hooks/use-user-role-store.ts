'use client';

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { Shop } from '@/lib/types';

export type UserRole = 'seller' | 'buyer';

interface UserRoleState {
  role: UserRole;
  pendingRole: UserRole | null;
  isInitialized: boolean;
  official: boolean;
  shop: Shop | null;
  setRole: (role: UserRole) => void;
}

export const useUserRoleStore = create<UserRoleState>()((set) => ({
  role: 'buyer',
  pendingRole: null,
  isInitialized: false,
  official: false,
  shop: null,
  setRole: (role) => {
    set({ role });
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        void supabase.from('profiles').update({ role }).eq('id', user.id)
          .then(({ error }) => { if (error) console.error('Failed to save role:', error); });
      } else {
        set({ pendingRole: role });
      }
    });
  },
}));
