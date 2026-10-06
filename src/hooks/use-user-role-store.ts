
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type UserRole = 'seller' | 'buyer';

interface UserRoleState {
  role: UserRole;
  isInitialized: boolean;
  setRole: (role: UserRole) => void;
}

const getStorageKey = (uid?: string) => {
    return uid ? `user-role-storage-${uid}` : 'user-role-storage-anonymous';
}

export const useUserRoleStore = create(
  persist<UserRoleState>(
    (set) => ({
      role: 'buyer', // Default role
      isInitialized: false,
      setRole: (role) => set({ role }),
    }),
    {
      name: getStorageKey(),
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isInitialized = true;
        }
      },
    }
  )
);
