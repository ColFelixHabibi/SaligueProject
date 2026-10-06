
'use client';

import { create } from 'zustand';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

export type UserRole = 'seller' | 'buyer';

interface UserRoleState {
  role: UserRole;
  // Role picked in the login/register dialog, applied to the account once sign-in completes.
  pendingRole: UserRole | null;
  isInitialized: boolean;
  setRole: (role: UserRole) => void;
}

export const useUserRoleStore = create<UserRoleState>()((set) => ({
  role: 'buyer', // Default role
  pendingRole: null,
  isInitialized: false,
  setRole: (role) => {
    set({ role });
    const uid = auth.currentUser?.uid;
    if (uid) {
      setDoc(doc(db, 'users', uid), { role }, { merge: true }).catch((error) =>
        console.error('Failed to save role:', error)
      );
    } else {
      set({ pendingRole: role });
    }
  },
}));
