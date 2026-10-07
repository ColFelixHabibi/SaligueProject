
// Plain-language messages for errors shown to users. Never exposes service names or error codes.
const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  email_not_confirmed: 'Confirm your email before logging in.',
  user_already_exists: 'An account with this email already exists. Log in instead.',
  weak_password: 'Password must be at least 6 characters.',
  over_request_rate_limit: 'Too many attempts. Please wait a moment and try again.',
  provider_disabled: 'This sign-in method is not enabled in the Supabase project yet.',
  identity_already_exists: 'This Google account is already linked to another Saligue account. Log in with that account.',
  anonymous_provider_disabled: 'Guest browsing is not enabled in the Supabase project yet.',
  '42501': 'You do not have permission to do that.',
  over_email_send_rate_limit: 'Too many attempts. Please wait a moment and try again.',
  email_address_invalid: 'Please enter a valid email address.',
};

export function friendlyError(error: unknown): string {
  const e = error as { code?: string; message?: string; name?: string } | undefined;
  if (e?.code && MESSAGES[e.code]) return MESSAGES[e.code];
  // Errors from services carry technical codes; our own errors are already written for people.
  if (e?.code || /supabase/i.test(e?.message ?? '')) {
    return 'Something went wrong. Please try again.';
  }
  if (e?.message === 'Failed to fetch') return 'No internet connection. Check your network and try again.';
  return e?.message || 'Something went wrong. Please try again.';
}
