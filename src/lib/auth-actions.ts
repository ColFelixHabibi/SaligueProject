'use client';

import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  linkWithPopup,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

// Every visitor gets a silent guest account so they can like, save, comment and shop without signing up.
// Registering upgrades that guest account in place, so their likes, saves and cart are kept.

export const isGuest = (user: User | null | undefined) => !user || user.isAnonymous;

// Called after an upgrade (the user object stays the same, so auth listeners don't fire).
let onUpgrade: (() => void) | null = null;
export function setUpgradeListener(listener: (() => void) | null) {
  onUpgrade = listener;
}

export async function registerWithEmail(name: string, email: string, password: string) {
  const current = auth.currentUser;
  let user: User;
  if (current?.isAnonymous) {
    user = (await linkWithCredential(current, EmailAuthProvider.credential(email, password))).user;
  } else {
    user = (await createUserWithEmailAndPassword(auth, email, password)).user;
  }
  await updateProfile(user, { displayName: name });
  await user.reload();
  onUpgrade?.();
}

export async function loginWithEmail(email: string, password: string) {
  await signInWithEmailAndPassword(auth, email, password);
}

export async function continueWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const current = auth.currentUser;
  if (current?.isAnonymous) {
    try {
      await linkWithPopup(current, provider);
      onUpgrade?.();
      return;
    } catch (error: any) {
      // This Google account already has a Saligue account: sign in to it instead.
      if (error.code === 'auth/credential-already-in-use') {
        const credential = GoogleAuthProvider.credentialFromError(error);
        if (credential) {
          await signInWithCredential(auth, credential);
          return;
        }
      }
      throw error;
    }
  }
  await signInWithPopup(auth, provider);
}
