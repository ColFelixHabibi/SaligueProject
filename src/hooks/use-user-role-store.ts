'use client';

import { create } from 'zustand';
import { getToken } from '@/lib/api';
import { updateAccount } from '@/lib/auth-actions';
import type { Shop } from '@/lib/types';

export type UserRole = 'seller' | 'buyer';

interface UserRoleState {
  role: UserRole;
  // Role picked in the login/register dialog, sent along when the visitor signs in.
  pendingRole: UserRole | null;
  isInitialized: boolean;
  // INDECIANA's official account(s), set with `node server/admin.mjs official <email>`.
  official: boolean;
  // The seller's shop profile with full address.
  shop: Shop | null;
  setRole: (role: UserRole) => void;
}

export const useUserRoleStore = create<UserRoleState>()((set) => ({
  role: 'buyer',
  pendingRole: null,
  isInitialized: false,
  official: false,
  shop: null,
  setRole: (role) => set({ role, pendingRole: role }),
}));

/** Saves a role change for a signed-in account (e.g. from settings). */
export async function saveRole(role: UserRole) {
  useUserRoleStore.setState({ role });
  if (getToken()) await updateAccount({ role });
}
