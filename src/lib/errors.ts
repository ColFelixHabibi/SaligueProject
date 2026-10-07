
// Plain-language messages for errors shown to users. Never exposes service names or error codes.
const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/user-not-found': 'No account uses this email. Create an account instead.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/missing-password': 'Please enter your password.',
  'auth/email-already-in-use': 'An account with this email already exists. Log in instead.',
  'auth/credential-already-in-use': 'This account is already registered. Log in instead.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/network-request-failed': 'No internet connection. Check your network and try again.',
  'auth/user-disabled': 'This account has been disabled. Please contact support.',
  'auth/requires-recent-login': 'For your security, please log in again and retry.',
  'auth/unauthorized-domain': 'Google sign-in is not available on this address yet. Please use email and password.',
  'auth/operation-not-allowed': 'This sign-in method is not available right now.',
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Please allow pop-ups and try again.',
  'auth/account-exists-with-different-credential': 'This email is registered with a password. Log in with email and password.',
  'permission-denied': 'You do not have permission to do that.',
  unavailable: 'No internet connection. Check your network and try again.',
  'deadline-exceeded': 'The connection is slow. Please try again.',
  'resource-exhausted': 'Too many requests right now. Please try again shortly.',
};

export function friendlyError(error: unknown): string {
  const e = error as { code?: string; message?: string; name?: string } | undefined;
  if (e?.code && MESSAGES[e.code]) return MESSAGES[e.code];
  // Errors from services carry technical codes; our own errors are already written for people.
  if (e?.code || e?.name === 'FirebaseError' || /firebase|\(auth\//i.test(e?.message ?? '')) {
    return 'Something went wrong. Please try again.';
  }
  if (e?.message === 'Failed to fetch') return 'No internet connection. Check your network and try again.';
  return e?.message || 'Something went wrong. Please try again.';
}
