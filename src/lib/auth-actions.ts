'use client';

import { api, setToken } from './api';
import type { Shop } from './types';

export type AccountUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  role: 'buyer' | 'seller';
  official: boolean;
  shop: Shop | null;
  // Profile photo (/media/… link). Sellers need one before listing.
  avatar: string | null;
  isGuest: boolean;
  createdAt: string;
};

type Session = { token: string; user: AccountUser; isNew?: boolean };
export type AccountChange = 'signed-in' | 'registered' | 'updated' | 'signed-out';

// Notified whenever the signed-in account changes (login, register, logout, profile updates).
const accountListeners = new Set<(user: AccountUser | null, change: AccountChange) => void>();
export function onAccountChange(listener: (user: AccountUser | null, change: AccountChange) => void) {
  accountListeners.add(listener);
  return () => {
    accountListeners.delete(listener);
  };
}
const emit = (user: AccountUser | null, change: AccountChange) => accountListeners.forEach((l) => l(user, change));

/** Every visitor gets a guest account, so likes, saves, cart and orders work without signing up. */
export async function startGuestSession() {
  const session = await api<Session>('/auth/guest', { method: 'POST' });
  setToken(session.token);
  return session.user;
}

export async function currentAccount() {
  return (await api<{ user: AccountUser }>('/auth/me')).user;
}

/** Creates an account. A guest keeps everything they liked, saved and ordered. */
export async function registerWithEmail(name: string, email: string, password: string, role: 'buyer' | 'seller', acceptTerms: boolean) {
  const session = await api<Session>('/auth/register', { body: { name, email, password, role, acceptTerms } });
  setToken(session.token);
  emit(session.user, 'registered');
}

export async function loginWithEmail(email: string, password: string, role?: 'buyer' | 'seller') {
  const session = await api<Session>('/auth/login', { body: { email, password, role } });
  setToken(session.token);
  emit(session.user, 'signed-in');
}

/** Emails a one-hour link to choose a new password (the answer doesn't reveal whether the email has an account). */
export async function requestPasswordReset(email: string) {
  await api('/auth/forgot', { body: { email } });
}

/** Sets the new password from the emailed link and signs in. */
export async function resetPassword(token: string, password: string) {
  const session = await api<Session>('/auth/reset', { body: { token, password } });
  setToken(session.token);
  emit(session.user, 'signed-in');
}

export async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  setToken(null);
  emit(null, 'signed-out');
}

export async function updateAccount(changes: { displayName?: string; role?: 'buyer' | 'seller'; shop?: Shop; avatar?: string | null; password?: string; currentPassword?: string }) {
  const { user } = await api<{ user: AccountUser }>('/auth/me', { method: 'PATCH', body: changes });
  emit(user, 'updated');
  return user;
}

/** The Google OAuth client ID set on the server, or null when Google sign-in is not switched on. */
export async function googleClientId() {
  return (await api<{ clientId: string | null }>('/auth/google')).clientId;
}

/** Signs in (or creates the account) with the ID token from Google's sign-in button. */
export async function loginWithGoogle(credential: string, role?: 'buyer' | 'seller') {
  const session = await api<Session>('/auth/google', { body: { credential, role } });
  setToken(session.token);
  emit(session.user, session.isNew ? 'registered' : 'signed-in');
}
