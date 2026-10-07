'use client';

import { requireSupabase, supabase } from './supabase';

export async function registerWithEmail(name: string, email: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user.is_anonymous) {
    const { error } = await supabase.auth.updateUser({
      email,
      data: { display_name: name },
    });
    if (error) throw error;
    return { confirmationRequired: true };
  }
  throw new Error('Guest sign-in is not ready yet. Refresh and try again.');
}

export async function loginWithEmail(email: string, password: string) {
  const { error } = await requireSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function continueWithGoogle() {
  const client = requireSupabase();
  const { data: { session } } = await client.auth.getSession();
  const options = {
    redirectTo: window.location.href,
    queryParams: { prompt: 'select_account' },
  };

  // Link Google to the anonymous session so its cart, likes and saved items stay
  // attached to the same user. Supabase requires identity linking to be enabled.
  const result = session?.user.is_anonymous
    ? await client.auth.linkIdentity({ provider: 'google', options })
    : await client.auth.signInWithOAuth({ provider: 'google', options });
  if (result.error) throw result.error;
  if (result.data.url) window.location.assign(result.data.url);
}

export async function logout() {
  const { error } = await requireSupabase().auth.signOut();
  if (error) throw error;
}
