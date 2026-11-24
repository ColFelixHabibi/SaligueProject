'use client';

import { api, serverOrigin, setToken } from './api';
import { openInBrowser } from './native';
import type { Shop } from './types';

export type AccountUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  username?: string | null;
  commentMode?: 'everyone' | 'followers' | 'off';
  hiddenWords?: string[];
  role: 'buyer' | 'seller';
  official: boolean;
  // Can open Platform settings (email, payments, try-on).
  admin?: boolean;
  shop: Shop | null;
  // Profile photo (/media/… link). Sellers need one before listing.
  avatar: string | null;
  isGuest: boolean;
  // Two-step sign-in by email is on for this account (a code is asked for at sign-in).
  twoFactor?: boolean;
  createdAt: string;
};

type Session = { token: string; user: AccountUser; isNew?: boolean };

/** What the server answers instead of a session when an account signs in with two-step sign-in on. */
export type TwoFactorChallenge = { ticket: string; email: string; minutes: number };
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
  const session = await api<Session>('/auth/guest', { method: 'POST', timeoutMs: 15_000 });
  setToken(session.token);
  return session.user;
}

export async function currentAccount() {
  return (await api<{ user: AccountUser }>('/auth/me', { timeoutMs: 15_000 })).user;
}

/** Creates an account. A guest keeps everything they liked, saved and ordered. `birthDate` is `YYYY-MM-DD` (16+). */
export async function registerWithEmail(name: string, email: string, password: string, role: 'buyer' | 'seller', acceptTerms: boolean, birthDate: string) {
  // Invited with a link (?ref=…, remembered by InviteCatcher): tells Saligue who brought this person.
  let ref: string | null = null;
  try { ref = localStorage.getItem('saligue-ref'); } catch { /* storage blocked */ }
  const session = await api<Session>('/auth/register', { body: { name, email, password, role, acceptTerms, birthDate, ref } });
  setToken(session.token);
  emit(session.user, 'registered');
}

/**
 * Signs in with email and password. Returns `null` when that was the whole sign-in, or the challenge to answer when
 * the account has two-step sign-in on: the code is in its inbox, and `completeTwoFactor` finishes it.
 */
export async function loginWithEmail(email: string, password: string, role?: 'buyer' | 'seller') {
  const answer = await api<Session | { twoFactor: TwoFactorChallenge }>('/auth/login', { body: { email, password, role } });
  if ('twoFactor' in answer) return answer.twoFactor;
  setToken(answer.token);
  emit(answer.user, 'signed-in');
  return null;
}

/** The second step of signing in: the six digits from the email. Only now is the session made. */
export async function completeTwoFactor(challenge: TwoFactorChallenge, code: string) {
  const session = await api<Session>('/auth/login/code', { body: { ticket: challenge.ticket, code } });
  setToken(session.token);
  emit(session.user, 'signed-in');
}

/** Whether two-step sign-in is on for this account, and whether the server can send email at all (`ready`). */
export async function twoFactorStatus() {
  return api<{ on: boolean; email: string | null; ready: boolean }>('/me/two-factor');
}

/** Mails a code that turns two-step sign-in on or off; `confirmTwoFactor` then answers with it. */
export async function askTwoFactor(on: boolean) {
  return api<{ ticket: string; email: string; minutes: number }>('/me/two-factor', { body: { on } });
}

/** Turns two-step sign-in on or off, once the code from the email is in. */
export async function confirmTwoFactor(ticket: string, code: string, on: boolean) {
  const { user } = await api<{ on: boolean; user: AccountUser }>('/me/two-factor/confirm', { body: { ticket, code, on } });
  emit(user, 'updated');
  return user;
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

export async function updateAccount(changes: { displayName?: string; username?: string; commentMode?: 'everyone' | 'followers' | 'off'; hiddenWords?: string[]; role?: 'buyer' | 'seller'; shop?: Shop; avatar?: string | null; bio?: string; password?: string; currentPassword?: string }) {
  // A new profile photo travels inside the body, so this is given longer than a usual call.
  const { user } = await api<{ user: AccountUser }>('/auth/me', { method: 'PATCH', body: changes, timeoutMs: 60_000 });
  emit(user, 'updated');
  return user;
}

/** The Google OAuth client ID set on the server, or null when Google sign-in is not switched on. */
export async function googleClientId() {
  return (await api<{ clientId: string | null }>('/auth/google')).clientId;
}

/**
 * Signs in (or creates the account) with the ID token from Google's sign-in button. A new account has to state its
 * date of birth in the same dialog (`birthDate`, `YYYY-MM-DD`); an account that already did is never asked again.
 */
export async function loginWithGoogle(credential: string, role?: 'buyer' | 'seller', birthDate?: string) {
  const session = await api<Session>('/auth/google', { body: { credential, role, birthDate } });
  setToken(session.token);
  emit(session.user, session.isNew ? 'registered' : 'signed-in');
}

// Google sign-in for the phone apps (server: /api/auth/google/app). Google refuses to sign in inside the app's WebView,
// so the app keeps a secret, opens /app-signin in the phone's browser with its SHA-256, and gets back a one-time code
// (com.indeciana.saligue://signin?code=…) that only this secret can turn into a session.
const VERIFIER_KEY = 'saligue-google-verifier';
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** In the app: opens Google sign-in in the phone's browser. */
export async function startAppGoogleSignIn(role?: 'buyer' | 'seller') {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  localStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  // The address the app reaches the server by now (the tunnel): the fixed sslip.io one does not resolve on the
  // users' phones. It must be among the Google client's authorized origins, as it already is for the website.
  openInBrowser(`${serverOrigin() || window.location.origin}/app-signin/?challenge=${challenge}${role ? `&role=${role}` : ''}`);
}

/** In the browser page /app-signin: Google's token and the app's challenge become a one-time code for the app. */
export const googleCodeForApp = (credential: string, challenge: string, role?: 'buyer' | 'seller', birthDate?: string) =>
  api<{ code: string }>('/auth/google/app', { body: { credential, challenge, role, birthDate } }).then((r) => r.code);

/** In the app, when the browser hands the code back: signs in with it and the secret kept for it. */
export async function finishAppGoogleSignIn(code: string) {
  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw Object.assign(new Error('That sign-in has expired. Tap Continue with Google again.'), { code: 'code_expired' });
  localStorage.removeItem(VERIFIER_KEY);
  const session = await api<Session>('/auth/google/app/redeem', { body: { code, verifier } });
  setToken(session.token);
  emit(session.user, session.isNew ? 'registered' : 'signed-in');
}
